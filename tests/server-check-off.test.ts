/**
 * Tests for Story 7.10's slice of `src/shell/server.ts`: the check-off
 * routes (transport over `app/check-off.ts`) and the commit sweep runner
 * (startup sweep + commit timer, AD-20). In-process via `app.request(...)`
 * against `:memory:` SQLite and a fake Notion client; the timer's
 * `setInterval` is injected, so no test waits on a real clock.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hc } from "hono/client";
import type { LogEntry } from "../src/adapters/logger.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { initPlanStateStoreSchema, UNDO_WINDOW_MS } from "../src/adapters/plan-state-store.ts";
import { initCompletionLogSchema, listCompletedTaskIdsOnDate } from "../src/adapters/completion-log.ts";
import { createMemoryStore } from "../src/adapters/memory-store.ts";
import { CHECK_OFF_COMMIT_TICK_MS, type CheckOffDeps } from "../src/app/check-off.ts";
import { createApp, startCheckOffCommitSweep, type ServerDeps } from "../src/shell/server.ts";
import type { AppType } from "../src/types/api.ts";
import { createFakeNotionStatusClient } from "./fakes/fake-notion-status-client.ts";

const T0 = "2026-09-25T18:00:00.000Z";
const at = (ms: number): Date => new Date(Date.parse(T0) + ms);

function setup() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initPlanStateStoreSchema(connection.db);
  initCompletionLogSchema(connection.db);
  const notion = createFakeNotionStatusClient();
  let clock = at(0);
  const checkOff: NonNullable<ServerDeps["checkOff"]> = {
    store: createMemoryStore(connection),
    timeZone: "UTC",
    notionClient: notion.client,
    notionStatusConfig: { tasksDataSourceId: "tasks-ds" },
    lookupTask: async (id) => ({ id, title: "Draft the memo", createdAt: T0, updatedAt: T0 }),
    now: () => clock,
  };
  const app = createApp({ connection, log: () => {}, checkOff });
  const fullDeps: CheckOffDeps = { connection, ...checkOff, now: () => clock };
  return {
    connection,
    notion,
    app,
    fullDeps,
    setClock: (d: Date) => {
      clock = d;
    },
  };
}

async function post(app: ReturnType<typeof createApp>, path: string, body?: unknown) {
  const res = await app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; value?: Record<string, unknown>; error?: { kind: string; message: string } } };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

test("POST /api/check-off records a pending completion and returns commitAt (the client never hard-codes the window)", async () => {
  const { app, connection } = setup();
  const { status, body } = await post(app, "/api/check-off", { taskId: "t1" });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.value?.["taskId"], "t1");
  assert.equal(body.value?.["commitAt"], at(UNDO_WINDOW_MS).toISOString());
  assert.equal(body.value?.["asOf"], T0);
  connection.close();
});

test("POST /api/check-off without a taskId is a 400 validation envelope", async () => {
  const { app, connection } = setup();
  const { status, body } = await post(app, "/api/check-off", {});
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error?.kind, "validation");
  connection.close();
});

test("POST /api/check-off/:id/undo deletes the pending record; a second undo is a 409 conflict", async () => {
  const { app, connection } = setup();
  const created = await post(app, "/api/check-off", { taskId: "t1" });
  const id = String(created.body.value?.["id"]);
  const undone = await post(app, `/api/check-off/${id}/undo`);
  assert.deepEqual(undone, { status: 200, body: { ok: true, value: { id } } });
  const again = await post(app, `/api/check-off/${id}/undo`);
  assert.equal(again.status, 409);
  assert.equal(again.body.error?.kind, "conflict");
  connection.close();
});

test("POST /api/check-off/:id/hold then /release returns the shifted commitAt", async () => {
  const { app, connection, setClock } = setup();
  const created = await post(app, "/api/check-off", { taskId: "t1" });
  const id = String(created.body.value?.["id"]);
  setClock(at(1_000));
  const held = await post(app, `/api/check-off/${id}/hold`);
  assert.equal(held.body.value?.["held"], true);
  setClock(at(11_000));
  const released = await post(app, `/api/check-off/${id}/release`);
  assert.equal(released.body.value?.["held"], false);
  assert.equal(released.body.value?.["commitAt"], at(UNDO_WINDOW_MS + 10_000).toISOString());
  connection.close();
});

test("the check-off routes report a clear 503 when check-off dependencies aren't configured", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const app = createApp({ connection, log: () => {} });
  for (const path of ["/api/check-off", "/api/check-off/x/undo", "/api/check-off/x/hold", "/api/check-off/x/release"]) {
    const { status, body } = await post(app, path, path === "/api/check-off" ? { taskId: "t1" } : undefined);
    assert.equal(status, 503, path);
    assert.equal(body.error?.kind, "unreachable", path);
  }
  connection.close();
});

test("the typed RPC client reaches the check-off routes at /api/check-off (no double /api prefix)", async () => {
  const { app, connection } = setup();
  const client = hc<AppType>("http://localhost", { headers: { "Content-Type": "application/json" }, fetch: (input: string | URL | Request, init?: RequestInit) => app.request(input, init) });
  const res = await client.api["check-off"].$post({ json: { taskId: "t1" } });
  const body = await res.json();
  assert.equal(body.ok, true);
  if (!body.ok) return;
  const undo = await client.api["check-off"][":id"].undo.$post({ param: { id: body.value.id } });
  assert.equal((await undo.json()).ok, true);
  connection.close();
});

// ---------------------------------------------------------------------------
// Commit sweep runner (startup sweep + timer)
// ---------------------------------------------------------------------------

function fakeInterval() {
  let tick: (() => void) | undefined;
  let intervalMs: number | undefined;
  let cleared = false;
  return {
    setIntervalFn: ((fn: () => void, ms: number) => {
      tick = fn;
      intervalMs = ms;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval,
    clearIntervalFn: (() => {
      cleared = true;
    }) as unknown as typeof clearInterval,
    tick: () => tick?.(),
    intervalMs: () => intervalMs,
    cleared: () => cleared,
  };
}

test("startCheckOffCommitSweep sweeps overdue records at startup, before any timer tick", async () => {
  const { app, connection, fullDeps, setClock } = setup();
  await post(app, "/api/check-off", { taskId: "t1" });
  setClock(at(3_600_000)); // the server restarts an hour later
  const timer = fakeInterval();
  const sweep = startCheckOffCommitSweep(fullDeps, { setIntervalFn: timer.setIntervalFn, clearIntervalFn: timer.clearIntervalFn, log: () => {} });
  await sweep.startup;
  assert.ok(listCompletedTaskIdsOnDate(connection, "2026-09-25", "UTC").has("t1"));
  assert.equal(timer.intervalMs(), CHECK_OFF_COMMIT_TICK_MS);
  sweep.stop();
  assert.equal(timer.cleared(), true);
  connection.close();
});

test("the commit timer commits a record once its window has passed, regardless of any browser tab", async () => {
  const { app, connection, notion, fullDeps, setClock } = setup();
  const timer = fakeInterval();
  const sweep = startCheckOffCommitSweep(fullDeps, { setIntervalFn: timer.setIntervalFn, clearIntervalFn: timer.clearIntervalFn, log: () => {} });
  await sweep.startup;
  await post(app, "/api/check-off", { taskId: "t1" });

  setClock(at(UNDO_WINDOW_MS - 1));
  await sweep.runOnce();
  assert.equal(listCompletedTaskIdsOnDate(connection, "2026-09-25", "UTC").size, 0);

  setClock(at(UNDO_WINDOW_MS));
  timer.tick();
  await sweep.runOnce(); // joins the in-flight tick rather than overlapping it
  assert.ok(listCompletedTaskIdsOnDate(connection, "2026-09-25", "UTC").has("t1"));
  assert.deepEqual(notion.writes, [{ taskId: "t1", status: "Completed" }]);
  sweep.stop();
  connection.close();
});

test("a sweep that commits something logs one structured summary line; an idle tick logs nothing", async () => {
  const { app, connection, fullDeps, setClock } = setup();
  const entries: LogEntry[] = [];
  const timer = fakeInterval();
  const sweep = startCheckOffCommitSweep(fullDeps, { setIntervalFn: timer.setIntervalFn, clearIntervalFn: timer.clearIntervalFn, log: (e) => entries.push(e) });
  await sweep.startup;
  assert.equal(entries.length, 0);
  await post(app, "/api/check-off", { taskId: "t1" });
  setClock(at(UNDO_WINDOW_MS));
  await sweep.runOnce();
  assert.deepEqual(
    entries.map((e) => ({ event: e.event, detail: e.detail })),
    [{ event: "server.check-off-sweep", detail: { committed: 1, notionSynced: 1, notionFailed: 0 } }],
  );
  sweep.stop();
  connection.close();
});
