/**
 * Tests for `GET /api/open-items` and `POST /api/open-items/answer` (Story
 * 8.6, Task 7): pure transport over `app/surface-open-items.ts`'s
 * `surfaceOpenItems` and `app/answer-open-item.ts`'s `answerOpenItem`,
 * reusing the SAME merged `chatDeps` object `POST /api/chat` uses
 * (Preflight ruling P2). Requests are seeded through `putOpenInteractionRequest`
 * directly — exactly as a ritual would, never through `chatTurn` — the
 * real shapes `core/open-item-questions.ts` derives a deterministic
 * `questionId` from (Preflight ruling P4), matching
 * `tests/surface-open-items.test.ts`'s own seeding convention.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryStore, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import type { AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import { createApp, type ChatTurnFn, type ServerDeps } from "../src/shell/server.ts";
import type { AnswerOpenItemRequest, AnswerOpenItemResponse, OpenItemsResponse } from "../src/types/api.ts";

function tempApp(chat: ServerDeps["chat"], extra: Partial<ServerDeps> = {}) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const app = createApp({ connection, log: () => {}, ...(chat ? { chat } : {}), ...extra });
  return { app, connection };
}

/**
 * `[ASSUMPTION, Task 7]` Only `store` (plus, per test, `updateTaskField`/
 * `llmClient`) is actually read by `surfaceOpenItems`/`answerOpenItem` for
 * the cases below — every other `ServerDeps["chat"]` field is required only
 * at the TYPE level (real `chatTurn` dispatch, exercised by
 * `tests/server-chat.test.ts`, not by these routes), so the cast mirrors
 * `tests/server-chat.test.ts`'s own `seamOnly` convention.
 */
function chatDepsFor(overrides: Record<string, unknown>): NonNullable<ServerDeps["chat"]> {
  return overrides as unknown as NonNullable<ServerDeps["chat"]>;
}

test("GET /api/open-items surfaces an open interaction request through surfaceOpenItems — including one a ritual raised (Review Focus #1)", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  // Seeded directly via memory-store.ts, exactly as a ritual (not chat-cli,
  // not any web request) would — the AC's "including ones created while the
  // CLI was in use."
  putOpenInteractionRequest(store, "data-completeness", {
    requestKind: "data-completeness",
    promptText: "I need a bit more before I can plan around Draft the memo.",
    createdAt: "2026-09-26T12:00:00.000Z",
    detail: { incomplete: [{ taskId: "t1", taskTitle: "Draft the memo", missingFields: ["area"] }] },
  });
  const app = createApp({ connection, log: () => {}, chat: chatDepsFor({ store }) });

  const res = await app.request("/api/open-items");
  const body = (await res.json()) as { ok: true; value: OpenItemsResponse };
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.value.items.length, 1);
  assert.equal(body.value.items[0]!.requestKind, "data-completeness");
  assert.equal(body.value.items[0]!.question.questionId, "t1:area");
  connection.close();
});

test("GET /api/open-items returns a clear unreachable error when chat deps are not configured", async () => {
  const { app, connection } = tempApp(undefined);
  const res = await app.request("/api/open-items");
  const body = (await res.json()) as { ok: false; error: { kind: string; message: string } };
  assert.equal(res.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.error.kind, "unreachable");
  connection.close();
});

test("POST /api/open-items/answer calls answerOpenItem and writes through the configured updateTaskField", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  putOpenInteractionRequest(store, "data-completeness", {
    requestKind: "data-completeness",
    promptText: "I need a bit more before I can plan around Draft the memo.",
    createdAt: "2026-09-26T12:00:00.000Z",
    detail: { incomplete: [{ taskId: "t1", taskTitle: "Draft the memo", missingFields: ["area"] }] },
  });
  const written: unknown[] = [];
  const app = createApp({
    connection,
    log: () => {},
    chat: chatDepsFor({ store, updateTaskField: async (taskId: string, field: string, value: unknown) => (written.push({ taskId, field, value }), { ok: true, value: undefined }) }),
  });

  const res = await app.request("/api/open-items/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "data-completeness", questionId: "t1:area", answer: "Work" } satisfies AnswerOpenItemRequest),
  });
  const body = (await res.json()) as { ok: boolean; value?: AnswerOpenItemResponse };
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(written, [{ taskId: "t1", field: "area", value: "Work" }]);
  connection.close();
});

test("POST /api/open-items/answer with a missing field returns 400 validation, never reaching answerOpenItem", async () => {
  const { app, connection } = tempApp(undefined);
  const res = await app.request("/api/open-items/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "x" }),
  });
  const body = (await res.json()) as { ok: false; error: { kind: string; message: string } };
  assert.equal(res.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error.kind, "validation");
  connection.close();
});

test("POST /api/open-items/answer surfaces a conflict when the request no longer exists", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  const app = createApp({ connection, log: () => {}, chat: chatDepsFor({ store }) });
  const res = await app.request("/api/open-items/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "nope", questionId: "x", answer: "y" } satisfies AnswerOpenItemRequest),
  });
  const body = (await res.json()) as { ok: false; error: { kind: string; message: string } };
  assert.equal(res.status, 409);
  assert.equal(body.ok, false);
  assert.equal(body.error.kind, "conflict");
  connection.close();
});

test("GET /api/open-items and POST /api/open-items/answer share the SAME chatDeps object POST /api/chat uses (Preflight ruling P2)", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  putOpenInteractionRequest(store, "data-completeness", {
    requestKind: "data-completeness",
    promptText: "x",
    createdAt: "2026-09-26T00:00:00.000Z",
    detail: { incomplete: [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["estimatedDurationMinutes"] }] },
  });
  const llmClient = {
    messages: { create: async () => ({ content: [{ type: "text", text: "CONFIDENT: 30 | Spencer said it'll take about half an hour" }] }) },
  } as unknown as AnthropicMessagesClient;
  // A fake `runChatTurn` (the test seam) pushes a line into `deps.session`
  // itself — real `chatTurn` does this via `recordRecentMessage`; the point
  // pinned here is only that `/api/open-items`'s OWN `surfaceOpenItems` call
  // sees whatever `/api/chat` left in that SAME `ChatSession`, not a second
  // one.
  const runChatTurn: ChatTurnFn = async (deps) => {
    deps.session.recentMessages.push("that dentist call will take about half an hour");
    return { ok: true, value: { reply: "", receipts: [] } };
  };
  const app = createApp({ connection, log: () => {}, chat: chatDepsFor({ store, llmClient, runChatTurn }) });

  await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "how long will that take", history: [] }),
  });
  const res = await app.request("/api/open-items");
  const body = (await res.json()) as { ok: true; value: OpenItemsResponse };
  assert.equal(body.value.items[0]!.question.questionId, "t1:estimatedDurationMinutes:suggest");
  connection.close();
});

test("POST /api/open-items/answer binds changeSet: approving a change-set proposal reaches applyChangeSet, and a missing Notion binding reports plainly", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  putOpenInteractionRequest(store, "proposal:change-set-1", {
    requestKind: "proposal",
    promptText: 'Mark "Draft the memo" done?',
    createdAt: new Date().toISOString(),
    detail: {
      proposal: {
        id: "change-set-1",
        kind: "change-set",
        entityId: "change-set-1",
        entityVersion: "new",
        suggested: { items: [{ kind: "complete-task", taskId: "t1", label: "Draft the memo" }] },
        reason: 'Mark "Draft the memo" done?',
        createdAt: new Date().toISOString(),
      },
      cursor: { questionId: "confirm" },
    },
  });
  const app = createApp({ connection, log: () => {}, chat: chatDepsFor({ store, timeZone: "America/New_York" }) });

  const res = await app.request("/api/open-items/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: "proposal:change-set-1", questionId: "confirm", answer: "approve" } satisfies AnswerOpenItemRequest),
  });
  const text = await res.text();
  assert.match(text, /Notion isn't set up, so I can't mark Tasks done/);
  assert.doesNotMatch(text, /changeSet/, "the dependency is bound, never reported missing");
  connection.close();
});

test("server.ts is transport only for open items (AD-16): interaction-request writes go through app/, never memory-store.ts directly", () => {
  const shellDir = join(import.meta.dirname, "..", "src", "shell");
  // server.ts and the files split out of it (server-streams.ts, server-routes.ts, server-wiring.ts).
  const source = readdirSync(shellDir)
    .filter((name) => /^server(-[a-z-]+)?\.ts$/.test(name))
    .map((name) => readFileSync(join(shellDir, name), "utf8"))
    .join("\n");
  const imported = [...source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']\.\.\/adapters\/memory-store\.ts["']/g)]
    .flatMap((m) => (m[1] ?? "").split(","))
    .map((s) => s.trim().replace(/^type\s+/, ""))
    .filter(Boolean);
  assert.ok(imported.length > 0);
  assert.deepEqual(
    imported.filter((name) => /^(putOpenInteractionRequest|clearInteractionRequest|updateInteractionRequestDetail|getOpenInteractionRequest|listOpenInteractionRequests)$/.test(name)),
    [],
  );
  assert.match(source, /from\s*["']\.\.\/app\/surface-open-items\.ts["']/);
  assert.match(source, /from\s*["']\.\.\/app\/answer-open-item\.ts["']/);
});
