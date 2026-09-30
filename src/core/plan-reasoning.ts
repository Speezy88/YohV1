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
 * ============================================================================
 * Derivation vs. selection (`eligibleTaskIds`, added by Task 10)
 * ============================================================================
 *
 * Scoring happens over the whole candidate set; picking WHICH Task the
 * sentence describes is a separate step that happens after. Task 10 added
 * the optional `eligibleTaskIds` parameter to narrow that second step to the
 * Tasks that actually survived `core/work-break-fit.ts`'s deferral rule, so
 * the line can never name a Task that has no block in the Plan it claims to
 * lead. Scoring is untouched by it, and omitting it reproduces the exact
 * pre-Task-10 behavior. See that parameter's own doc comment for the full
 * reasoning.
 *
 * This three-way split is a reasonable-default design for "genuinely tied
 * to the real computed factors" (the brief gives one example phrase, not a
 * template) -- documented here and in this task's report for visibility.
 */
import { computeDerivedPriorityFactors, type DerivedPriorityFactors } from "./derived-priority.ts";
import type { Area, CompleteTask, ExternalId, IsoDate, Result, YohError } from "../types/domain.ts";

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
  /**
   * Restricts which Task may be DESCRIBED as leading the Plan (and which
   * may be its runner-up) to Tasks that actually appear in it — added by
   * Task 10, additively, once assembling a real Plan exposed the gap.
   *
   * The distinction this parameter rests on: `computeDerivedPriorityFactors`
   * below derives every Task's score across the WHOLE candidate set (that
   * is the contract `rituals/morning-ritual.ts` honors by handing this
   * function the same array it handed `orderByDerivedPriority`), and only
   * afterwards is a lead picked out of the result. Those are two independent
   * steps, so narrowing the second one changes nothing about the scoring
   * that produced the ordering — the numbers quoted in the sentence are
   * still the real ones computed against every candidate.
   *
   * Why it's needed: `core/work-break-fit.ts` DEFERS a Task that cannot fit
   * the remaining Time Budget, leaving it out of the Plan entirely. Without
   * this parameter, a deferred Task could still be named as "leading
   * today's Plan" while no block for it is rendered — a sentence describing
   * a position that does not exist, which is exactly what FR-3's "references
   * the actual Derived Priority factors that produced the lead item's
   * position" forbids.
   *
   * Omit it (the default) and behavior is byte-identical to before this
   * parameter existed: every Task is eligible. An id in the set that isn't
   * in `tasks` is ignored. An EMPTY set means "no Task made it into the
   * Plan" and produces its own honest line that claims no lead at all.
   */
  readonly eligibleTaskIds?: ReadonlySet<ExternalId>;
  /**
   * Confirmed `areaDurationPadding` settings (Story 13.13, E1). When set, a
   * deterministic sentence citing the padding is appended for each Area that
   * has an included Task and padding > 0. Absent or empty: no change.
   */
  readonly areaPadding?: Readonly<Partial<Record<Area, number>>>;
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
  const base = generateBaseReasoning(input);
  if (!base.ok) return base;
  const citation = describeAreaPadding(input);
  return citation ? { ok: true, value: `${base.value} ${citation}` } : base;
}

function joinAreas(areas: readonly string[]): string {
  if (areas.length <= 2) return areas.join(" and ");
  return `${areas.slice(0, -1).join(", ")}, and ${areas[areas.length - 1]}`;
}

/** One deterministic sentence per distinct padding amount, for Areas of Tasks that actually got a block. */
function describeAreaPadding(input: GeneratePlanReasoningInput): string {
  const padding = input.areaPadding;
  if (!padding) return "";
  const included = new Set<string>();
  for (const task of input.tasks) {
    if (task.area.kind !== "set") continue;
    if (input.eligibleTaskIds !== undefined && !input.eligibleTaskIds.has(task.id)) continue;
    included.add(task.area.value);
  }
  const byMinutes = new Map<number, string[]>();
  for (const area of [...included].sort()) {
    const minutes = padding[area as Area];
    if (minutes === undefined || minutes <= 0) continue;
    byMinutes.set(minutes, [...(byMinutes.get(minutes) ?? []), area]);
  }
  return [...byMinutes.entries()]
    .map(([minutes, areas]) => `Blocks for ${joinAreas(areas)} Tasks include ${minutes} extra minutes, per the padding you approved.`)
    .join(" ");
}

function generateBaseReasoning(input: GeneratePlanReasoningInput): Result<string, YohError> {
  const { tasks, today, bumpLevels, eligibleTaskIds } = input;

  // Derivation: always across the FULL candidate set, per this function's
  // contract with `orderByDerivedPriority`.
  const factorsResult = computeDerivedPriorityFactors(tasks, today, bumpLevels);
  if (!factorsResult.ok) return factorsResult;
  const factors = factorsResult.value;

  if (factors.length === 0) {
    return { ok: true, value: "No Tasks are scheduled in today's Plan yet." };
  }

  // Selection: an independent step, optionally narrowed to the Tasks that
  // actually made it into the Plan (see `eligibleTaskIds`' doc comment).
  // `filter` preserves the derived ordering, so `describable[0]` is still
  // "the highest-priority of these", exactly as `factors[0]` was.
  const describable =
    eligibleTaskIds === undefined ? factors : factors.filter((entry) => eligibleTaskIds.has(entry.task.id));

  if (describable.length === 0) {
    return {
      ok: true,
      // Deliberately names no Task and makes no claim about a lead: there
      // is no position to explain when nothing made it into the Plan.
      value: "None of today's Tasks fit the time available — every one of them is still waiting.",
    };
  }

  const lead = describable[0]!;

  if (describable.length === 1) {
    return {
      ok: true,
      value: `"${lead.task.title}" leads today's Plan as the only Task in it — due ${describeDaysUntilDue(lead.daysUntilDue)}, a ${lead.task.estimatedDurationMinutes}-minute chunk.`,
    };
  }

  const runnerUp = describable[1]!;
  const primaryDiff = lead.primaryScore - runnerUp.primaryScore;

  // Mention Priority only when it changed the order: the lead is boosted and,
  // without the boost, some other Task would have sorted ahead of it.
  const priorityNote =
    lead.priorityBoost > 0 && describable.some((o) => o !== lead && o.primaryScore < lead.primaryScore + lead.priorityBoost - TIE_EPSILON)
      ? " Ranked up for High priority."
      : "";

  if (Math.abs(primaryDiff) <= TIE_EPSILON) {
    return { ok: true, value: describeTieBreakWin(lead, runnerUp) + priorityNote };
  }

  if (lead.daysUntilDue < runnerUp.daysUntilDue) {
    return { ok: true, value: describeDueDateWin(lead) + priorityNote };
  }

  return { ok: true, value: describeDurationTradeoffWin(lead, runnerUp) + priorityNote };
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
