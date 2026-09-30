/**
 * src/rituals/day-refit-inputs.ts
 *
 * The shared "re-fit the rest of today" seam: reads open Tasks and calendar
 * events, credits what has already happened, gathers the day's pins, routines
 * and bump levels, and runs `computeDayRefit`. `requestReshuffle` (a preview)
 * and `syncPlanFromCalendar` (a direct apply) both call it; neither writes
 * anything through it.
 */
import { getCurrentTimeBudget, type MemoryStore } from "../adapters/memory-store.ts";
import { listDayDrops, listDayPins } from "../adapters/plan-state-store.ts";
import { listRoutinesFromStore } from "../adapters/routine-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { isOpenTask } from "../core/planning-field-value.ts";
import type { MissingFieldReport } from "../core/data-completeness-gate.ts";
import type { Routine } from "../core/routine-commands.ts";
import { runDataCompletenessGate } from "./data-completeness.ts";
import { readPlanningSettings } from "../adapters/settings-store.ts";
import { computeDayRefit, computeSchoolDayInputs, elapsedMinutesWithinBlock, type DayRefitOutput } from "./reshuffle.ts";
import { computeBumpLevels, localIsoDate, missingRefiningFor } from "./ritual-shared.ts";
import type { CalendarEvent, CompleteTask, DayPin, ExternalId, IsoDate, Plan, PlanBlock, Result, Task, YohError } from "../types/domain.ts";

export interface DayRefitDeps {
  readonly store: MemoryStore;
  readonly timeZone: string;
  readonly now: () => Date;
  readonly readTasks: () => Promise<readonly Task[]>;
  readonly readCalendarEvents: () => Promise<readonly CalendarEvent[]>;
  /** Declared Routines. Defaults to reading them from `store`. */
  readonly readRoutines?: () => readonly Routine[];
}

/** The day's pins and drops; `requested` names Tasks whose pin the current request itself sets (only these may reject). */
export interface DayChange {
  readonly pins: readonly DayPin[];
  readonly drops: readonly ExternalId[];
  readonly requested?: readonly ExternalId[];
}

/** What is known before the day's change is decided. */
export interface RefitContext {
  readonly today: IsoDate;
  readonly nowMs: number;
  readonly openIds: ReadonlySet<ExternalId>;
  readonly incomplete: ReadonlyMap<ExternalId, MissingFieldReport>;
  readonly currentDay: DayChange;
}

export interface DayRefitResult {
  readonly today: IsoDate;
  readonly rawTasks: readonly Task[];
  readonly events: readonly CalendarEvent[];
  readonly needsDataTaskIds: readonly ExternalId[];
  readonly outstanding: readonly CompleteTask[];
  readonly currentDay: DayChange;
  /** The day change the refit was computed for (what `resolveDay` returned). */
  readonly day: DayChange;
  readonly refit: DayRefitOutput;
  /** `refit.blocks` with each work block tagged with what its Task still lacks. */
  readonly blocks: readonly PlanBlock[];
}

function fail(kind: YohError["kind"], message: string, detail?: unknown): Result<never, YohError> {
  return { ok: false, error: { kind, message, ...(detail !== undefined ? { detail } : {}) } };
}

/**
 * Re-fits the rest of today around `plan`. `resolveDay` turns the gathered context into the pins and
 * drops to fit with (a failure is returned as-is). Writes nothing.
 */
export async function refitToday(
  deps: DayRefitDeps,
  input: { readonly plan: Plan; /** The caller's clock reading, so its own math and the fit agree on `now`. */ readonly now?: Date; readonly resolveDay: (ctx: RefitContext) => Result<DayChange, YohError> },
): Promise<Result<DayRefitResult, YohError>> {
  const { plan } = input;
  const nowDate = input.now ?? deps.now();
  const nowMs = nowDate.getTime();
  const today = localIsoDate(nowDate, deps.timeZone);

  const budget = getCurrentTimeBudget(deps.store);
  if (!budget) return fail("missing-field", "I don't have a time budget for today yet. Tell me how much time you have.");

  let rawTasks: readonly Task[];
  let events: readonly CalendarEvent[];
  try {
    [rawTasks, events] = await Promise.all([deps.readTasks(), deps.readCalendarEvents()]);
  } catch (err) {
    return fail("unreachable", errorCopyForThrown(err), err);
  }

  let gate;
  try {
    gate = runDataCompletenessGate(deps.store, rawTasks.filter(isOpenTask));
  } catch (err) {
    return fail("conflict", errorCopyForThrown(err), err);
  }
  if (!gate.ok) return gate;
  const needsDataTaskIds = gate.value.incomplete.map((r) => r.taskId);

  // Credit what has already happened, as the mid-day reflow does.
  const pastBlocks = plan.blocks.filter((b) => Date.parse(b.end) <= nowMs);
  const elapsedByTask = new Map<ExternalId, number>();
  const scheduledTaskIds = new Set<ExternalId>();
  let elapsedBudget = 0;
  for (const b of plan.blocks) {
    const e = elapsedMinutesWithinBlock(b, nowMs);
    if (b.kind === "work" || b.kind === "break") elapsedBudget += e;
    if (b.kind === "work" && b.taskId !== undefined) {
      scheduledTaskIds.add(b.taskId);
      if (e > 0) elapsedByTask.set(b.taskId, (elapsedByTask.get(b.taskId) ?? 0) + e);
    }
  }
  const outstanding: CompleteTask[] = [];
  for (const task of gate.value.completeTasks) {
    if (!scheduledTaskIds.has(task.id)) {
      outstanding.push(task);
      continue;
    }
    const remaining = task.estimatedDurationMinutes - (elapsedByTask.get(task.id) ?? 0);
    if (remaining > 0) outstanding.push({ ...task, estimatedDurationMinutes: remaining });
  }

  const settings = deps.store.withDb(readPlanningSettings);
  const school = computeSchoolDayInputs(events, today, deps.timeZone, settings);
  if (!school.ok) return school;

  const currentDay: DayChange = {
    pins: deps.store.withDb((db) => listDayPins(db, today)),
    drops: deps.store.withDb((db) => listDayDrops(db, today)),
  };
  const resolved = input.resolveDay({
    today,
    nowMs,
    openIds: new Set(outstanding.map((t) => t.id)),
    incomplete: new Map(gate.value.incomplete.map((r) => [r.taskId, r])),
    currentDay,
  });
  if (!resolved.ok) return resolved;
  const day = resolved.value;

  let routines: readonly Routine[];
  try {
    routines = (deps.readRoutines ?? (() => listRoutinesFromStore(deps.store)))();
  } catch (err) {
    return fail("conflict", errorCopyForThrown(err), err);
  }
  const refit = computeDayRefit({
    settings,
    date: today,
    timeZone: deps.timeZone,
    workStart: school.value.workStart,
    now: nowDate.toISOString(),
    openTasks: outstanding,
    budget: {
      date: today,
      totalMinutes: Math.max(1, Math.round(budget.data.totalMinutes - elapsedBudget)),
      workMinutes: budget.data.workMinutes,
      breakMinutes: budget.data.breakMinutes,
    },
    fixedEvents: school.value.anchors,
    protectedWindows: school.value.protectedWindows,
    pastBlocks,
    pins: day.pins,
    drops: day.drops,
    requestPinTaskIds: day.requested ?? [],
    routines,
    storedRoutineBlocks: plan.blocks.filter((b) => b.kind === "routine"),
    bumpLevels: computeBumpLevels(deps.store),
    idPrefix: `v${plan.version + 1}`,
  });
  if (!refit.ok) return refit;
  const outstandingById = new Map(outstanding.map((t) => [t.id, t]));
  const fittedTagged = new Map(
    refit.value.fittedBlocks.map((b) => {
      const missing = b.kind === "work" && b.taskId !== undefined ? missingRefiningFor(outstandingById.get(b.taskId)!) : undefined;
      return [b.id, missing ? { ...b, missingRefining: missing } : b] as const;
    }),
  );
  const blocks = refit.value.blocks.map((b) => fittedTagged.get(b.id) ?? b);
  return { ok: true, value: { today, rawTasks, events, needsDataTaskIds, outstanding, currentDay, day, refit: refit.value, blocks } };
}
