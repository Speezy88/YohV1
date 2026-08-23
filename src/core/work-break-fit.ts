/**
 * src/core/work-break-fit.ts
 *
 * Work/Break Block Fitting Within Time Budget (Story 1.8 / FR-6-FR-8). Per
 * AD-2 (core purity) and AD-8 (Result types), this is a pure `core/*.ts`
 * module: no I/O, no module-level mutable state, same inputs always produce
 * the same outputs, and it never throws — it always returns
 * `Result<T, YohError>`. Per AD-11, `tasks` is `CompleteTask[]` only, never
 * raw `Task[]` — `core/data-completeness-gate.ts` is the sole producer of
 * `CompleteTask`, and `core/derived-priority.ts` is the sole producer of the
 * priority-ordered array this file consumes as input (its final ordering,
 * not its ranking algorithm). `startTime` (the wall-clock instant the
 * fitting day begins) is always passed in explicitly rather than read from
 * the system clock, per AD-2's "prior state a function needs ... is passed
 * in as an explicit parameter, never fetched internally" — mirroring
 * `core/time-budget.ts`'s own `date` parameter and `core/derived-priority.ts`'s
 * own `today` parameter.
 *
 * ============================================================================
 * The 70/15 ratio (or whatever Spencer overrode it to) already lives on the
 * given TimeBudget
 * ============================================================================
 *
 * `TimeBudget.workMinutes`/`.breakMinutes` (shaped by
 * `core/time-budget.ts`'s `shapeDeclaredTimeBudget`, defaulting to 70/15 —
 * see that file's `DEFAULT_WORK_MINUTES`/`DEFAULT_BREAK_MINUTES`) already
 * carry the per-block work/break segment lengths, Spencer-overridable at
 * declaration time. This file reads those two fields off the `TimeBudget` it
 * is given; it does not hardcode 70/15 and does not invent a second override
 * mechanism.
 *
 * ============================================================================
 * Fitting model
 * ============================================================================
 *
 * `budget.totalMinutes` is Spencer's declared available WALL-CLOCK minutes
 * for the day (FR-5) — work time AND the breaks between it both count
 * against it, so doubling `totalMinutes` (holding the ratio fixed) doubles
 * both the number of work blocks and the number of break blocks produced
 * (the story's "a larger declared Time Budget produces proportionally more
 * Work/Break Blocks using the same ratio" acceptance criterion). Calendar
 * anchors are the opposite: their wall-clock span is skipped over for free
 * (it doesn't count against `totalMinutes`) because Spencer's declared
 * "available time" is naturally exclusive of time he already knows is
 * committed to a fixed meeting.
 *
 * Tasks are placed in the given (Derived-Priority) order, continuously —
 * i.e. a work segment is not "one Task per segment"; when a Task finishes
 * before its work segment's `workMinutes` allowance is used up, the very
 * next Task starts immediately in the same segment's leftover space. A Task
 * only splits across a break boundary (into multiple `PlanBlock`s) when it
 * is still in progress at the `workMinutes` mark — block boundaries are
 * strictly clock-based; an in-progress Task is split there, never extended
 * past it.
 *
 * ----------------------------------------------------------------------------
 * Deferral: "does this Task fully fit" is decided BEFORE any of it is placed
 * ----------------------------------------------------------------------------
 *
 * Before committing any of a Task's minutes to the timeline, this function
 * computes the total wall-clock budget placing the Task WOULD consume —
 * its own `estimatedDurationMinutes` plus every break that would be forced
 * in between if the Task spans more than the current work segment's
 * remaining space (see `computeRequiredBudgetMinutes` below). If that total
 * exceeds what's left of `budget.totalMinutes`, the Task is deferred (its id
 * is added to `deferredTaskIds`, and none of its minutes appear in `blocks`)
 * rather than started and truncated partway — "not force-fit" per this
 * story's acceptance criterion. A deferred Task does not stop the fitting
 * process: the next (lower-priority, per input order) Task is still tried
 * against the same remaining budget, since a smaller Task further down the
 * list may still fit into what's left. This is a reasonable-default
 * bin-packing choice (not dictated verbatim by the spine) — it keeps a
 * single oversized Task from wasting budget that a smaller one could
 * otherwise use, which serves the story's "realistic, not padded or
 * overstuffed" framing.
 *
 * ----------------------------------------------------------------------------
 * Calendar anchors
 * ----------------------------------------------------------------------------
 *
 * Every `CalendarEvent` becomes a `calendar-anchor` `PlanBlock` with its
 * `start`/`end` reproduced verbatim (this function never reschedules one).
 * While placing work/break minutes, whenever the moving clock cursor would
 * run into an anchor, the current chunk is truncated at the anchor's start
 * (producing a real block boundary — the same "split, not extended"
 * treatment a work-segment boundary gets), the cursor jumps to the anchor's
 * end for free, and placement resumes for whatever of the chunk remains.
 * This guarantees no work/break block this function produces ever overlaps
 * a calendar-anchor block.
 *
 * ----------------------------------------------------------------------------
 * PlanBlock ids (AD-9)
 * ----------------------------------------------------------------------------
 *
 * Every `PlanBlock` produced carries `id: "<kind>-<sequence>"`, `sequence`
 * being a counter incremented once per block in generation order. This is
 * deterministic (not `crypto.randomUUID()`) so the same inputs always
 * produce the same output, per this file's own purity contract — and it is
 * trivially unique within one call's output, which is all AD-9 requires
 * ("every reference to a PlanBlock ... must address it by this id, never by
 * array position").
 */
import type {
  CalendarEvent,
  CompleteTask,
  ExternalId,
  IsoDateTime,
  PlanBlock,
  PlanBlockKind,
  Result,
  TimeBudget,
  YohError,
} from "../types/domain.ts";

const MINUTES_TO_MS = 60_000;

// ============================================================================
// Public input/output shapes
// ============================================================================

/**
 * Input to `fitWorkBreakBlocks`. `tasks` must already be in the order the
 * caller wants them attempted (ordinarily `core/derived-priority.ts`'s
 * output — this file consumes that ordering, not its ranking algorithm).
 * `calendarEvents` are Task 4's read output (`adapters/calendar-adapter.ts`),
 * fitted in as immovable anchors, never rescheduled.
 */
export interface FitWorkBreakBlocksInput {
  readonly tasks: readonly CompleteTask[];
  readonly budget: TimeBudget;
  readonly calendarEvents: readonly CalendarEvent[];
  /** Wall-clock instant the fitting day begins, e.g. Spencer's Morning Ritual time. Never read from the system clock internally (AD-2) — the caller supplies it. */
  readonly startTime: IsoDateTime;
}

/**
 * Output of `fitWorkBreakBlocks`. `blocks` is every `PlanBlock` produced
 * (work, break, and calendar-anchor alike), sorted by `start` ascending, each
 * with a stable, unique `id` (AD-9). `deferredTaskIds` is every input Task's
 * `id` that could not fit within the remaining Time Budget and was left out
 * of `blocks` entirely — eligible for a future Plan, per this story's
 * acceptance criterion, rather than force-fit.
 */
export interface FitWorkBreakBlocksOutput {
  readonly blocks: readonly PlanBlock[];
  readonly deferredTaskIds: readonly ExternalId[];
}

// ============================================================================
// Validation
// ============================================================================

function validationError(message: string, detail?: unknown): Result<never, YohError> {
  return { ok: false, error: { kind: "validation", message, detail } };
}

function isValidIsoDateTime(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

interface AnchorSpan {
  readonly event: CalendarEvent;
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Validates and sorts `calendarEvents` into ascending-by-start `AnchorSpan`s.
 * Rejects a malformed event (unparseable start/end, or `end` not strictly
 * after `start`) and rejects two events that overlap — this function fits
 * Work/Break blocks *around* fixed anchors; two anchors that overlap each
 * other leave no coherent "around" to fit into.
 */
function validateAndSortAnchors(calendarEvents: readonly CalendarEvent[]): Result<readonly AnchorSpan[], YohError> {
  const spans: AnchorSpan[] = [];
  for (const event of calendarEvents) {
    if (!isValidIsoDateTime(event.start) || !isValidIsoDateTime(event.end)) {
      return validationError(`work-break-fit: CalendarEvent "${event.id}" has a malformed start/end`, {
        eventId: event.id,
        start: event.start,
        end: event.end,
      });
    }
    const startMs = Date.parse(event.start);
    const endMs = Date.parse(event.end);
    if (!(endMs > startMs)) {
      return validationError(`work-break-fit: CalendarEvent "${event.id}" end must be strictly after start`, {
        eventId: event.id,
        start: event.start,
        end: event.end,
      });
    }
    spans.push({ event, startMs, endMs });
  }

  spans.sort((a, b) => a.startMs - b.startMs);

  for (let i = 1; i < spans.length; i++) {
    const previous = spans[i - 1]!;
    const current = spans[i]!;
    if (current.startMs < previous.endMs) {
      return validationError(
        `work-break-fit: CalendarEvents "${previous.event.id}" and "${current.event.id}" overlap — cannot fit Work/Break blocks around overlapping anchors`,
        { first: previous.event.id, second: current.event.id },
      );
    }
  }

  return { ok: true, value: spans };
}

// ============================================================================
// Required-budget pre-check (deferral decision)
// ============================================================================

/**
 * The total wall-clock minutes (work time plus every break it would force)
 * that placing `durationMinutes` of Task work would consume, given
 * `workSegmentRemainingMinutes` of space already open in the current work
 * segment (0 meaning the current segment is exhausted and a break is due
 * before any of this Task's minutes could be placed). See the file
 * docstring's "Deferral" section for the worked reasoning.
 */
function computeRequiredBudgetMinutes(
  durationMinutes: number,
  workSegmentRemainingMinutes: number,
  workMinutes: number,
  breakMinutes: number,
): number {
  if (durationMinutes <= workSegmentRemainingMinutes) {
    return durationMinutes;
  }
  const leftoverAfterCurrentSegment = durationMinutes - workSegmentRemainingMinutes;
  const additionalFullSegments = Math.floor(leftoverAfterCurrentSegment / workMinutes);
  const remainderInFinalSegment = leftoverAfterCurrentSegment % workMinutes;
  const breaksNeeded = additionalFullSegments + (remainderInFinalSegment > 0 ? 1 : 0);
  return durationMinutes + breaksNeeded * breakMinutes;
}

// ============================================================================
// Block placement — advances the clock cursor, splitting around anchors
// ============================================================================

interface PlacementState {
  cursorMs: number;
  blocks: PlanBlock[];
  idSequence: number;
}

function nextBlockId(state: PlacementState, kind: PlanBlockKind): string {
  const id = `${kind}-${state.idSequence}`;
  state.idSequence += 1;
  return id;
}

function toIso(ms: number): IsoDateTime {
  return new Date(ms).toISOString();
}

/**
 * Places `minutes` of continuous `kind` time (work, attributed to `taskId`/
 * `label`; or break, `taskId` omitted) starting at `state.cursorMs`,
 * truncating and re-emitting a fresh block whenever the moving cursor would
 * run into an anchor — the cursor then jumps to that anchor's end for free
 * (no budget consumed) and placement resumes for whatever of `minutes`
 * remains. Advances `state.cursorMs` by exactly `minutes` of on-the-clock
 * placement time, plus any anchor spans skipped along the way.
 */
function placeMinutes(
  state: PlacementState,
  minutes: number,
  kind: "work" | "break",
  label: string,
  taskId: ExternalId | undefined,
  anchors: readonly AnchorSpan[],
): void {
  let remainingMs = minutes * MINUTES_TO_MS;

  while (remainingMs > 0) {
    const containingAnchor = anchors.find((a) => state.cursorMs >= a.startMs && state.cursorMs < a.endMs);
    if (containingAnchor) {
      state.cursorMs = containingAnchor.endMs;
      continue;
    }

    const nextAnchor = anchors.find((a) => a.startMs > state.cursorMs);
    const naturalEndMs = state.cursorMs + remainingMs;
    const chunkEndMs = nextAnchor && nextAnchor.startMs < naturalEndMs ? nextAnchor.startMs : naturalEndMs;
    const placedMs = chunkEndMs - state.cursorMs;

    const block: PlanBlock =
      taskId === undefined
        ? { id: nextBlockId(state, kind), kind, start: toIso(state.cursorMs), end: toIso(chunkEndMs), label }
        : { id: nextBlockId(state, kind), kind, start: toIso(state.cursorMs), end: toIso(chunkEndMs), taskId, label };
    state.blocks.push(block);

    state.cursorMs = chunkEndMs;
    remainingMs -= placedMs;
  }
}

// ============================================================================
// fitWorkBreakBlocks — this file's sole export
// ============================================================================

/**
 * Fits `tasks` (already Derived-Priority-ordered) into clock-based
 * `work`/`break` `PlanBlock`s sized by `budget.workMinutes`/`.breakMinutes`,
 * around `calendarEvents` placed as immovable `calendar-anchor` blocks,
 * within `budget.totalMinutes` of wall-clock time starting at `startTime`.
 * See the file docstring for the full fitting model, deferral rule, and
 * anchor-splitting behavior.
 *
 * Returns `ok: false` (`YohError.kind: "validation"`) for malformed input
 * this function cannot meaningfully fit: a malformed `startTime`, a
 * malformed/non-positive `budget.totalMinutes`/`.workMinutes`/`.breakMinutes`,
 * a malformed Calendar event, two Calendar events that overlap, two Tasks
 * sharing the same `id`, or a Task with a non-positive
 * `estimatedDurationMinutes`. A well-formed candidate set always returns
 * `ok: true`, including an empty one (`blocks: []`, `deferredTaskIds: []`).
 */
export function fitWorkBreakBlocks(input: FitWorkBreakBlocksInput): Result<FitWorkBreakBlocksOutput, YohError> {
  const { tasks, budget, calendarEvents, startTime } = input;

  if (!isValidIsoDateTime(startTime)) {
    return validationError(`work-break-fit: "${startTime}" is not a valid ISO-8601 date-time`, { startTime });
  }
  if (!isPositiveInteger(budget.totalMinutes)) {
    return validationError(`work-break-fit: budget.totalMinutes must be a positive whole number, got ${budget.totalMinutes}`, {
      totalMinutes: budget.totalMinutes,
    });
  }
  if (!isPositiveInteger(budget.workMinutes)) {
    return validationError(`work-break-fit: budget.workMinutes must be a positive whole number, got ${budget.workMinutes}`, {
      workMinutes: budget.workMinutes,
    });
  }
  if (!isPositiveInteger(budget.breakMinutes)) {
    return validationError(`work-break-fit: budget.breakMinutes must be a positive whole number, got ${budget.breakMinutes}`, {
      breakMinutes: budget.breakMinutes,
    });
  }

  const seenTaskIds = new Set<string>();
  for (const task of tasks) {
    if (seenTaskIds.has(task.id)) {
      return validationError(`work-break-fit: duplicate CompleteTask id "${task.id}" in candidate set`, { taskId: task.id });
    }
    seenTaskIds.add(task.id);
    if (!Number.isFinite(task.estimatedDurationMinutes) || task.estimatedDurationMinutes <= 0) {
      return validationError(
        `work-break-fit: Task "${task.id}" has a non-positive estimatedDurationMinutes (${task.estimatedDurationMinutes})`,
        { taskId: task.id, estimatedDurationMinutes: task.estimatedDurationMinutes },
      );
    }
  }

  const anchorsResult = validateAndSortAnchors(calendarEvents);
  if (!anchorsResult.ok) return anchorsResult;
  const anchors = anchorsResult.value;

  const state: PlacementState = { cursorMs: Date.parse(startTime), blocks: [], idSequence: 0 };

  // Calendar-anchor blocks are fixed and independent of the budget — emit
  // them up front, verbatim, never rescheduled.
  for (const anchor of anchors) {
    state.blocks.push({
      id: nextBlockId(state, "calendar-anchor"),
      kind: "calendar-anchor",
      start: anchor.event.start,
      end: anchor.event.end,
      label: anchor.event.title,
    });
  }

  let remainingBudgetMinutes = budget.totalMinutes;
  let workSegmentRemainingMinutes = budget.workMinutes;
  const deferredTaskIds: ExternalId[] = [];

  for (const task of tasks) {
    const requiredBudgetMinutes = computeRequiredBudgetMinutes(
      task.estimatedDurationMinutes,
      workSegmentRemainingMinutes,
      budget.workMinutes,
      budget.breakMinutes,
    );

    if (requiredBudgetMinutes > remainingBudgetMinutes) {
      deferredTaskIds.push(task.id);
      continue;
    }

    let remainingTaskMinutes = task.estimatedDurationMinutes;
    while (remainingTaskMinutes > 0) {
      if (workSegmentRemainingMinutes === 0) {
        placeMinutes(state, budget.breakMinutes, "break", "Break", undefined, anchors);
        remainingBudgetMinutes -= budget.breakMinutes;
        workSegmentRemainingMinutes = budget.workMinutes;
      }

      const chunkMinutes = Math.min(remainingTaskMinutes, workSegmentRemainingMinutes);
      placeMinutes(state, chunkMinutes, "work", task.title, task.id, anchors);
      remainingTaskMinutes -= chunkMinutes;
      workSegmentRemainingMinutes -= chunkMinutes;
      remainingBudgetMinutes -= chunkMinutes;
    }
  }

  const sortedBlocks = [...state.blocks].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  return { ok: true, value: { blocks: sortedBlocks, deferredTaskIds } };
}
