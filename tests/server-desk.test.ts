/**
 * Tests for `GET /api/desk` (Epic 12): pure transport over `app/desk.ts`'s `getDesk`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createApp, type ServerDeps } from "../src/shell/server.ts";

function setup(overrides: Partial<NonNullable<ServerDeps["desk"]>> | "absent" = {}) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const desk: NonNullable<ServerDeps["desk"]> = {
    now: () => new Date("2026-10-07T18:00:00.000Z"),
    timeZone: "UTC",
    recordActivityDay: () => {},
    listCompletions: () => [{ taskName: "Essay", dueDate: "2026-10-07", estimatedMinutes: 60, completedAt: "2026-10-07T15:00:00.000Z" }],
    listActivityDays: () => [],
    listPlanDates: () => [],
    listCloseOutDates: () => [],
    listUsage: () => [],
    ...(overrides === "absent" ? {} : overrides),
  };
  return createApp({ connection, log: () => {}, ...(overrides === "absent" ? {} : { desk }) });
}

type Envelope = { ok: boolean; value?: Record<string, unknown>; error?: { kind: string; message: string } };
const get = async (app: ReturnType<typeof createApp>) => {
  const res = await app.request("/api/desk");
  return { status: res.status, body: (await res.json()) as Envelope };
};

test("GET /api/desk returns the success envelope", async () => {
  const { status, body } = await get(setup());
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.value!["today"], "2026-10-07");
  assert.equal(body.value!["minutesToday"], 60);
  assert.deepEqual(body.value!["spend"], { monthUsd: 0, unpricedCalls: 0 });
});

test("GET /api/desk returns a failure envelope with plain copy when a read throws", async () => {
  const { status, body } = await get(setup({ listUsage: () => { throw new Error("SQLITE_BUSY"); } }));
  assert.equal(status, 503);
  assert.equal(body.ok, false);
  assert.doesNotMatch(body.error!.message, /SQLITE/);
});

test("GET /api/desk reports not-configured when desk deps are absent", async () => {
  const { status, body } = await get(setup("absent"));
  assert.equal(status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.error!.kind, "unreachable");
});
