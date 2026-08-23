/**
 * src/core/slip-bump.ts
 *
 * Slip-Bump — escalating priority for slipped Tasks (Story 2.5 / FR-11).
 * Per AD-1/AD-2, this is a pure `core/*.ts` module: no I/O, no module-level
 * mutable state, never throws. It consumes
 * `core/escalate-under-strain.ts`'s shared `computeEscalation` (AD-6),
 * supplying its OWN `EscalationCurve` — per AD-6, "no consumer derives its
 * own normalized score or level enum, each just supplies its own curve."
 *
 * `strainCount` for this consumer is a Task's count of consecutive
 * days it has slipped (per AD-6's own framing, applied here) — persisted by
 * `adapters/memory-store.ts`'s `SlipHistory` record (`recordSlip`/
 * `clearSlip`/`getSlipHistory`/`listSlipHistories`), incremented each time a
 * Task is reported slipped and reset to zero (cleared) the moment it
 * completes, never carried indefinitely (this file's own AC).
 *
 * ============================================================================
 * The curve: `{ cap: 3, step: 1 }` — hardcoded starting shape (tunable)
 * ============================================================================
 *
 * Per the Architecture Spine's Deferred section and this task's Implementer
 * note: "small bump on slip 1, ~double on slip 2, cap by slip 3-4."
 * `computeEscalation`'s formula is `value = min(strainCount * step, cap)`
 * (see that file's own docstring) — worked arithmetic for `{ cap: 3, step: 1
 * }`:
 *
 *   consecutiveSlips 0 -> value 0          (never slipped -> no bump)
 *   consecutiveSlips 1 -> value 1          ("small bump on slip 1")
 *   consecutiveSlips 2 -> value 2          ("~double on slip 2" — exactly
 *                                            double slip 1's value of 1)
 *   consecutiveSlips 3 -> value 3, atCap   ("cap by slip 3-4" — the cap of 3
 *                                            is reached exactly at slip 3,
 *                                            squarely inside that window)
 *   consecutiveSlips 4 -> value 3, atCap   (still capped, unchanged)
 *   consecutiveSlips N -> value 3, atCap   (for any N >= 3 — the cap is
 *                                            never exceeded regardless of
 *                                            how many further consecutive
 *                                            days a Task slips)
 *
 * This is a documented, defensible starting value — not dictated by the
 * spine — same convention as `derived-priority.ts`'s
 * `SECONDARY_FACTOR_WEIGHT`/`REFERENCE_MINUTES_PER_DAY` and
 * `time-budget.ts`'s 70/15 default: freely tunable later (e.g. a bigger cap,
 * or a step that grows super-linearly instead of a flat +1 per slip) once
 * real Plan data exists to tune against.
 *
 * `value`'s SCALE matters here too: `derived-priority.ts`'s `bumpLevels`
 * seam (see its own docstring's "Slip-Bump seam" section) treats a bump
 * level of `n` as shifting a Task's effective due-date runway earlier by `n`
 * REFERENCE WORKDAYS (`REFERENCE_MINUTES_PER_DAY` each). A cap of 3 means a
 * repeatedly-slipping Task's due-date runway eventually shifts earlier by at
 * most 3 reference workdays — a meaningful, but bounded, priority nudge, not
 * an unbounded one that could otherwise swamp every other Task's ordering
 * the longer something is neglected.
 *
 * ============================================================================
 * Clearing on completion (this file's AC: "cleared, not carried
 * indefinitely")
 * ============================================================================
 *
 * This file has no state to "clear" itself (it's pure — every call is a
 * fresh computation from its inputs). The actual persisted clearing is
 * `adapters/memory-store.ts`'s `clearSlip(store, taskId)` — called once a
 * Task completes (Task 19's Night Ritual close-out is the intended real call
 * site; see this file's own "Scope" note below). Once cleared, that Task's
 * `SlipHistory` row no longer exists, so it is simply ABSENT from whatever
 * `slipCounts` map a caller builds from `listSlipHistories` before calling
 * `computeSlipBumpLevels` below — which is exactly "no bump," the same
 * outcome as a Task that has never slipped at all. There is no separate
 * "level 0 but still tracked" state to distinguish from "never slipped";
 * both read identically to every consumer of the resulting bump-levels map,
 * which is the intended behavior (a cleared Slip-Bump is genuinely gone, not
 * merely reset-and-remembered).
 *
 * ============================================================================
 * Scope note: no chat-facing "report a slip" trigger here (by design)
 * ============================================================================
 *
 * Per the epics text, "Night Ritual close-out is Slip-Bump's guaranteed,
 * authoritative trigger; Mid-Day Re-Flow is the earlier, optional one" —
 * neither exists yet (Task 19 is not yet built). This task builds only the
 * COMPUTATION (`computeSlipBumpLevel`/`computeSlipBumpLevels`, here) and
 * STORAGE (`recordSlip`/`clearSlip`/`getSlipHistory`/`listSlipHistories`,
 * `memory-store.ts`) machinery, ready for Task 19 to call from a real
 * close-out flow. It deliberately does NOT invent a new `chat-cli.ts`
 * trigger for Spencer to report a slip directly — the brief's acceptance
 * criteria only require the bump computation, the completion-clears
 * behavior, and the lineage-view command (all of which this task does
 * build); inventing an extra reporting trigger would risk conflicting with
 * whatever exact trigger shape Task 19's Night Ritual close-out settles on.
 */
import type { EscalationCurve, EscalationLevel, ExternalId } from "../types/domain.ts";
import { computeEscalation } from "./escalate-under-strain.ts";

/**
 * Slip-Bump's own `EscalationCurve` (AD-6) — see the file docstring's
 * worked-arithmetic section for why `{ cap: 3, step: 1 }` produces "small
 * bump on slip 1, ~double on slip 2, cap by slip 3-4." Tunable later.
 */
export const SLIP_BUMP_CURVE: EscalationCurve = { cap: 3, step: 1 };

/**
 * Computes a single Task's current Slip-Bump level from its consecutive-slip
 * count, via `escalate-under-strain.ts`'s shared `computeEscalation` and
 * this file's own `SLIP_BUMP_CURVE`. `consecutiveSlipCount` is the value
 * `adapters/memory-store.ts`'s `SlipHistory.consecutiveSlipCount` holds for
 * a Task (0, or absent entirely, both mean "no bump" — see the file
 * docstring's "Clearing on completion" section).
 */
export function computeSlipBumpLevel(consecutiveSlipCount: number): EscalationLevel {
  return computeEscalation(consecutiveSlipCount, SLIP_BUMP_CURVE);
}

/**
 * Batch form: turns a `taskId -> consecutiveSlipCount` map (what a caller
 * builds from `adapters/memory-store.ts`'s `listSlipHistories`) into a
 * `taskId -> numeric bump level` map — EXACTLY the shape
 * `core/derived-priority.ts`'s `orderByDerivedPriority(tasks, today,
 * bumpLevels?)` already expects for its optional third parameter
 * (`Readonly<Record<ExternalId, number>>`, per that file's own "Slip-Bump
 * seam" docstring section). A Task absent from `slipCounts` is simply
 * absent from the result too (equivalent to "no bump," matching
 * `orderByDerivedPriority`'s own "omitting a specific Task's id from it
 * means 'no bump'" contract) — this function never invents a zero entry for
 * an untracked Task.
 */
export function computeSlipBumpLevels(
  slipCounts: Readonly<Record<ExternalId, number>>,
): Readonly<Record<ExternalId, number>> {
  const levels: Record<ExternalId, number> = {};
  for (const [taskId, consecutiveSlipCount] of Object.entries(slipCounts)) {
    levels[taskId] = computeSlipBumpLevel(consecutiveSlipCount).value;
  }
  return levels;
}
