/**
 * Tests for `POST /api/activity` (Rulings E12-R3, E12-R14: only a real click or key marks a day) and the real dep's once-per-day closure.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { initCompletionLogSchema, listActivityDays } from "../src/adapters/completion-log.ts";
import { initLlmUsageStoreSchema, recordLlmUsage } from "../src/adapters/llm-usage-store.ts";
import { createApp, type ServerDeps } from "../src/shell/server.ts";
import { buildDeskDeps } from "../src/shell/server-wiring.ts";

const NO_READS = { listCompletions: () => [], listActivityDays: () => [], listPlanDates: () => [], listCloseOutDates: () => [], listUsage: () => [] };

function setup(desk?: ServerDeps["desk"]) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initCompletionLogSchema(connection.db);
  return { connection, app: createApp({ connection, log: () => {}, ...(desk ? { desk } : {}) }) };
}

const POST_ACTIVITY = { method: "POST", headers: { "content-type": "application/json" }, body: "{}" };

test("POST /api/activity records today and returns the host date and zone", async () => {
  const written: string[] = [];
  const { app } = setup({ now: () => new Date("2026-10-04T12:00:00.000Z"), timeZone: "UTC", recordActivityDay: (d) => void written.push(d), ...NO_READS });
  const res = await app.request("/api/activity", POST_ACTIVITY);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, value: { date: "2026-10-04", timeZone: "UTC" } });
  assert.deepEqual(written, ["2026-10-04"]);
});

test("E12-R14: GET /api/home, /api/desk, /api/events and /api/research record nothing", async () => {
  const written: string[] = [];
  const { app } = setup({ now: () => new Date("2026-10-04T12:00:00.000Z"), timeZone: "UTC", recordActivityDay: (d) => void written.push(d), ...NO_READS });
  for (const path of ["/api/home", "/api/desk", "/api/events", "/api/research", "/api/health"]) {
    const res = await app.request(path);
    await res.body?.cancel();
  }
  assert.deepEqual(written, []);
});

test("a throwing dep gives a failure envelope and no crash", async () => {
  const { app } = setup({ now: () => new Date(), timeZone: "UTC", recordActivityDay: () => { throw new Error("boom"); }, ...NO_READS });
  const res = await app.request("/api/activity", POST_ACTIVITY);
  assert.equal(res.status, 503);
  assert.equal((await res.json() as { ok: boolean }).ok, false);
});

test("POST /api/activity without Desk deps answers like GET /api/desk", async () => {
  const { app } = setup();
  const post = await app.request("/api/activity", POST_ACTIVITY);
  const get = await app.request("/api/desk");
  assert.equal(post.status, get.status);
  assert.deepEqual(await post.json(), await get.json());
});

test("buildDeskDeps writes once per day per process and again on a new day", () => {
  const { connection } = setup();
  const desk = buildDeskDeps(connection, { YOH_TIMEZONE: "UTC" })!;
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

test("M2: a missing or empty YOH_TIMEZONE means Desk is not configured, not UTC", () => {
  const { connection } = setup();
  assert.equal(buildDeskDeps(connection, {}), undefined);
  assert.equal(buildDeskDeps(connection, { YOH_TIMEZONE: "" }), undefined);
});

test("M9: after a failed write the closure does not retry within a minute, then retries", () => {
  const { connection } = setup();
  let clock = new Date("2026-10-04T12:00:00.000Z").getTime();
  const desk = buildDeskDeps(connection, { YOH_TIMEZONE: "UTC" }, () => new Date(clock))!;
  connection.db.exec("ALTER TABLE activity_days RENAME TO activity_days_gone");
  assert.throws(() => desk.recordActivityDay("2026-10-04"));
  clock += 30_000;
  assert.doesNotThrow(() => desk.recordActivityDay("2026-10-04"), "within a minute: no attempt");
  clock += 31_000;
  assert.throws(() => desk.recordActivityDay("2026-10-04"), "after a minute: tried again");
  connection.db.exec("ALTER TABLE activity_days_gone RENAME TO activity_days");
  clock += 61_000;
  desk.recordActivityDay("2026-10-04");
  assert.deepEqual(listActivityDays(connection), ["2026-10-04"]);
});

test("I1b: the real listUsage reads from just before this month, not the whole table", () => {
  const { connection } = setup();
  initLlmUsageStoreSchema(connection.db);
  const base = { model: "claude-haiku-4-5-20251001", purpose: "answer", inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } as const;
  recordLlmUsage(connection, { ...base, at: "2026-08-15T00:00:00.000Z" });
  recordLlmUsage(connection, { ...base, at: "2026-09-29T00:00:00.000Z" }); // inside the 2-day margin
  recordLlmUsage(connection, { ...base, at: "2026-10-03T00:00:00.000Z" });
  const desk = buildDeskDeps(connection, { YOH_TIMEZONE: "UTC" }, () => new Date("2026-10-04T12:00:00.000Z"))!;
  assert.deepEqual(desk.listUsage().map((r) => r.at), ["2026-09-29T00:00:00.000Z", "2026-10-03T00:00:00.000Z"]);
});
