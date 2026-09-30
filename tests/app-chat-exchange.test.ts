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
  const broken = { appendTurn: () => { throw new Error("disk"); }, turnsForDate: () => [], clearAll: () => {}, hasUserTurnAfter: () => false } as ChatStore;
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

// ---- Story 13.4 Part 2: memory directives (post-done seam) ----
import { createMemoryItemStore, initMemoryItemStoreSchema, type MemoryItemStore } from "../src/adapters/memory-item-store.ts";

function memoryHarness(runChatTurn: ChatTurnFn, extra: Partial<ChatExchangeDeps> = {}) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initChatStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const memoryItems = createMemoryItemStore(connection);
  const chatHistory = createChatStore(connection);
  const events: ChatStreamEvent[] = [];
  const logged: string[] = [];
  const deps = {
    chatHistory,
    memoryItems,
    timeZone: "America/New_York",
    now: () => NOW,
    emit: (e: ChatStreamEvent) => events.push(e),
    log: (e: { event: string }) => logged.push(e.event),
    runChatTurn,
    ...extra,
  } as unknown as ChatExchangeDeps;
  return { deps, events, logged, memoryItems, chatHistory };
}

function fakeFiler(text: string | Error | "hang") {
  const calls: unknown[] = [];
  return {
    calls,
    messages: {
      create: async (params: unknown) => {
        calls.push(params);
        if (text === "hang") return new Promise(() => {});
        if (text instanceof Error) throw text;
        return { content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } };
      },
    },
  } as unknown as ChatExchangeDeps["llmClient"];
}

const rememberTurn: ChatTurnFn = async () => ok("Got it.", { memory: { kind: "remember", text: "Chem club is a club" } });

test("remember: files as Stated after done, then emits remembered; memory is stripped from done", async () => {
  const client = fakeFiler('[{"folder":"about-you","text":"Chem club is a club, not a class","origin":"inferred"}]');
  const h = memoryHarness(rememberTurn, { memoryLlmClient: client });
  const result = await chatExchange(h.deps, { message: "remember that Chem club is a club" });
  assert.equal(result.ok, true);
  assert.deepEqual(h.events.map((e) => e.type), ["done", "remembered"]);
  const done = h.events[0];
  assert.ok(done?.type === "done" && done.response.memory === undefined);
  const rem = h.events[1];
  assert.ok(rem?.type === "remembered");
  assert.equal(rem.receipt.kind, "remembered");
  assert.equal(rem.receipt.items.length, 1);
  const item = h.memoryItems.getItem(rem.receipt.items[0]!.id);
  assert.equal(item?.origin, "stated");
  const userTurn = h.chatHistory.turnsForDate("2026-08-22")[0]!;
  assert.equal(item?.sourceTurnId, userTurn.id);
  const stored = h.memoryItems.getReceipt(rem.receipt.receiptId);
  assert.deepEqual([stored?.conversationId, stored?.userTurnId], [userTurn.conversationId, userTurn.id]);
});

test("remember: a restated item supersedes the current one", async () => {
  const h = memoryHarness(rememberTurn, {});
  const old = h.memoryItems.insert({ folder: "about-you", text: "Runs at 6", origin: "stated" });
  (h.deps as { memoryLlmClient?: unknown }).memoryLlmClient = fakeFiler(`[{"folder":"about-you","text":"Runs at 7","origin":"stated","contradictsId":"${old.id}"}]`);
  await chatExchange(h.deps, { message: "remember that I run at 7" });
  assert.equal(h.memoryItems.getItem(old.id)?.status, "superseded");
  assert.equal(h.memoryItems.listItems({ status: ["current"] }).map((i) => i.text).join(), "Runs at 7");
});

test("remember: failure, nothing accepted, and timeout each emit remembered with no items", async () => {
  for (const client of [fakeFiler(new Error("net")), fakeFiler("[]"), fakeFiler("hang")]) {
    const h = memoryHarness(rememberTurn, { memoryLlmClient: client, memoryFilingTimeoutMs: 20 } as Partial<ChatExchangeDeps>);
    const result = await chatExchange(h.deps, { message: "remember that x" });
    assert.equal(result.ok, true);
    assert.deepEqual(h.events.map((e) => e.type), ["done", "remembered"]);
    const rem = h.events[1];
    assert.ok(rem?.type === "remembered" && rem.receipt.items.length === 0);
    assert.equal(h.events.some((e) => e.type === "error"), false);
  }
});

test("remember: an aborted stream files nothing and emits no remembered", async () => {
  const client = fakeFiler('[{"folder":"about-you","text":"x","origin":"stated"}]');
  const h = memoryHarness(rememberTurn, { memoryLlmClient: client, isAborted: () => true });
  await chatExchange(h.deps, { message: "remember that x" });
  assert.deepEqual(h.events.map((e) => e.type), ["done"]);
  assert.equal(h.memoryItems.listItems().length, 0);
});

test("forgot directive emits remembered with the forgot receipt after done", async () => {
  const receipt = { receiptId: "r9", kind: "forgot" as const, items: [{ id: "i", text: "t", folder: "about-you" as const }] };
  const h = memoryHarness(async () => ok("Done.", { memory: { kind: "forgot", receipt, chainIds: ["i"] } }));
  await chatExchange(h.deps, { message: "forget t" });
  assert.deepEqual(h.events.map((e) => e.type), ["done", "remembered"]);
  const rem = h.events[1];
  assert.ok(rem?.type === "remembered" && rem.receipt.receiptId === "r9");
});

test("the inner turn gets turn ids, and purgeDeleted runs after the user turn is stored", async () => {
  let seen: unknown;
  let purged = 0;
  const h = memoryHarness(async (d) => { seen = d.turn; return ok("hi"); });
  (h.memoryItems as MemoryItemStore).purgeDeleted = () => { purged++; return 0; };
  await chatExchange(h.deps, { message: "hello" });
  const t = h.chatHistory.turnsForDate("2026-08-22")[0]!;
  assert.deepEqual(seen, { conversationId: t.conversationId, userTurnId: t.id });
  assert.equal(purged, 1);
});
