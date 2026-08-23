/**
 * src/core/plan-reasoning.ts
 *
 * Plan Reasoning Line (Story 1.9 / FR-3). Per AD-2 (core purity) and AD-8
 * (Result types), this is a pure `core/*.ts` module: no I/O, no
 * module-level mutable state, same inputs always produce the same outputs,
 * and it never throws -- it always returns `Result<T, YohError>`. Per
 * AD-11, `tasks` is `CompleteTask[]` only, never raw `Task[]`. `today` is
 * always passed in explicitly rather than read from the system clock, per
 * AD-2, mirroring `core/derived-priority.ts`'s own `today` parameter.
 *
 * This file produces ONLY the reasoning *text* (a plain string) --
 * rendering it in `{colors.muted}` directly under the Plan's block list
 * (UX-DR4) is a later task's (Task 10's) rendering concern, not this file's.
 *
 * ============================================================================
 * What "references the actual Derived Priority factors" means here
 * ============================================================================
 *
 * FR-3's acceptance criterion is that the line explains the lead Task's
 * position using the REAL numbers `core/derived-priority.ts` computed for
 * this exact candidate set -- never a generic/static string that reads the
 * same shape regardless of what actually happened. This file calls that
 * module's `computeDerivedPriorityFactors` (an additive introspection
 * export this task added -- see that file's own doc comment on it) to get
 * every Task's score breakdown, then inspects the LEAD Task against its
 * immediate runner-up (the Task Derived Priority placed second) to
 * determine which of three genuinely different things actually happened:
 *
 *   1. **Due-date-proximity win** -- the lead Task's own `daysUntilDue` is
 *      strictly smaller than the runner-up's. It is due soonest; whatever
 *      its own `estimatedDurationMinutes` "chunk" is gets named as the cost
 *      already weighed into that primary-axis score (per
 *      `derived-priority.ts`'s own "duration is a cost, never a bonus"
 *      formula) -- this is the brief's own "due soonest, biggest chunk"
 *      example shape.
 *   2. **Duration/cost tradeoff win** -- the lead Task is due on the SAME
 *      day as, or LATER than, the runner-up, yet still has the lower
 *      `primaryScore` (see `derived-priority.ts`'s own AC2 worked example:
 *      a smaller Task due slightly later can still out-rank a much larger
 *      Task due slightly sooner, because duration is added as a genuine
 *      cost against due-date runway). The reasoning line names the runner-up
 *      Task's own due-date head start and explains the lead Task's smaller
 *      chunk is what overcame it.
 *   3. **Secondary-axis tie-break win** -- the lead and runner-up
 *      Task's `primaryScore`s are equal within
 *      `derived-priority.ts`'s own tie tolerance, so the win came down to
 *      the even-split Area/Energy-fit/difficulty score instead. The
 *      reasoning line names whichever of those three sub-factors actually
 *      favored the lead Task (there can be more than one), rather than a
 *      blanket "tie-break happened" claim.
 *
 * A single-Task Plan (no runner-up to compare against) and an empty Plan
 * (no Tasks at all) are both handled as their own honest, non-generic
 * cases below rather than forced through the three-way comparison above.
 *
 * This three-way split is a reasonable-default design for "genuinely tied
 * to the real computed factors" (the brief gives one example phrase, not a
 * template) -- documented here and in this task's report for visibility.
 */
import { computeDerivedPriorityFactors, type DerivedPriorityFactors } from "./derived-priority.ts";
import type { CompleteTask, ExternalId, IsoDate, Result, YohError } from "../types/domain.ts";

// ============================================================================
// Public input shape
// ============================================================================

/**
 * Input to `generatePlanReasoning`. `tasks` is the same Derived-Priority
 * candidate set the Plan was assembled from (ordinarily the exact array
 * passed to `core/derived-priority.ts`'s `orderByDerivedPriority` and
 * `core/work-break-fit.ts`'s `fitWorkBreakBlocks` for this Plan -- order
 * within the array does not matter here since this file re-derives the
 * ordering itself). `bumpLevels`, if provided, must match whatever was
 * passed to `orderByDerivedPriority` for this same Plan, so the reasoning
 * line reflects the ordering that actually produced it (see
 * `derived-priority.ts`'s Slip-Bump seam doc comment).
 */
export interface GeneratePlanReasoningInput {
  readonly tasks: readonly CompleteTask[];
  readonly today: IsoDate;
  readonly bumpLevels?: Readonly<Record<ExternalId, number>>;
}

// ============================================================================
// Formatting helpers
// ============================================================================

/** Whole calendar days as a human phrase: negative -> "overdue by N day(s)", 0 -> "today", positive -> "N day(s)". */
function describeDaysUntilDue(daysUntilDue: number): string {
  if (daysUntilDue < 0) {
    const overdueBy = Math.abs(daysUntilDue);
    return `overdue by ${overdueBy} day${overdueBy === 1 ? "" : "s"}`;
  }
  if (daysUntilDue === 0) return "today";
  return `${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`;
}

/** Oxford-comma-joined list: ["Area"] -> "Area"; ["Area","Energy fit"] -> "Area and Energy fit"; 3+ -> "Area, Energy fit, and difficulty". */
function formatFactorList(factors: readonly string[]): string {
  if (factors.length === 0) return "the secondary Area/Energy fit/difficulty scoring";
  if (factors.length === 1) return factors[0]!;
  if (factors.length === 2) return `${factors[0]} and ${factors[1]}`;
  return `${factors.slice(0, -1).join(", ")}, and ${factors[factors.length - 1]}`;
}

// ============================================================================
// generatePlanReasoning -- this file's sole export
// ============================================================================

/**
 * Produces FR-3's one-line reasoning string for why `tasks`' Derived
 * Priority ordering placed its lead Task where it did. See the file
 * docstring for the three winning shapes distinguished, and
 * `core/derived-priority.ts` for the underlying scoring this reads.
 *
 * Returns `ok: false` (`YohError.kind: "validation"`) for exactly the same
 * malformed input `computeDerivedPriorityFactors` (and so
 * `orderByDerivedPriority`) would reject -- a malformed `today`, a Task
 * with a malformed `dueDate`, a duplicate Task id, or a negative/non-finite
 * `bumpLevels` entry. A well-formed candidate set always returns
 * `ok: true`, including an empty one.
 */
export function generatePlanReasoning(input: GeneratePlanReasoningInput): Result<string, YohError> {
  const { tasks, today, bumpLevels } = input;

  const factorsResult = computeDerivedPriorityFactors(tasks, today, bumpLevels);
  if (!factorsResult.ok) return factorsResult;
  const factors = factorsResult.value;

  if (factors.length === 0) {
    return { ok: true, value: "No Tasks are scheduled in today's Plan yet." };
  }

  const lead = factors[0]!;

  if (factors.length === 1) {
    return {
      ok: true,
      value: `"${lead.task.title}" leads today's Plan as the only Task in it — due ${describeDaysUntilDue(lead.daysUntilDue)}, a ${lead.task.estimatedDurationMinutes}-minute chunk.`,
    };
  }

  const runnerUp = factors[1]!;
  const primaryDiff = lead.primaryScore - runnerUp.primaryScore;

  if (Math.abs(primaryDiff) <= TIE_EPSILON) {
    return { ok: true, value: describeTieBreakWin(lead, runnerUp) };
  }

  if (lead.daysUntilDue < runnerUp.daysUntilDue) {
    return { ok: true, value: describeDueDateWin(lead) };
  }

  return { ok: true, value: describeDurationTradeoffWin(lead, runnerUp) };
}

/**
 * Same tolerance `derived-priority.ts` uses internally to decide "tied on
 * the primary axis" -- duplicated rather than imported since that constant
 * is private to that module (mirrors the pattern already established by
 * `derived-priority.ts`'s own duplication of `isValidIsoDate` from
 * `time-budget.ts`, per AD-2/AD-9's file-ownership discipline).
 */
const TIE_EPSILON = 1e-6;

function describeDueDateWin(lead: DerivedPriorityFactors): string {
  return `"${lead.task.title}" leads today's Plan — due soonest, in ${describeDaysUntilDue(lead.daysUntilDue)}, with its ${lead.task.estimatedDurationMinutes}-minute chunk weighed in as the cost against that runway.`;
}

function describeDurationTradeoffWin(lead: DerivedPriorityFactors, runnerUp: DerivedPriorityFactors): string {
  // `lead.daysUntilDue >= runnerUp.daysUntilDue` is the branch that routes
  // here (see generatePlanReasoning) -- that covers two distinct real
  // shapes, worded distinctly so neither claims a "head start" that isn't
  // actually there:
  const sameDueDate = lead.daysUntilDue === runnerUp.daysUntilDue;
  const dueClause = sameDueDate
    ? `due the same day as "${runnerUp.task.title}" (${runnerUp.task.estimatedDurationMinutes} min), its smaller chunk still wins out`
    : `small enough to outweigh "${runnerUp.task.title}"'s ${describeDaysUntilDue(runnerUp.daysUntilDue)} due-date head start`;
  return `"${lead.task.title}" leads today's Plan on a duration tradeoff — its ${lead.task.estimatedDurationMinutes}-minute chunk is ${dueClause}.`;
}

function describeTieBreakWin(lead: DerivedPriorityFactors, runnerUp: DerivedPriorityFactors): string {
  const favoring: string[] = [];
  if (lead.areaSub < runnerUp.areaSub) favoring.push("Area");
  if (lead.energySub < runnerUp.energySub) favoring.push("Energy fit");
  if (lead.difficultySub < runnerUp.difficultySub) favoring.push("difficulty");

  return `"${lead.task.title}" leads today's Plan on a tie-break — matched with "${runnerUp.task.title}" on due-date-adjusted urgency, but edges ahead on ${formatFactorList(favoring)}.`;
}
