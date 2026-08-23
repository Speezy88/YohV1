/**
 * src/core/escalate-under-strain.ts
 *
 * AD-6's shared "escalate under strain" curve — the one place a strain count
 * (how many consecutive strain events something has accumulated) is turned
 * into an escalation level. Per AD-6, this file exports EXACTLY one
 * function, `computeEscalation(strainCount, curve)`, and nothing else: no
 * per-consumer curve constant lives here (each consumer — `slip-bump.ts`
 * today; `tone.ts`'s Task 18 escalation and a future Night Ritual close-out
 * (Task 19) / Self-Check interval (Task 24) later — supplies its OWN
 * `EscalationCurve`, defined in its own file, per AD-6's "no consumer
 * derives its own normalized score or level enum, each just supplies its
 * own curve").
 *
 * Both `EscalationCurve` (`{ cap, step }`) and `EscalationLevel`
 * (`{ value, atCap }`) are defined once in `types/domain.ts` (Task 1
 * anticipated this exact need) — this file imports them rather than
 * declaring any parallel shape, per AD-9.
 *
 * ============================================================================
 * Total function, not `Result<T, YohError>` (AD-8) — documented choice
 * ============================================================================
 *
 * AD-8's `Result` contract is for a function that can genuinely FAIL on some
 * input. `computeEscalation`'s real contract is "a non-negative integer
 * strainCount and a valid curve" (per AD-6's own framing: "strainCount is
 * always a plain non-negative integer count of consecutive strain events")
 * — for that well-formed input there is no failure mode to report, so
 * wrapping the return in `Result` would just be `{ ok: true, value }` at
 * every call site: ceremony with no payoff. This mirrors `core/tone.ts`'s
 * own documented choice for the same reason (see that file's docstring).
 *
 * Rather than THROW on malformed input (a negative/non-integer strainCount,
 * or a curve with a negative cap/step), which AD-2/AD-8 forbid `core/*.ts`
 * from ever doing regardless of Result usage, this function NORMALIZES it
 * defensively and still returns a well-formed `EscalationLevel`:
 *   - `strainCount` is clamped to `>= 0` and floored to a whole number (a
 *     negative or fractional count is treated as "no accumulated strain
 *     beyond what floors to a whole number").
 *   - `curve.cap`/`curve.step` are each clamped to `>= 0` (a negative cap or
 *     step is nonsensical for an escalation curve — "the max is a negative
 *     number" or "each strain event REDUCES the level" — normalized to 0
 *     rather than propagated).
 * This keeps the function total (never throws, always returns a value) while
 * staying honest that these normalized branches are a defensive fallback,
 * not the documented contract callers should rely on.
 *
 * ============================================================================
 * The formula
 * ============================================================================
 *
 * `value = min(strainCount * curve.step, curve.cap)`, `atCap = value >=
 * curve.cap`. Worked example, curve `{ cap: 5, step: 2 }`:
 *
 *   strainCount 0 -> value 0,          atCap false
 *   strainCount 1 -> value 2,          atCap false
 *   strainCount 2 -> value 4,          atCap false
 *   strainCount 3 -> value min(6,5)=5, atCap true   (cap reached)
 *   strainCount 4 -> value 5,          atCap true   (stays capped)
 *
 * This is linear-then-flat: strictly increasing (monotonic) while
 * `strainCount * step < cap`, then flat at `cap` forever after — the shape
 * every consumer's own curve (a small step, an appropriate cap) is expected
 * to shape into whatever escalation curve THEY need (see `slip-bump.ts`'s
 * own docstring for how its curve turns this generic linear-then-flat shape
 * into "small bump on slip 1, ~double on slip 2, cap by slip 3-4").
 */
import type { EscalationCurve, EscalationLevel } from "../types/domain.ts";

/** Clamps `n` to `>= 0`, treating a non-finite input (NaN/Infinity) as `0` — see the file docstring's "never throws" section. */
function clampNonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * AD-6: `computeEscalation(strainCount, curve)` turns a strain count into an
 * `EscalationLevel` via the shared linear-then-flat curve — see the file
 * docstring for the full formula, worked numbers, and this function's
 * documented normalization behavior for malformed input.
 */
export function computeEscalation(strainCount: number, curve: EscalationCurve): EscalationLevel {
  const safeStrainCount = Math.floor(clampNonNegative(strainCount));
  const safeCap = clampNonNegative(curve.cap);
  const safeStep = clampNonNegative(curve.step);

  const value = Math.min(safeStrainCount * safeStep, safeCap);
  const atCap = value >= safeCap;

  return { value, atCap };
}
