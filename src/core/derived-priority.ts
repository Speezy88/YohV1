/**
 * src/core/derived-priority.ts
 *
 * Derived Priority ordering (Story 1.7 / FR-2). Per AD-11, this file's sole
 * export, `orderByDerivedPriority`, accepts `CompleteTask[]` only, never raw
 * `Task[]` — `core/data-completeness-gate.ts` (Task 5) is the sole producer
 * of `CompleteTask` values. Per AD-2 (core purity) and AD-8 (Result types),
 * this is a pure `core/*.ts` module: no I/O, no module-level mutable state,
 * same inputs always produce the same outputs, and it never throws — it
 * always returns `Result<T, YohError>`. `today` (the calendar date "now" is
 * measured against) is always passed in explicitly rather than read from the
 * system clock, per AD-2's "prior state a function needs ... is passed in as
 * an explicit parameter, never fetched internally" and mirroring
 * `core/time-budget.ts`'s own `date`/`today` parameters.
 *
 * ============================================================================
 * FR-2's ordering contract
 * ============================================================================
 *
 * FR-2: "The primary ordering axis is Due Date proximity adjusted by
 * Estimated Duration — urgency scaled by how much time the Task actually
 * needs — which dominates the ranking; a weighted score across the
 * remaining factors (Area, Energy fit, difficulty) breaks ties and refines
 * ordering beneath that primary axis."
 *
 * ----------------------------------------------------------------------------
 * Primary axis: `daysUntilDue * REFERENCE_MINUTES_PER_DAY + estimatedDurationMinutes`
 * ----------------------------------------------------------------------------
 *
 * Lower score = ordered earlier (more urgent). `daysUntilDue` is converted
 * into a minutes-denominated "runway" by treating one day of due-date lead
 * time as worth one `REFERENCE_MINUTES_PER_DAY` (480 minutes — a reference
 * 8-hour workday; a documented, tunable choice, not one dictated by the
 * spine), then the Task's own `estimatedDurationMinutes` is added on top as
 * a genuine cost against that runway. This is deliberately NOT a "slack"
 * formula that treats a bigger Task as more urgent (subtracting duration
 * from the runway) — FR-2's Deferred-section framing this task was built
 * against explicitly warns that "a big last-minute task doesn't
 * automatically dominate a tiny task due only slightly later," so duration
 * is added as a cost the Task must justify by its own due-date proximity,
 * not a bonus that always makes it win. Concretely:
 *
 *   - Holding duration equal, this collapses to plain due-date-proximity
 *     ordering (the duration term is identical on both sides and cancels
 *     out of the comparison) — this is what AC #1 requires.
 *   - A big, last-minute Task no longer automatically dominates a small,
 *     slightly-later Task, because its own large duration term counts
 *     against it. Worked example (AC #2):
 *
 *       Task A: due in 1 day,  estimatedDurationMinutes = 600
 *         primaryScore = 1 * 480 + 600 = 1080
 *       Task B: due in 2 days, estimatedDurationMinutes = 15
 *         primaryScore = 2 * 480 +  15 =  975
 *
 *       975 < 1080, so B — smaller and due only one day later — is ordered
 *       FIRST despite A being due sooner. A's much larger duration is what
 *       flips the ordering; with equal durations the closer-due Task always
 *       wins (see the file's test suite's "AC2 (sanity)" case).
 *
 * A Task's `dueDate` in the past (already overdue) yields a negative
 * `daysUntilDue`, which is intentional — an overdue Task's primaryScore
 * drops further, so it sorts even earlier than a Task due today.
 *
 * ----------------------------------------------------------------------------
 * Secondary axis (tie-break only): even-split Area/Energy-fit/difficulty
 * ----------------------------------------------------------------------------
 *
 * Per the Architecture Spine's Deferred section ("FR-2 secondary-factor
 * weights ... start with an even split, tune after a few weeks of real
 * Plans"), `SECONDARY_FACTOR_WEIGHT` below is hardcoded to 1/3 for each of
 * Area, Energy fit, and difficulty — the documented starting value, tunable
 * later once real Plan data exists. It only ever breaks a tie on the
 * primary axis (within `PRIMARY_SCORE_EPSILON`); it never overrides it.
 *
 * None of the three sub-factors has a genuinely independent, pre-existing
 * data source in this codebase today (documented gap, noted in this task's
 * report rather than silently widening `CompleteTask`):
 *
 *   - **Area** is free-form text (`types/domain.ts`) with no Spencer-defined
 *     preference ranking anywhere in the system yet. Sub-score: each
 *     distinct Area value present in *this call's* candidate set is ranked
 *     alphabetically and normalized to [0, 1] (0 = alphabetically first).
 *     This is a stable, deterministic placeholder for real preference data,
 *     not a claim that alphabetically-earlier Areas matter more. Story 9.1
 *     (AD-11 amended): a `{kind:"missing"}` Area is excluded from this
 *     ranked set entirely and scores the fixed neutral
 *     `NEUTRAL_REFINING_SCORE` (0.5) instead.
 *   - **Energy fit** would need "Spencer's current/today's energy level" as
 *     an input to score against, and no earlier task in this plan produces
 *     one. Sub-score: a fixed canonical ranking — `high` (0) < `medium`
 *     (0.5) < `low` (1) — on the reasoning that Yoh's one daily Morning Plan
 *     is generated once, when energy is typically freshest, so higher
 *     Energy Tasks are nudged earlier as a placeholder preference. A
 *     `{kind:"missing"}` Energy also scores `NEUTRAL_REFINING_SCORE` — the
 *     same 0.5 `ENERGY_RANK.medium` already used, reused verbatim rather
 *     than duplicated (controller ruling (c)).
 *   - **Difficulty** has no field anywhere in `Task`/`CompleteTask`, and no
 *     Notion property feeds one — the PRD explicitly lists "Chunk Size" and
 *     "Priority" as Notion Task fields Yoh's planning deliberately does NOT
 *     read. Sub-score: proxied from `estimatedDurationMinutes` itself
 *     (normalized to [0, 1] across the candidate set), the closest real
 *     signal already on `CompleteTask` for "how big/hard this Task is."
 *     This intentionally reuses a primary-axis input as a secondary-axis
 *     proxy; it's disclosed here rather than hidden, and it only ever
 *     matters once two Tasks are *already* tied on the primary axis (which
 *     does not require identical durations — many due-date/duration
 *     combinations can produce the same primary score).
 *
 *     **Directionality, reconciled with the primary axis:** the primary
 *     axis above is deliberate that a longer `estimatedDurationMinutes` is
 *     a *cost* against urgency, never a bonus ("a big last-minute task
 *     doesn't automatically dominate a tiny task due only slightly later").
 *     The difficulty proxy stays consistent with that same philosophy one
 *     layer down: `difficultySub = normalizedDuration` (NOT
 *     `1 - normalizedDuration`) — a longer/costlier Task gets a HIGHER
 *     (later) sub-score, same direction as the primary axis, never
 *     rewarded for being bigger. An earlier revision of this file had this
 *     inverted (`1 - normalizedDuration`, ranking the longer Task as more
 *     urgent in the tie-break — the mirror image of the primary axis's own
 *     stated philosophy, with nothing here reconciling the tension); this
 *     is the corrected, internally-coherent version.
 *
 * ============================================================================
 * Slip-Bump seam (Task 17 / Story 2.5)
 * ============================================================================
 *
 * `orderByDerivedPriority`'s optional third parameter, `bumpLevels`, is a
 * `taskId -> bump level` lookup the caller supplies (per AD-2: computed
 * externally and passed in, never fetched internally). It defaults to "no
 * bump" for every Task when omitted (or when a Task's id isn't a key in the
 * map), so this task has no forward dependency on Task 17/`slip-bump.ts`,
 * which doesn't exist yet. A bump level of `n` is treated as shifting a
 * Task's effective due-date runway earlier by `n` reference workdays,
 * folded directly into the primary-axis formula:
 *
 *   primaryScore = daysUntilDue * REFERENCE_MINUTES_PER_DAY
 *                  + estimatedDurationMinutes
 *                  - bumpLevel * REFERENCE_MINUTES_PER_DAY
 *
 * This composes with the primary axis without changing its algorithm — it's
 * a pure additive seam Task 17 can start passing real, non-zero levels
 * through once `slip-bump.ts` exists, without this file changing at all.
 * The exact scale a "bump level" should carry is Task 17's call to make
 * (FR-11's own curve/cap numbers are themselves still a Deferred tuning
 * value); this file only commits to "a higher level makes a Task strictly
 * more urgent, monotonically," which is all a seam needs to guarantee.
 */
import type { CompleteTask, Energy, ExternalId, IsoDate, Result, YohError } from "../types/domain.ts";

// ============================================================================
// Tunable constants (Deferred section starting values)
// ============================================================================

/**
 * Minutes in one reference workday, used to convert `daysUntilDue` into the
 * same minutes unit as `estimatedDurationMinutes` for the primary-axis
 * formula (see the file docstring's worked example). A documented,
 * reasonable-default choice (an 8-hour workday) — not dictated by the
 * spine, and freely tunable later without changing the formula's shape.
 */
export const REFERENCE_MINUTES_PER_DAY = 480;

/**
 * The even-split weight (1/3) applied to each of Area, Energy fit, and
 * difficulty when combining them into the secondary tie-break score. This
 * is the Architecture Spine's Deferred-section documented starting value
 * ("start with an even split ... tune after a few weeks of real Plans") —
 * hardcoded here rather than guessed at differently per factor.
 */
export const SECONDARY_FACTOR_WEIGHT = 1 / 3;

/** Floating-point tolerance for "tied on the primary axis" (guards against bump-level fractional rounding; the AC-driven integer cases above never need it). */
const PRIMARY_SCORE_EPSILON = 1e-6;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ============================================================================
// Date helpers (duplicated from core/time-budget.ts's own isValidIsoDate
// rather than imported, since core/*.ts files don't depend on each other's
// internals per AD-2/AD-9's file-ownership discipline -- this is the same
// duplication time-budget.ts's own docstring already calls out relative to
// core/planning-field-value.ts's parsePlanningFieldValue).
// ============================================================================

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Assumes both arguments already passed `isValidIsoDate`. Whole calendar days from `fromIso` to `toIso` (positive if `toIso` is later). */
function daysBetween(fromIso: IsoDate, toIso: IsoDate): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = toIso.split("-").map(Number) as [number, number, number];
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

function validationError(message: string, detail?: unknown): Result<never, YohError> {
  return { ok: false, error: { kind: "validation", message, detail } };
}

// ============================================================================
// Primary axis
// ============================================================================

function computePrimaryScore(task: CompleteTask, today: IsoDate, bumpLevel: number): number {
  const daysUntilDue = daysBetween(today, task.dueDate);
  return (
    daysUntilDue * REFERENCE_MINUTES_PER_DAY + task.estimatedDurationMinutes - bumpLevel * REFERENCE_MINUTES_PER_DAY
  );
}

// ============================================================================
// Secondary axis (tie-break only)
// ============================================================================

/** Fixed canonical Energy-fit placeholder ranking -- see the file docstring's "Energy fit" section. */
const ENERGY_RANK: Readonly<Record<Energy, number>> = { high: 0, medium: 0.5, low: 1 };

/**
 * Story 9.1 (AD-11 amended): the fixed neutral score a `{kind:"missing"}`
 * Refining Field (Area or Energy) scores on the secondary axis — "neither
 * favors nor penalizes" the Task (FR-4 amended). Reuses `ENERGY_RANK.medium`
 * (`0.5`) VERBATIM rather than inventing a second constant (controller
 * ruling (c)) — a documented coincidence, not a hidden one: `0.5` is both
 * "medium energy" and "no Refining data at all," and the two must never be
 * confused for anything other than sharing the same numeric midpoint. This
 * value exists only inside this computation — never stored, never sent to
 * the client as a real Area/Energy, never written to Notion.
 */
const NEUTRAL_REFINING_SCORE = ENERGY_RANK.medium;

/** Per-Task breakdown of the three even-split secondary sub-scores plus their combined weighted total. */
interface SecondaryScoreDetail {
  readonly areaSub: number;
  readonly energySub: number;
  readonly difficultySub: number;
  readonly secondaryScore: number;
}

/**
 * Computes the even-split secondary score (and its three sub-score
 * components, for `computeDerivedPriorityFactors` below) for every Task in
 * `tasks`, relative to the batch itself (Area alphabetical rank and
 * difficulty's duration normalization are both computed across this
 * candidate set, not against some fixed universal scale -- see the file
 * docstring). Returns a plain array in the same order as `tasks`, avoiding
 * any lookup-by-id step that could risk an unguaranteed-present key.
 */
function computeSecondaryScoreDetails(tasks: readonly CompleteTask[]): readonly SecondaryScoreDetail[] {
  // Story 9.1: a {kind:"missing"} Area contributes NOTHING to the
  // alphabetical-rank set -- it neither claims a rank slot nor shifts any
  // real Area's own rank (Review Focus, pinned above).
  const distinctAreasSorted = [...new Set(tasks.flatMap((t) => (t.area.kind === "set" ? [t.area.value] : [])))].sort();
  const areaRank = new Map<string, number>(
    distinctAreasSorted.map((area, index) => [
      area,
      distinctAreasSorted.length > 1 ? index / (distinctAreasSorted.length - 1) : 0,
    ]),
  );

  const durations = tasks.map((t) => t.estimatedDurationMinutes);
  const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
  const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
  const durationRange = maxDuration - minDuration;

  return tasks.map((task) => {
    // Story 9.1: {kind:"missing"} on either Refining Field scores the fixed
    // neutral value -- never looked up, never defaulted to a real value.
    const areaSub = task.area.kind === "missing" ? NEUTRAL_REFINING_SCORE : (areaRank.get(task.area.value) ?? 0);
    const energySub = task.energy.kind === "missing" ? NEUTRAL_REFINING_SCORE : ENERGY_RANK[task.energy.value];
    const normalizedDuration = durationRange > 0 ? (task.estimatedDurationMinutes - minDuration) / durationRange : 0;
    // Directionality matches the primary axis (see the file docstring's
    // "Difficulty" reconciliation paragraph): longer duration is a *cost*
    // there, not a bonus, so it stays a cost here too -- a longer/"harder"
    // Task gets a HIGHER (later) sub-score, never a lower one.
    const difficultySub = normalizedDuration;
    const secondaryScore =
      SECONDARY_FACTOR_WEIGHT * areaSub + SECONDARY_FACTOR_WEIGHT * energySub + SECONDARY_FACTOR_WEIGHT * difficultySub;
    return { areaSub, energySub, difficultySub, secondaryScore };
  });
}

// ============================================================================
// orderByDerivedPriority -- this file's sole export (AD-9's primary export)
// ============================================================================

/**
 * Orders `tasks` by Derived Priority (FR-2): the primary axis (Due Date
 * proximity adjusted by Estimated Duration) dominates, with the even-split
 * Area/Energy-fit/difficulty secondary score breaking ties beneath it. See
 * the file docstring for the full formula and worked examples.
 *
 * `today` is the calendar date (`YYYY-MM-DD`) `daysUntilDue` is measured
 * against, passed in explicitly per AD-2 (never read from the system
 * clock). `bumpLevels`, if provided, is an optional `taskId -> bump level`
 * lookup -- the Slip-Bump seam Task 17 will wire real values through later;
 * omitting it (or omitting a specific Task's id from it) means "no bump."
 *
 * There is deliberately no way to pass a manually-chosen position/priority
 * for a Task (FR-2: "Never set by manual Spencer input") -- only the
 * underlying inputs already on `CompleteTask` (Estimated Duration, Due
 * Date, Area, Energy) and the externally-computed `bumpLevels` seam feed
 * this ordering.
 *
 * Returns `ok: false` (`YohError.kind: "validation"`) for malformed input
 * this function cannot meaningfully order: a malformed `today`, a Task with
 * a malformed `dueDate`, two Tasks sharing the same `id` (ambiguous for the
 * `bumpLevels` lookup and for stable-sort semantics), or a negative/
 * non-finite `bumpLevels` entry. A well-formed candidate set always returns
 * `ok: true`, including an empty one (`value: []`).
 */
/**
 * Full per-Task breakdown this file computes internally on the way to an
 * ordering -- shared by `orderByDerivedPriority` (which discards everything
 * but `task`) and `computeDerivedPriorityFactors` below (which keeps it
 * all). Kept private: `DerivedPriorityFactors` (the public shape) is
 * structurally identical today, but declared as its own type below so the
 * two can diverge later without this internal shape being a public
 * contract.
 */
interface ScoredTask {
  readonly task: CompleteTask;
  readonly daysUntilDue: number;
  readonly bumpLevel: number;
  readonly primaryScore: number;
  readonly secondaryScore: number;
  readonly areaSub: number;
  readonly energySub: number;
  readonly difficultySub: number;
}

/**
 * Shared validation + scoring + sort behind both public exports of this
 * file. This is the exact validation/scoring/sort `orderByDerivedPriority`
 * always performed -- extracted verbatim, not altered, so that function's
 * behavior is unchanged by this refactor.
 */
function computeScored(
  tasks: readonly CompleteTask[],
  today: IsoDate,
  bumpLevels?: Readonly<Record<ExternalId, number>>,
): Result<readonly ScoredTask[], YohError> {
  if (!isValidIsoDate(today)) {
    return validationError(`derived-priority: "${today}" is not a valid ISO-8601 calendar date (YYYY-MM-DD)`, {
      today,
    });
  }

  const seenIds = new Set<string>();
  for (const task of tasks) {
    if (seenIds.has(task.id)) {
      return validationError(`derived-priority: duplicate CompleteTask id "${task.id}" in candidate set`, {
        taskId: task.id,
      });
    }
    seenIds.add(task.id);

    if (!isValidIsoDate(task.dueDate)) {
      return validationError(
        `derived-priority: Task "${task.id}" has a malformed dueDate "${task.dueDate}" (expected YYYY-MM-DD)`,
        { taskId: task.id, dueDate: task.dueDate },
      );
    }
  }

  if (bumpLevels) {
    for (const [taskId, level] of Object.entries(bumpLevels)) {
      if (!Number.isFinite(level) || level < 0) {
        return validationError(`derived-priority: bump level for Task "${taskId}" must be a finite number >= 0, got ${level}`, {
          taskId,
          level,
        });
      }
    }
  }

  const secondaryDetails = computeSecondaryScoreDetails(tasks);

  const scored = tasks.map((task, index) => {
    const bumpLevel = bumpLevels?.[task.id] ?? 0;
    const detail = secondaryDetails[index] ?? { areaSub: 0, energySub: 0, difficultySub: 0, secondaryScore: 0 };
    return {
      task,
      daysUntilDue: daysBetween(today, task.dueDate),
      bumpLevel,
      primaryScore: computePrimaryScore(task, today, bumpLevel),
      secondaryScore: detail.secondaryScore,
      areaSub: detail.areaSub,
      energySub: detail.energySub,
      difficultySub: detail.difficultySub,
    };
  });

  scored.sort((a, b) => {
    const primaryDiff = a.primaryScore - b.primaryScore;
    if (Math.abs(primaryDiff) > PRIMARY_SCORE_EPSILON) return primaryDiff;
    return a.secondaryScore - b.secondaryScore;
  });

  return { ok: true, value: scored };
}

export function orderByDerivedPriority(
  tasks: readonly CompleteTask[],
  today: IsoDate,
  bumpLevels?: Readonly<Record<ExternalId, number>>,
): Result<readonly CompleteTask[], YohError> {
  const scoredResult = computeScored(tasks, today, bumpLevels);
  if (!scoredResult.ok) return scoredResult;
  return { ok: true, value: scoredResult.value.map((s) => s.task) };
}

// ============================================================================
// computeDerivedPriorityFactors -- additive introspection export (Task 9)
// ============================================================================

/**
 * Per-Task Derived Priority breakdown: everything `orderByDerivedPriority`
 * computes internally on the way to an ordering, kept instead of discarded.
 * Added by Task 9 (`core/plan-reasoning.ts`) as a small, additive extension
 * of this file (per AD-9's allowance for a later task to extend a locked
 * file when it finds a genuine gap) -- `orderByDerivedPriority`'s own
 * signature and behavior are unchanged by this addition; this is a new
 * export surfacing values that were always computed but previously thrown
 * away, so Task 9's reasoning line can explain *why* the lead Task won
 * (due-date proximity, a duration/cost tradeoff, or a secondary-axis
 * tie-break) instead of asserting it.
 */
export interface DerivedPriorityFactors {
  readonly task: CompleteTask;
  /** Whole calendar days from `today` to `task.dueDate` (negative if overdue), the primary axis's due-date term before the `REFERENCE_MINUTES_PER_DAY` conversion. */
  readonly daysUntilDue: number;
  /** The bump level applied for this Task (0 if `bumpLevels` omitted or had no entry for it) -- see the file docstring's Slip-Bump seam section. */
  readonly bumpLevel: number;
  /** `daysUntilDue * REFERENCE_MINUTES_PER_DAY + task.estimatedDurationMinutes - bumpLevel * REFERENCE_MINUTES_PER_DAY`. Lower sorts earlier. */
  readonly primaryScore: number;
  /** The even-split combination of `areaSub`/`energySub`/`difficultySub`, weighted by `SECONDARY_FACTOR_WEIGHT` each. Only ever consulted to break a primary-axis tie. Lower sorts earlier. */
  readonly secondaryScore: number;
  /** This Task's Area, ranked alphabetically among the candidate set's distinct Areas and normalized to [0, 1] (0 = alphabetically first). */
  readonly areaSub: number;
  /** This Task's Energy fit sub-score: `high` = 0, `medium` = 0.5, `low` = 1. */
  readonly energySub: number;
  /** This Task's `estimatedDurationMinutes`, normalized to [0, 1] across the candidate set (0 = shortest). A longer/costlier Task gets a HIGHER sub-score, matching the primary axis's own "duration is a cost" directionality. */
  readonly difficultySub: number;
}

/**
 * Computes the same Derived Priority ordering `orderByDerivedPriority`
 * produces, but returns each Task's full score breakdown instead of just
 * the reordered `CompleteTask[]` -- same validation, same scoring, same
 * sort, same `Result<T, YohError>` failure cases (see
 * `orderByDerivedPriority`'s own doc comment); the two functions share one
 * internal implementation (`computeScored` above) so they cannot drift
 * apart. `DerivedPriorityFactors[0]` is always the Task
 * `orderByDerivedPriority`'s own output would place first.
 */
export function computeDerivedPriorityFactors(
  tasks: readonly CompleteTask[],
  today: IsoDate,
  bumpLevels?: Readonly<Record<ExternalId, number>>,
): Result<readonly DerivedPriorityFactors[], YohError> {
  return computeScored(tasks, today, bumpLevels);
}
