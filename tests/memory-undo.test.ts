/** Story 13.4 Part 3: undoMemoryReceipt, the forget disambiguation answer, ChatStore.hasUserTurnAfter. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createChatStore, initChatStoreSchema } from "../src/adapters/chat-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { createMemoryStore, getOpenInteractionRequest, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { undoMemoryReceipt } from "../src/app/memory-undo.ts";
import { ruleChangeRequestId } from "../src/core/rule-change.ts";
import { answerOpenItem } from "../src/app/answer-open-item.ts";
import { surfaceOpenItems } from "../src/app/surface-open-items.ts";

function world() {
  const c = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(c.db);
  initChatStoreSchema(c.db);
  initMemoryItemStoreSchema(c.db);
  return { chatHistory: createChatStore(c), memoryItems: createMemoryItemStore(c), store: createMemoryStore(c) };
}
const NEW = (o: object = {}) => ({ folder: "about-you" as const, text: "Runs at 6", origin: "stated" as const, ...o });
const T = (n: number) => `2026-09-29T1${n}:00:00.000Z`;

test("hasUserTurnAfter is true only when a later user turn exists", () => {
  const { chatHistory } = world();
  const u1 = chatHistory.appendTurn({ date: "2026-09-29", role: "user", text: "a", at: T(0) });
  chatHistory.appendTurn({ date: "2026-09-29", role: "assistant", text: "b", at: T(1) });
  assert.equal(chatHistory.hasUserTurnAfter(u1.conversationId, u1.id), false);
  chatHistory.appendTurn({ date: "2026-09-29", role: "user", text: "c", at: T(2) });
  assert.equal(chatHistory.hasUserTurnAfter(u1.conversationId, u1.id), true);
});

test("undo of a remembered receipt removes the item; second undo conflicts", async () => {
  const w = world();
  const u = w.chatHistory.appendTurn({ date: "2026-09-29", role: "user", text: "remember", at: T(0) });
  const item = w.memoryItems.insert(NEW());
  w.memoryItems.putReceipt({ receiptId: "r1", conversationId: u.conversationId, userTurnId: u.id, kind: "remembered", itemIds: [item.id], chainIds: [item.id], createdAt: T(0) });
  const r = await undoMemoryReceipt(w, { receiptId: "r1" });
  assert.ok(r.ok);
  assert.equal(r.value.message, "Removed from memory.");
  assert.equal(w.memoryItems.getItem(item.id), undefined);
  const again = await undoMemoryReceipt(w, { receiptId: "r1" });
  assert.ok(!again.ok && again.error.kind === "conflict");
});

test("undo of a forgot receipt restores the chain", async () => {
  const w = world();
  const u = w.chatHistory.appendTurn({ date: "2026-09-29", role: "user", text: "forget", at: T(0) });
  const item = w.memoryItems.insert(NEW());
  const { chainIds } = w.memoryItems.forget(item.id);
  w.memoryItems.putReceipt({ receiptId: "r2", conversationId: u.conversationId, userTurnId: u.id, kind: "forgot", itemIds: [item.id], chainIds, createdAt: T(0) });
  const r = await undoMemoryReceipt(w, { receiptId: "r2" });
  assert.ok(r.ok);
  assert.equal(r.value.message, "Restored to memory.");
  assert.equal(w.memoryItems.getItem(item.id)?.status, "current");
});

test("undo is refused after a later user turn, and for unknown receipts", async () => {
  const w = world();
  const u = w.chatHistory.appendTurn({ date: "2026-09-29", role: "user", text: "remember", at: T(0) });
  const item = w.memoryItems.insert(NEW());
  w.memoryItems.putReceipt({ receiptId: "r3", conversationId: u.conversationId, userTurnId: u.id, kind: "remembered", itemIds: [item.id], chainIds: [item.id], createdAt: T(0) });
  w.chatHistory.appendTurn({ date: "2026-09-29", role: "user", text: "next", at: T(1) });
  const r = await undoMemoryReceipt(w, { receiptId: "r3" });
  assert.ok(!r.ok && r.error.kind === "conflict");
  assert.equal(w.memoryItems.getItem(item.id)?.status, "current");
  const unknown = await undoMemoryReceipt(w, { receiptId: "nope" });
  assert.ok(!unknown.ok && unknown.error.kind === "conflict");
});

function forgetRequest(w: ReturnType<typeof world>, ids: string[]) {
  putOpenInteractionRequest(w.store, "memory-forget:1", { requestKind: "memory-forget", promptText: "Which one?", detail: { itemIds: ids }, createdAt: T(0) });
}
const base = (w: ReturnType<typeof world>) => ({
  store: w.store,
  memoryItems: w.memoryItems,
  session: { recentMessages: [], lastSearchAnswer: undefined },
  updateTaskField: async () => ({ ok: true as const, value: undefined }),
  setTaskStatus: async () => ({ ok: true as const, value: undefined }),
  recordCompletion: () => {},
  lookupTask: async () => undefined,
  today: "2026-09-29",
  random: () => 0,
});

test("surfaceOpenItems builds the memory-forget question with folder labels and None of these", async () => {
  const w = world();
  const a = w.memoryItems.insert(NEW({ text: "A one" }));
  const b = w.memoryItems.insert(NEW({ folder: "ideas-notes", text: "B two" }));
  forgetRequest(w, [a.id, b.id]);
  const r = await surfaceOpenItems(base(w), {});
  assert.ok(r.ok);
  const q = r.value.items[0]?.question;
  assert.deepEqual(q?.options.map((o) => o.label), ["A one · About you", "B two · Ideas & notes", "None of these"]);
  assert.equal(q?.allowsFreeText, false);
});

test("answering memory-forget forgets the chosen item; none removes nothing", async () => {
  const w = world();
  const a = w.memoryItems.insert(NEW({ text: "A one" }));
  const b = w.memoryItems.insert(NEW({ text: "B two" }));
  forgetRequest(w, [a.id, b.id]);
  const r = await answerOpenItem(base(w), { requestId: "memory-forget:1", questionId: "pick", answer: a.id });
  assert.ok(r.ok);
  assert.equal(r.value.message, "Forgot: A one.");
  assert.equal(r.value.next, "done");
  assert.equal(w.memoryItems.getItem(a.id)?.status, "deleted");
  assert.equal(w.memoryItems.getItem(b.id)?.status, "current");
  assert.equal(getOpenInteractionRequest(w.store, "memory-forget:1"), undefined);

  forgetRequest(w, [b.id]);
  const n = await answerOpenItem(base(w), { requestId: "memory-forget:1", questionId: "pick", answer: "none" });
  assert.ok(n.ok);
  assert.equal(n.value.message, "Okay, nothing removed.");
  assert.equal(w.memoryItems.getItem(b.id)?.status, "current");
});

test("answering memory-forget withdraws the item's open rule-change proposal", async () => {
  const w = world();
  const a = w.memoryItems.insert(NEW({ folder: "planning-preferences", text: "A one", ruleChange: "pending" }));
  const b = w.memoryItems.insert(NEW({ text: "B two" }));
  const rid = ruleChangeRequestId(a.id);
  putOpenInteractionRequest(w.store, rid, { requestKind: "proposal", promptText: "x", createdAt: T(0) } as never);
  forgetRequest(w, [a.id, b.id]);
  const r = await answerOpenItem(base(w), { requestId: "memory-forget:1", questionId: "pick", answer: a.id });
  assert.ok(r.ok);
  assert.equal(getOpenInteractionRequest(w.store, rid), undefined);
});

test("I2: forgetting a pending item withdraws its card and resets it, so Undo leaves no stranded 'pending'", async () => {
  const w = world();
  const u = w.chatHistory.appendTurn({ date: "2026-09-29", role: "user", text: "forget", at: T(0) });
  const item = w.memoryItems.insert(NEW({ folder: "planning-preferences", text: "Start at 4", ruleChange: "pending" }));
  const { chainIds } = w.memoryItems.forget(item.id);
  w.memoryItems.putReceipt({ receiptId: "r-i2", conversationId: u.conversationId, userTurnId: u.id, kind: "forgot", itemIds: [item.id], chainIds, createdAt: T(0) });
  const r = await undoMemoryReceipt(w, { receiptId: "r-i2" });
  assert.ok(r.ok);
  assert.equal(w.memoryItems.getItem(item.id)?.status, "current");
  assert.equal(w.memoryItems.getItem(item.id)?.ruleChange, "none");
});

test("M3: undoing a Remembered receipt is refused once an item was edited away from current", async () => {
  const w = world();
  const u = w.chatHistory.appendTurn({ date: "2026-09-29", role: "user", text: "remember", at: T(0) });
  const item = w.memoryItems.insert(NEW());
  w.memoryItems.putReceipt({ receiptId: "r-m3", conversationId: u.conversationId, userTurnId: u.id, kind: "remembered", itemIds: [item.id], chainIds: [item.id], createdAt: T(0) });
  w.memoryItems.supersede(item.id, NEW({ text: "Runs at 7" }));
  const r = await undoMemoryReceipt(w, { receiptId: "r-m3" });
  assert.ok(!r.ok && r.error.kind === "conflict" && r.error.message === "That can't be undone any more.");
  assert.equal(w.memoryItems.listItems().length, 1);
});
