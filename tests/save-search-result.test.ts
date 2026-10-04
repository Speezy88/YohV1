/**
 * Tests for `src/app/save-search-result.ts` (Story 8.4).
 *
 * Moved/adapted from `tests/chat-cli.test.ts`'s "'save that' -> file the
 * last search result" section (`handleSaveSearchResultCommand`'s own
 * tests).
 */
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { saveSearchResult, type SaveSearchResultDeps } from "../src/app/save-search-result.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { getMaxOutboxSeq, initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import type { NotionCreatePageClient, NotionCreatePageConfig } from "../src/adapters/notion-adapter.ts";
import type { ChatSession } from "../src/app/chat-session.ts";

function tempDeps(overrides: { bindingOk?: boolean; session?: ChatSession; client?: NotionCreatePageClient; config?: NotionCreatePageConfig } = {}): SaveSearchResultDeps {
  return {
    session: overrides.session ?? { recentMessages: [], lastSearchAnswer: undefined, researchOffered: new Set<string>() },
    timeZone: "America/New_York",
    now: () => new Date("2026-09-26T18:00:00.000Z"),
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
        : { ok: true, value: { client: overrides.client ?? ({} as NotionCreatePageClient), config: overrides.config ?? ({} as NotionCreatePageConfig) } },
  };
}

test("no recent search result -> a plain reply, nothing created", async () => {
  const result = await saveSearchResult(tempDeps(), {});
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.value.reply, /don't have a recent search result/);
});

test("Notion not configured -> a plain reply naming the problem", async () => {
  const session: ChatSession = { recentMessages: [], researchOffered: new Set<string>(), lastSearchAnswer: { query: "hiking boots", answer: { answer: "Salomon test well.", citations: [] } } };
  const result = await saveSearchResult(tempDeps({ bindingOk: false, session }), {});
  assert.equal(result.ok, true);
  // Task 4 (real-use fixes plan): a plain, honest sentence naming Notion —
  // never the raw "environment variable" jargon.
  if (result.ok) assert.equal(result.value.reply, "I'm not set up to do that yet — my Notion connection isn't configured.");
});

/**
 * A real `NotionCreatePageClient` fake — the SAME fixture shape
 * `tests/notion-adapter.test.ts`'s own `fakeCreatePageClient`/`fakeSchemaFor`
 * use for `createPage`'s own tests (this file duplicates a minimal version
 * rather than importing test fixtures across files, matching this repo's
 * existing per-file-fixture convention). `saveSearchResult` calls the REAL
 * `createPage`/`resolveNotionPageDraftProperties` against this fake client —
 * it is this file's own OWN `createPage` import that's exercised, not a
 * mock of `saveSearchResult`'s dependency surface.
 */
const RESEARCH_VAULT_CONFIG: NotionCreatePageConfig = { tasksDataSourceId: "tasks-ds", projectsDataSourceId: "projects-ds", researchVaultDataSourceId: "research-vault-ds" };

function fakeResearchVaultClient(): NotionCreatePageClient & { readonly createCalls: Array<{ readonly parent: unknown; readonly properties: unknown }> } {
  const createCalls: Array<{ parent: unknown; properties: unknown }> = [];
  const schema = {
    object: "data_source",
    id: "research-vault-ds",
    title: [],
    description: [],
    parent: { type: "database_id", database_id: "research-vault-ds-db" },
    database_parent: { type: "database_id", database_id: "research-vault-ds-db" },
    is_inline: false,
    in_trash: false,
    archived: false,
    created_time: "2026-08-01T09:00:00.000Z",
    last_edited_time: "2026-08-01T09:00:00.000Z",
    created_by: { object: "user", id: "user-1" },
    last_edited_by: { object: "user", id: "user-1" },
    icon: null,
    cover: null,
    url: "https://notion.so/research-vault-ds",
    public_url: null,
    properties: {
      "Research Title": { id: "title", name: "Research Title", description: null, type: "title", title: {} },
      "Key Findings": { id: "kf", name: "Key Findings", description: null, type: "rich_text", rich_text: {} },
      Query: { id: "q", name: "Query", description: null, type: "rich_text", rich_text: {} },
      Date: { id: "date", name: "Date", description: null, type: "date", date: {} },
      Sources: { id: "src", name: "Sources", description: null, type: "rich_text", rich_text: {} },
    },
  } as unknown as Awaited<ReturnType<NotionCreatePageClient["dataSources"]["retrieve"]>>;
  return {
    createCalls,
    dataSources: { retrieve: (async () => schema) as NotionCreatePageClient["dataSources"]["retrieve"] },
    pages: {
      create: (async (args: { parent: unknown; properties: unknown }) => {
        createCalls.push(args);
        return { object: "page", id: "new-page-id", url: "https://notion.so/new-page-id" };
      }) as NotionCreatePageClient["pages"]["create"],
    },
  };
}

test("Controller ruling: files the last search result via the REAL createPage('ResearchVault', ...), with the exact properties, and echoes a receipt", async () => {
  const client = fakeResearchVaultClient();
  const session: ChatSession = { recentMessages: [], researchOffered: new Set<string>(), lastSearchAnswer: { query: "best hiking boots under $150", answer: { answer: "Salomon and Merrell both test well.", citations: ["https://example.com/a"] } } };
  const result = await saveSearchResult(tempDeps({ session, client, config: RESEARCH_VAULT_CONFIG }), {});

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.receipts, ['Filed "best hiking boots under $150" to the Research Vault.']);
  assert.equal(client.createCalls.length, 1);
  assert.deepEqual(client.createCalls[0]!.parent, { data_source_id: "research-vault-ds" }, "must target the ResearchVault data source, not Tasks/Projects");
  const props = client.createCalls[0]!.properties as Record<string, unknown>;
  assert.ok("Research Title" in props, "the 'title' internal field must resolve to ResearchVault's real 'Research Title' property");
  assert.ok("Key Findings" in props);
});

test("Task 6C: a successful file appends one `research` outbox hint, keyed to the created page id", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const before = getMaxOutboxSeq(connection);
  const client = fakeResearchVaultClient();
  const session: ChatSession = { recentMessages: [], researchOffered: new Set<string>(), lastSearchAnswer: { query: "best hiking boots under $150", answer: { answer: "Salomon and Merrell both test well.", citations: ["https://example.com/a"] } } };
  const result = await saveSearchResult({ ...tempDeps({ session, client, config: RESEARCH_VAULT_CONFIG }), connection }, {});

  assert.equal(result.ok, true);
  const hints = tailOutboxSince(connection, before);
  assert.deepEqual(
    hints.map((h) => [h.topic, h.entityId]),
    [["research", "new-page-id"]],
  );
});

test("no connection given -> no hint, and saving still succeeds (the same 'tests that don't care' convention as create-task.ts)", async () => {
  const client = fakeResearchVaultClient();
  const session: ChatSession = { recentMessages: [], researchOffered: new Set<string>(), lastSearchAnswer: { query: "best hiking boots under $150", answer: { answer: "Salomon and Merrell both test well.", citations: [] } } };
  const result = await saveSearchResult(tempDeps({ session, client, config: RESEARCH_VAULT_CONFIG }), {});
  assert.equal(result.ok, true);
});

test("Controller ruling: save-search-result.ts never references confirmProposal — FR-29's createPage call site stays a direct write, never routed through the confirm path", () => {
  const source = readFileSync(new URL("../src/app/save-search-result.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /confirmProposal/);
});
