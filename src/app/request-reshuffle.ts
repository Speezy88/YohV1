/**
 * src/app/request-reshuffle.ts
 *
 * Builds a preview of the re-fitted rest of today from the stored Plan, the
 * live calendar and the open Tasks, and opens it as the one open `reshuffle`
 * proposal. Writes nothing to Calendar or to the stored Plan; applying the
 * proposal is `confirm-proposal`'s job.
 */
import { clearInteractionRequest, getCurrentTimeBudget, getPlan, type MemoryStore } from "../adapters/memory-store.ts";
import { listDayDrops, listDayPins } from "../adapters/plan-state-store.ts";
import { listOpenReshuffleProposals } from "../adapters/reshuffle-proposal-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { isOpenTask } from "../core/planning-field-value.ts";
import { buildReshuffleSummary, calendarVersionHash, diffPlanBlocks } from "../core/reshuffle-preview.ts";
import { runDataCompletenessGate } from "../rituals/data-completeness.ts";
import { computeDayRefit, computeSchoolDayInputs, elapsedMinutesWithinBlock } from "../rituals/reshuffle.ts";
import { computeBumpLevels, localIsoDate, missingRefiningFor } from "../rituals/ritual-shared.ts";
import { openProposal } from "./open-proposal.ts";
import type { OpenItemQuestion } from "../types/api.ts";
import type {
  CalendarEvent,
  CompleteTask,
  DayPin,
  ExternalId,
  IsoDate,
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

function fail(kind: YohError["kind"], message: string, detail?: unknown): Result<never, YohError> {
  return { ok: false, error: { kind, message, ...(detail !== undefined ? { detail } : {}) } };
}

function clearOpenReshuffleProposals(store: MemoryStore): void {
  for (const open of listOpenReshuffleProposals(store)) clearInteractionRequest(store, open.requestId, open.requestVersion);
}

const taskSubject = (pin: DayPin): ExternalId | undefined => (pin.subject.kind === "task" ? pin.subject.taskId : undefined);

interface DayChange {
  readonly pins: readonly DayPin[];
  readonly drops: readonly ExternalId[];
  /** Tasks whose pin this request itself sets; only these may reject the preview. */
  readonly requested?: readonly ExternalId[];
}

/** Resolves a request to the day's pins and drops after it is applied; a failure is the Result to return. */
function resolveRequest(
  request: ReshuffleRequest,
  current: DayChange,
  ctx: { readonly today: IsoDate; readonly nowMs: number; readonly timeZone: string; readonly plan: { readonly blocks: readonly PlanBlock[] }; readonly openIds: ReadonlySet<ExternalId> },
): Result<DayChange, YohError> {
  const without = (taskId: ExternalId): DayPin[] => current.pins.filter((p) => taskSubject(p) !== taskId);
  const pinAt = (taskId: ExternalId, start: string): Result<DayChange, YohError> => {
    const startMs = Date.parse(start);
    if (!ctx.openIds.has(taskId)) return fail("validation", "That Task isn't open for today, so I can't place it.");
    if (startMs < ctx.nowMs || localIsoDate(new Date(startMs), ctx.timeZone) !== ctx.today) {
      return fail("validation", "Pick a time later today.");
    }
    const pin: DayPin = { date: ctx.today, subject: { kind: "task", taskId }, start: new Date(startMs).toISOString() };
    return { ok: true, value: { pins: [...without(taskId), pin], drops: current.drops.filter((d) => d !== taskId), requested: [taskId] } };
  };
  switch (request.kind) {
    case "reflow-now":
      return { ok: true, value: current };
    case "pin-task":
      return pinAt(request.taskId, request.newStart);
    case "move-block": {
      const block = ctx.plan.blocks.find((b) => b.id === request.planBlockId);
      if (!block) return fail("stale-proposal", "That block has changed. Try dragging it again.");
      if (block.kind !== "work" || block.taskId === undefined || Date.parse(block.start) < ctx.nowMs) {
        return fail("validation", "That block can't be moved.");
      }
      return pinAt(block.taskId, request.newStart);
    }
    case "unpin-task":
      return { ok: true, value: { pins: without(request.taskId), drops: current.drops.filter((d) => d !== request.taskId) } };
    case "drop-task":
      return { ok: true, value: { pins: without(request.taskId), drops: current.drops.includes(request.taskId) ? current.drops : [...current.drops, request.taskId] } };
    case "swap": {
      const removed = ctx.plan.blocks.find((b) => b.kind === "work" && b.taskId === request.removeTaskId && Date.parse(b.start) >= ctx.nowMs);
      const start = removed?.start ?? new Date(ctx.nowMs).toISOString();
      const added = pinAt(request.addTaskId, start);
      if (!added.ok) return added;
      return {
        ok: true,
        value: {
          pins: added.value.pins.filter((p) => taskSubject(p) !== request.removeTaskId),
          drops: added.value.drops.includes(request.removeTaskId) ? added.value.drops : [...added.value.drops, request.removeTaskId],
          requested: [request.addTaskId],
        },
      };
    }
  }
}

export async function requestReshuffle(
  deps: RequestReshuffleDeps,
  input: RequestReshuffleInput,
): Promise<Result<RequestReshuffleOutput, YohError>> {
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

  const school = computeSchoolDayInputs(events, today, deps.timeZone);
  if (!school.ok) return school;

  const currentDay: DayChange = {
    pins: deps.store.withDb((db) => listDayPins(db, today)),
    drops: deps.store.withDb((db) => listDayDrops(db, today)),
  };
  const resolved = resolveRequest(input.request, currentDay, {
    today,
    nowMs,
    timeZone: deps.timeZone,
    plan,
    openIds: new Set(outstanding.map((t) => t.id)),
  });
  if (!resolved.ok) return resolved;
  const day = resolved.value;

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
    pins: day.pins,
    drops: day.drops,
    requestPinTaskIds: day.requested ?? [],
    bumpLevels: computeBumpLevels(deps.store),
    idPrefix: `v${plan.version + 1}`,
  });
  if (!refit.ok) return refit;
  const rejectedReason = refit.value.rejectedReason;
  const released = refit.value.releasedPins ?? [];
  const releasedIds = new Set(released.map((r) => r.taskId));
  const keptPins = day.pins.filter((p) => !(p.subject.kind === "task" && releasedIds.has(p.subject.taskId)));

  const outstandingById = new Map(outstanding.map((t) => [t.id, t]));
  const fittedTagged = new Map(
    refit.value.fittedBlocks.map((b) => {
      const missing = b.kind === "work" && b.taskId !== undefined ? missingRefiningFor(outstandingById.get(b.taskId)!) : undefined;
      return [b.id, missing ? { ...b, missingRefining: missing } : b] as const;
    }),
  );
  // A rejected request leaves the day exactly as stored.
  const blocks = rejectedReason !== undefined ? plan.blocks : refit.value.blocks.map((b) => fittedTagged.get(b.id) ?? b);

  const diff = diffPlanBlocks(plan.blocks, blocks);
  const titleOf = new Map(rawTasks.map((t) => [t.id, t.title]));
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const movedTitles = diff.movedBlockIds.map((id) => blockById.get(id)?.label ?? id);
  const deferredTaskIds = rejectedReason !== undefined ? [] : refit.value.deferredTaskIds;
  const deferredTitles = deferredTaskIds.map((id) => titleOf.get(id) ?? id);

  const calendarVersion = calendarVersionHash(events);
  const preview: ReshufflePreview = {
    date: today,
    request: input.request,
    blocks,
    movedBlockIds: diff.movedBlockIds,
    deferredTaskIds,
    needsDataTaskIds,
    pins: rejectedReason !== undefined ? currentDay.pins : keptPins,
    drops: rejectedReason !== undefined ? currentDay.drops : day.drops,
    unplacedRoutineLabels: [],
    ...(rejectedReason !== undefined ? { rejectedReason } : {}),
    summary:
      rejectedReason ??
      [...released.map((r) => `Unpinned ${r.title} — ${r.reason}.`), buildReshuffleSummary({ movedTitles, deferredTitles, needsDataCount: needsDataTaskIds.length })].join(" "),
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
