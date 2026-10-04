/**
 * Tests for `src/app/run-research-job.ts` (Story 11.3, E11-R9/R10/R12/R15): the background runner's job logic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { getMaxOutboxSeq, initNotificationStoreSchema, listUnreadNotifications, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { claimNextResearchJob, initJobStoreSchema, insertQueuedResearchJobInTx, listRunningResearchJobs } from "../src/adapters/job-store.ts";
import type { NotionCreatePageClient, NotionCreatePageConfig } from "../src/adapters/notion-adapter.ts";
import { failInterruptedResearchJobs, runNextResearchJob, RESEARCH_JOB_POLL_INTERVAL_MS, type RunResearchJobDeps } from "../src/app/run-research-job.ts";
import { researchTopic } from "../src/core/research-vault-properties.ts";
import type { Result, SearchAnswer, YohError } from "../src/types/domain.ts";

const CONFIG: NotionCreatePageConfig = { tasksDataSourceId: "tasks-ds", projectsDataSourceId: "projects-ds", researchVaultDataSourceId: "research-vault-ds" };

function fakeVaultClient(opts: { failCreate?: boolean } = {}) {
  const createCalls: Array<{ parent: unknown; properties: Record<string, unknown> }> = [];
  const schema = {
    object: "data_source",
    id: "research-vault-ds",
    title: [],
    description: [],
    parent: { type: "database_id", database_id: "x" },
    database_parent: { type: "database_id", database_id: "x" },
    is_inline: false,
    in_trash: false,
    archived: false,
    created_time: "2026-08-01T09:00:00.000Z",
    last_edited_time: "2026-08-01T09:00:00.000Z",
    created_by: { object: "user", id: "u" },
    last_edited_by: { object: "user", id: "u" },
    icon: null,
    cover: null,
    url: "https://notion.so/x",
    public_url: null,
    properties: {
      "Research Title": { id: "title", name: "Research Title", description: null, type: "title", title: {} },
      "Key Findings": { id: "kf", name: "Key Findings", description: null, type: "rich_text", rich_text: {} },
      Query: { id: "q", name: "Query", description: null, type: "rich_text", rich_text: {} },
      Date: { id: "date", name: "Date", description: null, type: "date", date: {} },
      Sources: { id: "src", name: "Sources", description: null, type: "rich_text", rich_text: {} },
    },
  } as unknown as Awaited<ReturnType<NotionCreatePageClient["dataSources"]["retrieve"]>>;
  const client: NotionCreatePageClient = {
    dataSources: { retrieve: (async () => schema) as NotionCreatePageClient["dataSources"]["retrieve"] },
    pages: {
      create: (async (args: { parent: unknown; properties: Record<string, unknown> }) => {
        if (opts.failCreate) throw new Error("boom: secret token abc123");
        createCalls.push(args);
        return { object: "page", id: "new-page-id", url: "https://notion.so/new-page-id" };
      }) as NotionCreatePageClient["pages"]["create"],
    },
  };
  return { client, createCalls };
}

function setup(opts: { search?: (q: string) => Promise<Result<SearchAnswer, YohError>>; failCreate?: boolean } = {}) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initJobStoreSchema(connection.db);
  const vault = fakeVaultClient(opts.failCreate ? { failCreate: true } : {});
  const searched: string[] = [];
  const deps: RunResearchJobDeps = {
    connection,
    searchFn: async (q) => {
      searched.push(q);
      return opts.search ? opts.search(q) : { ok: true, value: { answer: "Registration closes Oct 1.", citations: ["https://example.com/a"] } };
    },
    getNotionCreatePageBinding: () => ({ ok: true, value: { client: vault.client, config: CONFIG } }),
    timeZone: "America/New_York",
    now: () => new Date("2026-10-04T15:00:00.000Z"),
    log: () => {},
  };
  const queue = (question: string) => connection.writeTx((tx) => insertQueuedResearchJobInTx(tx, { question, createdAt: "2026-10-04T14:00:00.000Z" }));
  const job = (id: string) => connection.db.prepare("SELECT status, page_id, error FROM research_jobs WHERE id = ?").get(id) as { status: string; page_id: string | null; error: string | null };
  return { connection, deps, vault, searched, queue, job };
}

test("the poll interval is 3000 ms", () => {
  assert.equal(RESEARCH_JOB_POLL_INTERVAL_MS, 3000);
});

test("researchTopic cuts to 80 characters with an ellipsis", () => {
  assert.equal(researchTopic("short"), "short");
  const long = "x".repeat(100);
  assert.equal(researchTopic(long), `${"x".repeat(79)}…`);
  assert.equal(researchTopic(long).length, 80);
  assert.equal(researchTopic("y".repeat(80)), "y".repeat(80));
});

test("nothing queued -> { ran: false }", async () => {
  const { deps, connection } = setup();
  const result = await runNextResearchJob(deps, {});
  assert.deepEqual(result, { ok: true, value: { ran: false } });
  connection.close();
});

test("success: files with provenance, marks done, one research-ready notification + research hint", async () => {
  const { deps, connection, vault, queue, job } = setup();
  const id = queue("AP Bio registration deadline");
  const before = getMaxOutboxSeq(connection);
  const result = await runNextResearchJob(deps, {});
  assert.deepEqual(result, { ok: true, value: { ran: true, outcome: "done" } });
  assert.equal(vault.createCalls.length, 1);
  assert.deepEqual(vault.createCalls[0]!.parent, { data_source_id: "research-vault-ds" });
  const props = JSON.stringify(vault.createCalls[0]!.properties);
  assert.match(props, /AP Bio registration deadline/);
  assert.match(props, /Registration closes Oct 1\./);
  assert.match(props, /2026-10-04/);
  assert.match(props, /https:\/\/example\.com\/a/);
  assert.deepEqual(job(id), { status: "done", page_id: "new-page-id", error: null });
  const notes = listUnreadNotifications(connection);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.kind, "research-ready");
  assert.equal(notes[0]!.title, "Research ready: AP Bio registration deadline");
  assert.equal(notes[0]!.body, "Open it on Research Hub.");
  assert.equal(notes[0]!.deepLink, "research:new-page-id");
  const hints = tailOutboxSince(connection, before);
  assert.ok(hints.some((h) => h.topic === "research" && h.entityId === "new-page-id"));
  connection.close();
});

function assertFailed(ctx: ReturnType<typeof setup>, id: string, body: RegExp | string) {
  const row = ctx.job(id);
  assert.equal(row.status, "failed");
  assert.equal(row.page_id, null);
  const notes = listUnreadNotifications(ctx.connection);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.kind, "research-failed");
  assert.match(notes[0]!.title, /^Couldn't finish research: /);
  assert.equal(notes[0]!.deepLink, "chat");
  if (typeof body === "string") assert.equal(notes[0]!.body, body);
  else assert.match(notes[0]!.body, body);
  assert.equal(row.error, notes[0]!.body);
  assert.doesNotMatch(notes[0]!.body, /secret|abc123|boom/);
  assert.equal(ctx.vault.createCalls.length, 0);
}

test("search failure -> failed + research-failed with plain copy, nothing filed", async () => {
  const ctx = setup({ search: async () => ({ ok: false, error: { kind: "unreachable", message: "raw upstream 502" } }) });
  const id = ctx.queue("q one");
  const result = await runNextResearchJob(ctx.deps, {});
  assert.deepEqual(result, { ok: true, value: { ran: true, outcome: "failed" } });
  assertFailed(ctx, id, /./);
  assert.doesNotMatch(ctx.job(id).error ?? "", /502/);
  ctx.connection.close();
});

test("an empty result (no answer, no citations) is a failure, not ready", async () => {
  const ctx = setup({ search: async () => ({ ok: true, value: { answer: "  ", citations: [] } }) });
  const id = ctx.queue("q two");
  await runNextResearchJob(ctx.deps, {});
  assertFailed(ctx, id, "The search didn't find anything useful.");
  ctx.connection.close();
});

test("a thrown search error -> failed, never left running", async () => {
  const ctx = setup({
    search: async () => {
      throw new Error("boom: secret token abc123");
    },
  });
  const id = ctx.queue("q three");
  const result = await runNextResearchJob(ctx.deps, {});
  assert.equal(result.ok, true);
  assertFailed(ctx, id, /./);
  assert.equal(listRunningResearchJobs(ctx.connection).length, 0);
  ctx.connection.close();
});

test("a filing failure (createPage throws) -> failed, not ready", async () => {
  const ctx = setup({ failCreate: true });
  const id = ctx.queue("q four");
  await runNextResearchJob(ctx.deps, {});
  assert.equal(ctx.job(id).status, "failed");
  const notes = listUnreadNotifications(ctx.connection);
  assert.deepEqual(
    notes.map((n) => n.kind),
    ["research-failed"],
  );
  assert.doesNotMatch(notes[0]!.body, /secret|abc123|boom/);
  ctx.connection.close();
});

test("Notion not set up at run time -> failed", async () => {
  const ctx = setup();
  const id = ctx.queue("q five");
  const deps: RunResearchJobDeps = { ...ctx.deps, getNotionCreatePageBinding: () => ({ ok: false, error: { kind: "missing-field", message: "server: missing env" } }) };
  await runNextResearchJob(deps, {});
  assert.equal(ctx.job(id).status, "failed");
  assert.deepEqual(
    listUnreadNotifications(ctx.connection).map((n) => n.kind),
    ["research-failed"],
  );
  ctx.connection.close();
});

test("a failed job is never picked again", async () => {
  const ctx = setup({ search: async () => ({ ok: false, error: { kind: "unreachable", message: "x" } }) });
  ctx.queue("q six");
  await runNextResearchJob(ctx.deps, {});
  const again = await runNextResearchJob(ctx.deps, {});
  assert.deepEqual(again, { ok: true, value: { ran: false } });
  assert.equal(ctx.searched.length, 1);
  ctx.connection.close();
});

test("one job per call, oldest first", async () => {
  const ctx = setup();
  ctx.queue("first");
  ctx.queue("second");
  await runNextResearchJob(ctx.deps, {});
  assert.deepEqual(ctx.searched, ["first"]);
  await runNextResearchJob(ctx.deps, {});
  assert.deepEqual(ctx.searched, ["first", "second"]);
  ctx.connection.close();
});

test("recovery: every running job -> failed with one research-failed each; queued jobs stay queued; none re-run", async () => {
  const ctx = setup();
  const a = ctx.queue("interrupted a");
  claimNextResearchJob(ctx.connection, "2026-10-04T14:30:00.000Z");
  const q = ctx.queue("still queued");
  const result = await failInterruptedResearchJobs(ctx.deps, {});
  assert.deepEqual(result, { ok: true, value: { failed: 1 } });
  const text = "Yoh restarted before it finished. Send /research again to retry.";
  assert.deepEqual(ctx.job(a), { status: "failed", page_id: null, error: text });
  assert.equal(ctx.job(q).status, "queued");
  const notes = listUnreadNotifications(ctx.connection);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.kind, "research-failed");
  assert.equal(notes[0]!.title, "Couldn't finish research: interrupted a");
  assert.equal(notes[0]!.body, text);
  assert.equal(notes[0]!.deepLink, "chat");
  await runNextResearchJob(ctx.deps, {});
  assert.deepEqual(ctx.searched, ["still queued"]);
  ctx.connection.close();
});
