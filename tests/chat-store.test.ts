/** Tests for `src/adapters/chat-store.ts` (Story 13.1). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { createChatStore, initChatStoreSchema, MEMORY_TOPIC } from "../src/adapters/chat-store.ts";

function tempStore() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initChatStoreSchema(connection.db);
  return { connection, store: createChatStore(connection) };
}

test("appendTurn creates one conversation per date and lists turns oldest first", () => {
  const { store } = tempStore();
  const a = store.appendTurn({ date: "2026-09-29", role: "user", text: "hi", at: "2026-09-29T10:00:00.000Z" });
  const b = store.appendTurn({ date: "2026-09-29", role: "assistant", text: "hello", at: "2026-09-29T10:00:01.000Z" });
  const c = store.appendTurn({ date: "2026-09-30", role: "user", text: "next", at: "2026-09-30T10:00:00.000Z" });
  assert.equal(a.conversationId, b.conversationId);
  assert.notEqual(a.conversationId, c.conversationId);
  assert.deepEqual(store.turnsForDate("2026-09-29").map((t) => t.text), ["hi", "hello"]);
  assert.equal(b.truncated, false);
  assert.deepEqual(store.turnsForDate("2026-01-01"), []);
});

test("turnsForDate with a limit returns the last N turns, oldest first", () => {
  const { store } = tempStore();
  for (let i = 0; i < 5; i++) {
    store.appendTurn({ date: "2026-09-29", role: "user", text: `t${i}`, at: `2026-09-29T10:00:0${i}.000Z` });
  }
  assert.deepEqual(store.turnsForDate("2026-09-29", 2).map((t) => t.text), ["t3", "t4"]);
});

test("truncated flag round-trips", () => {
  const { store } = tempStore();
  store.appendTurn({ date: "2026-09-29", role: "assistant", text: "part", truncated: true, at: "2026-09-29T10:00:00.000Z" });
  assert.equal(store.turnsForDate("2026-09-29")[0]?.truncated, true);
});

test("each append writes one memory outbox row", () => {
  const { connection, store } = tempStore();
  const t = store.appendTurn({ date: "2026-09-29", role: "user", text: "hi", at: "2026-09-29T10:00:00.000Z" });
  const rows = tailOutboxSince(connection, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.topic, MEMORY_TOPIC);
  assert.equal(rows[0]?.entityId, t.conversationId);
});

test("turns are indexed in FTS5 and clearAll empties everything", () => {
  const { connection, store } = tempStore();
  store.appendTurn({ date: "2026-09-29", role: "user", text: "remember the marmalade", at: "2026-09-29T10:00:00.000Z" });
  const hit = connection.db.prepare("SELECT rowid FROM chat_turns_fts WHERE chat_turns_fts MATCH 'marmalade'").all();
  assert.equal(hit.length, 1);
  store.clearAll();
  assert.deepEqual(store.turnsForDate("2026-09-29"), []);
  assert.equal(connection.db.prepare("SELECT rowid FROM chat_turns_fts WHERE chat_turns_fts MATCH 'marmalade'").all().length, 0);
  assert.equal((connection.db.prepare("SELECT count(*) AS n FROM chat_conversations").get() as { n: number }).n, 0);
});

test("initChatStoreSchema is idempotent", () => {
  const { connection } = tempStore();
  initChatStoreSchema(connection.db);
});
