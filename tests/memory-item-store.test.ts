import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema, MemoryItemValidationError } from "../src/adapters/memory-item-store.ts";

function fresh() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  return { connection, store: createMemoryItemStore(connection) };
}
const T1 = "2026-09-29T10:00:00.000Z";
const T2 = "2026-09-29T11:00:00.000Z";
const outboxCount = (c: ReturnType<typeof fresh>["connection"]) => tailOutboxSince(c, 0).length;

test("supersede marks the old row superseded and inherits ruleChange", () => {
  const { store } = fresh();
  const a = store.insert({ folder: "planning-preferences", text: "No meetings before 10", origin: "stated", ruleChange: "confirmed", at: T1 });
  const b = store.supersede(a.id, { folder: "planning-preferences", text: "No meetings before 11", origin: "stated", at: T2 });
  assert.equal(b.replacesId, a.id);
  assert.equal(b.ruleChange, "confirmed");
  assert.equal(b.confirmedAt, T2);
  assert.equal(store.getItem(a.id)?.status, "superseded");
  assert.deepEqual(store.listItems().map((i) => i.id), [b.id]);
  assert.deepEqual(store.chainOf(a.id).map((i) => i.id), [b.id, a.id]);
});

test("supersede lets next.ruleChange override", () => {
  const { store } = fresh();
  const a = store.insert({ folder: "corrections", text: "alpha rule", origin: "stated", ruleChange: "confirmed" });
  const b = store.supersede(a.id, { folder: "corrections", text: "beta rule", origin: "stated", ruleChange: "declined" });
  assert.equal(b.ruleChange, "declined");
});

test("validation rejects empty and over-long text", () => {
  const { store, connection } = fresh();
  assert.throws(() => store.insert({ folder: "about-you", text: "  ", origin: "stated" }), MemoryItemValidationError);
  assert.throws(() => store.insert({ folder: "about-you", text: "x".repeat(281), origin: "stated" }), (e: unknown) => e instanceof MemoryItemValidationError && e.kind === "validation");
  store.insert({ folder: "about-you", text: "x".repeat(280), origin: "stated" });
  assert.equal(outboxCount(connection), 1);
});

test("merge supersedes both", () => {
  const { store } = fresh();
  const a = store.insert({ folder: "about-you", text: "likes tea", origin: "stated" });
  const b = store.insert({ folder: "about-you", text: "likes green tea", origin: "stated" });
  const m = store.merge([a.id, b.id], { folder: "about-you", text: "likes green tea daily", origin: "stated" });
  assert.equal(m.replacesId, a.id);
  assert.equal(store.getItem(a.id)?.status, "superseded");
  assert.equal(store.getItem(b.id)?.status, "superseded");
  assert.deepEqual(store.listItems().map((i) => i.id), [m.id]);
  assert.equal(store.chainOf(m.id).length, 3);
});

test("forget marks the chain deleted, restore undoes, purge hard-deletes", () => {
  const { store } = fresh();
  const a = store.insert({ folder: "goals-projects", text: "ship quarterly report", origin: "stated" });
  const b = store.supersede(a.id, { folder: "goals-projects", text: "ship quarterly report early", origin: "stated" });
  const { chainIds } = store.forget(a.id);
  assert.deepEqual([...chainIds].sort(), [a.id, b.id].sort());
  assert.equal(store.listItems({ status: ["current", "superseded", "deleted", "history"] }).filter((i) => i.status === "deleted").length, 2);
  assert.deepEqual(store.searchRelevant("quarterly report", ["goals-projects"], 5), []);
  store.restore(chainIds);
  assert.equal(store.getItem(a.id)?.status, "superseded");
  assert.equal(store.getItem(b.id)?.status, "current");
  assert.equal(store.searchRelevant("quarterly report", ["goals-projects"], 5).length, 1);
  store.forget(b.id);
  assert.equal(store.purgeDeleted(), 2);
  assert.equal(store.getItem(a.id), undefined);
  assert.deepEqual(store.searchRelevant("quarterly", ["goals-projects"], 5), []);
});

test("undoFiling removes the new row and revives the old", () => {
  const { store } = fresh();
  const a = store.insert({ folder: "corrections", text: "old wording here", origin: "stated" });
  const b = store.supersede(a.id, { folder: "corrections", text: "new wording here", origin: "stated" });
  store.undoFiling(b.id);
  assert.equal(store.getItem(b.id), undefined);
  assert.equal(store.getItem(a.id)?.status, "current");
  assert.equal(store.getItem(a.id)?.replacesId, undefined);
});

test("keepAsHistory excludes from lists and search", () => {
  const { store } = fresh();
  const a = store.insert({ folder: "decisions-commitments", text: "chose vendor acme", origin: "stated" });
  store.keepAsHistory(a.id);
  assert.equal(store.getItem(a.id)?.status, "history");
  assert.deepEqual(store.listItems(), []);
  assert.equal(store.listItems({ status: ["history"] }).length, 1);
  assert.deepEqual(store.searchRelevant("vendor acme", ["decisions-commitments"], 5), []);
});

test("searchRelevant filters by folder, is syntax-safe, ranks and limits", () => {
  const { store } = fresh();
  store.insert({ folder: "goals-projects", text: "Launch the website redesign", origin: "stated" });
  store.insert({ folder: "goals-projects", text: "Website copy review with Dana", origin: "stated" });
  store.insert({ folder: "ideas-notes", text: "Website idea: dark mode", origin: "stated" });
  assert.equal(store.searchRelevant("website", ["goals-projects"], 10).length, 2);
  assert.equal(store.searchRelevant("website", ["goals-projects"], 1).length, 1);
  assert.equal(store.searchRelevant("website", ["ideas-notes"], 10).length, 1);
  assert.deepEqual(store.searchRelevant('" OR NOT ( * ^ a', ["goals-projects"], 5), []);
  assert.deepEqual(store.searchRelevant("", ["goals-projects"], 5), []);
  assert.equal(store.searchRelevant('website"); DROP TABLE memory_items; --', ["goals-projects"], 5).length, 2);
});

test("touchMatched, setRuleChange, and every write appends one memory outbox row", () => {
  const { store, connection } = fresh();
  const a = store.insert({ folder: "about-you", text: "prefers mornings", origin: "inferred" });
  assert.equal(outboxCount(connection), 1);
  store.touchMatched([a.id], T2);
  assert.equal(store.getItem(a.id)?.lastMatchedAt, T2);
  store.setRuleChange(a.id, "pending");
  assert.equal(store.getItem(a.id)?.ruleChange, "pending");
  const b = store.supersede(a.id, { folder: "about-you", text: "prefers early mornings", origin: "inferred" });
  store.keepAsHistory(b.id);
  const { chainIds } = store.forget(a.id);
  store.restore(chainIds);
  store.purgeDeleted();
  const rows = tailOutboxSince(connection, 0);
  assert.ok(rows.every((r) => r.topic === "memory"));
  assert.ok(rows.length >= 6);
  const before = rows.length;
  store.getItem(a.id); store.listItems(); store.searchRelevant("mornings", ["about-you"], 3);
  assert.equal(outboxCount(connection), before);
});

test("pattern state upsert and clearAll", () => {
  const { store } = fresh();
  assert.equal(store.getPatternState("slip", "Work"), undefined);
  store.putPatternState({ kind: "slip", area: "Work", pendingProposalId: "p1" });
  store.putPatternState({ kind: "slip", area: "Work", declinedAt: T1, lastOfferedOn: "2026-09-29" });
  assert.deepEqual(store.getPatternState("slip", "Work"), { kind: "slip", area: "Work", declinedAt: T1, lastOfferedOn: "2026-09-29" });
  assert.equal(store.listPatternStates().length, 1);
  store.insert({ folder: "patterns", text: "slips on Fridays", origin: "inferred" });
  store.clearAll();
  assert.deepEqual(store.listPatternStates(), []);
  assert.deepEqual(store.listItems(), []);
  assert.deepEqual(store.searchRelevant("Fridays", ["patterns"], 5), []);
});

test("receipts: put/get/latest/markUndone with outbox hints", () => {
  const { store, connection } = fresh();
  const before = outboxCount(connection);
  store.putReceipt({ receiptId: "r1", conversationId: "c1", userTurnId: "t1", kind: "remembered", itemIds: ["a"], chainIds: [], createdAt: T1 });
  store.putReceipt({ receiptId: "r2", conversationId: "c1", userTurnId: "t2", kind: "remembered", itemIds: ["b"], chainIds: [], createdAt: T2 });
  store.putReceipt({ receiptId: "r3", conversationId: "c1", userTurnId: "t3", kind: "forgot", itemIds: [], chainIds: ["x", "y"], createdAt: T2 });
  assert.equal(outboxCount(connection), before + 3);
  assert.deepEqual(store.getReceipt("r3"), { receiptId: "r3", conversationId: "c1", userTurnId: "t3", kind: "forgot", itemIds: [], chainIds: ["x", "y"], createdAt: T2 });
  assert.equal(store.getReceipt("nope"), undefined);
  assert.equal(store.latestReceipt("c1", "remembered")?.receiptId, "r2");
  assert.equal(store.latestReceipt("c2", "remembered"), undefined);
  store.markReceiptUndone("r2", T2);
  assert.equal(store.latestReceipt("c1", "remembered")?.receiptId, "r1");
  assert.equal(store.getReceipt("r2")?.undoneAt, T2);
  assert.equal(outboxCount(connection), before + 4);
});

test("purgeChain removes exactly those rows with one outbox row; a forgotten chain elsewhere survives", () => {
  const { connection, store } = fresh();
  const other = store.insert({ folder: "about-you", text: "kept for undo", origin: "stated" });
  store.forget(other.id);
  const a = store.insert({ folder: "about-you", text: "one", origin: "stated" });
  const b = store.supersede(a.id, { folder: "about-you", text: "two", origin: "stated" });
  const { chainIds } = store.forget(b.id);
  const before = outboxCount(connection);
  store.purgeChain(chainIds);
  assert.equal(store.getItem(a.id), undefined);
  assert.equal(store.getItem(b.id), undefined);
  assert.equal(store.getItem(other.id)?.status, "deleted");
  assert.equal(outboxCount(connection), before + 1);
  store.purgeChain([]);
  assert.equal(outboxCount(connection), before + 1);
});

test("pattern state keeps confirmedAt and migrates an older table that lacks the column", () => {
  const { store, connection } = fresh();
  store.putPatternState({ kind: "area-overrun", area: "History", confirmedAt: T1 });
  assert.deepEqual(store.getPatternState("area-overrun", "History"), { kind: "area-overrun", area: "History", confirmedAt: T1 });
  connection.db.exec("DROP TABLE pattern_state; CREATE TABLE pattern_state (kind TEXT NOT NULL, area TEXT NOT NULL, pending_proposal_id TEXT, declined_at TEXT, last_offered_on TEXT, PRIMARY KEY (kind, area));");
  initMemoryItemStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const again = createMemoryItemStore(connection);
  again.putPatternState({ kind: "area-slips", area: "Work", confirmedAt: T2 });
  assert.equal(again.getPatternState("area-slips", "Work")?.confirmedAt, T2);
});
