/**
 * Tests for `src/rituals/reshuffle.ts` — the one re-planning pipeline shared
 * by the Morning Ritual and Mid-Day Re-Flow.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderByDerivedPriority } from "../src/core/derived-priority.ts";
import { fitWorkBreakBlocks } from "../src/core/work-break-fit.ts";
import { computeDayRefit } from "../src/rituals/reshuffle.ts";
import type { LogEntry } from "../src/adapters/logger.ts";
import type { CalendarEvent, CompleteTask, PlanBlock, TimeBudget } from "../src/types/domain.ts";

const NOW = "2026-08-22T09:00:00.000Z";
const DATE = "2026-08-22";
const BUDGET: TimeBudget = { date: DATE, totalMinutes: 240, workMinutes: 70, breakMinutes: 15 };

function task(id: string, minutes: number, dueDate: string): CompleteTask {
  return {
    id,
    title: `Task ${id}`,
    estimatedDurationMinutes: minutes,
    dueDate,
    status: "not-started",
    createdAt: NOW,
    updatedAt: NOW,
    area: { kind: "set", value: "Work" },
    energy: { kind: "set", value: "medium" },
  };
}

const ANCHOR: CalendarEvent = { id: "e1", title: "Standup", start: "2026-08-22T10:00:00.000Z", end: "2026-08-22T10:30:00.000Z" };

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    date: DATE,
    timeZone: "UTC",
    now: NOW,
    workStart: "2026-08-22T00:00:00.000Z",
    openTasks: [task("a", 60, "2026-08-25"), task("b", 45, "2026-08-23")],
    budget: BUDGET,
    fixedEvents: [ANCHOR],
    pastBlocks: [] as readonly PlanBlock[],
    idPrefix: "v1",
    ...overrides,
  };
}

test("matches the direct order -> fit pipeline, with block ids prefixed v<version>-<kind>-<n>", () => {
  const input = baseInput();
  const result = computeDayRefit(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const ordered = orderByDerivedPriority(input.openTasks, DATE);
  assert.equal(ordered.ok, true);
  if (!ordered.ok) return;
  const direct = fitWorkBreakBlocks({ tasks: ordered.value, budget: BUDGET, calendarEvents: [ANCHOR], startTime: NOW });
  assert.equal(direct.ok, true);
  if (!direct.ok) return;

  assert.deepEqual(
    result.value.blocks,
    direct.value.blocks.map((b) => ({ ...b, id: `v1-${b.id}` })),
  );
  assert.deepEqual(result.value.deferredTaskIds, direct.value.deferredTaskIds);
  assert.ok(result.value.blocks.some((b) => /^v1-work-\d+$/.test(b.id)));
  assert.ok(result.value.blocks.some((b) => /^v1-break-\d+$/.test(b.id)));
});

test("keeps pastBlocks verbatim and sorts the merge by start", () => {
  const past: PlanBlock = { id: "v0-work-0", kind: "work", start: "2026-08-22T08:00:00.000Z", end: "2026-08-22T08:30:00.000Z", label: "Old", taskId: "z" };
  const result = computeDayRefit(baseInput({ pastBlocks: [past] }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.blocks[0], past);
  const starts = result.value.blocks.map((b) => Date.parse(b.start));
  assert.deepEqual(starts, [...starts].sort((x, y) => x - y));
});

test("bumpLevels change the ordering", () => {
  const tasks = [task("a", 30, "2026-08-24"), task("b", 30, "2026-08-23")];
  const first = (bump?: Record<string, number>) => {
    const r = computeDayRefit(baseInput({ openTasks: tasks, fixedEvents: [], ...(bump ? { bumpLevels: bump } : {}) }));
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("unreachable");
    return r.value.blocks.find((b) => b.kind === "work")!.taskId;
  };
  assert.equal(first(), "b");
  assert.equal(first({ a: 4 }), "a");
});

test("logs reshuffle.computed with the duration", () => {
  const entries: LogEntry[] = [];
  const result = computeDayRefit(baseInput({ log: (e: LogEntry) => entries.push(e) }));
  assert.equal(result.ok, true);
  const entry = entries.find((e) => e.event === "reshuffle.computed");
  assert.ok(entry);
  assert.equal(typeof (entry!.detail as { ms: number }).ms, "number");
});

test("overlapping anchors are coalesced instead of rejected", () => {
  const overlapping: CalendarEvent = { id: "e2", title: "Call", start: "2026-08-22T10:15:00.000Z", end: "2026-08-22T10:45:00.000Z" };
  const result = computeDayRefit(baseInput({ fixedEvents: [ANCHOR, overlapping] }));
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// T5: pins and drops
// ---------------------------------------------------------------------------
import type { DayPin } from "../src/types/domain.ts";

const pinOf = (taskId: string, start: string, date = DATE): DayPin => ({ date, subject: { kind: "task", taskId }, start });

test("a pinned Task is placed exactly once at its pin, split by the normal rule, and others keep Derived Priority order", () => {
  const openTasks = [task("a", 60, "2026-08-25"), task("b", 100, "2026-08-23"), task("c", 30, "2026-08-30")];
  const result = computeDayRefit(baseInput({ openTasks, pins: [pinOf("b", "2026-08-22T11:00:00.000Z")] }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.rejectedReason, undefined);
  const bWork = result.value.blocks.filter((x) => x.kind === "work" && x.taskId === "b");
  assert.deepEqual(bWork.map((x) => [x.start, x.end]), [
    ["2026-08-22T11:00:00.000Z", "2026-08-22T12:10:00.000Z"],
    ["2026-08-22T12:25:00.000Z", "2026-08-22T12:55:00.000Z"],
  ]);
  assert.ok(bWork.every((x) => x.pinned === true));
  assert.ok(result.value.blocks.some((x) => x.kind === "break" && x.pinned === true && x.start === "2026-08-22T12:10:00.000Z"));
  // Others equal the direct order -> fit of the non-pinned Tasks around the pin span.
  const ordered = orderByDerivedPriority([openTasks[0]!, openTasks[2]!], DATE);
  assert.equal(ordered.ok, true);
  if (!ordered.ok) return;
  const pinAnchors: CalendarEvent[] = [{ id: "pin", title: "pin", start: "2026-08-22T11:00:00.000Z", end: "2026-08-22T12:55:00.000Z" }];
  const direct = fitWorkBreakBlocks({
    tasks: ordered.value,
    budget: { ...BUDGET, totalMinutes: BUDGET.totalMinutes - 100 - 15 },
    calendarEvents: [ANCHOR, ...pinAnchors],
    startTime: NOW,
  });
  assert.equal(direct.ok, true);
  if (!direct.ok) return;
  const othersWork = result.value.blocks.filter((x) => x.pinned !== true && x.kind === "work").map((x) => [x.taskId, x.start, x.end]);
  const directWork = direct.value.blocks.filter((x) => x.kind === "work").map((x) => [x.taskId, x.start, x.end]);
  assert.deepEqual(othersWork, directWork);
  assert.equal(new Set(result.value.blocks.map((x) => x.id)).size, result.value.blocks.length, "block ids unique");
});

test("a pin overlapping a fixed event is rejected with a reason naming the event, and the day is unchanged", () => {
  const plain = computeDayRefit(baseInput());
  const result = computeDayRefit(baseInput({ pins: [pinOf("a", "2026-08-22T10:15:00.000Z")], requestPinTaskIds: ["a"] }));
  assert.equal(result.ok && plain.ok, true);
  if (!result.ok || !plain.ok) return;
  assert.match(result.value.rejectedReason ?? "", /Standup/);
  assert.deepEqual(result.value.blocks, plain.value.blocks);
});

test("drops remove the Task from the day entirely; pins for another date are ignored", () => {
  const result = computeDayRefit(baseInput({ drops: ["a"], pins: [pinOf("b", "2026-08-22T11:00:00.000Z", "2026-08-23")] }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(!result.value.blocks.some((x) => x.taskId === "a"));
  assert.ok(!result.value.deferredTaskIds.includes("a"));
  const b = result.value.blocks.filter((x) => x.taskId === "b");
  assert.ok(b.length > 0 && b.every((x) => x.pinned === undefined));
});

test("an in-progress pin keeps its open Task going: placed first from now, pinned, ahead of a higher-priority Task", () => {
  const now = "2026-08-22T14:30:00.000Z";
  const openTasks = [task("a", 30, "2026-08-22"), task("b", 40, "2026-08-30")];
  const result = computeDayRefit(baseInput({ now, openTasks, fixedEvents: [], pins: [pinOf("b", "2026-08-22T14:00:00.000Z")] }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.rejectedReason, undefined);
  const b = result.value.blocks.filter((x) => x.taskId === "b");
  assert.deepEqual(b.map((x) => [x.start, x.end, x.pinned]), [["2026-08-22T14:30:00.000Z", "2026-08-22T15:10:00.000Z", true]]);
  const a = result.value.blocks.filter((x) => x.taskId === "a");
  assert.equal(a[0]!.start, "2026-08-22T15:10:00.000Z");
});

test("a stored pin whose span would run past the end of the day stops applying", () => {
  const now = "2026-08-22T23:30:00.000Z";
  const result = computeDayRefit(baseInput({ now, openTasks: [task("b", 60, "2026-08-30")], fixedEvents: [], pins: [pinOf("b", "2026-08-22T23:00:00.000Z")] }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.rejectedReason, undefined);
  assert.ok(result.value.blocks.every((x) => x.pinned === undefined));
});

test("a stored pin that now overlaps a fixed event is released, not rejected; a request pin still rejects", () => {
  const openTasks = [task("a", 60, "2026-08-25"), task("b", 45, "2026-08-23")];
  const pins = [pinOf("b", "2026-08-22T10:15:00.000Z")];
  const stored = computeDayRefit(baseInput({ openTasks, pins }));
  assert.equal(stored.ok, true);
  if (!stored.ok) return;
  assert.equal(stored.value.rejectedReason, undefined);
  assert.deepEqual(stored.value.releasedPins, [{ taskId: "b", title: "Task b", reason: "it now overlaps Standup" }]);
  assert.ok(stored.value.blocks.every((x) => x.pinned === undefined));
  assert.ok(stored.value.blocks.some((x) => x.taskId === "b"));
  const requested = computeDayRefit(baseInput({ openTasks, pins, requestPinTaskIds: ["b"] }));
  assert.equal(requested.ok && requested.value.rejectedReason !== undefined, true);
});
test("pins never reach derived-priority: it sees only the un-pinned Tasks", () => {
  const openTasks = [task("a", 60, "2026-08-25"), task("b", 45, "2026-08-23")];
  const bump = { b: 5, a: 0 };
  const withPin = computeDayRefit(baseInput({ openTasks, bumpLevels: bump, pins: [pinOf("b", "2026-08-22T11:00:00.000Z")] }));
  const without = computeDayRefit(baseInput({ openTasks: [openTasks[0]!], bumpLevels: bump }));
  assert.equal(withPin.ok && without.ok, true);
  if (!withPin.ok || !without.ok) return;
  const aWith = withPin.value.blocks.filter((x) => x.taskId === "a").map((x) => [x.start, x.end]);
  const aWithout = without.value.blocks.filter((x) => x.taskId === "a").map((x) => [x.start, x.end]);
  assert.deepEqual(aWith, aWithout);
});

// ---- Routines (Epic 10, T6b) ----

const dayMs = (hhmm: string): number => Date.parse(`2026-08-22T${hhmm}:00.000Z`);

test("routines: placed at declared time, work routes around them, budget is unaffected", () => {
  const routines = [{ id: "r1", label: "Commute", days: ["sat"] as const, startMinutes: 11 * 60, durationMinutes: 30 }];
  const binding = { ...BUDGET, totalMinutes: 120 }; // tight: 30 fewer minutes would defer a Task
  const withR = computeDayRefit(baseInput({ fixedEvents: [], routines, budget: binding }));
  const without = computeDayRefit(baseInput({ fixedEvents: [], budget: binding }));
  assert.equal(withR.ok && without.ok, true);
  if (!withR.ok || !without.ok) return;
  const rb = withR.value.blocks.filter((b) => b.kind === "routine");
  assert.equal(rb.length, 1);
  assert.equal(rb[0]!.start, "2026-08-22T11:00:00.000Z");
  assert.equal(rb[0]!.routineId, "r1");
  for (const b of withR.value.blocks.filter((x) => x.kind !== "routine")) {
    assert.ok(!(dayMs("11:00") < Date.parse(b.end) && Date.parse(b.start) < dayMs("11:30")), `${b.id} overlaps routine`);
  }
  const minutes = (blocks: readonly PlanBlock[]) => blocks.filter((b) => b.kind === "work").reduce((s, b) => s + (Date.parse(b.end) - Date.parse(b.start)) / 60000, 0);
  assert.equal(minutes(without.value.blocks), 105, "the budget just fits both Tasks");
  assert.equal(minutes(withR.value.blocks), minutes(without.value.blocks), "same work minutes with or without the routine");
  assert.deepEqual(withR.value.unplacedRoutineLabels ?? [], []);
});

test("routines: shifted around an anchor; unfit routines are reported unplaced", () => {
  const routines = [
    { id: "r1", label: "Commute", days: ["sat"] as const, startMinutes: 10 * 60, durationMinutes: 30 },
    { id: "r2", label: "Huge", days: ["sat"] as const, startMinutes: 12 * 60, durationMinutes: 24 * 60 },
  ];
  const r = computeDayRefit(baseInput({ routines }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const commute = r.value.blocks.find((b) => b.routineId === "r1")!;
  assert.equal(commute.start, "2026-08-22T09:30:00.000Z"); // anchor 10:00-10:30; a tie between 09:30 and 10:30 goes earlier
  assert.deepEqual(r.value.unplacedRoutineLabels, ["Huge"]);
});

test("routines: only routines declared for the day's weekday apply", () => {
  const routines = [{ id: "r1", label: "Weekday thing", days: ["mon"] as const, startMinutes: 11 * 60, durationMinutes: 30 }];
  const r = computeDayRefit(baseInput({ routines })); // 2026-08-22 is a Saturday
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.blocks.some((b) => b.kind === "routine"), false);
});

test("routines: a routine pin overrides the declared time; pinned Tasks are placed first", () => {
  const routines = [{ id: "r1", label: "Commute", days: ["sat"] as const, startMinutes: 11 * 60, durationMinutes: 30 }];
  const pins = [{ date: DATE, subject: { kind: "routine" as const, routineId: "r1" }, start: "2026-08-22T14:00:00.000Z" }];
  const r = computeDayRefit(baseInput({ routines, pins, fixedEvents: [] }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const b = r.value.blocks.find((x) => x.routineId === "r1")!;
  assert.equal(b.start, "2026-08-22T14:00:00.000Z");
  assert.equal(b.pinned, true);
});

test("routines: a routine goes around a pinned Task", () => {
  const routines = [{ id: "r1", label: "Commute", days: ["sat"] as const, startMinutes: 11 * 60, durationMinutes: 30 }];
  const pins = [{ date: DATE, subject: { kind: "task" as const, taskId: "a" }, start: "2026-08-22T11:00:00.000Z" }];
  const r = computeDayRefit(baseInput({ routines, pins, fixedEvents: [] }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const b = r.value.blocks.find((x) => x.routineId === "r1")!;
  const pinnedEnd = Math.max(...r.value.blocks.filter((x) => x.taskId === "a").map((x) => Date.parse(x.end)));
  assert.ok(Date.parse(b.start) >= pinnedEnd || Date.parse(b.end) <= dayMs("11:00"));
});

// ---- Routines: stored blocks (fix round 1) ----

const R1 = { id: "r1", label: "Commute", days: ["sat"] as const, startMinutes: 8 * 60, durationMinutes: 30 };
const storedRoutine = (start: string, end: string): PlanBlock => ({ id: "v1-routine-r1", kind: "routine", routineId: "r1", label: "Commute", start: `2026-08-22T${start}:00.000Z`, end: `2026-08-22T${end}:00.000Z` });

test("routines: a routine stored at a shifted future time stays there when the declared time has passed", () => {
  const r = computeDayRefit(baseInput({ now: "2026-08-22T08:30:00.000Z", fixedEvents: [], routines: [R1], storedRoutineBlocks: [storedRoutine("09:00", "09:30")] }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const rb = r.value.blocks.filter((b) => b.kind === "routine");
  assert.equal(rb.length, 1);
  assert.equal(rb[0]!.start, "2026-08-22T09:00:00.000Z");
});

test("routines: a routine in progress is kept verbatim, not re-placed", () => {
  const stored = storedRoutine("08:15", "08:45");
  const r = computeDayRefit(baseInput({ now: "2026-08-22T08:30:00.000Z", fixedEvents: [], routines: [R1], storedRoutineBlocks: [stored] }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const rb = r.value.blocks.filter((b) => b.kind === "routine");
  assert.deepEqual(rb, [stored]);
  for (const b of r.value.blocks.filter((x) => x.kind !== "routine")) {
    assert.ok(!(Date.parse(b.start) < Date.parse(stored.end) && Date.parse(stored.start) < Date.parse(b.end)), "work avoids the routine");
  }
});

test("routines: a routine whose stored block already elapsed is not placed again", () => {
  const past = storedRoutine("08:00", "08:30");
  const r = computeDayRefit(baseInput({
    now: "2026-08-22T08:45:00.000Z", fixedEvents: [], pastBlocks: [past], storedRoutineBlocks: [past],
    routines: [{ ...R1, startMinutes: 9 * 60 }],
  }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.blocks.filter((b) => b.kind === "routine"), [past]);
});

test("a request pin into an under-way routine is rejected naming the routine; a stored pin is released", () => {
  const stored = storedRoutine("08:15", "08:45");
  const now = "2026-08-22T08:30:00.000Z";
  const openTasks = [task("a", 60, "2026-08-25"), task("b", 45, "2026-08-23")];
  const pins = [pinOf("b", "2026-08-22T08:35:00.000Z")];
  const req = computeDayRefit(baseInput({ now, fixedEvents: [], routines: [R1], storedRoutineBlocks: [stored], openTasks, pins, requestPinTaskIds: ["b"] }));
  assert.equal(req.ok, true);
  if (!req.ok) return;
  assert.match(req.value.rejectedReason ?? "", new RegExp(`overlaps ${R1.label}`));
  const held = computeDayRefit(baseInput({ now, fixedEvents: [], routines: [R1], storedRoutineBlocks: [stored], openTasks, pins }));
  assert.equal(held.ok, true);
  if (!held.ok) return;
  assert.equal(held.value.rejectedReason, undefined);
  assert.equal(held.value.releasedPins?.[0]?.taskId, "b");
});

// ---------------------------------------------------------------------------
// Pin length (DayPin.durationMinutes)
// ---------------------------------------------------------------------------

test("a pin with durationMinutes places the Task for that length (longer than its estimate) and subtracts it from the budget", () => {
  const openTasks = [task("a", 60, "2026-08-25"), task("b", 30, "2026-08-23")];
  const pin: DayPin = { ...pinOf("b", "2026-08-22T11:00:00.000Z"), durationMinutes: 50 };
  const result = computeDayRefit(baseInput({ openTasks, pins: [pin] }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const bWork = result.value.blocks.filter((x) => x.kind === "work" && x.taskId === "b");
  assert.deepEqual(bWork.map((x) => [x.start, x.end]), [["2026-08-22T11:00:00.000Z", "2026-08-22T11:50:00.000Z"]]);
  const plain = computeDayRefit(baseInput({ openTasks, pins: [pinOf("b", "2026-08-22T11:00:00.000Z")] }));
  assert.equal(plain.ok, true);
  if (!plain.ok) return;
  const workMin = (blocks: readonly PlanBlock[], id: string) =>
    blocks.filter((x) => x.kind === "work" && x.taskId === id).reduce((s, x) => s + (Date.parse(x.end) - Date.parse(x.start)) / 60000, 0);
  assert.equal(workMin(plain.value.blocks, "b"), 30);
  assert.equal(workMin(result.value.blocks, "b"), 50);
});

test("a pin with durationMinutes shorter than the estimate places the shorter length", () => {
  const openTasks = [task("b", 90, "2026-08-23")];
  const pin: DayPin = { ...pinOf("b", "2026-08-22T11:00:00.000Z"), durationMinutes: 20 };
  const result = computeDayRefit(baseInput({ openTasks, pins: [pin] }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const bWork = result.value.blocks.filter((x) => x.kind === "work" && x.taskId === "b");
  assert.deepEqual(bWork.map((x) => [x.start, x.end]), [["2026-08-22T11:00:00.000Z", "2026-08-22T11:20:00.000Z"]]);
});

test("an in-progress pin with durationMinutes is placed from now for the remaining length; re-fitting again does not stretch it", () => {
  const openTasks = [task("b", 30, "2026-08-23")];
  const nowMs = Date.parse(NOW);
  const at = (mins: number) => new Date(nowMs + mins * 60_000).toISOString();
  const pin: DayPin = { ...pinOf("b", at(-30)), durationMinutes: 50 };
  const result = computeDayRefit(baseInput({ openTasks, pins: [pin] }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const bWork = result.value.blocks.filter((x) => x.kind === "work" && x.taskId === "b");
  assert.deepEqual(bWork.map((x) => [x.start, x.end]), [[NOW, at(20)]]);
});

test("an in-progress pin whose length has fully elapsed is skipped", () => {
  const openTasks = [task("b", 30, "2026-08-23")];
  const nowMs = Date.parse(NOW);
  const pin: DayPin = { ...pinOf("b", new Date(nowMs - 60 * 60_000).toISOString()), durationMinutes: 50 };
  const result = computeDayRefit(baseInput({ openTasks, pins: [pin] }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const bWork = result.value.blocks.filter((x) => x.kind === "work" && x.taskId === "b");
  assert.ok(bWork.length > 0 && bWork.every((x) => x.pinned !== true), "the elapsed pin no longer pins the Task");
});

// ============================================================================
// Earliest start (workStart): Yoh never places its own work before it; pins
// and routines keep Spencer's times.
// ============================================================================

test("workStart later than now: the first work block starts at workStart, not now", () => {
  const result = computeDayRefit({ ...baseInput({ fixedEvents: [] }), workStart: "2026-08-22T15:15:00.000Z" });
  assert.ok(result.ok);
  const work = result.value.fittedBlocks.filter((b) => b.kind === "work");
  assert.ok(work.length > 0);
  assert.equal(work[0]!.start, "2026-08-22T15:15:00.000Z");
  assert.ok(result.value.fittedBlocks.every((b) => Date.parse(b.start) >= Date.parse("2026-08-22T15:15:00.000Z")));
});

test("workStart earlier than now: placement starts at now", () => {
  const result = computeDayRefit({ ...baseInput({ fixedEvents: [] }), workStart: "2026-08-22T08:00:00.000Z" });
  assert.ok(result.ok);
  const work = result.value.fittedBlocks.filter((b) => b.kind === "work");
  assert.equal(work[0]!.start, NOW);
});

test("a pin before workStart keeps Spencer's time", () => {
  const pin = { date: DATE, subject: { kind: "task" as const, taskId: "b" }, start: "2026-08-22T10:00:00.000Z" };
  const result = computeDayRefit({ ...baseInput({ fixedEvents: [], pins: [pin] }), workStart: "2026-08-22T15:15:00.000Z" });
  assert.ok(result.ok);
  const pinned = result.value.fittedBlocks.find((b) => b.kind === "work" && b.taskId === "b");
  assert.equal(pinned!.start, "2026-08-22T10:00:00.000Z");
  const other = result.value.fittedBlocks.find((b) => b.kind === "work" && b.taskId === "a");
  assert.ok(Date.parse(other!.start) >= Date.parse("2026-08-22T15:15:00.000Z"));
});

test("a pin inside a protected window (Lunch) is Spencer's choice: kept, not released, and the day still fits", () => {
  const lunch: CalendarEvent = { id: "school-protected:lunch", title: "Lunch", start: "2026-08-22T10:55:00.000Z", end: "2026-08-22T11:35:00.000Z" };
  const pin = { date: DATE, subject: { kind: "task" as const, taskId: "b" }, start: "2026-08-22T11:00:00.000Z", durationMinutes: 30 };
  const result = computeDayRefit({ ...baseInput({ fixedEvents: [], protectedWindows: [lunch], pins: [pin] }), workStart: "2026-08-22T09:00:00.000Z" });
  assert.ok(result.ok);
  assert.equal(result.value.releasedPins, undefined);
  const pinned = result.value.fittedBlocks.find((b) => b.kind === "work" && b.taskId === "b");
  assert.equal(pinned!.start, "2026-08-22T11:00:00.000Z");
  // Yoh's own placement still stays out of the rest of Lunch.
  const own = result.value.fittedBlocks.filter((b) => b.kind === "work" && b.taskId === "a");
  assert.ok(own.every((b) => Date.parse(b.end) <= Date.parse(lunch.start) || Date.parse(b.start) >= Date.parse(lunch.end) || (Date.parse(b.start) >= Date.parse(pin.start) && Date.parse(b.end) <= Date.parse("2026-08-22T11:30:00.000Z"))));
});
