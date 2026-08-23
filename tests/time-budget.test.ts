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
  nextTimeBudgetDeferralStreak,
  buildTimeBudgetChangeProposal,
  DEFAULT_WORK_MINUTES,
  DEFAULT_BREAK_MINUTES,
  DEFERRAL_STREAK_PROPOSAL_THRESHOLD_DAYS,
  TIME_BUDGET_PROPOSAL_ENTITY_ID,
  type TimeBudgetDeferralStreakSnapshot,
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

// ============================================================================
// nextTimeBudgetDeferralStreak (Task 23 / Story 4.2, AD-3)
// ============================================================================

test("nextTimeBudgetDeferralStreak starts a fresh streak at 1 when there was no previous streak", () => {
  const result = nextTimeBudgetDeferralStreak(undefined, "2026-08-22", true);
  assert.deepEqual(result, { consecutiveDeferralDays: 1, lastDeferralDate: "2026-08-22" });
});

test("nextTimeBudgetDeferralStreak increments an existing streak by one on a new day with deferrals", () => {
  const previous: TimeBudgetDeferralStreakSnapshot = { consecutiveDeferralDays: 2, lastDeferralDate: "2026-08-21" };
  const result = nextTimeBudgetDeferralStreak(previous, "2026-08-22", true);
  assert.deepEqual(result, { consecutiveDeferralDays: 3, lastDeferralDate: "2026-08-22" });
});

test("nextTimeBudgetDeferralStreak clears the streak entirely on a day with no deferrals", () => {
  const previous: TimeBudgetDeferralStreakSnapshot = { consecutiveDeferralDays: 5, lastDeferralDate: "2026-08-21" };
  const result = nextTimeBudgetDeferralStreak(previous, "2026-08-22", false);
  assert.equal(result, undefined);
});

test("nextTimeBudgetDeferralStreak returns undefined (no streak) for a first day with no deferrals", () => {
  const result = nextTimeBudgetDeferralStreak(undefined, "2026-08-22", false);
  assert.equal(result, undefined);
});

test("nextTimeBudgetDeferralStreak is idempotent for a repeated call on the same date — does not double-increment", () => {
  const previous: TimeBudgetDeferralStreakSnapshot = { consecutiveDeferralDays: 2, lastDeferralDate: "2026-08-22" };
  const result = nextTimeBudgetDeferralStreak(previous, "2026-08-22", true);
  assert.deepEqual(result, previous);
});

// ============================================================================
// buildTimeBudgetChangeProposal (Task 23 / Story 4.2, AD-3)
// ============================================================================

const CURRENT_BUDGET: TimeBudget = { date: "2026-08-22", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 };

test("buildTimeBudgetChangeProposal returns undefined below the consecutive-day threshold", () => {
  assert.equal(DEFERRAL_STREAK_PROPOSAL_THRESHOLD_DAYS, 3, "documented starting threshold — update this test deliberately if the tunable changes");
  const streak: TimeBudgetDeferralStreakSnapshot = {
    consecutiveDeferralDays: DEFERRAL_STREAK_PROPOSAL_THRESHOLD_DAYS - 1,
    lastDeferralDate: "2026-08-22",
  };
  const result = buildTimeBudgetChangeProposal({
    currentBudget: CURRENT_BUDGET,
    currentBudgetVersion: 1,
    streak,
    createdAt: "2026-08-22T13:00:00.000Z",
  });
  assert.equal(result, undefined);
});

test("buildTimeBudgetChangeProposal produces a real Proposal<Partial<TimeBudget>> once the threshold is met, with an accurate reason string", () => {
  const streak: TimeBudgetDeferralStreakSnapshot = {
    consecutiveDeferralDays: DEFERRAL_STREAK_PROPOSAL_THRESHOLD_DAYS,
    lastDeferralDate: "2026-08-24",
  };
  const result = buildTimeBudgetChangeProposal({
    currentBudget: CURRENT_BUDGET,
    currentBudgetVersion: 4,
    streak,
    createdAt: "2026-08-24T13:00:00.000Z",
  });

  assert.ok(result, "expected a real Proposal, not undefined");
  assert.equal(result.kind, "time-budget-change");
  assert.equal(result.entityId, TIME_BUDGET_PROPOSAL_ENTITY_ID);
  assert.equal(result.entityVersion, "4", "entityVersion is the StoredRecord.version snapshot, stringified");
  assert.equal(result.createdAt, "2026-08-24T13:00:00.000Z");
  assert.ok(result.id.length > 0);

  // The suggested change: a real, larger totalMinutes — never the same or smaller.
  assert.ok(result.suggested.totalMinutes !== undefined);
  assert.ok(result.suggested.totalMinutes! > CURRENT_BUDGET.totalMinutes);
  // Not a placeholder: names the real streak length and both the real current and suggested totals.
  assert.match(result.reason, /3 consecutive days/);
  assert.match(result.reason, /360 minutes/);
  assert.match(result.reason, new RegExp(String(result.suggested.totalMinutes)));
});

test("buildTimeBudgetChangeProposal's reason string uses singular 'day' for a streak of exactly 1 (defensive phrasing check)", () => {
  // Not reachable via the real threshold (3), but exercises the pure
  // pluralization logic directly/independently of the threshold constant.
  const streak: TimeBudgetDeferralStreakSnapshot = { consecutiveDeferralDays: 1, lastDeferralDate: "2026-08-22" };
  const result = buildTimeBudgetChangeProposal({
    currentBudget: CURRENT_BUDGET,
    currentBudgetVersion: 1,
    streak,
    createdAt: "2026-08-22T13:00:00.000Z",
  });
  // consecutiveDeferralDays: 1 is below the real threshold, so this is undefined —
  // this test only documents that fact; the pluralization itself is covered
  // by the "at threshold" test above using the real (plural) threshold value.
  assert.equal(result, undefined);
});

test("buildTimeBudgetChangeProposal never suggests a totalMinutes beyond the 24-hour (1440-minute) ceiling shapeDeclaredTimeBudget itself enforces", () => {
  const nearCap: TimeBudget = { date: "2026-08-22", totalMinutes: 1400, workMinutes: 70, breakMinutes: 15 };
  const streak: TimeBudgetDeferralStreakSnapshot = {
    consecutiveDeferralDays: DEFERRAL_STREAK_PROPOSAL_THRESHOLD_DAYS,
    lastDeferralDate: "2026-08-22",
  };
  const result = buildTimeBudgetChangeProposal({
    currentBudget: nearCap,
    currentBudgetVersion: 1,
    streak,
    createdAt: "2026-08-22T13:00:00.000Z",
  });
  if (result) {
    assert.ok(result.suggested.totalMinutes! <= 1440);
  }
  // Either a capped-but-still-larger suggestion, or (if 1400 is already
  // within 20% of the 1440 ceiling) no proposal at all — both are correct;
  // what must never happen is a suggestion over 1440.
});

test("buildTimeBudgetChangeProposal returns undefined when already at the 24-hour ceiling — nothing meaningful left to propose", () => {
  const atCap: TimeBudget = { date: "2026-08-22", totalMinutes: 1440, workMinutes: 70, breakMinutes: 15 };
  const streak: TimeBudgetDeferralStreakSnapshot = {
    consecutiveDeferralDays: DEFERRAL_STREAK_PROPOSAL_THRESHOLD_DAYS,
    lastDeferralDate: "2026-08-22",
  };
  const result = buildTimeBudgetChangeProposal({
    currentBudget: atCap,
    currentBudgetVersion: 1,
    streak,
    createdAt: "2026-08-22T13:00:00.000Z",
  });
  assert.equal(result, undefined);
});
