/**
 * Tests for `src/app/day-view.ts` (real-use fixes plan, Task 5: "what's
 * happening tomorrow", read any day's calendar).
 *
 * Mirrors `tests/app-plan-view.test.ts`'s own conventions: a fake, injected
 * `readCalendarEventsForDate` (no real network call, no live Google
 * account), a temp in-memory `MemoryStore`, and a fixed clock so "today"
 * never depends on when the suite runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, putPlan, type MemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { dayView } from "../src/app/day-view.ts";
import type { CalendarEvent, IsoDate, Plan } from "../src/types/domain.ts";

const TEST_TIME_ZONE = "America/New_York";
const TODAY_NOW = () => new Date("2026-08-22T18:00:00.000Z"); // 2026-08-22 14:00 EDT

function tempStore(): MemoryStore {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return createMemoryStore(connection);
}

function samplePlanForDate(date: IsoDate): Plan {
  return {
    id: `plan-${date}`,
    date,
    blocks: [
      { id: "work-1", kind: "work", start: `${date}T13:00:00.000Z`, end: `${date}T14:00:00.000Z`, label: "Draft the memo", taskId: "t1" },
    ],
    reasoning: '"Draft the memo" leads the Plan — due soonest.',
    version: 1,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  };
}

function sampleEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "Dentist",
    start: "2026-08-23T14:00:00.000Z",
    end: "2026-08-23T15:00:00.000Z",
    ...overrides,
  };
}

test("dayView lists a future day's Calendar events and hints at /plan when no Plan exists yet for that day", async () => {
  const store = tempStore();
  const result = await dayView(
    { store, timeZone: TEST_TIME_ZONE, now: TODAY_NOW, readCalendarEventsForDate: async () => [sampleEvent()] },
    { date: "2026-08-23" },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /Dentist/);
  assert.match(result.value.reply, /10:00-11:00/); // 2026-08-23T14:00Z-15:00Z in America/New_York (EDT, UTC-4)
  assert.match(result.value.reply, /\/plan/);
  assert.deepEqual(result.value.receipts, []);
  store.close();
});

test("dayView shows a future day's genuinely-stored Plan too, when one already exists for that date (never fabricated — only what's actually stored)", async () => {
  const store = tempStore();
  putPlan(store, samplePlanForDate("2026-08-23"));

  const result = await dayView(
    { store, timeZone: TEST_TIME_ZONE, now: TODAY_NOW, readCalendarEventsForDate: async () => [sampleEvent()] },
    { date: "2026-08-23" },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /Dentist/);
  assert.match(result.value.reply, /Draft the memo/);
  store.close();
});

test("dayView lists TODAY's events plus today's stored Plan when one exists, with no /plan hint (today isn't a future day)", async () => {
  const store = tempStore();
  putPlan(store, samplePlanForDate("2026-08-22"));

  const result = await dayView(
    { store, timeZone: TEST_TIME_ZONE, now: TODAY_NOW, readCalendarEventsForDate: async () => [] },
    { date: "2026-08-22" },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /Draft the memo/);
  assert.doesNotMatch(result.value.reply, /\/plan/);
  store.close();
});

test("dayView says plainly there's nothing on an empty day, rather than fabricating or erroring", async () => {
  const store = tempStore();
  const result = await dayView(
    { store, timeZone: TEST_TIME_ZONE, now: TODAY_NOW, readCalendarEventsForDate: async () => [] },
    { date: "2026-08-22" },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /nothing/i);
  store.close();
});

test("dayView never fabricates a Plan for a past day with no stored Plan, and doesn't hint at /plan for a day that's already gone", async () => {
  const store = tempStore();
  const result = await dayView(
    { store, timeZone: TEST_TIME_ZONE, now: TODAY_NOW, readCalendarEventsForDate: async () => [] },
    { date: "2026-08-20" },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /nothing/i);
  assert.doesNotMatch(result.value.reply, /\/plan/);
  store.close();
});

test("dayView turns a thrown Calendar-read failure into an honest, non-crashing reply via errorCopy, never a raw thrown error", async () => {
  const store = tempStore();
  const result = await dayView(
    {
      store,
      timeZone: TEST_TIME_ZONE,
      now: TODAY_NOW,
      readCalendarEventsForDate: async () => {
        throw new Error("calendar-adapter: could not reach Google Calendar");
      },
    },
    { date: "2026-08-23" },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.doesNotMatch(result.value.reply, /calendar-adapter:/);
  assert.match(result.value.reply, /couldn't reach Google Calendar/i);
  store.close();
});

test("dayView displays an untitled event as '(No title)' — blank titles or punctuation-only", async () => {
  const store = tempStore();
  const result = await dayView(
    {
      store,
      timeZone: TEST_TIME_ZONE,
      now: TODAY_NOW,
      readCalendarEventsForDate: async () => [
        sampleEvent({ title: "" }), // blank title
        sampleEvent({ title: "  ", id: "event-2", start: "2026-08-23T15:00:00.000Z", end: "2026-08-23T16:00:00.000Z" }), // whitespace-only
        sampleEvent({ title: "...", id: "event-3", start: "2026-08-23T16:00:00.000Z", end: "2026-08-23T17:00:00.000Z" }), // punctuation-only
      ],
    },
    { date: "2026-08-23" },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  // All three events should show "(No title)"
  const matches = (result.value.reply.match(/\(No title\)/g) || []).length;
  assert.equal(matches, 3, "should have three '(No title)' strings for the three untitled events");
  store.close();
});
