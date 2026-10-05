/** Tests for `src/app/chat-exchange.ts` (Story 13.1, E2/E4). Fake inner turn; real in-memory chat store. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatStore, initChatStoreSchema, type ChatStore } from "../src/adapters/chat-store.ts";
import { createRatingStore, initRatingStoreSchema } from "../src/adapters/rating-store.ts";
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

test("stores the user turn before the inner turn and the Meeseek turn after done", async () => {
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

test("Meeseek turn text appends the question text; card-only reply is not stored", async () => {
  const q = { requestId: "r", questionId: "q", text: "Move it?", options: [], allowsFreeText: false };
  const h = makeDeps(async () => ok("Sure.", { question: q }));
  await chatExchange(h.deps, { message: "x" });
  assert.equal(h.chatHistory.turnsForDate("2026-08-22")[1]?.text, "Sure.\n\nMove it?");

  const h2 = makeDeps(async () => ok("", {}));
  await chatExchange(h2.deps, { message: "x" });
  assert.equal(h2.chatHistory.turnsForDate("2026-08-22").length, 1);
});

test("a failed inner Result is returned without a done event or Meeseek turn", async () => {
  const error: YohError = { kind: "unreachable", message: "down" };
  const h = makeDeps(async () => ({ ok: false, error }));
  const result = await chatExchange(h.deps, { message: "x" });
  assert.deepEqual(result, { ok: false, error });
  assert.deepEqual(h.events, []);
  assert.equal(h.chatHistory.turnsForDate("2026-08-22").length, 1);
});

test("store write failure is logged and the answer still streams", async () => {
  const broken = { appendTurn: () => { throw new Error("disk"); }, turnsForDate: () => [], clearAll: () => {}, hasUserTurnAfter: () => false, getTurn: () => undefined, searchTurns: () => [], listConversations: () => [], conversationTurns: () => undefined, deleteConversation: () => false } as ChatStore;
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

test("an aborted stream with nothing sent stores no Meeseek turn", async () => {
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

// ---- Story 13.5: automatic filing ----
const plainTurn = (extra: Partial<ChatTurnResponse> = {}): ChatTurnFn => async () => ok("Sure thing.", extra);
const CHEM = "I have chemistry club every Tuesday after school";
const userMessages = (client: unknown): string => JSON.stringify((client as { calls: unknown[] }).calls);

test("auto filing: trivial, deterministic, memory-directive, or store-less turns make no model call", async () => {
  for (const [msg, turn, extra] of [
    ["ok thanks", plainTurn(), {}],
    [CHEM, plainTurn({ handledDeterministically: true }), {}],
    [CHEM, rememberTurn, {}],
    [CHEM, plainTurn(), { memoryItems: undefined }],
  ] as const) {
    const client = fakeFiler('[{"folder":"about-you","text":"x","origin":"stated"}]');
    const h = memoryHarness(turn, { memoryLlmClient: client, ...extra } as unknown as Partial<ChatExchangeDeps>);
    await chatExchange(h.deps, { message: msg });
    if (turn !== rememberTurn) assert.equal((client as unknown as { calls: unknown[] }).calls.length, 0, msg);
    if (turn !== rememberTurn) assert.deepEqual(h.events.map((e) => e.type), ["done"]);
  }
});

test("auto filing: after done, files stated item with receipt; handledDeterministically stripped; only typed text + always-loaded sent", async () => {
  const client = fakeFiler('[{"folder":"about-you","text":"Chemistry club every Tuesday after school","origin":"stated"}]');
  const h = memoryHarness(plainTurn({ handledDeterministically: false }), { memoryLlmClient: client });
  h.memoryItems.insert({ folder: "about-you", text: "ALWAYS-LOADED-MARK", origin: "stated" });
  const result = await chatExchange(h.deps, { message: CHEM });
  assert.equal(result.ok, true);
  assert.deepEqual(h.events.map((e) => e.type), ["done", "remembered"]);
  const done = h.events[0];
  assert.ok(done?.type === "done" && done.response.handledDeterministically === undefined);
  const rem = h.events[1];
  assert.ok(rem?.type === "remembered" && rem.receipt.items.length === 1);
  const userTurn = h.chatHistory.turnsForDate("2026-08-22")[0]!;
  assert.equal(h.memoryItems.getItem(rem.receipt.items[0]!.id)?.sourceTurnId, userTurn.id);
  assert.ok(h.memoryItems.getReceipt(rem.receipt.receiptId));
  const sent = userMessages(client);
  assert.match(sent, /chemistry club/);
  assert.match(sent, /ALWAYS-LOADED-MARK/);
  assert.doesNotMatch(sent, /Sure thing/);
});

test("auto filing: clamps to two; drops inferred feedback and inferred health", async () => {
  const many = fakeFiler(JSON.stringify([1, 2, 3].map((n) => ({ folder: "about-you", text: `fact ${n}`, origin: "stated" }))));
  const h1 = memoryHarness(plainTurn(), { memoryLlmClient: many });
  await chatExchange(h1.deps, { message: CHEM });
  assert.equal(h1.memoryItems.listItems().length, 2);
  const bad = fakeFiler(JSON.stringify([
    { folder: "feedback", text: "prefers short plans", origin: "inferred", scope: "plans" },
    { folder: "about-you", text: "seems anxious", origin: "inferred", sensitive: "emotion" },
    { folder: "about-you", text: "takes meds", origin: "inferred", sensitive: "health" },
  ]));
  const h2 = memoryHarness(plainTurn(), { memoryLlmClient: bad });
  await chatExchange(h2.deps, { message: CHEM });
  assert.equal(h2.memoryItems.listItems().length, 0);
  assert.deepEqual(h2.events.map((e) => e.type), ["done"]);
});

test("auto filing: feedback without scope stores the narrowest reading; receipt carries it", async () => {
  const client = fakeFiler('[{"folder":"feedback","text":"Keep replies short","origin":"stated"}]');
  const h = memoryHarness(plainTurn(), { memoryLlmClient: client });
  await chatExchange(h.deps, { message: "Please keep your replies shorter from now on" });
  const rem = h.events[1];
  assert.ok(rem?.type === "remembered");
  assert.equal(rem.receipt.items[0]?.scope, "this kind of request");
});

test("auto filing: a restate makes a new version; a contradiction supersedes and stays as history", async () => {
  const h = memoryHarness(plainTurn(), {});
  const a = h.memoryItems.insert({ folder: "about-you", text: "Runs at 6", origin: "stated" });
  const b = h.memoryItems.insert({ folder: "about-you", text: "Works at the cafe", origin: "stated" });
  (h.deps as { memoryLlmClient?: unknown }).memoryLlmClient = fakeFiler(JSON.stringify([
    { folder: "about-you", text: "Runs at 6 sharp", origin: "stated", restatesId: a.id },
    { folder: "about-you", text: "Quit the cafe", origin: "stated", contradictsId: b.id },
  ]));
  await chatExchange(h.deps, { message: "I run at 6 sharp and I quit the cafe last week" });
  assert.equal(h.memoryItems.getItem(a.id)?.status, "superseded");
  assert.equal(h.memoryItems.getItem(b.id)?.status, "superseded");
  assert.deepEqual(h.memoryItems.listItems().map((i) => i.text).sort(), ["Quit the cafe", "Runs at 6 sharp"]);
});

test("auto filing: a ruleChange candidate files as an ordinary item with no rule change", async () => {
  const client = fakeFiler('[{"folder":"planning-preferences","text":"Start work at 2:30 on school days","origin":"stated","ruleChange":{"key":"schoolDayWorkStart","value":"14:30"}}]');
  const h = memoryHarness(plainTurn(), { memoryLlmClient: client });
  await chatExchange(h.deps, { message: "Please start my work at 2:30 on school days from now on" });
  const items = h.memoryItems.listItems();
  assert.equal(items.length, 1);
  assert.equal(items[0]?.ruleChange ?? "none", "none");
});

test("auto filing: timeout or failure shows nothing, logs, never delays or errors; aborted files nothing", async () => {
  for (const client of [fakeFiler("hang"), fakeFiler(new Error("net"))]) {
    const h = memoryHarness(plainTurn(), { memoryLlmClient: client, memoryFilingTimeoutMs: 20 } as Partial<ChatExchangeDeps>);
    const result = await chatExchange(h.deps, { message: CHEM });
    assert.equal(result.ok, true);
    assert.deepEqual(h.events.map((e) => e.type), ["done"]);
    assert.ok(h.logged.includes("chat-exchange.filing-failed"));
  }
  const client = fakeFiler('[{"folder":"about-you","text":"x","origin":"stated"}]');
  const h = memoryHarness(plainTurn(), { memoryLlmClient: client, isAborted: () => true });
  await chatExchange(h.deps, { message: CHEM });
  assert.equal((client as unknown as { calls: unknown[] }).calls.length, 0);
});

// ---- Story 13.5 fix round ----
function delayedFiler(text: string, ms: number) {
  return {
    messages: { create: async () => { await new Promise((r) => setTimeout(r, ms)); return { content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } }; } },
  } as unknown as ChatExchangeDeps["llmClient"];
}

test("auto and explicit filing: an extract that resolves after the timeout files nothing", async () => {
  for (const turn of [plainTurn(), rememberTurn]) {
    const client = delayedFiler('[{"folder":"about-you","text":"late","origin":"stated"}]', 80);
    const h = memoryHarness(turn, { memoryLlmClient: client, memoryFilingTimeoutMs: 10 } as Partial<ChatExchangeDeps>);
    await chatExchange(h.deps, { message: CHEM });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(h.memoryItems.listItems().length, 0);
  }
});

test("auto filing: aborted during the extract files nothing and emits nothing", async () => {
  let aborted = false;
  const client = delayedFiler('[{"folder":"about-you","text":"x","origin":"stated"}]', 30);
  const h = memoryHarness(plainTurn(), { memoryLlmClient: client, isAborted: () => aborted });
  const p = chatExchange(h.deps, { message: CHEM });
  setTimeout(() => { aborted = true; }, 10);
  await p;
  assert.equal(h.memoryItems.listItems().length, 0);
  assert.deepEqual(h.events.map((e) => e.type), ["done"]);
});

test("auto filing: a restatesId outside the always-loaded set inserts instead of superseding", async () => {
  const h = memoryHarness(plainTurn(), {});
  const idea = h.memoryItems.insert({ folder: "ideas-notes", text: "Try pottery", origin: "stated" });
  (h.deps as { memoryLlmClient?: unknown }).memoryLlmClient = fakeFiler(`[{"folder":"about-you","text":"Likes clay","origin":"stated","restatesId":"${idea.id}"}]`);
  await chatExchange(h.deps, { message: CHEM });
  assert.equal(h.memoryItems.getItem(idea.id)?.status, "current");
  assert.equal(h.memoryItems.listItems().length, 2);
});

// ---- Story 13.11: rating ----
function ratingHarness(turn: ChatTurnFn, extra: Partial<ChatExchangeDeps> = {}) {
  const h = memoryHarness(turn, extra);
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initRatingStoreSchema(connection.db);
  const ratings = createRatingStore(connection);
  Object.assign(h.deps, { ratings, ratingDraw: () => 0 });
  return { ...h, ratings };
}

test("rating: a substantive turn emits rating last, after remembered and proposal; done still carries substantive", async () => {
  const client = fakeFiler('[{"folder":"about-you","text":"Chem club is a club","origin":"stated"}]');
  const h = ratingHarness(async () => ok("Plan updated.", { substantive: true }), { memoryLlmClient: client });
  await chatExchange(h.deps, { message: CHEM });
  assert.deepEqual(h.events.map((e) => e.type), ["done", "remembered", "rating"]);
  const done = h.events[0];
  assert.ok(done?.type === "done" && done.response.substantive === true);
  const rating = h.events[2];
  assert.ok(rating?.type === "rating" && rating.promptId === h.ratings.getState().openPromptId);
});

test("rating: never after a non-substantive turn, an unlucky draw, or an abort; a second same-day turn does not prompt", async () => {
  const quiet = ratingHarness(plainTurn());
  await chatExchange(quiet.deps, { message: "hello there" });
  assert.equal(quiet.events.some((e) => e.type === "rating"), false);
  const unlucky = ratingHarness(async () => ok("x", { substantive: true }), { ratingDraw: () => 0.99 } as Partial<ChatExchangeDeps>);
  Object.assign(unlucky.deps, { ratingDraw: () => 0.99 });
  await chatExchange(unlucky.deps, { message: "/morning" });
  assert.equal(unlucky.events.some((e) => e.type === "rating"), false);
  const aborted = ratingHarness(async () => ok("x", { substantive: true }), { isAborted: () => true });
  await chatExchange(aborted.deps, { message: "/morning" });
  assert.equal(aborted.events.some((e) => e.type === "rating"), false);
  const twice = ratingHarness(async () => ok("x", { substantive: true }));
  await chatExchange(twice.deps, { message: "/morning" });
  const firstId = twice.ratings.getState().openPromptId;
  await chatExchange(twice.deps, { message: "/morning" });
  assert.equal(twice.events.filter((e) => e.type === "rating").length, 1);
  assert.equal(twice.ratings.getState().openPromptId, undefined, "the new message dismissed the open prompt");
  assert.equal(twice.ratings.getState().consecutiveDismissals, 1);
  assert.ok(firstId);
});

test("rating: a store failure is logged and never an error event nor a delayed done", async () => {
  const h = ratingHarness(async () => ok("x", { substantive: true }));
  (h.ratings as unknown as { getState: () => never }).getState = () => { throw new Error("boom"); };
  (h.ratings as unknown as { dismissOpen: () => never }).dismissOpen = () => { throw new Error("boom"); };
  const result = await chatExchange(h.deps, { message: "/morning" });
  assert.equal(result.ok, true);
  assert.deepEqual(h.events.map((e) => e.type), ["done"]);
  assert.ok(h.logged.includes("chat-exchange.rating-failed"));
  assert.ok(h.logged.includes("chat-exchange.rating-dismiss-failed"));
});
