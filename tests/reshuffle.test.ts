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
  const result = computeDayRefit(baseInput({ pins: [pinOf("a", "2026-08-22T10:15:00.000Z")] }));
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

test("a pin that has already started is ignored (the Task returns to normal ordering)", () => {
  const result = computeDayRefit(baseInput({ pins: [pinOf("b", "2026-08-22T08:00:00.000Z")] }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.value.blocks.every((x) => x.pinned === undefined));
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
