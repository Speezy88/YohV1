/**
 * Tests for `src/app/calendar-day.ts` (real-use fixes plan, Task 4: "pick
 * any day in Month to see its calendar"). Mirrors `tests/app-day-view.test.ts`'s
 * conventions: a fake, injected `readCalendarEventsForDate`, a temp
 * in-memory `MemoryStore`, and a fixed clock so "past"/"now" never depends
 * on when the suite runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, putPlan, type MemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { getCalendarDay, type CalendarDayDeps } from "../src/app/calendar-day.ts";
import type { CalendarEvent, Plan } from "../src/types/domain.ts";

const NOW = () => new Date("2026-09-25T18:00:00.000Z");

function tempStore(): MemoryStore {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return createMemoryStore(connection);
}

function baseDeps(overrides: Partial<CalendarDayDeps> = {}): CalendarDayDeps {
  return {
    store: tempStore(),
    timeZone: "America/New_York",
    now: NOW,
    readCalendarEventsForDate: async (): Promise<readonly CalendarEvent[]> => [],
    ...overrides,
  };
}

function samplePlanForDate(date: string): Plan {
  return {
    id: `plan-${date}`,
    date,
    blocks: [
      { id: "work-1", kind: "work", start: `${date}T13:00:00.000Z`, end: `${date}T14:00:00.000Z`, label: "Draft the memo", taskId: "t1" },
      { id: "break-1", kind: "break", start: `${date}T14:00:00.000Z`, end: `${date}T14:15:00.000Z`, label: "Break" },
      // A calendar-anchor block is the stored Plan's own generation-time
      // snapshot — never rendered as a calendar block (same rule
      // `getHomeView` follows); only a LIVE Calendar read produces "fixed".
      { id: "anchor-1", kind: "calendar-anchor", start: `${date}T15:00:00.000Z`, end: `${date}T15:30:00.000Z`, label: "Standing meeting" },
    ],
    reasoning: "",
    version: 1,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  };
}

function sampleEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: "event-1", title: "Dentist", start: "2026-09-29T14:00:00.000Z", end: "2026-09-29T15:00:00.000Z", ...overrides };
}

test("a future date with a live Calendar event and no stored Plan returns just the fixed block", async () => {
  const deps = baseDeps({ readCalendarEventsForDate: async () => [sampleEvent()] });
  const result = await getCalendarDay(deps, { date: "2026-09-29" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.date, "2026-09-29");
  assert.equal(result.value.timeZone, "America/New_York");
  assert.equal(result.value.blocks.length, 1);
  assert.equal(result.value.blocks[0]!.kind, "fixed");
  assert.equal(result.value.blocks[0]!.label, "Dentist");
  deps.store.close();
});

test("a date with a stored Plan returns its work/break blocks (never the Plan's own calendar-anchor snapshot) merged with live fixed events, sorted by start", async () => {
  const deps = baseDeps({ readCalendarEventsForDate: async () => [sampleEvent({ id: "e2", title: "Standup", start: "2026-09-29T12:00:00.000Z", end: "2026-09-29T12:30:00.000Z" })] });
  putPlan(deps.store, samplePlanForDate("2026-09-29"));

  const result = await getCalendarDay(deps, { date: "2026-09-29" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.blocks.map((b) => b.kind),
    ["fixed", "work", "break"],
  );
  assert.equal(result.value.blocks.every((b) => b.label !== "Standing meeting"), true);
  deps.store.close();
});

test("a stored Plan's own work block always reports completed: false (no live Notion read for a non-today date)", async () => {
  const deps = baseDeps();
  putPlan(deps.store, samplePlanForDate("2026-09-29"));
  const result = await getCalendarDay(deps, { date: "2026-09-29" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const work = result.value.blocks.find((b) => b.kind === "work");
  assert.equal(work?.completed, false);
  deps.store.close();
});

test("a block whose end is already before 'now' reports past: true", async () => {
  const deps = baseDeps({ readCalendarEventsForDate: async () => [sampleEvent({ start: "2026-09-20T14:00:00.000Z", end: "2026-09-20T15:00:00.000Z" })] });
  const result = await getCalendarDay(deps, { date: "2026-09-20" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.blocks[0]!.past, true);
  deps.store.close();
});

test("no stored Plan and no live events returns an empty blocks array, never an error", async () => {
  const deps = baseDeps();
  const result = await getCalendarDay(deps, { date: "2026-10-01" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.blocks, []);
  deps.store.close();
});

test("a thrown Calendar-read failure returns an honest 'unreachable' error, never a raw error message leak", async () => {
  const deps = baseDeps({
    readCalendarEventsForDate: async () => {
      throw new Error("ECONNREFUSED 10.0.0.1:443 secret-internal-detail");
    },
  });
  const result = await getCalendarDay(deps, { date: "2026-09-29" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
  assert.doesNotMatch(result.error.message, /ECONNREFUSED|10\.0\.0\.1|secret-internal-detail/);
  deps.store.close();
});

test("a stored Plan's routine block is returned as a routine calendar block", async () => {
  const deps = baseDeps();
  const plan = samplePlanForDate("2026-09-29");
  putPlan(deps.store, { ...plan, blocks: [...plan.blocks, { id: "r1", kind: "routine", start: "2026-09-29T16:00:00.000Z", end: "2026-09-29T16:30:00.000Z", label: "Commute", routineId: "routine-commute" }] });
  const result = await getCalendarDay(deps, { date: "2026-09-29" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.blocks.find((b) => b.kind === "routine")?.label, "Commute");
  deps.store.close();
});
