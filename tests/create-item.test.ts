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
import { draftItem, CREATE_ITEM_OPTIONS, type CreateItemDeps } from "../src/app/create-item.ts";
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
    getNotionCreatePageBinding: () =>
      overrides.bindingOk === false
        ? { ok: false, error: { kind: "missing-field", message: "no Notion config" } }
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
  if (result.ok) assert.match(result.value.reply, /no Notion config/);
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

test("draftItem's confirm question leads with 'Create', not a bare 'Yes' (Story 8.8 AC3) — the VALUE stays 'yes'/'no'", async () => {
  const deps = tempDeps({ llmResponse: "title=Buy hiking boots\narea=Errands" });
  const result = await draftItem(deps, { database: "Tasks", request: "create a task to buy hiking boots" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.value.question, "a valid draft always opens a confirm question");
  assert.deepEqual(result.value.question?.options, CREATE_ITEM_OPTIONS);
  assert.deepEqual(
    result.value.question?.options.map((o) => o.label),
    ["Create", "Cancel"],
  );
  assert.deepEqual(
    result.value.question?.options.map((o) => o.value),
    ["yes", "no"],
  );
  deps.connection.close();
});
