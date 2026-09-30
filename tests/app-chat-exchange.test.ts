/** Tests for `src/app/chat-exchange.ts` (Story 13.1, E2/E4). Fake inner turn; real in-memory chat store. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatStore, initChatStoreSchema, type ChatStore } from "../src/adapters/chat-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { chatExchange, type ChatExchangeDeps, type ChatTurnFn } from "../src/app/chat-exchange.ts";
import type { ChatStreamEvent, ChatTurnResponse } from "../src/types/api.ts";
import type { Result, YohError } from "../src/types/domain.ts";

const NOW = new Date("2026-08-22T18:00:00.000Z");

function realStore(): ChatStore {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initChatStoreSchema(connection.db);
  return createChatStore(connection);
}

function makeDeps(runChatTurn: ChatTurnFn, extra: Partial<ChatExchangeDeps> = {}) {
  const events: ChatStreamEvent[] = [];
  const logged: string[] = [];
  const chatHistory = realStore();
  const deps = {
    chatHistory,
    timeZone: "America/New_York",
    now: () => NOW,
    emit: (e: ChatStreamEvent) => events.push(e),
    log: (e: { event: string }) => logged.push(e.event),
    runChatTurn,
    ...extra,
  } as unknown as ChatExchangeDeps;
  return { deps, events, logged, chatHistory };
}

const ok = (reply: string, extra: Partial<ChatTurnResponse> = {}): Result<ChatTurnResponse, YohError> => ({
  ok: true,
  value: { reply, receipts: [], ...extra },
});

test("stores the user turn before the inner turn and the Yoh turn after done", async () => {
  let seenDuringTurn: string[] = [];
  const h = makeDeps(async (d) => {
    seenDuringTurn = h.chatHistory.turnsForDate("2026-08-22").map((t) => t.role);
    d.emit?.({ type: "delta", text: "Hel" });
    d.emit?.({ type: "delta", text: "lo" });
    return ok("Hello");
  });
  const result = await chatExchange(h.deps, { message: "  hi  " });
  assert.deepEqual(seenDuringTurn, ["user"]);
  assert.equal(result.ok, true);
  assert.deepEqual(h.events.map((e) => e.type), ["delta", "delta", "done"]);
  const turns = h.chatHistory.turnsForDate("2026-08-22");
  assert.deepEqual(turns.map((t) => [t.role, t.text, t.truncated]), [["user", "hi", false], ["assistant", "Hello", false]]);
});

test("Yoh turn text appends the question text; card-only reply is not stored", async () => {
  const q = { requestId: "r", questionId: "q", text: "Move it?", options: [], allowsFreeText: false };
  const h = makeDeps(async () => ok("Sure.", { question: q }));
  await chatExchange(h.deps, { message: "x" });
  assert.equal(h.chatHistory.turnsForDate("2026-08-22")[1]?.text, "Sure.\n\nMove it?");

  const h2 = makeDeps(async () => ok("", {}));
  await chatExchange(h2.deps, { message: "x" });
  assert.equal(h2.chatHistory.turnsForDate("2026-08-22").length, 1);
});

test("a failed inner Result is returned without a done event or Yoh turn", async () => {
  const error: YohError = { kind: "unreachable", message: "down" };
  const h = makeDeps(async () => ({ ok: false, error }));
  const result = await chatExchange(h.deps, { message: "x" });
  assert.deepEqual(result, { ok: false, error });
  assert.deepEqual(h.events, []);
  assert.equal(h.chatHistory.turnsForDate("2026-08-22").length, 1);
});

test("store write failure is logged and the answer still streams", async () => {
  const broken = { appendTurn: () => { throw new Error("disk"); }, turnsForDate: () => [], clearAll: () => {} } as ChatStore;
  const h = makeDeps(async () => ok("fine"), { chatHistory: broken });
  const result = await chatExchange(h.deps, { message: "x" });
  assert.equal(result.ok, true);
  assert.deepEqual(h.events.map((e) => e.type), ["done"]);
  assert.deepEqual(h.logged, ["chat-exchange.history-write-failed", "chat-exchange.history-write-failed"]);
});

test("an aborted stream stores the partial text as truncated", async () => {
  const h = makeDeps(async (d) => {
    d.emit?.({ type: "delta", text: "part" });
    return ok("partial full reply");
  }, { isAborted: () => true });
  const result = await chatExchange(h.deps, { message: "x" });
  assert.equal(result.ok && result.value.truncated, true);
  const yoh = h.chatHistory.turnsForDate("2026-08-22")[1];
  assert.deepEqual([yoh?.text, yoh?.truncated], ["part", true]);
});

test("an aborted stream with nothing sent stores no Yoh turn", async () => {
  const h = makeDeps(async () => ok("never seen"), { isAborted: () => true });
  await chatExchange(h.deps, { message: "x" });
  assert.equal(h.chatHistory.turnsForDate("2026-08-22").length, 1);
});

test("without a chat store it neither needs timeZone/now nor stores anything", async () => {
  const events: ChatStreamEvent[] = [];
  const deps = { emit: (e: ChatStreamEvent) => events.push(e), runChatTurn: async () => ok("hi") } as unknown as ChatExchangeDeps;
  const result = await chatExchange(deps, { message: "x" });
  assert.equal(result.ok, true);
  assert.deepEqual(events.map((e) => e.type), ["done"]);
});
