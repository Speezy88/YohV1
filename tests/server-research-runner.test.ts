/**
 * Tests for `startResearchJobRunner` in `src/shell/server.ts` (Story 11.3, E11-R9): recovery before the
 * first tick, one job per tick, ticks never overlap. Timers are injected; nothing waits on a real clock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema, listUnreadNotifications } from "../src/adapters/notification-store.ts";
import { claimNextResearchJob, initJobStoreSchema, insertQueuedResearchJobInTx } from "../src/adapters/job-store.ts";
import { RESEARCH_JOB_POLL_INTERVAL_MS, type RunResearchJobDeps } from "../src/app/run-research-job.ts";
import { startResearchJobRunner } from "../src/shell/server.ts";

function setup(searchFn: RunResearchJobDeps["searchFn"]) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initJobStoreSchema(connection.db);
  const deps: RunResearchJobDeps = {
    connection,
    searchFn,
    // A failing binding: every claimed job ends failed, which is enough to observe the runner's scheduling.
    getNotionCreatePageBinding: () => ({ ok: false, error: { kind: "missing-field", message: "x" } }),
    timeZone: "UTC",
    now: () => new Date("2026-10-04T15:00:00.000Z"),
  };
  const queue = (q: string) => connection.writeTx((tx) => insertQueuedResearchJobInTx(tx, { question: q, createdAt: "2026-10-04T14:00:00.000Z" }));
  const status = (id: string) => (connection.db.prepare("SELECT status FROM research_jobs WHERE id = ?").get(id) as { status: string }).status;
  return { connection, deps, queue, status };
}

function fakeTimers() {
  let tick: (() => void) | undefined;
  let cleared = false;
  let intervalMs = -1;
  return {
    setIntervalFn: ((fn: () => void, ms: number) => {
      tick = fn;
      intervalMs = ms;
      return 1 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval,
    clearIntervalFn: (() => {
      cleared = true;
    }) as unknown as typeof clearInterval,
    fire: () => tick?.(),
    get cleared() {
      return cleared;
    },
    get intervalMs() {
      return intervalMs;
    },
  };
}

const okSearch: RunResearchJobDeps["searchFn"] = async () => ({ ok: true, value: { answer: "a", citations: [] } });

test("recovery runs before the first tick: a job left running is failed with a notification and never re-run", async () => {
  const searched: string[] = [];
  const { connection, deps, queue, status } = setup(async (q) => {
    searched.push(q);
    return okSearch(q);
  });
  const stale = queue("stale");
  claimNextResearchJob(connection, "2026-10-04T14:30:00.000Z");
  const timers = fakeTimers();
  const handle = startResearchJobRunner(deps, { setIntervalFn: timers.setIntervalFn, clearIntervalFn: timers.clearIntervalFn, log: () => {} });
  await handle.startup;
  assert.equal(status(stale), "failed");
  assert.deepEqual(
    listUnreadNotifications(connection).map((n) => n.kind),
    ["research-failed"],
  );
  assert.deepEqual(searched, []);
  assert.equal(timers.intervalMs, RESEARCH_JOB_POLL_INTERVAL_MS);
  handle.stop();
  assert.equal(timers.cleared, true);
  connection.close();
});

test("a queued job left from before the restart still runs, one job per tick", async () => {
  const searched: string[] = [];
  const { connection, deps, queue, status } = setup(async (q) => {
    searched.push(q);
    return okSearch(q);
  });
  const a = queue("a");
  const b = queue("b");
  const timers = fakeTimers();
  const handle = startResearchJobRunner(deps, { setIntervalFn: timers.setIntervalFn, clearIntervalFn: timers.clearIntervalFn, log: () => {} });
  await handle.startup;
  await handle.runOnce();
  assert.deepEqual(searched, ["a"]);
  assert.equal(status(a), "failed");
  assert.equal(status(b), "queued");
  await handle.runOnce();
  assert.deepEqual(searched, ["a", "b"]);
  handle.stop();
  connection.close();
});

test("a tick during a running job joins it rather than starting a second", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let calls = 0;
  const { connection, deps, queue } = setup(async (q) => {
    calls += 1;
    await gate;
    return okSearch(q);
  });
  queue("slow");
  queue("next");
  const timers = fakeTimers();
  const handle = startResearchJobRunner(deps, { setIntervalFn: timers.setIntervalFn, clearIntervalFn: timers.clearIntervalFn, log: () => {} });
  await handle.startup;
  const first = handle.runOnce();
  const second = handle.runOnce();
  timers.fire();
  assert.equal(first, second);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(calls, 1);
  handle.stop();
  connection.close();
});
