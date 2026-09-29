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
