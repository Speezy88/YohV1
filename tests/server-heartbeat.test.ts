/**
 * Tests for `shell/server.ts`'s heartbeat writer (Story 7.4, AD-7).
 * Injects fake `setInterval`/`clearInterval` and a fake clock so the suite
 * never waits on a real 30s interval.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { getLastHeartbeatAt, initPlanStateStoreSchema } from "../src/adapters/plan-state-store.ts";
import { startHeartbeatWriter } from "../src/shell/server.ts";

function fakeTimers() {
  let callback: (() => void) | undefined;
  let intervalMs: number | undefined;
  let cleared = false;
  return {
    setIntervalFn: ((fn: () => void, ms: number) => {
      callback = fn;
      intervalMs = ms;
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setInterval,
    clearIntervalFn: (() => {
      cleared = true;
    }) as typeof clearInterval,
    tick: () => callback?.(),
    get intervalMs() {
      return intervalMs;
    },
    get cleared() {
      return cleared;
    },
  };
}

test("startHeartbeatWriter writes a heartbeat immediately on start", () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initPlanStateStoreSchema(connection.db);
  const timers = fakeTimers();

  const handle = startHeartbeatWriter(connection, {
    now: () => new Date("2026-09-25T00:00:00.000Z"),
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
  });

  assert.equal(getLastHeartbeatAt(connection), "2026-09-25T00:00:00.000Z");
  handle.stop();
  connection.close();
});

test("startHeartbeatWriter writes another heartbeat on every interval tick, at HEARTBEAT_INTERVAL_MS", () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initPlanStateStoreSchema(connection.db);
  const timers = fakeTimers();
  let now = new Date("2026-09-25T00:00:00.000Z");

  startHeartbeatWriter(connection, {
    now: () => now,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
  });

  assert.equal(timers.intervalMs, 30_000);
  now = new Date("2026-09-25T00:00:30.000Z");
  timers.tick();
  assert.equal(getLastHeartbeatAt(connection), "2026-09-25T00:00:30.000Z");
  connection.close();
});

test("stop() clears the interval", () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initPlanStateStoreSchema(connection.db);
  const timers = fakeTimers();
  const handle = startHeartbeatWriter(connection, { setIntervalFn: timers.setIntervalFn, clearIntervalFn: timers.clearIntervalFn });
  handle.stop();
  assert.equal(timers.cleared, true);
  connection.close();
});
