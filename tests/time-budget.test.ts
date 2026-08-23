/**
 * Tests for `src/core/time-budget.ts` (Story 1.6 / Task 6, FR-5).
 *
 * Per AD-2/AD-8, this is a pure `core/*.ts` module: no I/O, no module-level
 * state, `Result<T, YohError>`, never throws. These tests exercise it purely
 * in-process — no `MemoryStore` or any adapter involved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shapeDeclaredTimeBudget,
  resolveTodayTimeBudget,
  DEFAULT_WORK_MINUTES,
  DEFAULT_BREAK_MINUTES,
} from "../src/core/time-budget.ts";
import type { TimeBudget } from "../src/types/domain.ts";

// ============================================================================
// shapeDeclaredTimeBudget — validate/shape a declared Time Budget value
// ============================================================================

test("shapeDeclaredTimeBudget produces a TimeBudget with default work/break rhythm (70/15) when not overridden", () => {
  const result = shapeDeclaredTimeBudget({ totalMinutes: 360, date: "2026-08-22" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    date: "2026-08-22",
    totalMinutes: 360,
    workMinutes: DEFAULT_WORK_MINUTES,
    breakMinutes: DEFAULT_BREAK_MINUTES,
  });
});

test("shapeDeclaredTimeBudget honors explicit workMinutes/breakMinutes overrides", () => {
  const result = shapeDeclaredTimeBudget({
    totalMinutes: 300,
    date: "2026-08-22",
    workMinutes: 50,
    breakMinutes: 10,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.workMinutes, 50);
  assert.equal(result.value.breakMinutes, 10);
});

test("shapeDeclaredTimeBudget rejects a zero or negative totalMinutes", () => {
  for (const totalMinutes of [0, -30]) {
    const result = shapeDeclaredTimeBudget({ totalMinutes, date: "2026-08-22" });
    assert.equal(result.ok, false, `expected ${totalMinutes} to be rejected`);
    if (result.ok) return;
    assert.equal(result.error.kind, "validation");
  }
});

test("shapeDeclaredTimeBudget rejects a non-integer (fractional-minute) totalMinutes", () => {
  const result = shapeDeclaredTimeBudget({ totalMinutes: 90.5, date: "2026-08-22" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
});

test("shapeDeclaredTimeBudget rejects a totalMinutes exceeding 24 hours (1440 minutes)", () => {
  const result = shapeDeclaredTimeBudget({ totalMinutes: 1441, date: "2026-08-22" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
});

test("shapeDeclaredTimeBudget accepts exactly 1440 minutes (24 hours), the upper bound", () => {
  const result = shapeDeclaredTimeBudget({ totalMinutes: 1440, date: "2026-08-22" });
  assert.equal(result.ok, true);
});

test("shapeDeclaredTimeBudget rejects a malformed date string", () => {
  for (const date of ["08/22/2026", "2026-8-22", "not-a-date", ""]) {
    const result = shapeDeclaredTimeBudget({ totalMinutes: 300, date });
    assert.equal(result.ok, false, `expected date "${date}" to be rejected`);
    if (result.ok) return;
    assert.equal(result.error.kind, "validation");
  }
});

test("shapeDeclaredTimeBudget rejects a date that doesn't exist on the calendar", () => {
  const result = shapeDeclaredTimeBudget({ totalMinutes: 300, date: "2026-02-30" });
  assert.equal(result.ok, false);
});

test("shapeDeclaredTimeBudget rejects a zero or negative workMinutes/breakMinutes override", () => {
  const badWork = shapeDeclaredTimeBudget({ totalMinutes: 300, date: "2026-08-22", workMinutes: 0 });
  assert.equal(badWork.ok, false);
  const badBreak = shapeDeclaredTimeBudget({ totalMinutes: 300, date: "2026-08-22", breakMinutes: -5 });
  assert.equal(badBreak.ok, false);
});

test("shapeDeclaredTimeBudget never throws, even on wildly invalid input", () => {
  assert.doesNotThrow(() => {
    shapeDeclaredTimeBudget({ totalMinutes: Number.NaN, date: "" });
  });
});

// ============================================================================
// resolveTodayTimeBudget — "does today already have a carried-forward value"
// ============================================================================

const DECLARED_FRIDAY: TimeBudget = {
  date: "2026-08-21", // a Friday
  totalMinutes: 360,
  workMinutes: 70,
  breakMinutes: 15,
};

test("resolveTodayTimeBudget returns undefined when nothing has ever been declared", () => {
  assert.equal(resolveTodayTimeBudget(undefined, "2026-08-22"), undefined);
});

test("resolveTodayTimeBudget reports carriedForward: false when the stored value's date is today", () => {
  const stored: TimeBudget = { ...DECLARED_FRIDAY, date: "2026-08-22" };
  const result = resolveTodayTimeBudget(stored, "2026-08-22");
  assert.deepEqual(result, { budget: stored, carriedForward: false });
});

test("resolveTodayTimeBudget reports carriedForward: true, with the value unchanged, one day later", () => {
  const result = resolveTodayTimeBudget(DECLARED_FRIDAY, "2026-08-22"); // Saturday
  assert.deepEqual(result, { budget: DECLARED_FRIDAY, carriedForward: true });
});

test("resolveTodayTimeBudget carries the exact same value across an entire weekend boundary (Fri declared -> Mon read)", () => {
  const result = resolveTodayTimeBudget(DECLARED_FRIDAY, "2026-08-24"); // the following Monday
  assert.ok(result);
  assert.equal(result?.carriedForward, true);
  // The value itself is untouched — no different default, no reset.
  assert.deepEqual(result?.budget, DECLARED_FRIDAY);
});
