/**
 * src/rituals/mid-day-reflow.ts
 *
 * User-Initiated Mid-Day Re-Flow (Story 2.3 / FR-9). Spencer tells Yoh a
 * Task ran long or got skipped, and the REST of today's already-generated
 * Plan re-fits around what's actually true now — without re-explaining or
 * touching whatever he already lived through. Per AD-8 this is one of the
 * two layers allowed to catch an adapter throw and convert it to a
 * `Result`; per AD-1 it may import `core/*.ts` and `adapters/*.ts` but never
 * `shell/*.ts`; per AD-2 `now` is always an explicit parameter, never read
 * from the system clock internally.
 *
 * ============================================================================
 * What "not-yet-completed" means here (no explicit completion flag exists)
 * ============================================================================
 *
 * `PlanBlock` (`types/domain.ts`) carries no "done" boolean — Task-level
 * completed/slipped status is Night Ritual close-out's concern (Task 19,
 * FR-12), not a mid-day Plan Block state. FR-9's AC nonetheless requires
 * recomputing only "the remaining, not-yet-completed Plan Blocks" while
 * leaving "already-completed blocks" untouched. The natural, defensible
 * reading adopted here is TIME-based: a block whose `end` has already
 * passed as of `now` is treated as already-elapsed/immutable — Spencer
 * already lived through it, so re-flowing it makes no sense, and leaving it
 * exactly as-is (same id, same start/end/content) is what "does not touch
 * already-completed blocks" means in practice. A block that hasn't started
 * yet, OR is currently in progress (`start <= now < end`), is "remaining"
 * and gets folded into the re-fit, replaced rather than surviving verbatim
 * — see `isElapsed` below.
 *
 * A genuinely in-progress block (`start < now < end`) does NOT get re-fit
 * for its Task's FULL original duration, though — a review caught and this
 * file now fixes exactly that bug. `elapsedMinutesWithinBlock` credits the
 * real `now - start` minutes already spent as elapsed (for both that Task's
 * remaining duration and the day's remaining Time Budget) before the
 * re-fit recomputes the genuinely remaining chunk; it does not fabricate a
 * finer split of the block itself (the block is still wholly replaced by
 * the re-fit, never partially preserved) — only the MINUTES credited to
 * "already spent" are accounted for precisely, per-Task and per-budget.
 *
 * Historical note (this scope boundary is now CLOSED by Story 2.4 / Task
 * 16, below): earlier, nothing here could represent "Spencer says a Task
 * ran long or was skipped despite its scheduled `end` having already
 * passed" — overriding a block `isElapsed` already treated as done.
 * `chat-cli.ts`'s Mid-Day Re-Flow trigger has no room to name which Task or
 * by how much, so that gap could only be closed by a path that does NOT
 * need to name either — see the "Logistics-Only Blocker Handling" section
 * below for how.
 *
 * ============================================================================
 * Logistics-Only Blocker Handling (Story 2.4 / Task 16, FR-10, UX-DR12)
 * ============================================================================
 *
 * FR-10's own example — "meeting ran over" — deliberately names neither
 * WHICH Task nor HOW MUCH time was lost, and FR-10 itself says Yoh must not
 * try to resolve/judge/problem-solve the Blocker. So this needs no free-text
 * parsing of a Task or a duration — only a classification ("this input is
 * reporting a logistics Blocker", `core/chat-commands.ts`'s
 * `isBlockerReportCommand` — Story 8.3: moved from `chat-cli.ts`)
 * plus a MECHANICAL rule for "what was Spencer just supposed to be doing":
 * the current/most-recently-active `work`/`break` block as of `now` (never
 * a `calendar-anchor` — AD-4, see `findBlockerOverrideBlockId` below).
 *
 * `runMidDayReflow` takes an optional `blockerReported` flag rather than
 * being a second exported function. A genuinely separate function would
 * have to duplicate every line from "re-read Notion Tasks" through
 * "persist" verbatim — the ONLY thing that differs is which ONE block (if
 * any) `isElapsed` treats as an exception, and how that one block's elapsed
 * minutes are credited. A single boolean threaded through the one function
 * that already owns this whole pipeline keeps that pipeline in exactly one
 * place, at the cost of two small `id === overrideBlockId` branches — a far
 * smaller footprint than a parallel copy of ~150 lines of re-fit/merge/
 * persist logic. The RESPONSE rendering still differs sharply between the
 * two callers (UX-DR11's "one short block" vs UX-DR12's "one confirmation
 * line") — that stays entirely `app/mid-day-reflow.ts`'s / `app/blocker-
 * report.ts`'s job (Story 8.3: moved from `chat-cli.ts`; see
 * `buildBlockerConfirmationLine` below), so this shared function's own
 * `rendered`/`plan.reasoning` fields keep meaning exactly what they already
 * meant for Task 15, unaffected by which caller triggered this run.
 *
 * Block selection (`findBlockerOverrideBlockId`): the block genuinely in
 * progress as of `now` (`start <= now < end`) if one exists, else the most
 * recently ENDED `work`/`break` block (largest `end <= now`).
 * `calendar-anchor` blocks are never eligible — AD-4 says Yoh never
 * reschedules a fixed external commitment, and Blocker handling can't
 * retroactively invent flexibility Yoh never created there. If no
 * `work`/`break` block has started yet as of `now` (too early in the day),
 * there is nothing to override and Blocker handling degrades gracefully to
 * plain Task 15 behavior for that run — FR-10 still applies unconditionally
 * (AD-3: no confirmation gate either way), it just has nothing to act on.
 *
 * Override effect (`elapsedMinutesSinceBlockStart`, and the two
 * `isOverridden` branches in the main elapsed-minutes loop below): for
 * ONLY the selected block,
 *   - it is excluded from `pastBlocks` (so it does NOT survive verbatim —
 *     `isElapsed` is effectively overridden to `false` for this one id),
 *     and
 *   - its contribution to the day's remaining Time Budget uses `now -
 *     start` (the real wall-clock minutes since it started) REGARDLESS of
 *     whether its scheduled `end` has already passed — i.e. Yoh charges
 *     the Budget for genuine time lost to the disruption, including any
 *     overrun past the original schedule, rather than pretending nothing
 *     happened. This reuses `elapsedMinutesWithinBlock`'s own "genuinely in
 *     progress" formula, just applied unconditionally instead of only when
 *     `start < now < end`.
 *   - it contributes NOTHING to that block's Task's own elapsed-minutes
 *     tally (`elapsedMinutesByTaskId`) — deliberately, and NOT merely
 *     "capped at zero": crediting ANY amount here would require Yoh to
 *     guess how much genuine progress Spencer made before the disruption,
 *     which is exactly the judgment FR-10 says Yoh must not exercise. The
 *     Task's FULL current `estimatedDurationMinutes` is what re-enters
 *     `outstanding` (mirroring the "never scheduled today at all" case
 *     just below) — mechanically "whatever Spencer was just supposed to be
 *     doing" is not-actually-done, full stop, whether the block had
 *     genuinely just started or had already run over its scheduled `end`
 *     by the time of the report. (A worked-math note for why this can't
 *     instead be `duration - (now - start)`: work-break-fit.ts always
 *     places a Task's FULL duration as one block, so block-duration ==
 *     task-duration on a first placement; once `now` is at or past that
 *     block's `end`, `now - start` is by construction `>= ` duration,
 *     making that subtraction `<= 0` for EVERY blocker report on an
 *     already-ended block — i.e. the exact reviewer-flagged scenario this
 *     task exists to fix would always compute right back to "already
 *     done". Crediting zero to the Task instead of that guaranteed-`<=0`
 *     subtraction is what actually closes the gap.)
 *
 * ============================================================================
 * Where "which Tasks are still outstanding" comes from
 * ============================================================================
 *
 * `rituals/morning-ritual.ts` doesn't expose a clean "today's candidate
 * CompleteTask set" as its own reusable output — building one requires the
 * same re-read-Notion -> merge-overrides -> gate sequence that ritual
 * already runs internally. Rather than invent a second, parallel data path,
 * this file mirrors that ritual exactly: it re-reads Notion Tasks
 * (`deps.readTasks`) and runs `rituals/data-completeness.ts`'s
 * `runDataCompletenessGate` (the same stateful merge/gate/sync capability
 * `morning-ritual.ts` uses) to get a fresh `CompleteTask[]` candidate set —
 * "fresh" on purpose, so a Task whose Estimated Duration Spencer just
 * corrected in chat (a `TaskFieldOverride`), or a Task Spencer added to
 * Notion since this morning, is honored by the re-flow.
 *
 * From that fresh candidate set, "still outstanding" is derived against the
 * CURRENTLY STORED Plan's own blocks (not a separately-persisted
 * `deferredTaskIds` list — `Plan` doesn't carry one; see
 * `adapters/memory-store.ts`'s `putPlan` doc comment, which stores a `Plan`
 * verbatim with no such side table):
 *
 *   - A Task with NO `work` block anywhere in today's stored Plan (past or
 *     remaining) is outstanding at its FULL current duration. This
 *     recovers exactly the set the brief calls "the day's original
 *     deferredTaskIds ... since a deferred Task might now fit given time
 *     that's passed" — a Task `fitWorkBreakBlocks` deferred this morning
 *     has, by construction, zero blocks in the stored Plan — and it also
 *     naturally covers a brand-new Task that didn't exist this morning,
 *     without this file needing two separate code paths for the two cases.
 *   - A Task with `work` blocks entirely in the PAST (fully elapsed) is
 *     done: `work-break-fit.ts`'s own deferral rule guarantees a placed
 *     Task always gets its FULL `estimatedDurationMinutes` on the timeline
 *     (never started-then-truncated), so "past minutes spent on this Task"
 *     `>= ` its current duration means it's finished.
 *   - A Task with SOME past minutes and some remaining minutes (split
 *     across the re-flow boundary, e.g. interrupted by a break) is
 *     outstanding for exactly `estimatedDurationMinutes - pastMinutes` —
 *     the genuinely-remaining chunk, not the whole Task over again.
 *
 * ============================================================================
 * Calendar anchors: reused from the stored Plan, not re-read from Calendar
 * ============================================================================
 *
 * Unlike the Morning Ritual, this file does not call a Calendar adapter.
 * The Task 15 brief's own "Depends on" list names Task 8 (`work-break-fit.ts`)
 * and Task 13 (chat routing) only — Mid-Day Re-Flow's job, per its own
 * story, is reacting to Spencer reporting a Task change, not picking up a
 * newly-added Calendar event. The stored Plan's own `calendar-anchor`
 * blocks that are still ahead (not yet elapsed) are reused verbatim as the
 * anchors `fitWorkBreakBlocks` fits the remaining work/break rhythm around
 * — this is strictly a re-fit of what was already known, never a re-read of
 * new external state.
 *
 * ============================================================================
 * Remaining Time Budget
 * ============================================================================
 *
 * Read fresh from `memory-store.ts` (so a Spencer `"time budget N hours"`
 * chat command issued before triggering a re-flow is honored), minus every
 * ELAPSED `work`/`break` minute already spent today (calendar anchors don't
 * count against the budget at all — same rule `work-break-fit.ts` itself
 * documents). `fitWorkBreakBlocks` requires `budget.totalMinutes` to be a
 * positive integer, so a computed remainder of zero or less (the declared
 * budget has already been fully used) is clamped to 1 minute — enough for
 * the function to still run (emitting any remaining anchors verbatim and
 * correctly deferring every real Task, since essentially no Task fits in
 * one minute) rather than needing a second, parallel "no budget left"
 * branch.
 *
 * ============================================================================
 * Merging past and re-fit blocks — id uniqueness (AD-9)
 * ============================================================================
 *
 * `fitWorkBreakBlocks` numbers every block it produces from a fresh
 * `idSequence` starting at 0 each call, so calling it again for just the
 * remaining portion would, unprefixed, reproduce ids already used by the
 * untouched past blocks (e.g. a second "work-0"). Every re-fit block's id
 * is therefore rewritten as `v<newPlanVersion>-<originalId>` before
 * merging — `newPlanVersion` (`existingPlan.version + 1`) strictly
 * increases on every successive re-flow of the same day's Plan, so two
 * different re-flow runs can never collide with each other's ids either,
 * and the morning Plan uses the same `v<N>-` scheme for its own version.
 *
 * ============================================================================
 * Rendering — "one short block" (UX-DR11), reusing `renderPlan`
 * ============================================================================
 *
 * `renderPlan` (from `morning-ritual.ts`) already renders exactly
 * `plan.blocks` plus a trailing reasoning line, with an OPTIONAL header
 * (`includeHeader: false` omits it). Handing it a small synthetic `Plan`
 * whose `blocks` is ONLY the newly re-fit remainder (never the untouched
 * past blocks, never the whole day) and a short reasoning line describing
 * just the change reuses that exact, already-tested layout logic verbatim
 * rather than reimplementing block-line formatting a second time — no
 * private helper of `morning-ritual.ts` needs to be exported for this.
 *
 * ============================================================================
 * No proactive trigger path
 * ============================================================================
 *
 * `runMidDayReflow` is called from exactly one place in this codebase:
 * `app/mid-day-reflow.ts`'s `reflowDay` (Story 8.3: moved from `shell/
 * chat-cli.ts`'s own Mid-Day Re-Flow command check), itself only reached in
 * direct response to a line Spencer typed in Chat. Nothing in
 * `rituals/*.ts`, `shell/ritual-cli.ts` (the cron-triggered entry point),
 * or any timer calls it — see `tests/mid-day-reflow.test.ts`'s "no
 * proactive trigger path" structural check for how that's verified.
 */
import { getCurrentTimeBudget, getPlan, PLAN_TOPIC, putPlan, type MemoryStore } from "../adapters/memory-store.ts";
import { appendOutboxInTx } from "../adapters/notification-store.ts";
import type { LogEntry } from "../adapters/logger.ts";
import type { DataCompletenessGateResult } from "../core/data-completeness-gate.ts";
import { isOpenTask } from "../core/planning-field-value.ts";
import { listDayDrops, listDayPins } from "../adapters/plan-state-store.ts";
import { computeDayRefit, elapsedMinutesWithinBlock } from "./reshuffle.ts";
import { runDataCompletenessGate } from "./data-completeness.ts";
import { describeError, failure, localIsoDate, missingRefiningFor, renderPlan } from "./ritual-shared.ts";
import type {
  CalendarEvent,
  CompleteTask,
  ExternalId,
  IsoDate,
  Plan,
  PlanBlock,
  Result,
  Task,
  YohError,
} from "../types/domain.ts";

const MINUTES_TO_MS = 60_000;

// ============================================================================
// Deps / outcome shapes
// ============================================================================

/**
 * Every input and I/O edge Mid-Day Re-Flow needs, injected — mirrors
 * `MorningRitualDeps`'s shape/conventions (`morning-ritual.ts`) minus the
 * seams this file doesn't need (no Calendar read, no notification send —
 * see the file docstring for why). `readTasks` is expected to throw on I/O
 * failure (AD-8) — catching that is this file's job, not its caller's.
 */
export interface MidDayReflowDeps {
  readonly store: MemoryStore;
  /** `adapters/notion-adapter.ts`'s `readNotionTasks`, pre-bound to its client/config. Throws on I/O failure. */
  readonly readTasks: () => Promise<readonly Task[]>;
  /** Injectable clock — never `new Date()` inline, so a test can pin the instant (AD-2). */
  readonly now: () => Date;
  /** Spencer's IANA timezone, defining both "today" and the rendered wall-clock times. */
  readonly timeZone: string;
  /** Slip-Bump levels (Task 17 / FR-11), threaded through to the ordering exactly as `morning-ritual.ts` does. Omitted -> "no bump" for every Task. */
  readonly bumpLevels?: Readonly<Record<ExternalId, number>>;
  readonly log?: (entry: LogEntry) => void;
  /** Forces color on/off for `rendered`; defaults to `renderPlan`'s own `shouldUseColor()`. */
  readonly color?: boolean;
  /**
   * Story 2.4 / Task 16 (FR-10): set by `app/blocker-report.ts` (Story 8.3:
   * moved from `chat-cli.ts`) when the triggering line was recognized as a
   * logistics Blocker report (e.g. "meeting ran
   * over"), rather than an explicit Mid-Day Re-Flow trigger. When `true`,
   * the current/most-recently-active `work`/`break` block as of `now` is
   * treated as NOT elapsed regardless of its scheduled `end` — see the file
   * docstring's "Logistics-Only Blocker Handling" section. Defaults to
   * `false` (Task 15's plain re-flow behavior, unchanged).
   */
  readonly blockerReported?: boolean;
}

/** What one Mid-Day Re-Flow run did. Discriminated on `status`, mirroring `MorningRitualOutcome`'s shape. */
export type MidDayReflowOutcome =
  | {
      /** No Plan has been generated for today yet — there is nothing to re-flow. */
      readonly status: "no-plan-today";
      readonly date: IsoDate;
    }
  | {
      /**
       * Every Task is either already fully placed in the past or genuinely
       * complete — there is no outstanding work to re-fit. Deliberately
       * its own outcome rather than a re-persisted, unchanged Plan: nothing
       * about today actually changes, so nothing is written and
       * `Plan.version` is not bumped for no reason.
       */
      readonly status: "nothing-to-reflow";
      readonly date: IsoDate;
    }
  | {
      readonly status: "reflowed";
      readonly date: IsoDate;
      readonly plan: Plan;
      /** ONLY the newly re-fit remainder, rendered via `renderPlan` with no header — UX-DR11's "one short block," never the whole day. */
      readonly rendered: string;
      /** Outstanding Tasks that still could not fit the remaining Time Budget and were left for a future Plan. */
      readonly deferredTaskIds: readonly ExternalId[];
      /** Tasks the Data-Completeness Gate held back on this re-read; an open interaction request names them. */
      readonly incompleteTaskIds: readonly ExternalId[];
      /** How many distinct Tasks were re-fit into the remainder — same count `buildReflowReasoning` embeds in `plan.reasoning`, exposed here so `buildBlockerConfirmationLine` (Task 16) can build its own, differently-worded single line without re-deriving it from `plan.blocks`' id-prefix convention. */
      readonly refitTaskCount: number;
    };

/**
 * Whether `block` has been fully lived through as of `nowMs` — used ONLY to
 * decide which blocks survive VERBATIM into the merged output (see the file
 * docstring's "not-yet-completed" design note). This is deliberately NOT
 * the same question as "how many of this Task's minutes have actually
 * elapsed" — see `elapsedMinutesWithinBlock` below, which a genuinely
 * in-progress block (this function's `false` case) still needs to answer
 * partially, not as a flat zero.
 *
 * By default, a block whose scheduled `end` has already passed is
 * unconditionally treated as fully done. Story 2.4 / Task 16 (Logistics-Only
 * Blocker Handling, FR-10) closes exactly this gap for ONE block at a time
 * — `runMidDayReflow` itself overrides this function's result for whichever
 * single block `findBlockerOverrideBlockId` selects, rather than this
 * function growing a parameter of its own; see the file docstring's
 * "Logistics-Only Blocker Handling" section for the full design and why the
 * override lives at the call site instead of here.
 */
function isElapsed(block: PlanBlock, nowMs: number): boolean {
  return Date.parse(block.end) <= nowMs;
}

/** Short, change-only reasoning line — UX-DR11: never re-explains or re-justifies the whole day, only names what the re-flow did. */
function buildReflowReasoning(refitTaskCount: number, deferredCount: number): string {
  if (refitTaskCount === 0) {
    return deferredCount > 0
      ? `Re-flowed the rest of today — nothing fit; ${deferredCount} Task${deferredCount === 1 ? "" : "s"} deferred for another day.`
      : "Re-flowed the rest of today — nothing left to schedule.";
  }
  const refitPart = `${refitTaskCount} Task${refitTaskCount === 1 ? "" : "s"} re-fit into what's left of today`;
  const deferredPart = deferredCount > 0 ? `, ${deferredCount} deferred for another day` : "";
  return `Re-flowed the rest of today — ${refitPart}${deferredPart}.`;
}

// ============================================================================
// Logistics-Only Blocker Handling (Story 2.4 / Task 16, FR-10) — helpers
// ============================================================================

/**
 * Selects the id of "the current/most-recently-active" `work`/`break` block
 * as of `nowMs` — the ONE block a Blocker report overrides. See the file
 * docstring's "Logistics-Only Blocker Handling" section for the full
 * reasoning. Prefers a block genuinely in progress (`start <= now < end`);
 * failing that, the most recently ENDED block (largest `end <= now`).
 * `calendar-anchor` blocks are never eligible (AD-4). Returns `undefined` if
 * no `work`/`break` block has started yet as of `nowMs`.
 */
function findBlockerOverrideBlockId(blocks: readonly PlanBlock[], nowMs: number): string | undefined {
  const eligible = blocks.filter((b) => b.kind !== "calendar-anchor");

  const inProgress = eligible.find((b) => Date.parse(b.start) <= nowMs && nowMs < Date.parse(b.end));
  if (inProgress) return inProgress.id;

  let mostRecentlyEnded: PlanBlock | undefined;
  for (const b of eligible) {
    const endMs = Date.parse(b.end);
    if (endMs > nowMs) continue; // hasn't ended yet — not a candidate for "most recently ended"
    if (!mostRecentlyEnded || endMs > Date.parse(mostRecentlyEnded.end)) mostRecentlyEnded = b;
  }
  return mostRecentlyEnded?.id;
}

/**
 * `elapsedMinutesWithinBlock`'s "genuinely in progress" formula (`now -
 * start`), applied UNCONDITIONALLY — including when `block.end` has already
 * passed — rather than only when `start < now < end`. Only ever called for
 * the ONE block a Blocker report overrides; see the file docstring for why
 * this is deliberately not capped at the block's own scheduled duration.
 */
function elapsedMinutesSinceBlockStart(block: PlanBlock, nowMs: number): number {
  return Math.max(0, (nowMs - Date.parse(block.start)) / MINUTES_TO_MS);
}

/**
 * `app/blocker-report.ts`'s ONLY rendering for a Blocker report's outcome
 * (`status: "reflowed"`; Story 8.3: moved from `chat-cli.ts`) — UX-DR12's
 * "single confirmation line describing the schedule change," deliberately
 * far terser than `outcome.rendered` (UX-DR11's "one short block," reused
 * only by Task 15's Mid-Day Re-Flow trigger, never by this path). No
 * suggestions for resolving the underlying obstacle, no commentary or
 * judgment — just what moved. Exported (rather than kept private like
 * `buildReflowReasoning`) because `app/blocker-report.ts`, not this file,
 * is the caller that needs it — this file's own `rendered`/
 * `plan.reasoning` fields keep their Task 15 meaning regardless of which
 * caller triggered the run (see the file docstring).
 */
export function buildBlockerConfirmationLine(outcome: {
  readonly refitTaskCount: number;
  readonly deferredTaskIds: readonly ExternalId[];
}): string {
  const deferredCount = outcome.deferredTaskIds.length;
  const refitPart =
    outcome.refitTaskCount > 0
      ? `${outcome.refitTaskCount} Task${outcome.refitTaskCount === 1 ? "" : "s"} rescheduled around it`
      : "the rest of today rescheduled around it";
  const deferredPart = deferredCount > 0 ? `, ${deferredCount} deferred for another day` : "";
  return `Got it — ${refitPart}${deferredPart}.`;
}

// ============================================================================
// runMidDayReflow — this file's sole export
// ============================================================================

/**
 * Re-fits ONLY the remaining, not-yet-elapsed portion of today's already
 * stored Plan, leaving every already-elapsed block byte-identical, and
 * persists the result. See the file docstring for the full design.
 *
 * Per AD-8, this is one of the two layers allowed to catch an adapter's
 * throw: `deps.readTasks`, `data-completeness.ts`'s gate sync (which can
 * throw `ConflictError` under AD-10 concurrency), and `putPlan` are all
 * wrapped and converted into a `Result` failure plus a structured log line.
 */
export async function runMidDayReflow(deps: MidDayReflowDeps): Promise<Result<MidDayReflowOutcome, YohError>> {
  const log = deps.log ?? ((): void => {});
  const nowDate = deps.now();
  const nowIso = nowDate.toISOString();
  const nowMs = nowDate.getTime();
  const today = localIsoDate(nowDate, deps.timeZone);

  // --- Is there even a Plan to re-flow? --------------------------------------
  const existingPlan = getPlan(deps.store, today);
  if (!existingPlan) {
    log({ level: "info", event: "mid-day-reflow.no-plan-today", detail: { date: today } });
    return { ok: true, value: { status: "no-plan-today", date: today } };
  }

  // --- Logistics-Only Blocker Handling override (Story 2.4 / Task 16) --------
  // See the file docstring's "Logistics-Only Blocker Handling" section for
  // the full design. `overrideBlockId` names the ONE block (if any)
  // `isElapsed` is overridden for below; `undefined` (the non-Blocker
  // default, or a Blocker report with nothing eligible yet) changes nothing.
  const overrideBlockId = deps.blockerReported
    ? findBlockerOverrideBlockId(existingPlan.data.blocks, nowMs)
    : undefined;

  const pastBlocks = existingPlan.data.blocks.filter((b) => isElapsed(b, nowMs) && b.id !== overrideBlockId);
  const remainingBlocks = existingPlan.data.blocks.filter((b) => !isElapsed(b, nowMs) || b.id === overrideBlockId);

  // --- Re-read Notion Tasks (AD-8 boundary) ----------------------------------
  let rawTasks: readonly Task[];
  try {
    rawTasks = await deps.readTasks();
  } catch (err) {
    log({ level: "error", event: "mid-day-reflow.read-tasks-failed", detail: describeError(err) });
    return failure("unreachable", `mid-day-reflow: could not read Notion Tasks — ${describeError(err)}`, err);
  }

  // Polish-5 Task 1: a completed Task is dropped here, BEFORE the
  // Data-Completeness Gate ever sees it — the SAME `isOpenTask` rule
  // `morning-ritual.ts` applies to its own re-read, so a Completed Task is
  // never a re-flow candidate, never counted incomplete, and never tagged
  // `missingRefining` here either.
  const openTasks = rawTasks.filter(isOpenTask);

  // --- Merge overrides, gate, sync the interaction request -------------------
  let gate: Result<DataCompletenessGateResult, YohError>;
  try {
    gate = runDataCompletenessGate(deps.store, openTasks);
  } catch (err) {
    log({ level: "error", event: "mid-day-reflow.gate-sync-failed", detail: describeError(err) });
    return failure(
      "conflict",
      `mid-day-reflow: could not record the Data-Completeness prompt — ${describeError(err)}`,
      err,
    );
  }
  if (!gate.ok) {
    log({ level: "error", event: "mid-day-reflow.gate-rejected", detail: gate.error });
    return gate;
  }
  const incompleteTaskIds = gate.value.incomplete.map((report) => report.taskId);

  // --- Which Tasks are still outstanding? (see file docstring) ---------------
  // Elapsed-minutes crediting runs over EVERY block in the stored Plan (past
  // AND remaining) via `elapsedMinutesWithinBlock`, not just `pastBlocks` —
  // a genuinely in-progress block (still "remaining" per `isElapsed`, so it
  // still gets re-fit, not preserved verbatim) must still credit its
  // already-elapsed portion, not zero (see that function's own doc comment
  // for the bug this fixes). `taskIdsWithAnyBlock` tracks "did this Task
  // appear anywhere in today's Plan at all" independent of how much of it
  // has elapsed, since a Task can have a non-zero elapsed credit that's
  // still less than its full duration.
  const elapsedMinutesByTaskId = new Map<ExternalId, number>();
  const taskIdsWithAnyBlock = new Set<ExternalId>();
  let elapsedBudgetMinutes = 0;
  for (const b of existingPlan.data.blocks) {
    // The ONE Blocker-overridden block (if any) uses the forced "in
    // progress" formula for the BUDGET (real wall-clock minutes lost,
    // uncapped by its scheduled `end`) and contributes NOTHING to its
    // Task's own elapsed tally — see the file docstring for why crediting
    // any amount there would be exactly the judgment call FR-10 rules out.
    const isOverridden = b.id === overrideBlockId;
    const elapsed = isOverridden ? elapsedMinutesSinceBlockStart(b, nowMs) : elapsedMinutesWithinBlock(b, nowMs);
    if (b.kind === "work" || b.kind === "break") elapsedBudgetMinutes += elapsed;
    if (!isOverridden && b.kind === "work" && b.taskId !== undefined) {
      taskIdsWithAnyBlock.add(b.taskId);
      if (elapsed > 0) {
        elapsedMinutesByTaskId.set(b.taskId, (elapsedMinutesByTaskId.get(b.taskId) ?? 0) + elapsed);
      }
    }
  }

  const outstanding: CompleteTask[] = [];
  for (const task of gate.value.completeTasks) {
    if (!taskIdsWithAnyBlock.has(task.id)) {
      // Never scheduled today at all — either deferred by this morning's
      // fit, or a Task that has appeared/become complete since. Outstanding
      // at its full current duration.
      outstanding.push(task);
      continue;
    }

    const elapsedMinutesForTask = elapsedMinutesByTaskId.get(task.id) ?? 0;
    const remainingDurationMinutes = task.estimatedDurationMinutes - elapsedMinutesForTask;
    if (remainingDurationMinutes <= 0) continue; // Already fully lived through.
    outstanding.push({ ...task, estimatedDurationMinutes: remainingDurationMinutes });
  }

  if (outstanding.length === 0) {
    log({ level: "info", event: "mid-day-reflow.nothing-to-reflow", detail: { date: today } });
    return { ok: true, value: { status: "nothing-to-reflow", date: today } };
  }

  // --- Remaining Time Budget for the rest of the day --------------------------
  const storedBudget = getCurrentTimeBudget(deps.store);
  if (!storedBudget) {
    log({ level: "warn", event: "mid-day-reflow.no-time-budget", detail: { date: today } });
    return failure(
      "missing-field",
      "mid-day-reflow: no Time Budget has been declared yet — tell Yoh how much time you have (e.g. `time budget 6 hours` in chat) and re-trigger the re-flow",
    );
  }
  // `elapsedBudgetMinutes` was computed above via `elapsedMinutesWithinBlock`
  // over EVERY block (not just `pastBlocks`) — it already correctly credits
  // an in-progress block's partial elapsed time rather than crediting it 0
  // (the same fix `elapsedMinutesByTaskId` above needed).
  // Clamped to >= 1 — `fitWorkBreakBlocks` requires a positive integer total;
  // see the file docstring's "Remaining Time Budget" section for why 1
  // (rather than a second no-budget-left branch) is the right minimum here.
  const remainingBudgetMinutes = Math.max(1, Math.round(storedBudget.data.totalMinutes - elapsedBudgetMinutes));

  // --- Calendar anchors still ahead, reused verbatim from the stored Plan ----
  const remainingAnchorEvents: readonly CalendarEvent[] = remainingBlocks
    .filter((b) => b.kind === "calendar-anchor")
    .map((b) => ({ id: b.id, title: b.label, start: b.start, end: b.end }));

  // --- Order + fit, via the ONE shared pipeline (`rituals/reshuffle.ts`) ------
  // Anchors (including any protected windows the stored Plan carries) come
  // verbatim from the stored Plan.
  const nextVersion = existingPlan.data.version + 1;
  // See the file docstring's "Merging past and re-fit blocks" section: the
  // version-keyed prefix guarantees no id collision across successive re-flows.
  const refit = computeDayRefit({
    date: today,
    timeZone: deps.timeZone,
    now: nowIso,
    openTasks: outstanding,
    budget: {
      date: today,
      totalMinutes: remainingBudgetMinutes,
      workMinutes: storedBudget.data.workMinutes,
      breakMinutes: storedBudget.data.breakMinutes,
    },
    fixedEvents: remainingAnchorEvents,
    pastBlocks,
    pins: deps.store.withDb((db) => listDayPins(db, today)),
    drops: deps.store.withDb((db) => listDayDrops(db, today)),
    ...(deps.bumpLevels ? { bumpLevels: deps.bumpLevels } : {}),
    idPrefix: `v${nextVersion}`,
    log,
  });
  if (!refit.ok) {
    log({ level: "error", event: "mid-day-reflow.fitting-rejected", detail: refit.error });
    return refit;
  }
  const fitted = { value: { deferredTaskIds: refit.value.deferredTaskIds } };

  const outstandingById = new Map<ExternalId, CompleteTask>(outstanding.map((t) => [t.id, t]));
  const refitBlocks: readonly PlanBlock[] = refit.value.fittedBlocks.map((b) => {
    const missing = b.kind === "work" && b.taskId !== undefined ? missingRefiningFor(outstandingById.get(b.taskId)!) : undefined;
    return missing ? { ...b, missingRefining: missing } : b;
  });

  const refitById = new Map(refitBlocks.map((b) => [b.id, b]));
  const mergedBlocks = refit.value.blocks.map((b) => refitById.get(b.id) ?? b);


  const refitTaskIds = new Set<ExternalId>(
    refitBlocks.flatMap((b) => (b.kind === "work" && b.taskId !== undefined ? [b.taskId] : [])),
  );

  const plan: Plan = {
    id: existingPlan.data.id,
    date: today,
    blocks: mergedBlocks,
    reasoning: buildReflowReasoning(refitTaskIds.size, fitted.value.deferredTaskIds.length),
    version: nextVersion,
    createdAt: existingPlan.data.createdAt,
    updatedAt: nowIso,
  };

  // --- Render ONLY the remainder — UX-DR11's "one short block" ---------------
  const remainderView: Plan = { ...plan, blocks: refitBlocks };
  const rendered = renderPlan(remainderView, {
    timeZone: deps.timeZone,
    includeHeader: false,
    ...(deps.color === undefined ? {} : { color: deps.color }),
  });

  // --- Persist -----------------------------------------------------------------
  try {
    // Story 7.8, Ruling R4: same atomic Plan-change outbox hint as
    // morning-ritual.ts's own putPlan call — see that call site's comment.
    putPlan(deps.store, plan, (db) => appendOutboxInTx(db, { topic: PLAN_TOPIC, entityId: plan.date }));
  } catch (err) {
    log({ level: "error", event: "mid-day-reflow.persist-failed", detail: describeError(err) });
    return failure("conflict", `mid-day-reflow: could not persist the updated Plan — ${describeError(err)}`, err);
  }

  log({
    level: "info",
    event: "mid-day-reflow.reflowed",
    detail: { date: today, refit: refitTaskIds.size, deferred: fitted.value.deferredTaskIds.length },
  });

  return {
    ok: true,
    value: {
      status: "reflowed",
      date: today,
      plan,
      rendered,
      deferredTaskIds: fitted.value.deferredTaskIds,
      incompleteTaskIds,
      refitTaskCount: refitTaskIds.size,
    },
  };
}
