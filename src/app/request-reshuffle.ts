/**
 * src/app/request-reshuffle.ts
 *
 * Builds a preview of the re-fitted rest of today from the stored Plan, the
 * live calendar and the open Tasks, and opens it as the one open `reshuffle`
 * proposal. Writes nothing to Calendar or to the stored Plan; applying the
 * proposal is `confirm-proposal`'s job.
 */
import { clearInteractionRequest, getPlan, type MemoryStore } from "../adapters/memory-store.ts";
import { listOpenReshuffleProposals } from "../adapters/reshuffle-proposal-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import type { MissingFieldReport } from "../core/data-completeness-gate.ts";
import { PLANNING_FIELD_LABELS } from "../core/planning-field-value.ts";
import { buildReshuffleSummary, calendarVersionHash, diffPlanBlocks } from "../core/reshuffle-preview.ts";
import { refitToday, type DayChange, type DayRefitDeps } from "../rituals/day-refit-inputs.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import { openProposal } from "./open-proposal.ts";
import type { OpenItemQuestion } from "../types/api.ts";
import type {
  DayPin,
  ExternalId,
  IsoDate,
  PlanBlock,
  Proposal,
  ReshufflePreview,
  ReshuffleRequest,
  Result,
  YohError,
} from "../types/domain.ts";

export type RequestReshuffleDeps = DayRefitDeps;

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
const isRoutinePin = (pin: DayPin, routineId: string): boolean => pin.subject.kind === "routine" && pin.subject.routineId === routineId;

/** Resolves a request to the day's pins and drops after it is applied; a failure is the Result to return. */
function resolveRequest(
  request: ReshuffleRequest,
  current: DayChange,
  ctx: { readonly today: IsoDate; readonly nowMs: number; readonly timeZone: string; readonly plan: { readonly blocks: readonly PlanBlock[] }; readonly openIds: ReadonlySet<ExternalId>; readonly incomplete: ReadonlyMap<ExternalId, MissingFieldReport> },
): Result<DayChange, YohError> {
  const without = (taskId: ExternalId): DayPin[] => current.pins.filter((p) => taskSubject(p) !== taskId);
  const pinAt = (taskId: ExternalId, start: string): Result<DayChange, YohError> => {
    const startMs = Date.parse(start);
    const missing = ctx.incomplete.get(taskId);
    if (missing) {
      const labels = missing.missingFields.map((f) => PLANNING_FIELD_LABELS[f]).join(" and ");
      return fail("validation", `${missing.taskTitle} needs ${labels} before I can place it.`);
    }
    if (!ctx.openIds.has(taskId)) return fail("validation", "That Task isn't open for today, so I can't place it.");
    if (startMs < ctx.nowMs || localIsoDate(new Date(startMs), ctx.timeZone) !== ctx.today) {
      return fail("validation", "Pick a time later today.");
    }
    // A length Spencer set for a pin that hasn't started moves with the Task.
    const earlier = current.pins.find((p) => taskSubject(p) === taskId);
    const keptMinutes = earlier && Date.parse(earlier.start) >= ctx.nowMs ? earlier.durationMinutes : undefined;
    const pin: DayPin = { date: ctx.today, subject: { kind: "task", taskId }, start: new Date(startMs).toISOString(), ...(keptMinutes !== undefined ? { durationMinutes: keptMinutes } : {}) };
    return { ok: true, value: { pins: [...without(taskId), pin], drops: current.drops.filter((d) => d !== taskId), requested: [taskId] } };
  };
  const pinRoutineAt = (routineId: string, start: string): Result<DayChange, YohError> => {
    const startMs = Date.parse(start);
    if (startMs < ctx.nowMs || localIsoDate(new Date(startMs), ctx.timeZone) !== ctx.today) return fail("validation", "Pick a time later today.");
    const pin: DayPin = { date: ctx.today, subject: { kind: "routine", routineId }, start: new Date(startMs).toISOString() };
    return { ok: true, value: { pins: [...current.pins.filter((p) => !isRoutinePin(p, routineId)), pin], drops: current.drops } };
  };
  const upcoming = (b: PlanBlock): boolean => Date.parse(b.start) >= ctx.nowMs;
  switch (request.kind) {
    case "reflow-now":
      return { ok: true, value: current };
    case "pin-task":
      return pinAt(request.taskId, request.newStart);
    case "move-block": {
      const block = ctx.plan.blocks.find((b) => b.id === request.planBlockId);
      if (!block) return fail("stale-proposal", "That block has changed. Try dragging it again.");
      if (block.kind === "routine" && block.routineId !== undefined && upcoming(block)) return pinRoutineAt(block.routineId, request.newStart);
      if (block.kind !== "work" || block.taskId === undefined || !upcoming(block)) {
        return fail("validation", "That block can't be moved.");
      }
      return pinAt(block.taskId, request.newStart);
    }
    case "pin-routine": {
      if (!ctx.plan.blocks.some((b) => b.kind === "routine" && b.routineId === request.routineId && upcoming(b))) return fail("validation", "That block can't be moved.");
      return pinRoutineAt(request.routineId, request.newStart);
    }
    case "resize-task": {
      // The Task stays where it sits: its pin if it has one that hasn't started, else its first block still to come.
      const earlier = current.pins.find((p) => taskSubject(p) === request.taskId);
      const block = ctx.plan.blocks.filter((b) => b.kind === "work" && b.taskId === request.taskId && upcoming(b)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
      const start = earlier && Date.parse(earlier.start) >= ctx.nowMs ? earlier.start : block?.start;
      if (start === undefined || !Number.isInteger(request.durationMinutes) || request.durationMinutes < 1) return fail("validation", "That block can't be resized.");
      const placed = pinAt(request.taskId, start);
      if (!placed.ok) return placed;
      return { ok: true, value: { ...placed.value, pins: placed.value.pins.map((p) => (taskSubject(p) === request.taskId ? { ...p, durationMinutes: request.durationMinutes } : p)) } };
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

  const result = await refitToday(deps, {
    plan,
    now: nowDate,
    resolveDay: (ctx) =>
      resolveRequest(input.request, ctx.currentDay, {
        today,
        nowMs,
        timeZone: deps.timeZone,
        plan,
        openIds: ctx.openIds,
        incomplete: ctx.incomplete,
      }),
  });
  if (!result.ok) return result;
  const { rawTasks, events, needsDataTaskIds, currentDay, day, refit } = result.value;
  const rejectedReason = refit.rejectedReason;
  // A request that cannot be honored is a plain failure, not a proposal to approve.
  if (rejectedReason !== undefined) return { ok: false, error: { kind: "validation", message: rejectedReason } };
  const released = refit.releasedPins ?? [];
  const releasedIds = new Set(released.map((r) => r.taskId));
  const keptPins = day.pins.filter((p) => !(p.subject.kind === "task" && releasedIds.has(p.subject.taskId)));

  // A rejected request leaves the day exactly as stored.
  const blocks = rejectedReason !== undefined ? plan.blocks : result.value.blocks;

  const diff = diffPlanBlocks(plan.blocks, blocks);
  const titleOf = new Map(rawTasks.map((t) => [t.id, t.title]));
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const movedTitles = diff.movedBlockIds.map((id) => blockById.get(id)?.label ?? id);
  const deferredTaskIds = rejectedReason !== undefined ? [] : refit.deferredTaskIds;
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
    unplacedRoutineLabels: rejectedReason !== undefined ? (plan.unplacedRoutineLabels ?? []) : (refit.unplacedRoutineLabels ?? []),
    ...(rejectedReason !== undefined ? { rejectedReason } : {}),
    summary:
      rejectedReason ??
      [...released.map((r) => `Unpinned ${r.title} — ${r.reason}.`), buildReshuffleSummary({ movedTitles, deferredTitles, needsDataCount: needsDataTaskIds.length, unplacedRoutineLabels: refit.unplacedRoutineLabels ?? [] })].join(" "),
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
