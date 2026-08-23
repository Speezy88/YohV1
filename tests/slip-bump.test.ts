/**
 * Tests for `src/core/slip-bump.ts` (Task 17 / Story 2.5, FR-11).
 *
 * Per AD-1/AD-2, this is a pure `core/*.ts` module — no I/O, no mutable
 * module state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SLIP_BUMP_CURVE, computeSlipBumpLevel, computeSlipBumpLevels } from "../src/core/slip-bump.ts";

// ============================================================================
// The curve itself — small bump on slip 1, ~double on slip 2, cap by slip 3-4
// ============================================================================

test("SLIP_BUMP_CURVE: worked numbers show 'small bump on slip 1, ~double on slip 2, cap by slip 3-4' (Architecture Spine Deferred section)", () => {
  const slip1 = computeSlipBumpLevel(1);
  const slip2 = computeSlipBumpLevel(2);
  const slip3 = computeSlipBumpLevel(3);
  const slip4 = computeSlipBumpLevel(4);

  // Slip 1: a small, non-zero bump.
  assert.ok(slip1.value > 0, "slip 1 should produce a non-zero bump");
  assert.equal(slip1.atCap, false);

  // Slip 2: roughly double slip 1's bump.
  assert.equal(slip2.value, slip1.value * 2, "slip 2 should be exactly double slip 1's bump for this curve's chosen step");
  assert.equal(slip2.atCap, false);

  // Cap reached by slip 3 (within the "cap by slip 3-4" window), and never
  // exceeded thereafter.
  assert.equal(slip3.value, SLIP_BUMP_CURVE.cap);
  assert.equal(slip3.atCap, true);
  assert.equal(slip4.value, SLIP_BUMP_CURVE.cap);
  assert.equal(slip4.atCap, true);

  // Concrete numbers this curve actually produces, spelled out so a future
  // tuning change is forced to consciously re-examine this test rather than
  // silently drift: cap 3, step 1 -> 1, 2, 3, 3.
  assert.deepEqual(
    [slip1.value, slip2.value, slip3.value, slip4.value],
    [1, 2, 3, 3],
  );
});

// ============================================================================
// A Task slipping 3+ consecutive days never exceeds the cap
// ============================================================================

test("computeSlipBumpLevel: a Task slipping 3 consecutive days gets a bump at or below the cap, never exceeded by further slips", () => {
  const atThreeSlips = computeSlipBumpLevel(3);
  assert.ok(atThreeSlips.value <= SLIP_BUMP_CURVE.cap);

  for (const consecutiveSlips of [3, 4, 5, 10, 365]) {
    const level = computeSlipBumpLevel(consecutiveSlips);
    assert.ok(
      level.value <= SLIP_BUMP_CURVE.cap,
      `consecutiveSlips=${consecutiveSlips} produced ${level.value} > cap ${SLIP_BUMP_CURVE.cap}`,
    );
    assert.equal(level.value, SLIP_BUMP_CURVE.cap, "value should be pinned at the cap once reached");
    assert.equal(level.atCap, true);
  }
});

test("computeSlipBumpLevel: a Task with zero consecutive slips gets no bump", () => {
  const level = computeSlipBumpLevel(0);
  assert.equal(level.value, 0);
  assert.equal(level.atCap, false);
});

// ============================================================================
// computeSlipBumpLevels — the taskId -> numeric level map shape
// derived-priority.ts's `orderByDerivedPriority(tasks, today, bumpLevels?)`
// already expects (`Readonly<Record<ExternalId, number>>`)
// ============================================================================

test("computeSlipBumpLevels: produces a plain taskId -> numeric level map matching derived-priority.ts's bumpLevels shape", () => {
  const slipCounts = { "task-a": 1, "task-b": 2, "task-c": 3, "task-d": 0 };
  const levels = computeSlipBumpLevels(slipCounts);

  assert.deepEqual(levels, {
    "task-a": 1,
    "task-b": 2,
    "task-c": 3,
    "task-d": 0,
  });

  // Every value is a plain number (not a nested EscalationLevel object) —
  // exactly what orderByDerivedPriority's bumpLevels parameter expects.
  for (const value of Object.values(levels)) {
    assert.equal(typeof value, "number");
  }
});

test("computeSlipBumpLevels: an empty slip-counts map produces an empty levels map", () => {
  assert.deepEqual(computeSlipBumpLevels({}), {});
});

test("computeSlipBumpLevels: a Task absent from the slip-counts map is simply absent from the levels map (no bump, since it has never slipped)", () => {
  const levels = computeSlipBumpLevels({ "task-a": 2 });
  assert.equal(Object.prototype.hasOwnProperty.call(levels, "task-b"), false);
});
