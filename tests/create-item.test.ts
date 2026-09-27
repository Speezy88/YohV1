/**
 * Tests for `src/app/create-item.ts` (Story 8.4).
 *
 * Moved/adapted from `tests/chat-cli.test.ts`'s `handleCreateItemCommand`
 * end-to-end section, restructured for the one-shot
 * draft-then-`openProposal` shape: a valid draft now returns a `question`
 * (the confirm is answered on a LATER turn via `answerOpenItem` ->
 * `confirmProposal`, already covered by Story 8.2's own tests) rather than
 * blocking here for a "yes"/"no" line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { draftItem, type CreateItemDeps } from "../src/app/create-item.ts";
import type { AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import type { NotionCreatePageClient, NotionCreatePageConfig } from "../src/adapters/notion-adapter.ts";

function makeFakeLlmClient(responseText: string): AnthropicMessagesClient {
  return { messages: { create: async () => ({ content: [{ type: "text", text: responseText }] }) } } as unknown as AnthropicMessagesClient;
}

const CREATE_PAGE_CONFIG: NotionCreatePageConfig = {
  tasksDataSourceId: "tasks-ds",
  projectsDataSourceId: "projects-ds",
  researchVaultDataSourceId: "research-vault-ds",
};

/** A minimal real `NotionCreatePageClient` fake (mirrors `tests/notion-adapter.test.ts`'s own `fakeSchemaFor`/`fakeCreatePageClient` fixtures) — `draftItem` calls the REAL `resolveNotionPageDraftProperties` against it, so a test that reaches the validation step exercises real schema-resolution behavior, not a stand-in for it. */
function fakeTasksClient(): NotionCreatePageClient {
  const schema = {
    object: "data_source",
    id: "tasks-ds",
    title: [],
    description: [],
    parent: { type: "database_id", database_id: "tasks-ds-db" },
    database_parent: { type: "database_id", database_id: "tasks-ds-db" },
    is_inline: false,
    in_trash: false,
    archived: false,
    created_time: "2026-08-01T09:00:00.000Z",
    last_edited_time: "2026-08-01T09:00:00.000Z",
    created_by: { object: "user", id: "user-1" },
    last_edited_by: { object: "user", id: "user-1" },
    icon: null,
    cover: null,
    url: "https://notion.so/tasks-ds",
    public_url: null,
    properties: {
      Name: { id: "title", name: "Name", description: null, type: "title", title: {} },
      Area: {
        id: "area",
        name: "Area",
        description: null,
        type: "select",
        select: { options: [{ id: "1", name: "Errands", color: "blue", description: null }] },
      },
      "Due Date": { id: "due", name: "Due Date", description: null, type: "date", date: {} },
    },
  } as unknown as Awaited<ReturnType<NotionCreatePageClient["dataSources"]["retrieve"]>>;
  return {
    dataSources: { retrieve: (async () => schema) as NotionCreatePageClient["dataSources"]["retrieve"] },
    pages: {
      create: (async () => ({ object: "page", id: "new-page-id", url: "https://notion.so/new-page-id" })) as NotionCreatePageClient["pages"]["create"],
    },
  };
}

/**
 * Uses a REAL `SqliteConnection` (`:memory:`) + a real `MemoryStore` behind
 * it, not an opaque fake — `draftItem` calls the real `openProposal` (Story
 * 8.2) on every successful draft, so a test that reaches that path needs
 * `deps`'s `store` to actually be one `openProposal` can persist into.
 */
function tempDeps(overrides: { bindingOk?: boolean; llmResponse?: string } = {}): CreateItemDeps & { readonly connection: ReturnType<typeof openSqliteConnection> } {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db); // Task 7 (Epic 8): interaction-request writes (via openProposal) now append an outbox row.
  const store = createMemoryStore(connection);
  return {
    connection,
    store,
    llmClient: makeFakeLlmClient(overrides.llmResponse ?? ""),
    now: () => new Date("2026-09-26T18:00:00.000Z"),
    timeZone: "America/Los_Angeles",
    getNotionCreatePageBinding: () =>
      overrides.bindingOk === false
        ? {
            // The real shape `shell/server.ts` returns (Task 4, real-use
            // fixes plan): a `modulename:`-prefixed message naming raw
            // environment-variable jargon — `core/error-copy.ts` must never
            // let this leak verbatim to Spencer.
            ok: false,
            error: { kind: "missing-field", message: "server: missing required Notion environment variable(s) — needed to create or file a Notion item" },
          }
        : { ok: true, value: { client: fakeTasksClient(), config: CREATE_PAGE_CONFIG } },
  };
}

test("no title extracted -> a plain reply, nothing proposed", async () => {
  const deps = tempDeps({ llmResponse: "area=Errands" }); // no `title=` line
  const result = await draftItem(deps, { database: "Tasks", request: "buy hiking boots" });
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.value.reply, /couldn't tell what you want/);
  deps.connection.close();
});

test("Notion not configured -> a plain reply naming the problem, nothing proposed", async () => {
  const deps = tempDeps({ bindingOk: false, llmResponse: "title=Buy hiking boots\narea=Errands" });
  const result = await draftItem(deps, { database: "Tasks", request: "buy hiking boots" });
  assert.equal(result.ok, true);
  // Task 4 (real-use fixes plan): a plain, honest sentence naming Notion —
  // never the raw "environment variable" jargon.
  if (result.ok) assert.equal(result.value.reply, "I'm not set up to do that yet — my Notion connection isn't configured.");
  deps.connection.close();
});

test("Controller ruling: two consecutive create-item requests for the SAME database never conflict — each proposal is keyed by its own id, not the database", async () => {
  const deps = tempDeps({ llmResponse: "title=Buy hiking boots\narea=Errands" });
  const first = await draftItem(deps, { database: "Tasks", request: "buy hiking boots" });
  const second = await draftItem(deps, { database: "Tasks", request: "call the dentist" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok) assert.ok(first.value.question, "expected the first draft to open cleanly");
  if (second.ok) assert.ok(second.value.question, "expected the SECOND draft to ALSO open cleanly — no conflict for a create-type Proposal (controller ruling)");
  deps.connection.close();
});

test("a valid draft is persisted as an open Proposal and returned as `question`, with an empty `reply` (the confirm text lives in the question)", async () => {
  const deps = tempDeps({ llmResponse: "title=Buy hiking boots\narea=Errands" });
  const result = await draftItem(deps, { database: "Tasks", request: "buy hiking boots" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, "");
  assert.equal(result.value.receipts.length, 0);
  assert.ok(result.value.question, "expected a follow-up confirm question");
  assert.equal(result.value.question?.questionId, "confirm");
  assert.match(result.value.question?.text ?? "", /Here's what I'll create in Tasks/);
  deps.connection.close();
});

test("draftItem's confirm question leads with 'Create', not a bare 'Yes' (Story 8.8 AC3) — the VALUE stays 'yes'/'no' (final-review fix: this now comes from open-proposal.ts's own return, via core/open-item-questions.ts's buildProposalQuestion — the one shared assembly point, not a relabel local to this file)", async () => {
  const deps = tempDeps({ llmResponse: "title=Buy hiking boots\narea=Errands" });
  const result = await draftItem(deps, { database: "Tasks", request: "create a task to buy hiking boots" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.value.question, "a valid draft always opens a confirm question");
  assert.deepEqual(result.value.question?.options, [
    { label: "Create", value: "yes" },
    { label: "Cancel", value: "no" },
  ]);
  deps.connection.close();
});

// ============================================================================
// Real-use fixes plan, Task 3: dates are resolved and validated before any
// draft is shown. `tempDeps`'s frozen `now` is 2026-09-26T18:00:00.000Z —
// 2026-09-26T11:00:00-07:00 in America/Los_Angeles (PDT), so "today" is
// 2026-09-26 and "tomorrow" is 2026-09-27 in Spencer's own timezone.
// ============================================================================

test("the incident: an LLM draft that carries the literal, unresolved phrase \"tomorrow at 10:45 AM\" as dueDate is resolved deterministically before any draft is shown, never surfaced to Spencer as-is", async () => {
  const deps = tempDeps({ llmResponse: "title=Lab report draft\ndueDate=tomorrow at 10:45 AM" });
  const result = await draftItem(deps, { database: "Tasks", request: "lab report draft due tomorrow at 10:45am" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.value.question, "a resolvable date must still open a normal confirm question, not a clarifying question");
  // 10:45 AM PDT (UTC-7) on 2026-09-27 is 17:45 UTC.
  assert.match(result.value.question?.text ?? "", /dueDate: 2026-09-27T17:45:00\.000Z/);
  deps.connection.close();
});

test("an unresolvable dueDate never produces a draft — a plain clarifying question instead", async () => {
  const deps = tempDeps({ llmResponse: "title=Lab report draft\ndueDate=sometime soon" });
  const result = await draftItem(deps, { database: "Tasks", request: "lab report draft due sometime soon" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.question, undefined, "an unresolvable date must never open a confirm question / Proposal");
  assert.equal(result.value.reply, 'When is "Lab report draft" due? I couldn\'t read "sometime soon" as a date.');
  deps.connection.close();
});

test("an already-ISO dueDate (the LLM resolved it itself) passes through unchanged", async () => {
  const deps = tempDeps({ llmResponse: "title=Lab report draft\ndueDate=2026-10-01" });
  const result = await draftItem(deps, { database: "Tasks", request: "lab report draft due Oct 1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.value.question);
  assert.match(result.value.question?.text ?? "", /dueDate: 2026-10-01/);
  deps.connection.close();
});

test("a bare relative dueDate with no time (\"Thursday\") resolves to a plain YYYY-MM-DD, not a datetime", async () => {
  // 2026-09-26 is a Saturday; the next Thursday is 2026-10-01.
  const deps = tempDeps({ llmResponse: "title=Lab report draft\ndueDate=Thursday" });
  const result = await draftItem(deps, { database: "Tasks", request: "lab report draft due Thursday" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.value.question);
  assert.match(result.value.question?.text ?? "", /dueDate: 2026-10-01(?!T)/);
  deps.connection.close();
});
