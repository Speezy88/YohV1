/**
 * src/app/run-research-job.ts
 *
 * Story 11.3 (E11-R9, R10, R12, R13, R15): the background research runner's job logic. One call claims
 * one queued job, searches, files the answer to the Research Vault (a direct write, like "save that"),
 * and records the outcome plus an in-app notification in one transaction. A failure is never reported
 * as ready, and a job is never re-run: interrupted jobs are failed at startup. No push, no model call.
 */
import { claimNextResearchJob, listRunningResearchJobs, markResearchJobDoneInTx, markResearchJobFailedInTx, type ResearchJob } from "../adapters/job-store.ts";
import type { LogEntry } from "../adapters/logger.ts";
import { appendOutboxInTx, createNotificationInTx } from "../adapters/notification-store.ts";
import { createPage } from "../adapters/notion-adapter.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { errorCopy, errorCopyForThrown } from "../core/error-copy.ts";
import { researchTopic, researchVaultProperties } from "../core/research-vault-properties.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { Result, YohError } from "../types/domain.ts";
import type { NotionCreatePageBindingFn } from "./create-item.ts";
import { RESEARCH_TOPIC } from "./save-search-result.ts";
import type { SearchFn } from "./web-search.ts";

/** How often the server's runner looks for a queued job (E11-R9). */
export const RESEARCH_JOB_POLL_INTERVAL_MS = 3000;

const EMPTY_RESULT_COPY = "The search didn't find anything useful.";
const INTERRUPTED_COPY = "Meeseek restarted before it finished. It may already be on Research Hub; if not, send /research again.";
const FILED_NOT_RECORDED_COPY = "It was filed, but Meeseek couldn't record it. Check Research Hub.";
const SEARCH_TIMEOUT_COPY = "The search took too long.";

/** The longest the runner waits for one search before failing the job (E11 review M5). */
export const RESEARCH_SEARCH_TIMEOUT_MS = 120_000;

export interface RunResearchJobDeps {
  readonly connection: SqliteConnection;
  readonly searchFn: SearchFn;
  readonly getNotionCreatePageBinding: NotionCreatePageBindingFn;
  readonly timeZone: string;
  readonly now: () => Date;
  readonly log?: (entry: LogEntry) => void;
  /** Test seam: overrides `RESEARCH_SEARCH_TIMEOUT_MS`. */
  readonly searchTimeoutMs?: number;
}

export type RunNextResearchJobOutput = { readonly ran: false } | { readonly ran: true; readonly outcome: "done" | "failed" };

/** Marks the job failed and raises "Couldn't finish research", in one transaction. */
function failJob(deps: RunResearchJobDeps, job: ResearchJob, text: string, pageId?: string): void {
  const finishedAt = deps.now().toISOString();
  deps.connection.writeTx((tx) => {
    markResearchJobFailedInTx(tx, job.id, { error: text, finishedAt, ...(pageId ? { pageId } : {}) });
    const topic = researchTopic(job.question);
    createNotificationInTx(tx, {
      kind: "research-failed",
      title: pageId ? `Research filed, but not recorded: ${topic}` : `Couldn't finish research: ${topic}`,
      body: text,
      deepLink: pageId ? `research:${pageId}` : "chat",
      createdAt: finishedAt,
    });
    if (pageId) appendOutboxInTx(tx, { topic: RESEARCH_TOPIC, entityId: pageId });
  });
}

/** Search and file one claimed job. Returns the failure copy, or the created page id. */
async function searchAndFile(deps: RunResearchJobDeps, job: ResearchJob): Promise<{ readonly pageId: string } | { readonly failure: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), deps.searchTimeoutMs ?? RESEARCH_SEARCH_TIMEOUT_MS);
  });
  let searched: Awaited<ReturnType<SearchFn>> | "timeout";
  try {
    searched = await Promise.race([deps.searchFn(job.question), timedOut]);
  } finally {
    clearTimeout(timer);
  }
  if (searched === "timeout") return { failure: SEARCH_TIMEOUT_COPY };
  if (!searched.ok) return { failure: errorCopy(searched.error, { service: "web search" }) };
  const { answer, citations } = searched.value;
  if (!answer.trim() && citations.length === 0) return { failure: EMPTY_RESULT_COPY };

  const binding = deps.getNotionCreatePageBinding();
  if (!binding.ok) return { failure: errorCopy(binding.error, { service: "Notion" }) };
  const properties = researchVaultProperties({ query: job.question, answer, citations, searchDate: localIsoDate(deps.now(), deps.timeZone) });
  const created = await createPage(binding.value.client, binding.value.config, "ResearchVault", properties);
  if (!created.ok) return { failure: errorCopy(created.error, { service: "Notion" }) };
  return { pageId: created.value.pageId };
}

export async function runNextResearchJob(deps: RunResearchJobDeps, _input: Record<string, never>): Promise<Result<RunNextResearchJobOutput, YohError>> {
  // One runner and non-overlapping ticks: a row still `running` here is orphaned, so fail it like startup recovery does.
  const swept = await failInterruptedResearchJobs(deps, {});
  if (!swept.ok) return swept;
  let job: ResearchJob | undefined;
  try {
    job = claimNextResearchJob(deps.connection, deps.now().toISOString());
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: err instanceof Error ? err.message : String(err) } };
  }
  if (!job) return { ok: true, value: { ran: false } };

  let outcome: { readonly pageId: string } | { readonly failure: string };
  try {
    outcome = await searchAndFile(deps, job);
  } catch (err) {
    outcome = { failure: errorCopyForThrown(err) };
  }

  try {
    if ("pageId" in outcome) {
      const { pageId } = outcome;
      const finishedAt = deps.now().toISOString();
      deps.connection.writeTx((tx) => {
        markResearchJobDoneInTx(tx, job.id, { pageId, finishedAt });
        createNotificationInTx(tx, {
          kind: "research-ready",
          title: `Research ready: ${researchTopic(job.question)}`,
          body: "Open it on Research Hub.",
          deepLink: `research:${pageId}`,
          createdAt: finishedAt,
        });
        appendOutboxInTx(tx, { topic: RESEARCH_TOPIC, entityId: pageId });
      });
      return { ok: true, value: { ran: true, outcome: "done" } };
    }
    failJob(deps, job, outcome.failure);
    return { ok: true, value: { ran: true, outcome: "failed" } };
  } catch (err) {
    // The recording write itself failed: still try to end the job failed, never left running.
    // If the page was already filed, keep its id and say so.
    const filedPageId = "pageId" in outcome ? outcome.pageId : undefined;
    deps.log?.({ level: "error", event: "run-research-job.record-failed", detail: { message: err instanceof Error ? err.message : String(err) } });
    try {
      failJob(deps, job, filedPageId ? FILED_NOT_RECORDED_COPY : errorCopyForThrown(err), filedPageId);
      return { ok: true, value: { ran: true, outcome: "failed" } };
    } catch (inner) {
      deps.log?.({ level: "error", event: "run-research-job.fail-record-failed", detail: { message: inner instanceof Error ? inner.message : String(inner) } });
      return { ok: false, error: { kind: "unreachable", message: inner instanceof Error ? inner.message : String(inner) } };
    }
  }
}

/** Startup recovery (E11-R9): every job still `running` was interrupted by a restart. Failed, notified, never re-run. */
export async function failInterruptedResearchJobs(deps: RunResearchJobDeps, _input: Record<string, never>): Promise<Result<{ readonly failed: number }, YohError>> {
  try {
    const running = listRunningResearchJobs(deps.connection);
    for (const job of running) failJob(deps, job, INTERRUPTED_COPY);
    return { ok: true, value: { failed: running.length } };
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: err instanceof Error ? err.message : String(err) } };
  }
}
