/**
 * The Yoh Plan calendar sync's runner: `startPlanCalendarSyncSweep` (startup run,
 * interval, join, stop) and `POST /api/plan/sync`, which shares the sweep's lock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, putPlan } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createApp, startPlanCalendarSyncSweep, PLAN_CALENDAR_SYNC_INTERVAL_MS } from "../src/shell/server.ts";
import { PLAN_SYNC_MISSING_UNCONFIRMED_EVENT, type SyncPlanFromCalendarDeps } from "../src/app/sync-plan-from-calendar.ts";
import { withDeferredWriteHook } from "../src/shell/server-wiring.ts";
import type { LogEntry } from "../src/adapters/logger.ts";
import type { Plan, YohPlanEvent } from "../src/types/domain.ts";

const NOW = new Date("2026-08-22T18:00:00.000Z");

function setup(opts: { withPlan?: boolean; readEvents?: () => Promise<readonly YohPlanEvent[]> } = {}) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  if (opts.withPlan) {
    const plan: Plan = { id: "plan-2026-08-22", date: "2026-08-22", version: 1, reasoning: "x", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), blocks: [] };
    putPlan(store, plan);
  }
  let reads = 0;
  const deps: SyncPlanFromCalendarDeps = {
    store, connection, timeZone: "America/New_York", now: () => NOW,
    readTasks: async () => [],
    readCalendarEvents: async () => [],
    readYohPlanEvents: async () => { reads++; return opts.readEvents ? opts.readEvents() : []; },
    readPlanCalendarSnapshot: () => [],
  };
  return { connection, deps, reads: () => reads };
}

function fakeInterval() {
  let tick: (() => void) | undefined;
  let intervalMs: number | undefined;
  let cleared = false;
  return {
    setIntervalFn: ((fn: () => void, ms: number) => { tick = fn; intervalMs = ms; return 1 as unknown as ReturnType<typeof setInterval>; }) as unknown as typeof setInterval,
    clearIntervalFn: (() => { cleared = true; }) as unknown as typeof clearInterval,
    tick: () => tick?.(),
    intervalMs: () => intervalMs,
    cleared: () => cleared,
  };
}

test("the sweep runs at startup, then on each interval tick, every 2 minutes", async () => {
  const { connection, deps, reads } = setup({ withPlan: true });
  const timer = fakeInterval();
  const sweep = startPlanCalendarSyncSweep(deps, { setIntervalFn: timer.setIntervalFn, clearIntervalFn: timer.clearIntervalFn, log: () => {} });
  await sweep.startup;
  assert.equal(reads(), 1);
  assert.equal(timer.intervalMs(), PLAN_CALENDAR_SYNC_INTERVAL_MS);
  assert.equal(PLAN_CALENDAR_SYNC_INTERVAL_MS, 120_000);
  timer.tick();
  await sweep.runOnce();
  assert.equal(reads(), 2);
  sweep.stop();
  assert.equal(timer.cleared(), true);
  connection.close();
});

test("runOnce joins the in-flight run instead of starting a second", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { connection, deps, reads } = setup({ withPlan: true, readEvents: async () => { await gate; return []; } });
  const timer = fakeInterval();
  const sweep = startPlanCalendarSyncSweep(deps, { setIntervalFn: timer.setIntervalFn, clearIntervalFn: timer.clearIntervalFn, log: () => {} });
  const a = sweep.runOnce();
  const b = sweep.runOnce();
  timer.tick();
  release();
  const [ra, rb] = await Promise.all([a, b]);
  await sweep.startup;
  assert.equal(reads(), 1);
  assert.equal(ra, rb);
  assert.deepEqual(ra, { ok: true, value: { status: "unchanged" } });
  sweep.stop();
  connection.close();
});

test("a failing sync logs server.plan-sync-failed and an unchanged one is silent", async () => {
  const entries: LogEntry[] = [];
  const quiet = setup({ withPlan: true });
  const t1 = fakeInterval();
  const s1 = startPlanCalendarSyncSweep(quiet.deps, { setIntervalFn: t1.setIntervalFn, clearIntervalFn: t1.clearIntervalFn, log: (e) => entries.push(e) });
  await s1.startup;
  assert.equal(entries.length, 0);
  s1.stop();
  quiet.connection.close();

  const bad = setup({ withPlan: true, readEvents: async () => { throw new Error("boom"); } });
  const t2 = fakeInterval();
  const s2 = startPlanCalendarSyncSweep(bad.deps, { setIntervalFn: t2.setIntervalFn, clearIntervalFn: t2.clearIntervalFn, log: (e) => entries.push(e) });
  await s2.startup;
  assert.deepEqual(entries.map((e) => e.event), ["server.plan-sync-failed"]);
  s2.stop();
  bad.connection.close();
});

test("the sweep logs a missing, unconfirmed event once, and again only when the count changes or it clears", async () => {
  const base = setup({ withPlan: true });
  const entry = (n: number) => ({ eventId: `e${n}`, blockId: `b${n}`, kind: "work" as const, taskId: `t${n}`, start: "2026-08-22T20:00:00.000Z", end: "2026-08-22T21:00:00.000Z" });
  const present: YohPlanEvent = { eventId: "e1", blockId: "b1", title: "One", start: "2026-08-22T20:00:00.000Z", end: "2026-08-22T21:00:00.000Z" };
  let snapshot = [entry(1), entry(2)];
  const deps: SyncPlanFromCalendarDeps = { ...base.deps, readYohPlanEvents: async () => [present], readPlanCalendarSnapshot: () => snapshot, readDeletedYohPlanEventIds: async () => [] };
  const timer = fakeInterval();
  const entries: LogEntry[] = [];
  const sweep = startPlanCalendarSyncSweep(deps, { setIntervalFn: timer.setIntervalFn, clearIntervalFn: timer.clearIntervalFn, log: (e) => entries.push(e) });
  const missing = () => entries.filter((e) => e.event === PLAN_SYNC_MISSING_UNCONFIRMED_EVENT).map((e) => (e.detail as { events: number }).events);
  await sweep.startup;
  await sweep.runOnce();
  assert.deepEqual(missing(), [1], "the same warning is not repeated");
  snapshot = [entry(1), entry(2), entry(3)];
  await sweep.runOnce();
  assert.deepEqual(missing(), [1, 2], "a changed count is logged");
  snapshot = [entry(1)];
  await sweep.runOnce();
  snapshot = [entry(1), entry(2), entry(3)];
  await sweep.runOnce();
  assert.deepEqual(missing(), [1, 2, 2], "logged again after a run with nothing missing");
  sweep.stop();
  base.connection.close();
});

test("POST /api/plan/sync without sync deps reports unchanged", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  const app = createApp({ connection, log: () => {} });
  const res = await app.request("/api/plan/sync", { method: "POST", headers: { "Content-Type": "application/json" } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, value: { status: "unchanged" } });
  connection.close();
});

test("POST /api/plan/sync runs the sync and returns its Result, sharing the sweep's lock", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { connection, deps, reads } = setup({ withPlan: true, readEvents: async () => { await gate; return []; } });
  const timer = fakeInterval();
  const app = createApp({ connection, log: () => {}, planSync: deps });
  const sweep = startPlanCalendarSyncSweep(deps, { setIntervalFn: timer.setIntervalFn, clearIntervalFn: timer.clearIntervalFn, log: () => {} });
  const pending = app.request("/api/plan/sync", { method: "POST", headers: { "Content-Type": "application/json" } });
  release();
  const res = await pending;
  await sweep.startup;
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, value: { status: "unchanged" } });
  assert.equal(reads(), 1, "the route joined the sweep's run");
  sweep.stop();
  connection.close();
});

test("POST /api/plan/sync with no Plan today reports no-plan", async () => {
  const { connection, deps } = setup();
  const app = createApp({ connection, log: () => {}, planSync: deps });
  const res = await app.request("/api/plan/sync", { method: "POST", headers: { "Content-Type": "application/json" } });
  assert.deepEqual(await res.json(), { ok: true, value: { status: "no-plan" } });
  connection.close();
});

test("a deferred Plan calendar write triggers one sync run on a later tick; a normal write triggers none", async () => {
  let runs = 0;
  const hook = (): Promise<void> => { runs++; return Promise.resolve(); };
  let deferred = true;
  const write = withDeferredWriteHook(async (_blocks: readonly string[]) => (deferred ? { written: [], failed: [], deferred: true as const } : { written: ["a"], failed: [] as string[] }), () => hook);
  const result = await write(["a"]);
  assert.equal(result.deferred, true);
  assert.equal(runs, 0, "never awaited: it runs on a later tick");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
  deferred = false;
  await write(["a"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
});

test("a throwing or rejecting hook never reaches the writer's caller", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown): void => { unhandled.push(e); };
  process.on("unhandledRejection", onUnhandled);
  const throwing = withDeferredWriteHook(async () => ({ deferred: true as const }), () => () => { throw new Error("boom"); });
  const rejecting = withDeferredWriteHook(async () => ({ deferred: true as const }), () => () => Promise.reject(new Error("boom")));
  assert.deepEqual(await throwing(), { deferred: true });
  assert.deepEqual(await rejecting(), { deferred: true });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(unhandled, []);
});
