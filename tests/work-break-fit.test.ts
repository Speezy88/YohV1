/**
 * Tests for `src/core/work-break-fit.ts` (Story 1.8 / Task 8, FR-6-FR-8).
 *
 * Per AD-2/AD-8, this is a pure `core/*.ts` module: no I/O, no module-level
 * state, `Result<T, YohError>`, never throws. These tests exercise it purely
 * in-process with hand-built `CompleteTask`/`CalendarEvent`/`TimeBudget`
 * fixtures -- no `MemoryStore` or any adapter involved. `startTime` is always
 * passed in explicitly (AD-2 -- never read from the system clock internally).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitWorkBreakBlocks } from "../src/core/work-break-fit.ts";
import type { Area, CalendarEvent, CompleteTask, Energy, Refining, TimeBudget } from "../src/types/domain.ts";

const NOW = "2026-08-22T00:00:00.000Z";
const START = "2026-08-22T09:00:00.000Z"; // 09:00 UTC start of the fitting day

function toRefining<T>(value: T | "missing" | undefined, fallback: T): Refining<T> {
  if (value === "missing") return { kind: "missing" };
  return { kind: "set", value: value ?? fallback };
}

function makeTask(
  id: string,
  estimatedDurationMinutes: number,
  overrides: Partial<Omit<CompleteTask, "id" | "estimatedDurationMinutes" | "createdAt" | "updatedAt" | "area" | "energy">> & {
    area?: Area | "missing";
    energy?: Energy | "missing";
  } = {},
): CompleteTask {
  return {
    id,
    title: overrides.title ?? `Task ${id}`,
    estimatedDurationMinutes,
    dueDate: overrides.dueDate ?? "2026-08-25",
    status: overrides.status ?? "not-started",
    createdAt: NOW,
    updatedAt: NOW,
    area: toRefining<Area>(overrides.area, "Work"),
    energy: toRefining<Energy>(overrides.energy, "medium"),
  };
}

function makeBudget(overrides: Partial<TimeBudget> = {}): TimeBudget {
  return {
    date: "2026-08-22",
    totalMinutes: 170, // default: one full 70/15 cycle + a partial second work segment
    workMinutes: 70,
    breakMinutes: 15,
    ...overrides,
  };
}

function minutesFromStart(iso: string): number {
  return (Date.parse(iso) - Date.parse(START)) / 60000;
}

// ============================================================================
// Behavior 1: default 70/15 fitting, splitting a Task larger than one
// work-segment, strictly-clock-based boundaries (split, not extended).
// ============================================================================

test("fits a Task smaller than one work segment into a single work block using the budget's own workMinutes/breakMinutes", () => {
  const task = makeTask("small", 30);
  const budget = makeBudget({ totalMinutes: 100, workMinutes: 70, breakMinutes: 15 });

  const result = fitWorkBreakBlocks({ tasks: [task], budget, calendarEvents: [], startTime: START });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const workBlocks = result.value.blocks.filter((b) => b.kind === "work");
  assert.equal(workBlocks.length, 1);
  assert.equal(workBlocks[0]?.taskId, "small");
  assert.equal(minutesFromStart(workBlocks[0]!.start), 0);
  assert.equal(minutesFromStart(workBlocks[0]!.end), 30);
  assert.equal(result.value.deferredTaskIds.length, 0);
});

test("splits a Task larger than one work segment across multiple work blocks separated by a break block, boundaries strictly clock-based (split, not extended)", () => {
  // 90-minute task, 70-minute work segment: must split at the 70-minute mark.
  const task = makeTask("big", 90);
  const budget = makeBudget({ totalMinutes: 200, workMinutes: 70, breakMinutes: 15 });

  const result = fitWorkBreakBlocks({ tasks: [task], budget, calendarEvents: [], startTime: START });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const workBlocks = result.value.blocks.filter((b) => b.kind === "work");
  const breakBlocks = result.value.blocks.filter((b) => b.kind === "break");

  assert.equal(workBlocks.length, 2, "a 90-minute Task in a 70-minute work segment must split into two work blocks");
  assert.equal(workBlocks[0]?.taskId, "big");
  assert.equal(workBlocks[1]?.taskId, "big");

  // First chunk runs exactly to the 70-minute mark -- split, not extended.
  assert.equal(minutesFromStart(workBlocks[0]!.start), 0);
  assert.equal(minutesFromStart(workBlocks[0]!.end), 70);

  // A single break block separates the two work chunks.
  assert.equal(breakBlocks.length, 1);
  assert.equal(minutesFromStart(breakBlocks[0]!.start), 70);
  assert.equal(minutesFromStart(breakBlocks[0]!.end), 85);

  // Second chunk picks up immediately after the break and covers the
  // remaining 20 minutes of the Task.
  assert.equal(minutesFromStart(workBlocks[1]!.start), 85);
  assert.equal(minutesFromStart(workBlocks[1]!.end), 105);

  assert.equal(result.value.deferredTaskIds.length, 0);
});

test("the 70/15 ratio is overridable via the given TimeBudget's own workMinutes/breakMinutes fields", () => {
  const task = makeTask("custom", 80);
  const budget = makeBudget({ totalMinutes: 200, workMinutes: 50, breakMinutes: 10 });

  const result = fitWorkBreakBlocks({ tasks: [task], budget, calendarEvents: [], startTime: START });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const workBlocks = result.value.blocks.filter((b) => b.kind === "work");
  const breakBlocks = result.value.blocks.filter((b) => b.kind === "break");

  assert.equal(workBlocks.length, 2);
  assert.equal(minutesFromStart(workBlocks[0]!.end), 50); // split at the overridden 50-minute mark
  assert.equal(breakBlocks.length, 1);
  assert.equal(minutesFromStart(breakBlocks[0]!.end), 60); // 50 + overridden 10-minute break
  assert.equal(minutesFromStart(workBlocks[1]!.end), 90); // remaining 30 minutes of the Task
});

// ============================================================================
// Behavior 2: a larger declared Time Budget produces proportionally more
// Work/Break blocks using the same ratio.
// ============================================================================

test("a larger declared Time Budget produces proportionally more Work/Break blocks using the same ratio", () => {
  // Plenty of task material so the budget itself is always the binding
  // constraint, not task availability.
  const manyTasks = Array.from({ length: 20 }, (_, i) => makeTask(`t${i}`, 70));

  const smallBudget = makeBudget({ totalMinutes: 170, workMinutes: 70, breakMinutes: 15 }); // 2 work segments
  const largeBudget = makeBudget({ totalMinutes: 340, workMinutes: 70, breakMinutes: 15 }); // 4 work segments (2x)

  const smallResult = fitWorkBreakBlocks({ tasks: manyTasks, budget: smallBudget, calendarEvents: [], startTime: START });
  const largeResult = fitWorkBreakBlocks({ tasks: manyTasks, budget: largeBudget, calendarEvents: [], startTime: START });

  assert.equal(smallResult.ok, true);
  assert.equal(largeResult.ok, true);
  if (!smallResult.ok || !largeResult.ok) return;

  const smallWorkBlocks = smallResult.value.blocks.filter((b) => b.kind === "work");
  const largeWorkBlocks = largeResult.value.blocks.filter((b) => b.kind === "work");
  const smallBreakBlocks = smallResult.value.blocks.filter((b) => b.kind === "break");
  const largeBreakBlocks = largeResult.value.blocks.filter((b) => b.kind === "break");

  // Double the budget (same ratio) -> double the work blocks, since each
  // 70-minute work block holds exactly one 70-minute Task here.
  assert.equal(smallWorkBlocks.length, 2);
  assert.equal(largeWorkBlocks.length, smallWorkBlocks.length * 2);
  // Breaks are only ever inserted *between* two work segments (never a
  // trailing/padding break with nothing scheduled after it), so break count
  // is always (work count - 1), not a clean doubling of break count itself --
  // this is what "proportionally more Work/Break Blocks" looks like without
  // padding the day with an unused trailing break.
  assert.equal(smallBreakBlocks.length, smallWorkBlocks.length - 1);
  assert.equal(largeBreakBlocks.length, largeWorkBlocks.length - 1);
  assert.ok(largeBreakBlocks.length > smallBreakBlocks.length);
});

// ============================================================================
// Behavior 3: a Task that cannot fit in the remaining Time Budget is
// deferred, not force-fit.
// ============================================================================

test("a Task that cannot fit in the remaining Time Budget is deferred rather than force-fit", () => {
  // Budget only has room for one 70-minute work segment (no break follows,
  // since nothing more will fit). A 200-minute Task cannot fit at all inside
  // a single 70-minute-budget day.
  const tooBig = makeTask("too-big", 200);
  const budget = makeBudget({ totalMinutes: 70, workMinutes: 70, breakMinutes: 15 });

  const result = fitWorkBreakBlocks({ tasks: [tooBig], budget, calendarEvents: [], startTime: START });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.deferredTaskIds, ["too-big"]);
  // Not force-fit: no partial/truncated work block for the deferred Task.
  assert.equal(result.value.blocks.filter((b) => b.taskId === "too-big").length, 0);
});

test("a deferred Task does not block a smaller, later Task from still being fitted into the remaining budget", () => {
  const tooBig = makeTask("too-big", 500);
  const fitsFine = makeTask("fits-fine", 20);
  const budget = makeBudget({ totalMinutes: 70, workMinutes: 70, breakMinutes: 15 });

  const result = fitWorkBreakBlocks({
    tasks: [tooBig, fitsFine],
    budget,
    calendarEvents: [],
    startTime: START,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.deferredTaskIds, ["too-big"]);
  const fitsFineBlocks = result.value.blocks.filter((b) => b.taskId === "fits-fine");
  assert.equal(fitsFineBlocks.length, 1);
  assert.equal(minutesFromStart(fitsFineBlocks[0]!.start), 0);
  assert.equal(minutesFromStart(fitsFineBlocks[0]!.end), 20);
});

// ============================================================================
// Behavior 4: fixed Calendar-anchor events are placed as immovable anchors
// that Work/Break blocks are fitted around.
// ============================================================================

test("a Calendar event's start/end reappears unchanged as a calendar-anchor PlanBlock, and no work/break block overlaps it", () => {
  const event: CalendarEvent = {
    id: "cal-1",
    title: "Standup",
    start: "2026-08-22T09:20:00.000Z", // 20 minutes into the fitting day
    end: "2026-08-22T09:35:00.000Z", // 15-minute meeting
  };
  const task = makeTask("around-anchor", 60);
  const budget = makeBudget({ totalMinutes: 200, workMinutes: 70, breakMinutes: 15 });

  const result = fitWorkBreakBlocks({ tasks: [task], budget, calendarEvents: [event], startTime: START });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const anchorBlocks = result.value.blocks.filter((b) => b.kind === "calendar-anchor");
  assert.equal(anchorBlocks.length, 1);
  assert.equal(anchorBlocks[0]?.start, event.start);
  assert.equal(anchorBlocks[0]?.end, event.end);
  assert.equal(anchorBlocks[0]?.label, "Standup");

  const anchorStartMs = Date.parse(event.start);
  const anchorEndMs = Date.parse(event.end);
  for (const block of result.value.blocks) {
    if (block.kind === "calendar-anchor") continue;
    const blockStartMs = Date.parse(block.start);
    const blockEndMs = Date.parse(block.end);
    const overlaps = blockStartMs < anchorEndMs && blockEndMs > anchorStartMs;
    assert.equal(overlaps, false, `block ${block.id} (${block.start}-${block.end}) overlaps the calendar anchor`);
  }

  // Work time skips over (rather than consumes budget for) the anchor's
  // wall-clock span: the Task's work is split around the meeting. The
  // anchor's own 15-minute wall-clock span still elapses on the clock (it's
  // free with respect to the Time Budget, not with respect to real time), so
  // the second chunk's wall-clock end reflects that real elapsed time even
  // though only 60 total minutes of *work* were placed.
  const workBlocks = result.value.blocks.filter((b) => b.kind === "work");
  assert.equal(workBlocks.length, 2);
  assert.equal(minutesFromStart(workBlocks[0]!.start), 0);
  assert.equal(minutesFromStart(workBlocks[0]!.end), 20); // runs up to the anchor's start
  assert.equal(workBlocks[1]!.start, event.end); // resumes exactly at the anchor's end
  assert.equal(minutesFromStart(workBlocks[1]!.end), 20 + 15 + 40); // + anchor's 15-minute real-time span + remaining 40 minutes of the 60-minute Task
  // Together the two work chunks account for the Task's full 60 minutes.
  const totalWorkMinutesPlaced =
    (Date.parse(workBlocks[0]!.end) - Date.parse(workBlocks[0]!.start)) / 60000 +
    (Date.parse(workBlocks[1]!.end) - Date.parse(workBlocks[1]!.start)) / 60000;
  assert.equal(totalWorkMinutesPlaced, 60);
});

// ============================================================================
// Behavior 5: every produced PlanBlock has a stable, unique id.
// ============================================================================

test("every produced PlanBlock has a non-empty, unique id", () => {
  const event: CalendarEvent = {
    id: "cal-1",
    title: "Standup",
    start: "2026-08-22T09:20:00.000Z",
    end: "2026-08-22T09:35:00.000Z",
  };
  const tasks = [makeTask("a", 90), makeTask("b", 40)];
  const budget = makeBudget({ totalMinutes: 300, workMinutes: 70, breakMinutes: 15 });

  const result = fitWorkBreakBlocks({ tasks, budget, calendarEvents: [event], startTime: START });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.value.blocks.length > 1);
  const ids = result.value.blocks.map((b) => b.id);
  for (const id of ids) {
    assert.equal(typeof id, "string");
    assert.ok(id.length > 0);
  }
  assert.equal(new Set(ids).size, ids.length, "every PlanBlock id must be unique");
});

test("ids are stable (deterministic) across repeated calls with identical input", () => {
  const tasks = [makeTask("a", 90), makeTask("b", 40)];
  const budget = makeBudget({ totalMinutes: 300, workMinutes: 70, breakMinutes: 15 });
  const input = { tasks, budget, calendarEvents: [], startTime: START };

  const first = fitWorkBreakBlocks(input);
  const second = fitWorkBreakBlocks(input);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.value.blocks.map((b) => b.id), second.value.blocks.map((b) => b.id));
});

// ============================================================================
// Validation / never-throws
// ============================================================================

test("rejects a malformed startTime", () => {
  const result = fitWorkBreakBlocks({
    tasks: [],
    budget: makeBudget(),
    calendarEvents: [],
    startTime: "not-a-datetime",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
});

test("rejects two overlapping Calendar events", () => {
  const eventA: CalendarEvent = { id: "a", title: "A", start: "2026-08-22T09:00:00.000Z", end: "2026-08-22T09:30:00.000Z" };
  const eventB: CalendarEvent = { id: "b", title: "B", start: "2026-08-22T09:15:00.000Z", end: "2026-08-22T09:45:00.000Z" };
  const result = fitWorkBreakBlocks({
    tasks: [],
    budget: makeBudget(),
    calendarEvents: [eventA, eventB],
    startTime: START,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
});

test("rejects a non-positive workMinutes/breakMinutes/totalMinutes on the given TimeBudget", () => {
  const result = fitWorkBreakBlocks({
    tasks: [],
    budget: makeBudget({ workMinutes: 0 }),
    calendarEvents: [],
    startTime: START,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
});

test("an empty candidate Task list with an empty calendar produces an empty blocks list", () => {
  const result = fitWorkBreakBlocks({ tasks: [], budget: makeBudget(), calendarEvents: [], startTime: START });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.blocks, []);
  assert.deepEqual(result.value.deferredTaskIds, []);
});

test("never throws, even on wildly invalid input", () => {
  assert.doesNotThrow(() => {
    fitWorkBreakBlocks({
      tasks: [makeTask("a", -5)],
      budget: makeBudget({ totalMinutes: -1 }),
      calendarEvents: [],
      startTime: "",
    });
  });
});
