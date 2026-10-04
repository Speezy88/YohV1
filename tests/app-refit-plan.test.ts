import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, getPlan, listOpenInteractionRequests, putPlan, putTimeBudget } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { localIsoDate } from "../src/rituals/ritual-shared.ts";
import { errorCopy } from "../src/core/error-copy.ts";
import { refitPlan } from "../src/app/refit-plan.ts";
import type { ApproveReshuffleDeps } from "../src/app/approve-reshuffle.ts";
import type { CalendarEvent, Plan, Task } from "../src/types/domain.ts";

const TZ = "America/New_York";
const NOW = new Date("2026-08-22T18:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const iso = (mins: number): string => new Date(NOW.getTime() + mins * 60_000).toISOString();

function task(id: string, title: string): Task {
  return { id, title, createdAt: NOW_ISO, updatedAt: NOW_ISO, estimatedDurationMinutes: 30, area: "Work", dueDate: "2026-08-22", status: "not-started", energy: "medium" } as Task;
}

function setup(readCalendarEvents: () => Promise<readonly CalendarEvent[]>) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  const today = localIsoDate(NOW, TZ);
  putTimeBudget(store, { date: today, totalMinutes: 480, workMinutes: 70, breakMinutes: 15 });
  const plan: Plan = {
    id: `plan-${today}`, date: today, version: 1, reasoning: "x", createdAt: iso(-60), updatedAt: iso(-60),
    blocks: [
      { id: "v1-work-0", kind: "work", start: iso(-30), end: iso(0), label: "Past", taskId: "t1" },
      { id: "v1-work-1", kind: "work", start: iso(30), end: iso(60), label: "Future", taskId: "t2" },
    ],
  };
  putPlan(store, plan);
  const deps: ApproveReshuffleDeps = {
    store, connection, timeZone: TZ, now: () => NOW,
    readTasks: async () => [task("t1", "Past"), task("t2", "Future"), task("t3", "Fresh")],
    readCalendarEvents,
    writeCalendarPlan: async (blocks) => ({ written: blocks.map((b) => b.id), failed: [] }),
  };
  return { store, today, deps };
}

test("refitPlan re-fits the rest of today, writes the new Plan and leaves no reshuffle card open", async () => {
  const s = setup(async () => []);
  const result = await refitPlan(s.deps, {});
  assert.equal(result.ok, true);
  if (result.ok) assert.notEqual(result.value.reply, "");
  assert.equal(getPlan(s.store, s.today)!.data.version, 2);
  assert.equal(listOpenInteractionRequests(s.store).length, 0);
  s.store.close();
});

test("refitPlan with no Plan today fails and opens nothing", async () => {
  const s = setup(async () => []);
  const other = { ...s.deps, now: () => new Date("2026-08-25T18:00:00.000Z") };
  const result = await refitPlan(other, {});
  assert.equal(result.ok, false);
  assert.equal(listOpenInteractionRequests(s.store).length, 0);
  s.store.close();
});

test("refitPlan whose approve step recomputes (calendar changed) fails, writes nothing and clears every reshuffle card it opened", async () => {
  let reads = 0;
  const s = setup(async () => (reads++ === 0 ? [] : [{ id: "e1", title: "New meeting", start: iso(90), end: iso(120), isAllDay: false } as unknown as CalendarEvent]));
  const result = await refitPlan(s.deps, {});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.kind, "validation");
    assert.equal(errorCopy(result.error), "Your Plan or Calendar changed while I was re-fitting, so I left the Plan as it was.");
  }
  assert.equal(getPlan(s.store, s.today)!.data.version, 1);
  assert.equal(listOpenInteractionRequests(s.store).length, 0, "no stray reshuffle card beside the change-set outcome");
  s.store.close();
});

test("refitPlan applied with calendar blocks that failed to sync says so", async () => {
  const s = setup(async () => []);
  const failing = { ...s.deps, writeCalendarPlan: async (blocks: readonly { id: string }[]) => ({ written: [], failed: blocks.map((b) => b.id) }) };
  const result = await refitPlan(failing as typeof s.deps, {});
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.value.reply, /couldn't update your calendar for some blocks/);
  assert.equal(getPlan(s.store, s.today)!.data.version, 2);
  s.store.close();
});

test("refitPlan given a single-block request applies that request and rewrites the calendar", async () => {
  const s = setup(async () => []);
  const written: string[][] = [];
  const deps = { ...s.deps, writeCalendarPlan: async (blocks: readonly { id: string }[]) => { written.push(blocks.map((b) => b.id)); return { written: blocks.map((b) => b.id), failed: [] }; } };
  const result = await refitPlan(deps as typeof s.deps, { request: { kind: "drop-task", taskId: "t2" } });
  assert.equal(result.ok, true);
  const plan = getPlan(s.store, s.today)!.data;
  assert.equal(plan.version, 2);
  assert.ok(!plan.blocks.some((b) => b.taskId === "t2" && Date.parse(b.end) > NOW.getTime()), "the dropped Task has no block left to come");
  assert.equal(written.length, 1);
  assert.equal(listOpenInteractionRequests(s.store).length, 0);
  s.store.close();
});

test("refitPlan whose request can't be honored fails with its reason and changes nothing", async () => {
  const s = setup(async () => []);
  const result = await refitPlan(s.deps, { request: { kind: "resize-task", taskId: "t1", durationMinutes: 45 } });
  assert.equal(result.ok, false);
  assert.equal(getPlan(s.store, s.today)!.data.version, 1);
  assert.equal(listOpenInteractionRequests(s.store).length, 0);
  s.store.close();
});
