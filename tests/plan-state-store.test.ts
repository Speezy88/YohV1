/**
 * Tests for `src/adapters/plan-state-store.ts` (Story 7.4, AD-7/AD-10).
 * Only the heartbeat table exists this story — Pins/pending check-offs
 * arrive in Story 7.10.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import {
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
