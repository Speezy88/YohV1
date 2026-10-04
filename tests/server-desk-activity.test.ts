/**
 * Tests for the `/api/*` activity-day middleware (Ruling E12-R3) and the real dep's once-per-day closure.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { initCompletionLogSchema, listActivityDays } from "../src/adapters/completion-log.ts";
import { createApp, type ServerDeps } from "../src/shell/server.ts";
import { buildDeskDeps } from "../src/shell/server-wiring.ts";

function setup(desk?: ServerDeps["desk"]) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initCompletionLogSchema(connection.db);
  return { connection, app: createApp({ connection, log: () => {}, ...(desk ? { desk } : {}) }) };
}

test("a request to an /api/* route records today", async () => {
  const written: string[] = [];
  const { app } = setup({ now: () => new Date("2026-10-04T12:00:00.000Z"), timeZone: "UTC", recordActivityDay: (d) => void written.push(d) });
  await app.request("/api/research");
  assert.deepEqual(written, ["2026-10-04"]);
});

test("GET /api/health does not record", async () => {
  const written: string[] = [];
  const { app } = setup({ now: () => new Date("2026-10-04T12:00:00.000Z"), timeZone: "UTC", recordActivityDay: (d) => void written.push(d) });
  const res = await app.request("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(written, []);
});

test("a throwing dep still returns the route's normal response, and is logged", async () => {
  const logs: string[] = [];
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const app = createApp({
    connection,
    log: (e) => void logs.push(e.event),
    desk: { now: () => new Date(), timeZone: "UTC", recordActivityDay: () => { throw new Error("boom"); } },
  });
  const res = await app.request("/api/research");
  assert.equal(res.status, 503, "the route's own not-configured answer");
  assert.ok(logs.includes("server.activity-day-failed"));
});

test("no desk deps means no error", async () => {
  const { app } = setup();
  const res = await app.request("/api/research");
  assert.equal(res.status, 503);
});

test("buildDeskDeps writes once per day per process and again on a new day", () => {
  const { connection } = setup();
  const desk = buildDeskDeps(connection, { YOH_TIMEZONE: "UTC" });
  desk.recordActivityDay("2026-10-04");
  desk.recordActivityDay("2026-10-04");
  assert.deepEqual(listActivityDays(connection), ["2026-10-04"]);
  // Prove the second call skipped the write: remove the row, call again, it stays gone.
  connection.db.prepare("DELETE FROM activity_days").run();
  desk.recordActivityDay("2026-10-04");
  assert.deepEqual(listActivityDays(connection), []);
  desk.recordActivityDay("2026-10-05");
  assert.deepEqual(listActivityDays(connection), ["2026-10-05"]);
});
