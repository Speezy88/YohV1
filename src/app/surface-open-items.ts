/**
 * src/app/surface-open-items.ts
 *
 * Story 8.1 (C3/C4). `buildOpenItemQuestion` is the ONE call site that
 * fetches an FR-25 suggestion (impure — `llmClient`) and hands it to
 * `core/open-item-questions.ts`'s pure assemblers; every `app/answer-*.ts`
 * file calls it too, after mutating state, to build
 * `AnswerOpenItemResponse.next` — so "what's pending" is computed in exactly
 * one place (Controller Ruling 1), never duplicated between surfacing and
 * answering.
 */
import { clearInteractionRequest, getOpenInteractionRequest, getTaskFieldOverride, listOpenInteractionRequests, type MemoryStore, type StoredRecord } from "../adapters/memory-store.ts";
import { suggestFieldValue, type AnthropicMessagesClient } from "../adapters/llm-adapter.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import type { MemoryItemStore } from "../adapters/memory-item-store.ts";
import { memoryFolderLabel } from "../core/memory-folders.ts";
import { isOlderThanDays, RULE_PROPOSAL_TTL_DAYS } from "../core/proposal-ttl.ts";
import { changeSetIsStale } from "../core/chat-tools.ts";
import { RESEARCH_OFFER_KIND } from "../core/research-offer.ts";
import { CHANGE_SET_PROPOSAL_KIND } from "./apply-change-set.ts";
import { isProposalExpired } from "../core/reshuffle-preview.ts";
import { parsePlanningFieldValue } from "../core/planning-field-value.ts";
import { buildMemoryForgetQuestion } from "../core/open-item-questions.ts";
import {
  buildDataCompletenessQuestion,
  buildGenericQuestion,
  buildNightCloseOutQuestion,
  buildProposalQuestion,
  nextDataCompletenessQuestion,
  nextNightCloseOutTask,
  type DataCompletenessCursor,
  type NightCloseOutCursor,
} from "../core/open-item-questions.ts";
import type { MissingFieldReport } from "../core/data-completeness-gate.ts";
import type { NightCloseOutRequestDetail } from "../rituals/night-ritual.ts";
import type { ChatSession } from "./chat-session.ts";
import type { FieldValueSuggestion, InteractionRequest, PlanningFieldNames, Proposal, Result, Task, TaskFieldOverride, YohError } from "../types/domain.ts";
import type { OpenItem, OpenItemQuestion, OpenItemsResponse } from "../types/api.ts";

export interface SurfaceOpenItemsDeps {
  readonly store: MemoryStore;
  readonly session: ChatSession;
  readonly llmClient?: AnthropicMessagesClient;
  /** Story 13.4: resolves a `memory-forget` request's candidate items into option labels. */
  readonly memoryItems?: MemoryItemStore;
  /** Real-use fixes plan, Task 9: passed straight through to `suggestFieldValue`'s own trailing `connection` argument so its usage gets recorded. */
  readonly connection?: SqliteConnection;
  /** Clock seam for hiding expired reshuffle previews; defaults to the real time. */
  readonly now?: () => Date;
  /** Host time zone: with it, a change set staged on an earlier local day is hidden (it can no longer be approved). */
  readonly timeZone?: string;
}

export interface BuildOpenItemQuestionInput {
  readonly requestId: string;
}

/** Bridges `parsePlanningFieldValue` (`core/`) into `suggestFieldValue`'s injected-parser parameter (`adapters/llm-adapter.ts` cannot import `core/*.ts` — AD-1). Discards the rejection message: FR-25 treats an unparseable claimed value identically to "no confident inference." */
function parseValueWrapper(field: PlanningFieldNames, raw: string): NonNullable<Task[PlanningFieldNames]> | undefined {
  const parsed = parsePlanningFieldValue(field, raw);
  return parsed.ok ? (parsed.value as NonNullable<Task[PlanningFieldNames]>) : undefined;
}

function readOverridesByTaskId(store: MemoryStore, incomplete: readonly MissingFieldReport[]): ReadonlyMap<string, TaskFieldOverride> {
  const map = new Map<string, TaskFieldOverride>();
  for (const report of incomplete) {
    const stored = getTaskFieldOverride(store, report.taskId);
    if (stored) map.set(report.taskId, stored.data);
  }
  return map;
}

async function buildForRecord(deps: SurfaceOpenItemsDeps, record: StoredRecord<InteractionRequest>): Promise<OpenItemQuestion | "done"> {
  switch (record.data.requestKind) {
    case "data-completeness": {
      const detail = record.data.detail as { readonly incomplete?: readonly MissingFieldReport[]; readonly cursor?: DataCompletenessCursor } | undefined;
      const incomplete = detail?.incomplete ?? [];
      const overridesByTaskId = readOverridesByTaskId(deps.store, incomplete);
      const declinedSuggestions = new Set(detail?.cursor?.declinedSuggestions ?? []);
      const pending = nextDataCompletenessQuestion({ incomplete, overridesByTaskId, declinedSuggestions });
      if (!pending) return "done";
      let suggestion: FieldValueSuggestion | undefined;
      if (!pending.suggestionDeclined && deps.llmClient) {
        try {
          suggestion = await suggestFieldValue(
            deps.llmClient,
            pending.taskId,
            pending.taskTitle,
            pending.field,
            deps.session.recentMessages,
            parseValueWrapper,
            deps.connection,
          );
        } catch {
          suggestion = undefined; // A Claude/API failure must never block the fallback blind ask.
        }
      }
      return suggestion
        ? buildDataCompletenessQuestion(record.id, pending, suggestion, new Date().toISOString())
        : buildDataCompletenessQuestion(record.id, pending);
    }
    case "night-close-out": {
      const detail = record.data.detail as (NightCloseOutRequestDetail & { readonly cursor?: NightCloseOutCursor }) | undefined;
      const tasks = detail?.tasks ?? [];
      const pending = nextNightCloseOutTask({
        tasks,
        resolvedTaskIds: new Set(detail?.cursor?.resolvedTaskIds ?? []),
        skippedTaskIds: new Set(detail?.cursor?.skippedTaskIds ?? []),
      });
      return pending ? buildNightCloseOutQuestion(record.id, pending) : "done";
    }
    case "memory-forget": {
      const ids = (record.data.detail as { readonly itemIds?: readonly string[] } | undefined)?.itemIds ?? [];
      const store = deps.memoryItems;
      if (!store) return buildGenericQuestion(record.id);
      const candidates = ids.flatMap((id) => {
        const item = store.getItem(id);
        return item && item.status === "current" ? [{ id, label: `${item.text} \u00b7 ${memoryFolderLabel(item.folder)}` }] : [];
      });
      return candidates.length === 0 ? "done" : buildMemoryForgetQuestion(record.id, record.data.promptText, candidates);
    }
    case "proposal": {
      // Story 8.2 (Important fix): a stored Proposal request previously fell
      // through to the generic fallback (blank text, no options, no
      // `proposal` attached) — C4 requires its full confirm-question shape
      // instead. The server-stored proposal is authoritative; if it's ever
      // missing (a malformed/legacy record), fall back generically rather
      // than fabricate one — this function is read-only and can't clear the
      // request itself (that's `answerProposalOpenItem`'s job).
      const detail = record.data.detail as { readonly proposal?: Proposal<unknown> } | undefined;
      return detail?.proposal ? buildProposalQuestion(record.id, record.data.promptText, detail.proposal) : buildGenericQuestion(record.id);
    }
    default:
      return buildGenericQuestion(record.id);
  }
}

/** The one FR-25 suggestion-fetch call site (C3) — reads the request fresh, computes the pending cursor position, fetches a suggestion when applicable, and builds the matching `OpenItemQuestion`. Every `answer-*.ts` calls this once, after mutating state, to build `AnswerOpenItemResponse.next`. `"done"` means the request no longer exists OR every question it covers has already been answered. */
export async function buildOpenItemQuestion(deps: SurfaceOpenItemsDeps, input: BuildOpenItemQuestionInput): Promise<Result<OpenItemQuestion | "done", YohError>> {
  const record = getOpenInteractionRequest(deps.store, input.requestId);
  if (!record) return { ok: true, value: "done" };
  return { ok: true, value: await buildForRecord(deps, record) };
}

/** Every open interaction request, each with its CURRENT pending question, built from its stored cursor (C3) — what the Web App's `GET /api/open-items` route presents (Story 8.9: originally also `chat-cli.ts`'s own blocking transport loop). */
export async function surfaceOpenItems(deps: SurfaceOpenItemsDeps, _input: Record<string, never>): Promise<Result<OpenItemsResponse, YohError>> {
  const open = listOpenInteractionRequests(deps.store);
  const items: OpenItem[] = [];
  const now = (deps.now ?? (() => new Date()))();
  for (const record of open) {
    const proposal = (record.data.detail as { readonly proposal?: Proposal<unknown> } | undefined)?.proposal;
    if (record.data.requestKind === "proposal" && proposal?.kind === "reshuffle" && isProposalExpired(proposal.createdAt, now)) continue;
    if (record.data.requestKind === "proposal" && proposal?.kind === CHANGE_SET_PROPOSAL_KIND && deps.timeZone && changeSetIsStale(proposal.createdAt, now, deps.timeZone)) continue;
    if (record.data.requestKind === "proposal" && proposal?.kind === RESEARCH_OFFER_KIND && deps.timeZone && changeSetIsStale(proposal.createdAt, now, deps.timeZone)) {
      // Same-day rule as a change set: an offer from an earlier day is withdrawn, never shown.
      try {
        clearInteractionRequest(deps.store, record.id, record.version);
      } catch {
        // a concurrent answer already cleared it
      }
      continue;
    }
    if (record.data.requestKind === "proposal" && proposal?.kind === "rule-change" && isOlderThanDays(proposal.createdAt, now, RULE_PROPOSAL_TTL_DAYS)) {
      // Lazy 7-day TTL (AD-29): withdrawn, never shown; the preference stays as a declined soft item.
      try {
        clearInteractionRequest(deps.store, record.id, record.version);
        const itemId = (proposal.suggested as { memoryItemId?: string } | undefined)?.memoryItemId;
        if (itemId) deps.memoryItems?.setRuleChange(itemId, "declined");
      } catch {
        // a concurrent answer already cleared it
      }
      continue;
    }
    // Story 13.13: Pattern proposals surface only through their own offer routes and the Memory page.
    if (record.data.requestKind === "proposal" && proposal?.kind === "pattern") continue;
    const question = await buildForRecord(deps, record);
    items.push({
      requestId: record.id,
      requestKind: record.data.requestKind,
      promptText: record.data.promptText,
      question: question === "done" ? buildGenericQuestion(record.id) : question,
    });
  }
  return { ok: true, value: { items } };
}
