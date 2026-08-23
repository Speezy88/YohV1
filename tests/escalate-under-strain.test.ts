/**
 * Tests for `src/core/escalate-under-strain.ts` (AD-6's shared curve,
 * Task 17 / Story 2.5).
 *
 * Per AD-1/AD-2, this is a pure `core/*.ts` module — no I/O, no mutable
 * module state — so every test here is a plain synchronous function call,
 * no fixtures, no store.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEscalation } from "../src/core/escalate-under-strain.ts";
import type { EscalationCurve } from "../src/types/domain.ts";

// ============================================================================
// AD-6 exact export surface
// ============================================================================

test("escalate-under-strain.ts exports EXACTLY computeEscalation, per AD-6", async () => {
  const mod = await import("../src/core/escalate-under-strain.ts");
  assert.deepEqual(Object.keys(mod).sort(), ["computeEscalation"]);
});

test("computeEscalation(strainCount, curve) returns an EscalationLevel ({ value, atCap })", () => {
  const curve: EscalationCurve = { cap: 5, step: 2 };
  const level = computeEscalation(1, curve);
  assert.equal(typeof level.value, "number");
  assert.equal(typeof level.atCap, "boolean");
});

// ============================================================================
// Worked-number behavior: value = strainCount * step, capped at curve.cap
// ============================================================================

test("computeEscalation: worked example — curve { cap: 5, step: 2 }", () => {
  const curve: EscalationCurve = { cap: 5, step: 2 };
  assert.deepEqual(computeEscalation(0, curve), { value: 0, atCap: false });
  assert.deepEqual(computeEscalation(1, curve), { value: 2, atCap: false });
  assert.deepEqual(computeEscalation(2, curve), { value: 4, atCap: false });
  // 3 * 2 = 6, clamped to the cap of 5.
  assert.deepEqual(computeEscalation(3, curve), { value: 5, atCap: true });
  // Further strain never exceeds the cap.
  assert.deepEqual(computeEscalation(4, curve), { value: 5, atCap: true });
  assert.deepEqual(computeEscalation(100, curve), { value: 5, atCap: true });
});

// ============================================================================
// value never exceeds cap, regardless of strainCount
// ============================================================================

test("computeEscalation: value never exceeds curve.cap for any strainCount", () => {
  const curve: EscalationCurve = { cap: 7, step: 3 };
  for (const strainCount of [0, 1, 2, 3, 4, 5, 10, 50, 1000]) {
    const level = computeEscalation(strainCount, curve);
    assert.ok(level.value <= curve.cap, `strainCount=${strainCount} produced value ${level.value} > cap ${curve.cap}`);
  }
});

// ============================================================================
// atCap flag correctness
// ============================================================================

test("computeEscalation: atCap is false strictly below the cap, true at/after it", () => {
  const curve: EscalationCurve = { cap: 4, step: 1 };
  assert.equal(computeEscalation(0, curve).atCap, false);
  assert.equal(computeEscalation(1, curve).atCap, false);
  assert.equal(computeEscalation(2, curve).atCap, false);
  assert.equal(computeEscalation(3, curve).atCap, false);
  assert.equal(computeEscalation(4, curve).atCap, true);
  assert.equal(computeEscalation(5, curve).atCap, true);
});

// ============================================================================
// Monotonicity in strainCount
// ============================================================================

test("computeEscalation: monotonic non-decreasing in strainCount, holding curve fixed", () => {
  const curve: EscalationCurve = { cap: 6, step: 2 };
  let previous = -Infinity;
  for (let strainCount = 0; strainCount <= 20; strainCount++) {
    const { value } = computeEscalation(strainCount, curve);
    assert.ok(value >= previous, `value regressed at strainCount=${strainCount}: ${value} < ${previous}`);
    previous = value;
  }
});

// ============================================================================
// Never throws — malformed input is normalized, not rejected (this file's
// documented choice: no Result<T, YohError> wrapper, since a non-negative
// integer strainCount and a valid curve never fail; see the file's own
// docstring for the reasoning)
// ============================================================================

test("computeEscalation: never throws — a negative or non-integer strainCount is clamped, not rejected", () => {
  const curve: EscalationCurve = { cap: 3, step: 1 };
  assert.doesNotThrow(() => computeEscalation(-5, curve));
  assert.deepEqual(computeEscalation(-5, curve), { value: 0, atCap: false });

  assert.doesNotThrow(() => computeEscalation(2.7, curve));
  // Floors to 2 strain events -> value 2, below the cap of 3.
  assert.deepEqual(computeEscalation(2.7, curve), { value: 2, atCap: false });
});

test("computeEscalation: never throws — a malformed curve (negative cap/step) is normalized, not rejected", () => {
  assert.doesNotThrow(() => computeEscalation(3, { cap: -1, step: 1 }));
  const level = computeEscalation(3, { cap: -1, step: 1 });
  assert.equal(level.value, 0);
  assert.equal(level.atCap, true);

  assert.doesNotThrow(() => computeEscalation(3, { cap: 5, step: -2 }));
  const level2 = computeEscalation(3, { cap: 5, step: -2 });
  assert.equal(level2.value, 0);
});

test("computeEscalation: a zero-cap curve is always at cap, at value 0", () => {
  const curve: EscalationCurve = { cap: 0, step: 1 };
  for (const strainCount of [0, 1, 5]) {
    assert.deepEqual(computeEscalation(strainCount, curve), { value: 0, atCap: true });
  }
});
