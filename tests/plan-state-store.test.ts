/**
 * Tests for `src/adapters/plan-state-store.ts` (Story 7.4, AD-7/AD-10;
 * Story 7.10 adds the pending-check-offs table, AD-20).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import {
  CHECK_OFF_MAX_HOLD_MS,
  claimDueCheckOffInTx,
  createPendingCheckOffInTx,
  deleteUncommittedCheckOffInTx,
  findUncommittedCheckOffForTask,
  getPendingCheckOff,
  holdPendingCheckOff,
  listDueCheckOffs,
  leaseNotionRetryInTx,
  listNotionSyncDueCheckOffs,
  markNotionSyncFailedInTx,
  releasePendingCheckOff,
  removePendingCheckOff,
  UNDO_WINDOW_MS,
  getLastHeartbeatAt,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_STALE_THRESHOLD_MS,
  initPlanStateStoreSchema,
  isHeartbeatStale,
  writeHeartbeat,
} from "../src/adapters/plan-state-store.ts";

function tempStore() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initPlanStateStoreSchema(connection.db);
  return connection;
}

test("HEARTBEAT_INTERVAL_MS and HEARTBEAT_STALE_THRESHOLD_MS are exported once, and the threshold is comfortably larger than the interval", () => {
  assert.equal(HEARTBEAT_INTERVAL_MS, 30_000);
  assert.equal(HEARTBEAT_STALE_THRESHOLD_MS, 300_000);
  assert.ok(HEARTBEAT_STALE_THRESHOLD_MS > HEARTBEAT_INTERVAL_MS * 5, "the threshold must tolerate several missed ticks before alerting, not just one");
});

test("initPlanStateStoreSchema is idempotent", () => {
  const connection = tempStore();
  initPlanStateStoreSchema(connection.db);
  connection.close();
});

test("getLastHeartbeatAt returns undefined before any heartbeat is written", () => {
  const connection = tempStore();
  assert.equal(getLastHeartbeatAt(connection), undefined);
  connection.close();
});

test("writeHeartbeat is a singleton upsert — the latest write replaces the previous one, never appends", () => {
  const connection = tempStore();
  writeHeartbeat(connection, "2026-09-25T00:00:00.000Z");
  writeHeartbeat(connection, "2026-09-25T00:00:30.000Z");
  assert.equal(getLastHeartbeatAt(connection), "2026-09-25T00:00:30.000Z");
  assert.equal((connection.db.prepare("SELECT COUNT(*) AS n FROM heartbeat").get() as { n: number }).n, 1);
  connection.close();
});

test("isHeartbeatStale is true when no heartbeat has ever been written", () => {
  assert.equal(isHeartbeatStale(undefined, new Date("2026-09-25T00:00:00.000Z")), true);
});

test("isHeartbeatStale is false within the threshold, true beyond it", () => {
  const lastAt = "2026-09-25T00:00:00.000Z";
  assert.equal(isHeartbeatStale(lastAt, new Date("2026-09-25T00:04:00.000Z"), 300_000), false);
  assert.equal(isHeartbeatStale(lastAt, new Date("2026-09-25T00:06:00.000Z"), 300_000), true);
});

// ============================================================================
// Pending check-offs (Story 7.10, AD-20)
// ============================================================================

const T0 = "2026-09-25T18:00:00.000Z";

function at(offsetMs: number): string {
  return new Date(Date.parse(T0) + offsetMs).toISOString();
}

function create(connection: ReturnType<typeof tempStore>, taskId = "t1", completedAt = T0) {
  return connection.writeTx((db) => createPendingCheckOffInTx(db, { taskId, taskName: "Draft the memo", completedAt }));
}

test("UNDO_WINDOW_MS is exported once, ~5s; the max hold is far longer than the window", () => {
  assert.equal(UNDO_WINDOW_MS, 5000);
  assert.ok(CHECK_OFF_MAX_HOLD_MS >= 60 * UNDO_WINDOW_MS);
});

test("initPlanStateStoreSchema creates the pending_check_offs table idempotently", () => {
  const connection = tempStore();
  initPlanStateStoreSchema(connection.db);
  const row = connection.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pending_check_offs'").get();
  assert.ok(row);
  connection.close();
});

test("createPendingCheckOffInTx stamps commitAt = completedAt + UNDO_WINDOW_MS and a fresh id", () => {
  const connection = tempStore();
  const a = create(connection, "t1");
  const b = create(connection, "t2");
  assert.notEqual(a.id, b.id);
  assert.equal(a.completedAt, T0);
  assert.equal(a.commitAt, at(UNDO_WINDOW_MS));
  assert.equal(a.heldSince, undefined);
  assert.equal(a.committedAt, undefined);
  assert.deepEqual(getPendingCheckOff(connection, a.id), a);
  connection.close();
});

test("findUncommittedCheckOffForTask finds only a not-yet-committed record for that Task", () => {
  const connection = tempStore();
  const a = create(connection, "t1");
  assert.equal(findUncommittedCheckOffForTask(connection, "t1")?.id, a.id);
  assert.equal(findUncommittedCheckOffForTask(connection, "t2"), undefined);
  connection.writeTx((db) => claimDueCheckOffInTx(db, a.id, new Date(at(UNDO_WINDOW_MS)), at(UNDO_WINDOW_MS)));
  assert.equal(findUncommittedCheckOffForTask(connection, "t1"), undefined);
  connection.close();
});

test("listDueCheckOffs returns only uncommitted, unheld records whose commitAt has passed", () => {
  const connection = tempStore();
  const due = create(connection, "t1", T0);
  create(connection, "t2", at(10_000));
  assert.deepEqual(listDueCheckOffs(connection, new Date(at(6_000))).map((r) => r.id), [due.id]);
  connection.close();
});

test("a held record is never due until its hold goes stale past CHECK_OFF_MAX_HOLD_MS (a tab closed mid-hover still commits)", () => {
  const connection = tempStore();
  const row = create(connection);
  holdPendingCheckOff(connection, row.id, at(2_000));
  assert.equal(listDueCheckOffs(connection, new Date(at(60_000))).length, 0);
  assert.equal(connection.writeTx((db) => claimDueCheckOffInTx(db, row.id, new Date(at(60_000)), at(60_000))), false);
  const stale = new Date(Date.parse(at(2_000)) + CHECK_OFF_MAX_HOLD_MS);
  assert.deepEqual(listDueCheckOffs(connection, stale).map((r) => r.id), [row.id]);
  assert.equal(connection.writeTx((db) => claimDueCheckOffInTx(db, row.id, stale, stale.toISOString())), true);
  connection.close();
});

test("releasePendingCheckOff shifts commitAt forward by exactly the held duration (the timer pauses)", () => {
  const connection = tempStore();
  const row = create(connection); // commitAt T0+5s
  const held = holdPendingCheckOff(connection, row.id, at(2_000));
  assert.equal(held?.heldSince, at(2_000));
  const released = releasePendingCheckOff(connection, row.id, at(5_000)); // held 3s
  assert.equal(released?.commitAt, at(8_000));
  assert.equal(released?.heldSince, undefined);
  connection.close();
});

test("a second hold keeps the first hold's start; release without a hold is a no-op", () => {
  const connection = tempStore();
  const row = create(connection);
  assert.equal(releasePendingCheckOff(connection, row.id, at(1_000))?.commitAt, at(5_000));
  holdPendingCheckOff(connection, row.id, at(1_000));
  holdPendingCheckOff(connection, row.id, at(3_000));
  assert.equal(releasePendingCheckOff(connection, row.id, at(4_000))?.commitAt, at(8_000));
  connection.close();
});

test("hold/release on a committed or missing record return undefined and change nothing", () => {
  const connection = tempStore();
  const row = create(connection);
  connection.writeTx((db) => claimDueCheckOffInTx(db, row.id, new Date(at(5_000)), at(5_000)));
  assert.equal(holdPendingCheckOff(connection, row.id, at(6_000)), undefined);
  assert.equal(releasePendingCheckOff(connection, row.id, at(7_000)), undefined);
  assert.equal(holdPendingCheckOff(connection, "nope", at(6_000)), undefined);
  assert.equal(getPendingCheckOff(connection, row.id)?.heldSince, undefined);
  connection.close();
});

test("deleteUncommittedCheckOffInTx deletes a pending record (undo) but refuses once it has committed", () => {
  const connection = tempStore();
  const a = create(connection, "t1");
  assert.equal(connection.writeTx((db) => deleteUncommittedCheckOffInTx(db, a.id)), "deleted");
  assert.equal(getPendingCheckOff(connection, a.id), undefined);
  assert.equal(connection.writeTx((db) => deleteUncommittedCheckOffInTx(db, a.id)), "missing");

  const b = create(connection, "t2");
  connection.writeTx((db) => claimDueCheckOffInTx(db, b.id, new Date(at(5_000)), at(5_000)));
  assert.equal(connection.writeTx((db) => deleteUncommittedCheckOffInTx(db, b.id)), "committed");
  assert.ok(getPendingCheckOff(connection, b.id));
  connection.close();
});

test("claimDueCheckOffInTx claims a due record exactly once, marking it committed with Notion sync owed", () => {
  const connection = tempStore();
  const row = create(connection);
  assert.equal(connection.writeTx((db) => claimDueCheckOffInTx(db, row.id, new Date(at(4_999)), at(4_999))), false, "not due yet");
  assert.equal(connection.writeTx((db) => claimDueCheckOffInTx(db, row.id, new Date(at(5_000)), at(5_000))), true);
  assert.equal(connection.writeTx((db) => claimDueCheckOffInTx(db, row.id, new Date(at(6_000)), at(6_000))), false, "never claimed twice");
  const claimed = getPendingCheckOff(connection, row.id);
  assert.equal(claimed?.committedAt, at(5_000));
  assert.equal(claimed?.notionSyncPending, true);
  assert.equal(listDueCheckOffs(connection, new Date(at(60_000))).length, 0, "a committed record is never due again");
  connection.close();
});

test("listNotionSyncDueCheckOffs lists committed records still owing Notion, honoring the claim lease and notionRetryAt", () => {
  const connection = tempStore();
  const row = create(connection);
  assert.equal(listNotionSyncDueCheckOffs(connection, new Date(at(5_000))).length, 0, "uncommitted records are not Notion-sync candidates");
  connection.writeTx((db) => claimDueCheckOffInTx(db, row.id, new Date(at(5_000)), at(20_000)));
  assert.equal(listNotionSyncDueCheckOffs(connection, new Date(at(19_999))).length, 0, "the claimer's own first attempt holds a lease");
  assert.deepEqual(listNotionSyncDueCheckOffs(connection, new Date(at(20_000))).map((r) => r.id), [row.id]);

  connection.writeTx((db) => markNotionSyncFailedInTx(db, row.id, at(65_000)));
  assert.equal(listNotionSyncDueCheckOffs(connection, new Date(at(64_999))).length, 0);
  assert.deepEqual(listNotionSyncDueCheckOffs(connection, new Date(at(65_000))).map((r) => r.id), [row.id]);
  connection.close();
});

test("markNotionSyncFailedInTx reports true only on the FIRST failure (one notification per record)", () => {
  const connection = tempStore();
  const row = create(connection);
  connection.writeTx((db) => claimDueCheckOffInTx(db, row.id, new Date(at(5_000)), at(5_000)));
  assert.equal(connection.writeTx((db) => markNotionSyncFailedInTx(db, row.id, at(65_000))), true);
  assert.equal(connection.writeTx((db) => markNotionSyncFailedInTx(db, row.id, at(125_000))), false);
  assert.equal(getPendingCheckOff(connection, row.id)?.notionRetryAt, at(125_000));
  connection.close();
});

test("removePendingCheckOff deletes the record once Notion is in sync", () => {
  const connection = tempStore();
  const row = create(connection);
  removePendingCheckOff(connection, row.id);
  assert.equal(getPendingCheckOff(connection, row.id), undefined);
  connection.close();
});

test("leaseNotionRetryInTx lets exactly one sweep take a due retry", () => {
  const connection = tempStore();
  const row = create(connection);
  assert.equal(connection.writeTx((db) => leaseNotionRetryInTx(db, row.id, new Date(at(6_000)), at(66_000))), false, "uncommitted: nothing to retry");
  connection.writeTx((db) => claimDueCheckOffInTx(db, row.id, new Date(at(5_000)), at(5_000)));
  assert.equal(connection.writeTx((db) => leaseNotionRetryInTx(db, row.id, new Date(at(6_000)), at(66_000))), true);
  assert.equal(connection.writeTx((db) => leaseNotionRetryInTx(db, row.id, new Date(at(6_000)), at(66_000))), false);
  assert.equal(getPendingCheckOff(connection, row.id)?.notionRetryAt, at(66_000));
  connection.close();
});

// T5: day pins and drops
import { listDayDrops, listDayPins, replaceDayPinsAndDropsInTx } from "../src/adapters/plan-state-store.ts";

test("day pins and drops: replace per date, read by date, other dates untouched, init idempotent", () => {
  const connection = tempStore();
  initPlanStateStoreSchema(connection.db);
  const pin = (date: string, taskId: string, start: string) => ({ date, subject: { kind: "task" as const, taskId }, start });
  connection.writeTx((db) => replaceDayPinsAndDropsInTx(db, "2026-08-22", [pin("2026-08-22", "a", "2026-08-22T11:00:00.000Z")], ["x"]));
  connection.writeTx((db) => replaceDayPinsAndDropsInTx(db, "2026-08-23", [pin("2026-08-23", "b", "2026-08-23T11:00:00.000Z")], []));
  assert.deepEqual(listDayPins(connection.db, "2026-08-22").map((p) => p.subject), [{ kind: "task", taskId: "a" }]);
  assert.deepEqual(listDayDrops(connection.db, "2026-08-22"), ["x"]);
  connection.writeTx((db) => replaceDayPinsAndDropsInTx(db, "2026-08-22", [], []));
  assert.deepEqual(listDayPins(connection.db, "2026-08-22"), []);
  assert.deepEqual(listDayDrops(connection.db, "2026-08-22"), []);
  assert.equal(listDayPins(connection.db, "2026-08-23").length, 1);
});
