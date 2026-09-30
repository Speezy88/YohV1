/** Story 13.9 Part 2: chat history list, transcript, delete and clear. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { createChatStore, initChatStoreSchema, MEMORY_TOPIC } from "../src/adapters/chat-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { createMemoryStore } from "../src/adapters/memory-store.ts";
import { clearChatHistory, deleteChatConversation, getChatConversation, listChatHistory } from "../src/app/chat-history.ts";
import { viewMemory } from "../src/app/memory-view.ts";
import { searchMemory } from "../src/app/memory-search.ts";

function world() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initChatStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const chatHistory = createChatStore(connection);
  const memoryItems = createMemoryItemStore(connection);
  return { connection, chatHistory, memoryItems };
}

test("deleteChatConversation removes turns and FTS hits; a memory item's source reads 'deleted'", async () => {
  const w = world();
  const t = w.chatHistory.appendTurn({ date: "2026-09-28", role: "user", text: "remember the marmalade", at: "2026-09-28T10:00:00.000Z" });
  w.memoryItems.insert({ folder: "about-you", text: "Likes marmalade", origin: "stated", sourceTurnId: t.id });
  const before = await viewMemory({ memoryItems: w.memoryItems, chatHistory: w.chatHistory, connection: w.connection, store: createMemoryStore(w.connection), now: () => new Date("2026-09-29T15:00:00.000Z"), timeZone: "UTC" }, {});
  assert.ok(before.ok);
  assert.notEqual(before.value.folders.find((f) => f.folder === "about-you")!.items[0]!.source, "deleted");

  const r = await deleteChatConversation({ chatHistory: w.chatHistory }, { conversationId: t.conversationId });
  assert.ok(r.ok);
  assert.deepEqual(w.chatHistory.searchTurns("marmalade", 5), []);
  assert.equal(w.chatHistory.conversationTurns(t.conversationId), undefined);
  const after = await viewMemory({ memoryItems: w.memoryItems, chatHistory: w.chatHistory, connection: w.connection, store: createMemoryStore(w.connection), now: () => new Date("2026-09-29T15:00:00.000Z"), timeZone: "UTC" }, {});
  assert.ok(after.ok);
  const item = after.value.folders.find((f) => f.folder === "about-you")!.items[0]!;
  assert.equal(item.source, "deleted");
  assert.equal(item.text, "Likes marmalade");
  const s = await searchMemory({ memoryItems: w.memoryItems, chatHistory: w.chatHistory, now: () => new Date(), timeZone: "UTC" }, { query: "marmalade" });
  assert.ok(s.ok);
  assert.equal(s.value.turns.length, 0);
  assert.equal(s.value.items.length, 1);

  const again = await deleteChatConversation({ chatHistory: w.chatHistory }, { conversationId: t.conversationId });
  assert.ok(!again.ok);
  assert.equal(again.error.kind, "conflict");
  assert.equal(again.error.message, "That conversation is already gone.");
});

test("listChatHistory is newest first with turn count and a first line trimmed to 80 chars", async () => {
  const w = world();
  w.chatHistory.appendTurn({ date: "2026-09-27", role: "assistant", text: "Morning", at: "2026-09-27T09:00:00.000Z" });
  w.chatHistory.appendTurn({ date: "2026-09-27", role: "user", text: "x".repeat(120), at: "2026-09-27T09:01:00.000Z" });
  w.chatHistory.appendTurn({ date: "2026-09-28", role: "user", text: "  Plan my day  ", at: "2026-09-28T09:00:00.000Z" });
  w.chatHistory.appendTurn({ date: "2026-09-28", role: "assistant", text: "Sure", at: "2026-09-28T09:00:01.000Z" });
  const r = await listChatHistory({ chatHistory: w.chatHistory }, {});
  assert.ok(r.ok);
  assert.deepEqual(r.value.conversations.map((c) => [c.date, c.turnCount, c.firstLine]), [
    ["2026-09-28", 2, "Plan my day"],
    ["2026-09-27", 2, "x".repeat(80)],
  ]);
});

test("getChatConversation attaches a receipt to the assistant turn after a receipted user turn; skips undone and gone items", async () => {
  const w = world();
  const u1 = w.chatHistory.appendTurn({ date: "2026-09-28", role: "user", text: "remember I run at 6", at: "2026-09-28T09:00:00.000Z" });
  const a1 = w.chatHistory.appendTurn({ date: "2026-09-28", role: "assistant", text: "Remembered.", at: "2026-09-28T09:00:01.000Z" });
  const u2 = w.chatHistory.appendTurn({ date: "2026-09-28", role: "user", text: "remember tea", at: "2026-09-28T09:01:00.000Z" });
  w.chatHistory.appendTurn({ date: "2026-09-28", role: "assistant", text: "Done.", at: "2026-09-28T09:01:01.000Z" });
  const item = w.memoryItems.insert({ folder: "about-you", text: "Runs at 6", origin: "stated", scope: "mornings" });
  const tea = w.memoryItems.insert({ folder: "about-you", text: "Tea", origin: "stated" });
  w.memoryItems.putReceipt({ receiptId: "r1", conversationId: u1.conversationId, userTurnId: u1.id, kind: "remembered", itemIds: [item.id], chainIds: [item.id], createdAt: "2026-09-28T09:00:01.000Z" });
  w.memoryItems.putReceipt({ receiptId: "r2", conversationId: u2.conversationId, userTurnId: u2.id, kind: "remembered", itemIds: [tea.id], chainIds: [tea.id], createdAt: "2026-09-28T09:01:01.000Z" });
  w.memoryItems.markReceiptUndone("r2");
  const r = await getChatConversation({ chatHistory: w.chatHistory, memoryItems: w.memoryItems }, { conversationId: u1.conversationId });
  assert.ok(r.ok);
  assert.equal(r.value.date, "2026-09-28");
  assert.deepEqual(r.value.turns.map((t) => t.id).slice(0, 2), [u1.id, a1.id]);
  assert.deepEqual(r.value.turns.map((t) => t.receipt?.receiptId), [undefined, "r1", undefined, undefined]);
  assert.deepEqual(r.value.turns[1]!.receipt!.items, [{ id: item.id, text: "Runs at 6", folder: "about-you", scope: "mornings" }]);
  const gone = await getChatConversation({ chatHistory: w.chatHistory, memoryItems: w.memoryItems }, { conversationId: "nope" });
  assert.ok(!gone.ok);
  assert.equal(gone.error.kind, "conflict");
});

test("clearChatHistory empties everything, appends one memory outbox row, and leaves items alone", async () => {
  const w = world();
  const t = w.chatHistory.appendTurn({ date: "2026-09-28", role: "user", text: "hi", at: "2026-09-28T09:00:00.000Z" });
  w.memoryItems.insert({ folder: "about-you", text: "Keep", origin: "stated", sourceTurnId: t.id });
  const seq = tailOutboxSince(w.connection, 0).length;
  const r = await clearChatHistory({ chatHistory: w.chatHistory }, {});
  assert.ok(r.ok);
  const rows = tailOutboxSince(w.connection, 0);
  assert.equal(rows.length, seq + 1);
  assert.equal(rows.at(-1)!.topic, MEMORY_TOPIC);
  assert.equal(w.chatHistory.listConversations().length, 0);
  assert.equal(w.memoryItems.listItems({}).length, 1);
  await clearChatHistory({ chatHistory: w.chatHistory }, {});
  assert.equal(tailOutboxSince(w.connection, 0).length, seq + 1);
});

test("chat-history routes: list, transcript, delete, clear; work without chat deps; /today is not shadowed", async () => {
  const { createApp } = await import("../src/shell/server.ts");
  const w = world();
  const t = w.chatHistory.appendTurn({ date: "2026-09-28", role: "user", text: "hello there", at: "2026-09-28T09:00:00.000Z" });
  const app = createApp({ connection: w.connection, log: () => {}, chatHistory: w.chatHistory, memoryItems: w.memoryItems });
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const list = (await (await app.request("/api/chat-history")).json()) as { ok: boolean; value: { conversations: { id: string }[] } };
  assert.equal(list.value.conversations[0]!.id, t.conversationId);
  const one = (await (await app.request(`/api/chat-history/${t.conversationId}`)).json()) as { ok: boolean; value: { turns: unknown[] } };
  assert.equal(one.value.turns.length, 1);
  const today = await app.request("/api/chat-history/today");
  assert.notEqual(today.status, 404);
  assert.equal((await post("/api/chat-history/delete", {})).status, 400);
  assert.equal((await post("/api/chat-history/delete", { conversationId: t.conversationId })).status, 200);
  assert.equal((await post("/api/chat-history/delete", { conversationId: t.conversationId })).status, 409);
  assert.equal((await app.request(`/api/chat-history/${t.conversationId}`)).status, 409);
  w.chatHistory.appendTurn({ date: "2026-09-28", role: "user", text: "again", at: "2026-09-28T09:00:00.000Z" });
  assert.equal((await post("/api/chat-history/clear", {})).status, 200);
  assert.equal(w.chatHistory.listConversations().length, 0);
  assert.ok((await createApp({ connection: w.connection, log: () => {} }).request("/api/chat-history")).status >= 500);
});

test("seedFixtureMemory seeds items, two Conversations, a receipt and a setting override", async () => {
  const { seedFixtureMemory, FIXTURE_MEMORY_ITEMS, FIXTURE_CONVERSATIONS } = await import("./e2e/fixture-memory-seed.ts");
  const { listSettingRows } = await import("../src/adapters/settings-store.ts");
  const w = world();
  seedFixtureMemory(w, "2026-09-29");
  seedFixtureMemory(w, "2026-09-29");
  const view = await viewMemory({ memoryItems: w.memoryItems, chatHistory: w.chatHistory, connection: w.connection, store: createMemoryStore(w.connection), now: () => new Date("2026-09-29T15:00:00.000Z"), timeZone: "UTC" }, {});
  assert.ok(view.ok);
  const all = view.value.folders.flatMap((f) => f.items);
  assert.equal(all.length, FIXTURE_MEMORY_ITEMS.length);
  assert.ok(view.value.folders.filter((f) => f.count > 0).length >= 4);
  assert.ok(all.some((i) => i.origin === "inferred") && all.some((i) => i.expiresOn) && all.some((i) => i.scope));
  assert.equal(view.value.needsReview.length, 1);
  assert.equal(view.value.changedSettings.length, 1);
  assert.ok(all.some((i) => typeof i.source === "object"));
  assert.equal(w.chatHistory.listConversations().length, FIXTURE_CONVERSATIONS.length);
  assert.equal(listSettingRows(w.connection.db).length, 1);
  const first = w.chatHistory.listConversations()[0]!;
  const conv = await getChatConversation({ chatHistory: w.chatHistory, memoryItems: w.memoryItems }, { conversationId: first.id });
  assert.ok(conv.ok);
  assert.ok(conv.value.turns.some((t) => t.receipt));
});
