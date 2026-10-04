/** Sorting feedback in the memory item store: one verdict per item, following it through versions and deletes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";

function fresh() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  return { connection, store: createMemoryItemStore(connection) };
}
const T1 = "2026-09-29T10:00:00.000Z";
const T2 = "2026-09-29T11:00:00.000Z";
const outboxCount = (c: ReturnType<typeof fresh>["connection"]) => tailOutboxSince(c, 0).length;

test("one verdict per item, snapshotting its text and folder; one outbox row", () => {
  const { connection, store } = fresh();
  const a = store.insert({ folder: "about-you", text: "Prefers deep work before lunch", origin: "stated", at: T1 });
  const before = outboxCount(connection);
  const saved = store.putSortFeedback({ itemId: a.id, verdict: "wrong", reason: "It's a rule.", belongsIn: "planning-preferences", at: T1 });
  assert.equal(outboxCount(connection), before + 1);
  assert.deepEqual(saved, { itemId: a.id, text: "Prefers deep work before lunch", folder: "about-you", verdict: "wrong", reason: "It's a rule.", belongsIn: "planning-preferences", createdAt: T1 });
  store.putSortFeedback({ itemId: a.id, verdict: "right", reason: "On reflection it is about me.", at: T2 });
  assert.deepEqual(store.listSortFeedback(), [{ itemId: a.id, text: "Prefers deep work before lunch", folder: "about-you", verdict: "right", reason: "On reflection it is about me.", createdAt: T2 }]);
  assert.throws(() => store.putSortFeedback({ itemId: "nope", verdict: "right", reason: "x" }));
});

test("newest first, limited, and follows the item to its next version", () => {
  const { store } = fresh();
  const a = store.insert({ folder: "about-you", text: "A", origin: "stated", at: T1 });
  const b = store.insert({ folder: "ideas-notes", text: "B", origin: "stated", at: T1 });
  store.putSortFeedback({ itemId: a.id, verdict: "right", reason: "ra", at: T1 });
  store.putSortFeedback({ itemId: b.id, verdict: "wrong", reason: "rb", at: T2 });
  assert.deepEqual(store.listSortFeedback().map((f) => f.reason), ["rb", "ra"]);
  assert.deepEqual(store.listSortFeedback(1).map((f) => f.reason), ["rb"]);

  const a2 = store.supersede(a.id, { folder: "corrections", text: "A edited", origin: "stated", at: T2 });
  const moved = store.listSortFeedback().find((f) => f.reason === "ra");
  assert.equal(moved?.itemId, a2.id);
  assert.equal(moved?.folder, "about-you");
  assert.equal(moved?.text, "A");
  store.undoFiling(a2.id);
  assert.equal(store.listSortFeedback().find((f) => f.reason === "ra")?.itemId, a.id);

  const merged = store.merge([a.id, b.id], { folder: "about-you", text: "AB", origin: "stated", at: T2 });
  assert.deepEqual(store.listSortFeedback().map((f) => f.itemId), [merged.id]);
});

test("hidden while its item is deleted, gone once the item is purged", () => {
  const { store } = fresh();
  const a = store.insert({ folder: "about-you", text: "A", origin: "stated", at: T1 });
  store.putSortFeedback({ itemId: a.id, verdict: "right", reason: "ra", at: T1 });
  const { chainIds } = store.forget(a.id);
  assert.deepEqual(store.listSortFeedback(), []);
  store.restore(chainIds);
  assert.equal(store.listSortFeedback().length, 1);

  store.forget(a.id);
  store.purgeChain(chainIds);
  const b = store.insert({ folder: "about-you", text: "B", origin: "stated", at: T1 });
  store.putSortFeedback({ itemId: b.id, verdict: "right", reason: "rb", at: T1 });
  store.undoFiling(b.id);
  const c = store.insert({ folder: "about-you", text: "C", origin: "stated", at: T1 });
  store.putSortFeedback({ itemId: c.id, verdict: "right", reason: "rc", at: T1 });
  store.forget(c.id);
  assert.equal(store.purgeDeleted(), 1);
  const d = store.insert({ folder: "about-you", text: "D", origin: "stated", at: T1 });
  assert.deepEqual(store.listSortFeedback(), []);

  store.putSortFeedback({ itemId: d.id, verdict: "right", reason: "rd", at: T1 });
  store.clearAll();
  assert.deepEqual(store.listSortFeedback(), []);
});
