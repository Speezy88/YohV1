/**
 * The one re-planning pipeline (Epic 10, T2). Morning and mid-day reflow
 * (and later request/approve) share `computeDayRefit`: order by Derived
 * Priority, coalesce overlapping anchors, fit work/break blocks, apply the
 * school-day last resort, then merge with the already-lived `pastBlocks`.
 * No store I/O; callers persist.
 */
import type { LogEntry } from "../adapters/logger.ts";
import { orderByDerivedPriority } from "../core/derived-priority.ts";
import { computeSchoolDay, mergeOverlappingAnchors } from "../core/school-day.ts";
import { fitWorkBreakBlocks, type FitWorkBreakBlocksOutput } from "../core/work-break-fit.ts";
import { localIsoDate } from "./ritual-shared.ts";
import type {
  CalendarEvent,
  CompleteTask,
  DayPin,
  ExternalId,
  IsoDate,
  IsoDateTime,
  PlanBlock,
  Result,
  TimeBudget,
  YohError,
} from "../types/domain.ts";

// ============================================================================
// Polish-5 Task 3: school-day "last resort" — a due-today/overdue Task pass
// 1 (`core/school-day.ts`'s anchors + protected windows already busy) still
// deferred may get a second, narrower chance at protected-window time.
// ============================================================================

/**
 * True whenever `[aStart, aEnd)` and `[bStart, bEnd)` (millis) share any
 * instant.
 */
function overlapsMs(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Pass 2's own `calendarEvents`: everything from `startTimeMs` onward is
 * BUSY except the two protected windows themselves — the only wall-clock
 * room pass 2 has to place a rescued Task's minutes into. This is computed
 * directly from `protectedWindows` (never from pass 1's own placed blocks),
 * so pass 2 can never spill a rescued Task into some unrelated leftover
 * slot further into the day — only literally inside lunch/community time.
 * (Pass 1 itself already rejects a real Calendar anchor that overlaps a
 * protected window — `validateAndSortAnchors`'s overlap check — so by the
 * time this runs, no real anchor can occupy this space either.)
 */
function buildProtectedWindowOnlyAnchors(startTimeMs: number, protectedWindows: readonly CalendarEvent[]): CalendarEvent[] {
  const sortedWindows = [...protectedWindows]
    .map((window) => ({ startMs: Date.parse(window.start), endMs: Date.parse(window.end) }))
    .sort((a, b) => a.startMs - b.startMs);
  const lastWindowEndMs = sortedWindows.length > 0 ? sortedWindows[sortedWindows.length - 1]!.endMs : startTimeMs;
  // A day past the last protected window — generous enough a rescued
  // Task's own (small) minutes are never truncated mid-placement, while
  // still confining pass 2 to "today", never some arbitrary far-future slot.
  const cutoffMs = lastWindowEndMs + 24 * 60 * 60 * 1000;

  const busyPieces: { readonly start: number; readonly end: number }[] = [];
  let cursorMs = startTimeMs;
  for (const window of sortedWindows) {
    if (window.startMs > cursorMs) busyPieces.push({ start: cursorMs, end: window.startMs });
    cursorMs = Math.max(cursorMs, window.endMs);
  }
  if (cursorMs < cutoffMs) busyPieces.push({ start: cursorMs, end: cutoffMs });

  return busyPieces.map((piece, index) => ({
    id: `pass2-busy-${index}`,
    title: "Busy",
    start: new Date(piece.start).toISOString(),
    end: new Date(piece.end).toISOString(),
  }));
}

interface SchoolDayLastResortInput {
  readonly pass1: FitWorkBreakBlocksOutput;
  /** The SAME Derived-Priority-ordered `CompleteTask[]` pass 1 was given. */
  readonly tasks: readonly CompleteTask[];
  readonly protectedWindows: readonly CalendarEvent[];
  readonly budget: TimeBudget;
  readonly startTime: IsoDateTime;
  readonly today: IsoDate;
}

/**
 * Polish-5 Task 3, ruling 3 ("Last resort"). If pass 1 deferred a Task due
 * today or overdue, this gives ONLY those Tasks (never a non-deadline one —
 * they're never even in pass 2's own `tasks` input) a second
 * `fitWorkBreakBlocks` call whose only open wall-clock room is the two
 * protected windows (`buildProtectedWindowOnlyAnchors`).
 *
 * Final fix round (M2): pass 2's budget is the protected minutes STILL
 * AHEAD of `startTime` — `Σ max(0, windowEnd - max(windowStart, startTime))`
 * over `protectedWindows` (already M1-clipped by the caller) — never the
 * windows' full nominal span. A run whose `startTime` is already past both
 * windows has zero reachable minutes and skips the rescue entirely, rather
 * than handing `fitWorkBreakBlocks` a budget it would have to spill past
 * `buildProtectedWindowOnlyAnchors`'s trailing (non-protected) filler anchor
 * to satisfy. As a second, independent guard against that same spillover, a
 * Task is only actually rescued if EVERY ONE of its own pass-2 "work"
 * blocks lands fully inside a (pre-clip, real) protected window — never
 * partially, and never in the filler anchor beyond it; a candidate that
 * fails this keeps none of its pass-2 blocks and stays deferred, exactly as
 * if pass 2 had never run for it. Together these mean a rescue can only
 * ever place a Task's minutes inside protected-window time actually ahead
 * of `startTime` today — never tomorrow, and never more than the protected
 * windows' own span beyond Spencer's declared TimeBudget.
 *
 * A rescue candidate that still doesn't fit was genuinely too large for the
 * day and stays deferred, indistinguishable from a pass-1-only deferral.
 * When a rescued Task's block DOES land inside a protected window, that
 * window's own `calendar-anchor` block (from pass 1) is dropped entirely —
 * never trimmed — so the Plan never shows two overlapping blocks over the
 * same span.
 */
function applySchoolDayLastResort(input: SchoolDayLastResortInput): Result<FitWorkBreakBlocksOutput, YohError> {
  const { pass1, tasks, protectedWindows, budget, startTime, today } = input;

  if (protectedWindows.length === 0 || pass1.deferredTaskIds.length === 0) {
    return { ok: true, value: pass1 };
  }

  const deferredTaskIds = new Set(pass1.deferredTaskIds);
  // "due today or overdue" — same lexical `<=` comparison
  // `core/derived-priority.ts`'s own `daysBetween(today, task.dueDate) <= 0`
  // makes, spelled directly against two "YYYY-MM-DD" strings.
  const rescueCandidates = tasks.filter((task) => deferredTaskIds.has(task.id) && task.dueDate <= today);
  if (rescueCandidates.length === 0) {
    return { ok: true, value: pass1 };
  }

  const startTimeMs = Date.parse(startTime);

  // M2 fix (a): the protected minutes still physically reachable from
  // `startTime` onward today — never the windows' full 45+50, since a
  // window (or part of one) already in the past contributes nothing.
  const protectedSpans = protectedWindows.map((window) => ({ startMs: Date.parse(window.start), endMs: Date.parse(window.end) }));
  const reachableMinutes = Math.floor(
    protectedSpans.reduce((total, span) => total + Math.max(0, (span.endMs - Math.max(span.startMs, startTimeMs)) / 60_000), 0),
  );
  if (reachableMinutes <= 0) {
    return { ok: true, value: pass1 };
  }

  const pass2Budget: TimeBudget = { ...budget, totalMinutes: reachableMinutes };
  const pass2Anchors = buildProtectedWindowOnlyAnchors(startTimeMs, protectedWindows);

  const pass2 = fitWorkBreakBlocks({ tasks: rescueCandidates, budget: pass2Budget, calendarEvents: pass2Anchors, startTime });
  if (!pass2.ok) return pass2;

  // M2 fix (b), independent of (a): a Task is rescued only if EVERY one of
  // its own pass-2 work blocks lies fully inside a real protected window
  // (never partially, never in the trailing filler anchor beyond it).
  const isInsideAProtectedWindow = (block: PlanBlock): boolean =>
    protectedSpans.some((span) => Date.parse(block.start) >= span.startMs && Date.parse(block.end) <= span.endMs);

  const rescuedTaskIds = new Set<ExternalId>();
  for (const task of rescueCandidates) {
    const taskWorkBlocks = pass2.value.blocks.filter((block) => block.kind === "work" && block.taskId === task.id);
    if (taskWorkBlocks.length > 0 && taskWorkBlocks.every(isInsideAProtectedWindow)) {
      rescuedTaskIds.add(task.id);
    }
  }

  if (rescuedTaskIds.size === 0) {
    // Nobody rescued — every candidate genuinely didn't fit even with the
    // protected-window bonus. Pass 1's own Plan stands unchanged.
    return { ok: true, value: pass1 };
  }

  const rescuedBlocks: PlanBlock[] = pass2.value.blocks
    .filter((block) => {
      if (block.kind === "calendar-anchor") return false;
      if (block.kind === "work") return block.taskId !== undefined && rescuedTaskIds.has(block.taskId);
      // A "break" block belongs to no Task — keep it only if it too sits
      // inside a real protected window, never the filler anchor beyond it.
      return isInsideAProtectedWindow(block);
    })
    .map((block) => ({ ...block, id: `resc-${block.id}` }));

  const usedProtectedSpans = protectedSpans.filter((span) =>
    rescuedBlocks.some((block) => overlapsMs(Date.parse(block.start), Date.parse(block.end), span.startMs, span.endMs)),
  );

  const keptPass1Blocks = pass1.blocks.filter((block) => {
    if (block.kind !== "calendar-anchor") return true;
    const blockStartMs = Date.parse(block.start);
    const blockEndMs = Date.parse(block.end);
    return !usedProtectedSpans.some((span) => span.startMs === blockStartMs && span.endMs === blockEndMs);
  });

  const mergedBlocks = [...keptPass1Blocks, ...rescuedBlocks].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  const mergedDeferredTaskIds = pass1.deferredTaskIds.filter((id) => !rescuedTaskIds.has(id));

  return { ok: true, value: { blocks: mergedBlocks, deferredTaskIds: mergedDeferredTaskIds } };
}

export interface DayRefitInput {
  readonly date: IsoDate;
  readonly timeZone: string;
  readonly now: IsoDateTime;
  /** Already gated (and, for reflow, remaining-duration-adjusted) open Tasks. */
  readonly openTasks: readonly CompleteTask[];
  readonly budget: TimeBudget;
  /** Anchors the fit must route around (calendar anchors, plus protected windows when the caller has no separate `protectedWindows`). */
  readonly fixedEvents: readonly CalendarEvent[];
  /** School-day protected windows, kept separate so the last-resort rescue can target them. Fitted around exactly like `fixedEvents`. */
  readonly protectedWindows?: readonly CalendarEvent[];
  /** Blocks already lived through — kept verbatim in the merged output. */
  readonly pastBlocks: readonly PlanBlock[];
  readonly bumpLevels?: Readonly<Record<ExternalId, number>>;
  /**
   * The day's hand-fixed placements. Task pins dated `date` for still-open Tasks apply; a pin
   * that started already is placed from `now` (the Task keeps going). Pinned Tasks skip ordering.
   */
  readonly pins?: readonly DayPin[];
  /** Task ids whose pin comes from the current request. Only these may reject; a stored pin that now collides is released. */
  readonly requestPinTaskIds?: readonly ExternalId[];
  /** Task ids dropped for the day; removed before ordering. */
  readonly drops?: readonly ExternalId[];
  /** Prefix for every fitted block id, e.g. `v3` gives `v3-work-0`. */
  readonly idPrefix: string;
  readonly log?: (entry: LogEntry) => void;
}

export interface DayRefitOutput {
  /** `pastBlocks` plus every freshly fitted block, sorted by start. */
  readonly blocks: readonly PlanBlock[];
  /** Only the freshly fitted (prefixed) blocks. */
  readonly fittedBlocks: readonly PlanBlock[];
  readonly deferredTaskIds: readonly ExternalId[];
  readonly fitMs: number;
  /** Set when a pin could not be honored (it overlaps a fixed event or another pin); the blocks are then the day fitted with no pins at all. */
  readonly rejectedReason?: string;
  /** Stored pins let go because they now overlap a fixed event or another pin; the Task is ordered normally. */
  readonly releasedPins?: readonly { readonly taskId: ExternalId; readonly title: string; readonly reason: string }[];
}

const PIN_ANCHOR_TITLE = "__pin__";
const MINUTES_TO_MS = 60_000;

/**
 * How many of `block`'s minutes have elapsed as of `nowMs`: the whole block if it
 * has ended, none if it has not started, and `now - start` while it is running.
 * Callers credit these against a Task's duration and the day's Time Budget.
 */
export function elapsedMinutesWithinBlock(block: PlanBlock, nowMs: number): number {
  const startMs = Date.parse(block.start);
  const endMs = Date.parse(block.end);
  if (endMs <= nowMs) return (endMs - startMs) / MINUTES_TO_MS;
  if (startMs >= nowMs) return 0;
  return (nowMs - startMs) / MINUTES_TO_MS;
}

interface PinPlacement {
  readonly task: CompleteTask;
  readonly blocks: readonly PlanBlock[];
  readonly startMs: number;
  readonly endMs: number;
}

/** Places each pinned Task contiguously from its pin start, split into work and break blocks by the normal rule. */
function placePinnedTasks(
  pinned: readonly { readonly task: CompleteTask; readonly start: IsoDateTime }[],
  budget: TimeBudget,
  idPrefix: string,
): Result<PinPlacement[], YohError> {
  const placements: PinPlacement[] = [];
  for (const [index, { task, start }] of pinned.entries()) {
    const fit = fitWorkBreakBlocks({ tasks: [task], budget: { ...budget, totalMinutes: 1_000_000 }, calendarEvents: [], startTime: start });
    if (!fit.ok) return fit;
    const blocks = fit.value.blocks.map((b): PlanBlock => ({ ...b, id: `${idPrefix}-p${index}-${b.id}`, pinned: true }));
    placements.push({
      task,
      blocks,
      startMs: Math.min(...blocks.map((b) => Date.parse(b.start))),
      endMs: Math.max(...blocks.map((b) => Date.parse(b.end))),
    });
  }
  return { ok: true, value: placements };
}

type PinCollision = { readonly release: PinPlacement; readonly reason: string } | { readonly reject: string };

/** The first pin that cannot be honored: a stored pin is released, a request pin rejects the request. */
function firstPinCollision(placements: readonly PinPlacement[], fixed: readonly CalendarEvent[], requested: ReadonlySet<ExternalId>): PinCollision | undefined {
  for (const [i, p] of placements.entries()) {
    const hit = fixed.find((e) => overlapsMs(p.startMs, p.endMs, Date.parse(e.start), Date.parse(e.end)));
    if (hit) return requested.has(p.task.id) ? { reject: `"${p.task.title}" can't go there: it overlaps ${hit.title}.` } : { release: p, reason: `it now overlaps ${hit.title}` };
    const q = placements.slice(i + 1).find((o) => overlapsMs(p.startMs, p.endMs, o.startMs, o.endMs));
    if (q) {
      if (!requested.has(q.task.id)) return { release: q, reason: `it now overlaps ${p.task.title}` };
      if (!requested.has(p.task.id)) return { release: p, reason: `it now overlaps ${q.task.title}` };
      return { reject: `"${p.task.title}" and "${q.task.title}" can't both go there: their times overlap.` };
    }
  }
  return undefined;
}

/** `computeSchoolDay` for the morning path: the raw calendar events split into anchors and protected windows. */
export function computeSchoolDayInputs(
  events: readonly CalendarEvent[],
  date: IsoDate,
  timeZone: string,
): Result<{ anchors: readonly CalendarEvent[]; protectedWindows: readonly CalendarEvent[] }, YohError> {
  return computeSchoolDay(events, date, timeZone);
}

export function computeDayRefit(input: DayRefitInput): Result<DayRefitOutput, YohError> {
  const startedMs = Date.now();
  const dropped = new Set(input.drops ?? []);
  const nowMs = Date.parse(input.now);
  const requested = new Set(input.requestPinTaskIds ?? []);
  const openById = new Map(input.openTasks.map((t) => [t.id, t]));
  const pinned: { task: CompleteTask; start: IsoDateTime }[] = [];
  for (const pin of [...(input.pins ?? [])].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    if (pin.date !== input.date || pin.subject.kind !== "task") continue;
    const task = openById.get(pin.subject.taskId);
    if (!task || dropped.has(task.id) || pinned.some((p) => p.task.id === task.id)) continue;
    // A pin already under way keeps the Task going from now.
    pinned.push({ task, start: Date.parse(pin.start) < nowMs ? input.now : pin.start });
  }

  const { anchors, protectedWindows } = mergeOverlappingAnchors(input.fixedEvents, input.protectedWindows ?? []);

  const placed = placePinnedTasks(pinned, input.budget, input.idPrefix);
  if (!placed.ok) return placed;
  let placements = placed.value;
  // A stored pin running past the end of the day stops applying; a request pin like that is rejected.
  const runsPastDay = (p: PinPlacement): boolean => localIsoDate(new Date(p.endMs - 1), input.timeZone) !== input.date;
  const spilled = placements.find((p) => runsPastDay(p) && requested.has(p.task.id));
  const released: { taskId: ExternalId; title: string; reason: string }[] = [];
  placements = placements.filter((p) => !runsPastDay(p) || requested.has(p.task.id));
  let rejection = spilled ? `"${spilled.task.title}" can't go there: it would run past the end of the day.` : undefined;
  while (rejection === undefined) {
    const collision = firstPinCollision(placements, [...anchors, ...protectedWindows], requested);
    if (!collision) break;
    if ("reject" in collision) {
      rejection = collision.reject;
      break;
    }
    released.push({ taskId: collision.release.task.id, title: collision.release.task.title, reason: collision.reason });
    placements = placements.filter((p) => p !== collision.release);
  }
  if (rejection !== undefined) {
    const unpinned = computeDayRefit({ ...input, pins: [] });
    return unpinned.ok ? { ok: true, value: { ...unpinned.value, rejectedReason: rejection } } : unpinned;
  }

  const pinnedIds = new Set(placements.map((p) => p.task.id));
  const population = input.openTasks.filter((t) => !dropped.has(t.id) && !pinnedIds.has(t.id));
  const ordered = orderByDerivedPriority(population, input.date, input.bumpLevels);
  if (!ordered.ok) return ordered;

  const pinBlocks = placements.flatMap((p) => p.blocks);
  const pinAnchors: CalendarEvent[] = placements.map((p, i) => ({
    id: `pin-anchor-${i}`,
    title: PIN_ANCHOR_TITLE,
    start: new Date(p.startMs).toISOString(),
    end: new Date(p.endMs).toISOString(),
  }));
  const pinnedMinutes = pinBlocks.reduce((sum, b) => sum + (Date.parse(b.end) - Date.parse(b.start)) / MINUTES_TO_MS, 0);
  const budget: TimeBudget =
    pinnedMinutes > 0 ? { ...input.budget, totalMinutes: Math.max(1, Math.round(input.budget.totalMinutes - pinnedMinutes)) } : input.budget;

  const pass1 = fitWorkBreakBlocks({
    tasks: ordered.value,
    budget,
    calendarEvents: [...anchors, ...protectedWindows, ...pinAnchors],
    startTime: input.now,
  });
  if (!pass1.ok) return pass1;

  const fitted = applySchoolDayLastResort({
    pass1: pass1.value,
    tasks: ordered.value,
    protectedWindows,
    budget,
    startTime: input.now,
    today: input.date,
  });
  if (!fitted.ok) return fitted;

  const fittedBlocks = [
    ...fitted.value.blocks.filter((b) => !(b.kind === "calendar-anchor" && b.label === PIN_ANCHOR_TITLE)).map((b) => ({ ...b, id: `${input.idPrefix}-${b.id}` })),
    ...pinBlocks,
  ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const blocks = [...input.pastBlocks, ...fittedBlocks].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const fitMs = Date.now() - startedMs;
  input.log?.({
    level: "info",
    event: "reshuffle.computed",
    detail: { date: input.date, ms: fitMs, blocks: blocks.length, deferred: fitted.value.deferredTaskIds.length },
  });
  return {
    ok: true,
    value: { blocks, fittedBlocks, deferredTaskIds: fitted.value.deferredTaskIds, fitMs, ...(released.length > 0 ? { releasedPins: released } : {}) },
  };
}
