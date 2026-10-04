/**
 * Tests for `src/core/desk-metrics.ts` (Epic 12): the Desk page's pure metrics.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DESK_HEATMAP_WEEKS,
  completedToday,
  heatmapWeeks,
  hoursWithYoh,
  minutesToday,
  monthlySpend,
  onTimeRate,
  streakOf,
  type DeskCompletionRow,
} from "../src/core/desk-metrics.ts";

const LA = "America/Los_Angeles";
const row = (completedAt: string, o: Partial<DeskCompletionRow> = {}): DeskCompletionRow => ({
  taskName: "t",
  dueDate: null,
  estimatedMinutes: null,
  completedAt,
  ...o,
});

test("completedToday: zero rows, newest first, local midnight in Los Angeles", () => {
  assert.deepEqual(completedToday([], "2026-10-04", LA), []);
  const rows = [
    row("2026-10-04T06:59:59.000Z", { taskName: "before midnight" }), // 23:59:59 PDT on the 3rd
    row("2026-10-04T07:00:00.000Z", { taskName: "first" }), // 00:00 PDT on the 4th
    row("2026-10-04T20:00:00.000Z", { taskName: "later" }),
    row("2026-10-05T06:59:59.000Z", { taskName: "last" }), // 23:59:59 PDT on the 4th
    row("2026-10-05T07:00:00.000Z", { taskName: "after midnight" }), // the 5th
  ];
  assert.deepEqual(
    completedToday(rows, "2026-10-04", LA).map((r) => r.taskName),
    ["last", "later", "first"],
  );
  assert.deepEqual(completedToday(rows, "2026-10-04", LA)[0], { taskName: "last", completedAt: "2026-10-05T06:59:59.000Z" });
});

test("minutesToday and hoursWithYoh: zero rows, null estimates, rounding", () => {
  assert.equal(minutesToday([], "2026-10-04", "UTC"), 0);
  assert.equal(hoursWithYoh([]), 0);
  const rows = [
    row("2026-10-04T10:00:00.000Z", { estimatedMinutes: 30 }),
    row("2026-10-04T11:00:00.000Z", { estimatedMinutes: null }),
    row("2026-10-03T11:00:00.000Z", { estimatedMinutes: 100 }),
  ];
  assert.equal(minutesToday(rows, "2026-10-04", "UTC"), 30);
  assert.equal(hoursWithYoh(rows), 2); // 130 min = 2.17 h
  assert.equal(hoursWithYoh([row("2026-10-04T10:00:00.000Z", { estimatedMinutes: 90 })]), 2); // 1.5 rounds up
  assert.equal(hoursWithYoh([row("2026-10-04T10:00:00.000Z", { estimatedMinutes: 29 })]), 0);
});

test("onTimeRate: due day, day after, no due date, zero rows, local midnight", () => {
  assert.deepEqual(onTimeRate([], "UTC"), { onTime: 0, counted: 0, percent: null });
  const rows = [
    row("2026-10-04T10:00:00.000Z", { dueDate: "2026-10-04" }), // on the due day: on time
    row("2026-10-05T10:00:00.000Z", { dueDate: "2026-10-04" }), // the day after: late
    row("2026-10-05T10:00:00.000Z"), // no due date: left out
    row("2026-10-01T10:00:00.000Z", { dueDate: "2026-10-04" }), // early: on time
  ];
  assert.deepEqual(onTimeRate(rows, "UTC"), { onTime: 2, counted: 3, percent: 67 });
  // 06:30Z on the 5th is still the 4th in Los Angeles: on time there, late in UTC.
  const edge = [row("2026-10-05T06:30:00.000Z", { dueDate: "2026-10-04" })];
  assert.equal(onTimeRate(edge, LA).percent, 100);
  assert.equal(onTimeRate(edge, "UTC").percent, 0);
  // 07:30Z on the 5th is the 5th in Los Angeles: late.
  assert.equal(onTimeRate([row("2026-10-05T07:30:00.000Z", { dueDate: "2026-10-04" })], LA).percent, 0);
});

test("streakOf: today closed out, today pending, gaps, weekends, one-sided days, longest, empty", () => {
  const both = (days: string[]) => streakOf(days, days, "2026-10-07");
  assert.deepEqual(streakOf([], [], "2026-10-07"), { current: 0, longest: 0 });
  assert.deepEqual(both(["2026-10-05", "2026-10-06", "2026-10-07"]), { current: 3, longest: 3 }); // today closed out
  assert.deepEqual(both(["2026-10-05", "2026-10-06"]), { current: 2, longest: 2 }); // today pending
  assert.deepEqual(both(["2026-10-04", "2026-10-05"]), { current: 0, longest: 2 }); // yesterday missing
  // Fri 2026-10-02 and Mon 2026-10-05 with the weekend between: the weekend breaks the run.
  assert.deepEqual(both(["2026-10-02", "2026-10-05", "2026-10-06"]), { current: 2, longest: 2 });
  // A Plan with no close-out and a close-out with no Plan are not streak days.
  assert.deepEqual(streakOf(["2026-10-05", "2026-10-06"], ["2026-10-06"], "2026-10-07"), { current: 1, longest: 1 });
  assert.deepEqual(streakOf(["2026-10-06"], ["2026-10-05", "2026-10-06"], "2026-10-07"), { current: 1, longest: 1 });
  // Longest longer than current.
  const days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-10-06"];
  assert.deepEqual(both(days), { current: 1, longest: 4 });
  // Across a month and year boundary.
  assert.deepEqual(streakOf(["2025-12-31", "2026-01-01"], ["2025-12-31", "2026-01-01"], "2026-01-01"), { current: 2, longest: 2 });
});

test("heatmapWeeks: 26 Sunday-start columns ending this week, nothing after today", () => {
  assert.equal(DESK_HEATMAP_WEEKS, 26);
  const weeks = heatmapWeeks([], [], "2026-10-07", "UTC"); // a Wednesday
  assert.equal(weeks.length, 26);
  assert.equal(weeks[25]!.length, 4); // Sun..Wed
  assert.equal(weeks[25]![0]!.date, "2026-10-04"); // a Sunday
  assert.equal(weeks[25]!.at(-1)!.date, "2026-10-07");
  for (const w of weeks.slice(0, 25)) assert.equal(w.length, 7);
  for (const w of weeks) assert.equal(new Date(`${w[0]!.date}T00:00:00Z`).getUTCDay(), 0);
  assert.equal(weeks[0]![0]!.date, "2026-04-12"); // 25 weeks before 2026-10-04
  // On a Sunday the last column holds one day.
  assert.equal(heatmapWeeks([], [], "2026-10-04", "UTC")[25]!.length, 1);
  // On a Saturday it is a full week.
  assert.equal(heatmapWeeks([], [], "2026-10-10", "UTC")[25]!.length, 7);
});

test("heatmapWeeks: level boundaries and activity-only days", () => {
  const at = (day: string, n: number) => Array.from({ length: n }, (_, i) => row(`${day}T1${i}:00:00.000Z`));
  const rows = [...at("2026-10-01", 1), ...at("2026-10-02", 2), ...at("2026-10-03", 3), ...at("2026-10-04", 4), ...at("2026-10-05", 5), ...at("2026-10-06", 7)];
  const days = heatmapWeeks(rows, ["2026-10-07"], "2026-10-08", "UTC").flat();
  const level = (d: string) => days.find((x) => x.date === d)!;
  assert.deepEqual([level("2026-10-01").level, level("2026-10-02").level, level("2026-10-03").level, level("2026-10-04").level, level("2026-10-05").level, level("2026-10-06").level], [2, 2, 3, 3, 4, 4]);
  assert.equal(level("2026-10-04").completed, 4);
  assert.equal(level("2026-10-07").level, 1); // activity day, nothing completed
  assert.equal(level("2026-10-07").completed, 0);
  assert.equal(level("2026-10-08").level, 0); // nothing at all
  // A completion counts even without an activity-day row (level 2 above had none), and level 0 with neither.
  assert.equal(level("2026-09-30").level, 0);
  assert.equal(level("2026-09-30").completed, 0);
  // An activity day with a completion takes the completion level.
  const both = heatmapWeeks(at("2026-10-01", 5), ["2026-10-01"], "2026-10-08", "UTC").flat();
  assert.equal(both.find((x) => x.date === "2026-10-01")!.level, 4);
});

test("heatmapWeeks: local dates, year boundary and a DST change", () => {
  // 07:30Z on 2026-10-05 is 00:30 on the 5th in LA; 06:30Z is the 4th.
  const days = heatmapWeeks([row("2026-10-05T06:30:00.000Z"), row("2026-10-05T07:30:00.000Z")], [], "2026-10-07", LA).flat();
  assert.equal(days.find((d) => d.date === "2026-10-04")!.completed, 1);
  assert.equal(days.find((d) => d.date === "2026-10-05")!.completed, 1);
  // Year boundary: dates are contiguous and unique.
  const jan = heatmapWeeks([], [], "2026-01-03", "UTC").flat();
  assert.equal(jan.length, new Set(jan.map((d) => d.date)).size);
  assert.ok(jan.some((d) => d.date === "2025-12-31") && jan.some((d) => d.date === "2026-01-01"));
  // DST end in LA (2026-11-01): every date appears once, in order.
  for (const [today, changeDay] of [["2026-11-08", "2026-11-01"], ["2026-03-15", "2026-03-08"]] as const) {
    const dates = heatmapWeeks([], [], today, LA).flat().map((d) => d.date);
    assert.ok(dates.includes(changeDay));
    for (let i = 1; i < dates.length; i++) assert.equal((Date.parse(`${dates[i]}T00:00:00Z`) - Date.parse(`${dates[i - 1]}T00:00:00Z`)) / 86_400_000, 1);
  }
  // A completion at the DST fall-back hour lands on the local day.
  const fall = heatmapWeeks([row("2026-11-01T09:30:00.000Z")], [], "2026-11-08", LA).flat();
  assert.equal(fall.find((d) => d.date === "2026-11-01")!.completed, 1);
});

test("monthlySpend: month boundary in local time, unpriced model, no rows", () => {
  const u = (at: string, model = "claude-haiku-4-5") => ({ at, model, inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  assert.deepEqual(monthlySpend([], new Date("2026-10-15T12:00:00Z"), "UTC"), { monthUsd: 0, unpricedCalls: 0 });
  const now = new Date("2026-10-15T12:00:00Z");
  // In LA, 2026-10-01T06:00Z is still September 30; 2026-11-01T06:59Z is still October 31.
  const rows = [u("2026-10-01T06:00:00.000Z"), u("2026-10-01T07:00:00.000Z"), u("2026-11-01T06:59:00.000Z"), u("2026-11-01T07:00:00.000Z")];
  assert.deepEqual(monthlySpend(rows, now, LA), { monthUsd: 2, unpricedCalls: 0 });
  assert.deepEqual(monthlySpend(rows, now, "UTC"), { monthUsd: 2, unpricedCalls: 0 }); // Oct 1 07:00 and Oct 1 06:00
  // An unpriced model is left out and counted; it never throws.
  const mixed = [u("2026-10-02T00:00:00.000Z"), u("2026-10-03T00:00:00.000Z", "claude-mystery-9"), u("2026-09-03T00:00:00.000Z", "claude-mystery-9")];
  assert.deepEqual(monthlySpend(mixed, now, "UTC"), { monthUsd: 1, unpricedCalls: 1 });
  // Rounded to cents.
  const small = [{ ...u("2026-10-02T00:00:00.000Z"), inputTokens: 12_345, outputTokens: 6_789 }];
  assert.equal(monthlySpend(small, now, "UTC").monthUsd, 0.05); // 0.012345 + 0.033945 = 0.04629
});

test("M3: a completion with an unreadable completedAt is left out of every metric and never throws", () => {
  const rows = [row("garbage", { dueDate: "2026-10-04", estimatedMinutes: 30 }), row("2026-10-04T15:00:00.000Z", { dueDate: "2026-10-04", estimatedMinutes: 10 })];
  assert.equal(completedToday(rows, "2026-10-04", "UTC").length, 1);
  assert.equal(minutesToday(rows, "2026-10-04", "UTC"), 10);
  assert.deepEqual(onTimeRate(rows, "UTC"), { onTime: 1, counted: 1, percent: 100 });
  const total = heatmapWeeks(rows, [], "2026-10-04", "UTC").flat().reduce((n, d) => n + d.completed, 0);
  assert.equal(total, 1);
});

test("M3: a usage row with an unreadable at is left out and counted as unpriced", () => {
  const base = { model: "claude-haiku-4-5-20251001", inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  const out = monthlySpend([{ ...base, at: "garbage" }, { ...base, at: "2026-10-04T12:00:00.000Z" }], new Date("2026-10-15T12:00:00Z"), "UTC");
  assert.equal(out.unpricedCalls, 1);
  assert.ok(out.monthUsd > 0);
});

test("I1a: 50,000 usage rows and 5,000 completions are processed well under 500 ms", () => {
  const usage = Array.from({ length: 50_000 }, (_, i) => ({
    model: "claude-haiku-4-5-20251001", inputTokens: 10, outputTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
    at: new Date(Date.UTC(2026, 9, 1 + (i % 28), i % 24)).toISOString(),
  }));
  const rows = Array.from({ length: 5_000 }, (_, i) => row(new Date(Date.UTC(2026, 3, 1 + (i % 180), i % 24)).toISOString(), { dueDate: "2026-10-04", estimatedMinutes: 5 }));
  const t0 = performance.now();
  monthlySpend(usage, new Date("2026-10-15T12:00:00Z"), "America/Denver");
  completedToday(rows, "2026-10-04", "America/Denver");
  minutesToday(rows, "2026-10-04", "America/Denver");
  onTimeRate(rows, "America/Denver");
  heatmapWeeks(rows, [], "2026-10-04", "America/Denver");
  const ms = performance.now() - t0;
  assert.ok(ms < 500, `took ${ms.toFixed(0)} ms`);
});
