/**
 * Tests for Task 4's slice of `src/shell/server.ts`: `GET
 * /api/calendar/day?date=` — pure transport over `app/calendar-day.ts`'s
 * `getCalendarDay`. In-process via `app.request(...)`, no real Notion/Google.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryStore, putPlan } from "../src/adapters/memory-store.ts";
import { createApp, type ServerDeps } from "../src/shell/server.ts";
import type { CalendarEvent } from "../src/types/domain.ts";

function setup(withCalendarDay = true) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  const events: CalendarEvent[] = [{ id: "e1", title: "Dentist", start: "2026-09-29T14:00:00.000Z", end: "2026-09-29T15:00:00.000Z" }];
  const calendarDay: NonNullable<ServerDeps["calendarDay"]> = {
    store,
    timeZone: "UTC",
    readCalendarEventsForDate: async () => events,
    now: () => new Date("2026-09-25T18:00:00.000Z"),
  };
  const app = createApp({ connection, log: () => {}, ...(withCalendarDay ? { calendarDay } : {}) });
  return { app, connection, store };
}

type Envelope = { ok: boolean; value?: Record<string, unknown>; error?: { kind: string; message: string } };

async function get(app: ReturnType<typeof createApp>, path: string): Promise<{ status: number; body: Envelope }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as Envelope };
}

test("GET /api/calendar/day?date=YYYY-MM-DD returns that date's blocks", async () => {
  const { app } = setup();
  const { status, body } = await get(app, "/api/calendar/day?date=2026-09-29");
  assert.equal(status, 200);
  assert.ok(body.ok);
  const value = body.value as { date: string; blocks: Array<{ id: string; kind: string }>; timeZone: string };
  assert.equal(value.date, "2026-09-29");
  assert.equal(value.timeZone, "UTC");
  assert.deepEqual(
    value.blocks.map((b) => b.id),
    ["e1"],
  );
});

test("GET /api/calendar/day merges that date's stored Plan work/break blocks with the live fixed events", async () => {
  const { app, store } = setup();
  putPlan(store, {
    id: "plan-2026-09-29",
    date: "2026-09-29",
    blocks: [{ id: "w1", kind: "work", start: "2026-09-29T09:00:00.000Z", end: "2026-09-29T10:00:00.000Z", taskId: "t1", label: "Draft the memo" }],
    reasoning: "",
    version: 1,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  });
  const { status, body } = await get(app, "/api/calendar/day?date=2026-09-29");
  assert.equal(status, 200);
  assert.ok(body.ok);
  const value = body.value as { blocks: Array<{ id: string; kind: string }> };
  assert.deepEqual(
    value.blocks.map((b) => b.id),
    ["w1", "e1"],
  );
});

test("GET /api/calendar/day without a date is a 400 validation envelope", async () => {
  const { app } = setup();
  const { status, body } = await get(app, "/api/calendar/day");
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error?.kind, "validation");
});

test("GET /api/calendar/day with a malformed date is a 400 validation envelope", async () => {
  const { app } = setup();
  const { status, body } = await get(app, "/api/calendar/day?date=not-a-date");
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error?.kind, "validation");
});

test("GET /api/calendar/day without Notion/Google configured is a clear unreachable error, not a 500", async () => {
  const { app } = setup(false);
  const { status, body } = await get(app, "/api/calendar/day?date=2026-09-29");
  assert.equal(status, 503);
  assert.equal(body.error?.kind, "unreachable");
  assert.match(body.error!.message, /not configured/);
});

test("GET /api/calendar/day maps a Calendar read failure to an honest unreachable error, never a raw error leak", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const calendarDay: NonNullable<ServerDeps["calendarDay"]> = {
    store: createMemoryStore(connection),
    timeZone: "UTC",
    readCalendarEventsForDate: async () => {
      throw new Error("ECONNREFUSED 10.0.0.1:443");
    },
  };
  const app = createApp({ connection, log: () => {}, calendarDay });
  const { status, body } = await get(app, "/api/calendar/day?date=2026-09-29");
  assert.equal(status, 503);
  assert.equal(body.error?.kind, "unreachable");
  assert.doesNotMatch(body.error!.message, /ECONNREFUSED|10\.0\.0\.1/);
});
