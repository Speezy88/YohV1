/**
 * src/app/request-reshuffle.ts
 *
 * Builds a preview of the re-fitted rest of today from the stored Plan, the
 * live calendar and the open Tasks, and opens it as the one open `reshuffle`
 * proposal. Writes nothing to Calendar or to the stored Plan; applying the
 * proposal is `confirm-proposal`'s job.
 */
import {
  clearInteractionRequest,
  getCurrentTimeBudget,
  getPlan,
  listOpenInteractionRequests,
  type MemoryStore,
} from "../adapters/memory-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { isOpenTask } from "../core/planning-field-value.ts";
import { buildReshuffleSummary, calendarVersionHash, diffPlanBlocks } from "../core/reshuffle-preview.ts";
import { runDataCompletenessGate } from "../rituals/data-completeness.ts";
import { computeDayRefit, computeSchoolDayInputs } from "../rituals/reshuffle.ts";
import { computeBumpLevels, localIsoDate, missingRefiningFor } from "../rituals/ritual-shared.ts";
import { openProposal } from "./open-proposal.ts";
import type { OpenItemQuestion } from "../types/api.ts";
import type {
  CalendarEvent,
  CompleteTask,
  ExternalId,
  PlanBlock,
  Proposal,
  ReshufflePreview,
  ReshuffleRequest,
  Result,
  Task,
  YohError,
} from "../types/domain.ts";

export interface RequestReshuffleDeps {
  readonly store: MemoryStore;
  readonly timeZone: string;
  readonly now: () => Date;
  readonly readTasks: () => Promise<readonly Task[]>;
  readonly readCalendarEvents: () => Promise<readonly CalendarEvent[]>;
}

export interface RequestReshuffleInput {
  readonly request: ReshuffleRequest;
}

export interface RequestReshuffleOutput {
  readonly proposal: Proposal<ReshufflePreview>;
  readonly question: OpenItemQuestion;
}

const MINUTE_MS = 60_000;

function fail(kind: YohError["kind"], message: string, detail?: unknown): Result<never, YohError> {
  return { ok: false, error: { kind, message, ...(detail !== undefined ? { detail } : {}) } };
}

function clearOpenReshuffleProposals(store: MemoryStore): void {
  for (const record of listOpenInteractionRequests(store)) {
    if (record.data.requestKind !== "proposal") continue;
    const stored = (record.data.detail as { readonly proposal?: Proposal<unknown> } | undefined)?.proposal;
    if (stored?.kind === "reshuffle") clearInteractionRequest(store, record.id, record.version);
  }
}

export async function requestReshuffle(
  deps: RequestReshuffleDeps,
  input: RequestReshuffleInput,
): Promise<Result<RequestReshuffleOutput, YohError>> {
  if (input.request.kind !== "reflow-now") {
    return fail("validation", "That kind of change isn't available yet.");
  }
  const nowDate = deps.now();
  const nowMs = nowDate.getTime();
  const today = localIsoDate(nowDate, deps.timeZone);

  const stored = getPlan(deps.store, today);
  if (!stored) return fail("missing-field", "There's no Plan for today yet.");
  const plan = stored.data;

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
  const elapsedMinutes = (b: PlanBlock): number => {
    const start = Date.parse(b.start);
    const end = Date.parse(b.end);
    if (end <= nowMs) return (end - start) / MINUTE_MS;
    return start >= nowMs ? 0 : (nowMs - start) / MINUTE_MS;
  };
  const elapsedByTask = new Map<ExternalId, number>();
  const scheduledTaskIds = new Set<ExternalId>();
  let elapsedBudget = 0;
  for (const b of plan.blocks) {
    const e = elapsedMinutes(b);
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

  const school = computeSchoolDayInputs(events, today, deps.timeZone);
  if (!school.ok) return school;

  const refit = computeDayRefit({
    date: today,
    timeZone: deps.timeZone,
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

  const diff = diffPlanBlocks(plan.blocks, blocks);
  const titleOf = new Map(rawTasks.map((t) => [t.id, t.title]));
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const movedTitles = diff.movedBlockIds.map((id) => blockById.get(id)?.label ?? id);
  const deferredTitles = refit.value.deferredTaskIds.map((id) => titleOf.get(id) ?? id);

  const calendarVersion = calendarVersionHash(events);
  const preview: ReshufflePreview = {
    date: today,
    request: input.request,
    blocks,
    movedBlockIds: diff.movedBlockIds,
    deferredTaskIds: refit.value.deferredTaskIds,
    needsDataTaskIds,
    pins: [],
    drops: [],
    unplacedRoutineLabels: [],
    summary: buildReshuffleSummary({ movedTitles, deferredTitles, needsDataCount: needsDataTaskIds.length }),
    planVersion: plan.version,
    calendarVersion,
  };
  const createdAt = nowDate.toISOString();
  const proposal: Proposal<ReshufflePreview> = {
    id: `reshuffle-${today}-${nowMs}`,
    kind: "reshuffle",
    entityId: today,
    entityVersion: `${plan.version}:${calendarVersion}`,
    suggested: preview,
    reason: preview.summary,
    createdAt,
  };

  try {
    clearOpenReshuffleProposals(deps.store);
  } catch (err) {
    return fail("conflict", errorCopyForThrown(err), err);
  }
  const opened = await openProposal({ store: deps.store, now: deps.now }, { proposal });
  if (!opened.ok) return opened;
  return { ok: true, value: { proposal, question: opened.value } };
}
