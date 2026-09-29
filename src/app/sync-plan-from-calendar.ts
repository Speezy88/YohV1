/**
 * src/app/sync-plan-from-calendar.ts
 *
 * Reads what Spencer changed on the Yoh Plan calendar since Yoh last wrote it,
 * turns that into pins and drops, re-fits the rest of today and applies the
 * result directly (his edit is the instruction; there is no proposal), then
 * rewrites the calendar. Writes nothing to Notion. A snapshot that matches the
 * calendar is a no-op with no write and no hint.
 */
import { getPlan, PLAN_TOPIC, putPlan, ConflictError, type MemoryStore } from "../adapters/memory-store.ts";
import { appendOutboxInTx, createNotificationInTx } from "../adapters/notification-store.ts";
import { replaceDayPinsAndDropsInTx } from "../adapters/plan-state-store.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { diffPlanCalendar } from "../core/plan-calendar-diff.ts";
import { buildReshuffleSummary, diffPlanBlocks } from "../core/reshuffle-preview.ts";
import { refitToday } from "../rituals/day-refit-inputs.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { RequestReshuffleDeps } from "./request-reshuffle.ts";
import type { DayPin, ExternalId, PlanBlock, PlanCalendarSnapshotEntry, Result, YohError, YohPlanEvent } from "../types/domain.ts";

export interface SyncPlanFromCalendarDeps extends RequestReshuffleDeps {
  readonly connection: SqliteConnection;
  /** `writeTodaysPlanToCalendar`, pre-bound. Receives only non-anchor blocks; returns per-block outcome. */
  readonly writeCalendarPlan?: (blocks: readonly PlanBlock[]) => Promise<{ readonly written: readonly string[]; readonly failed: readonly string[] }>;
  /** Events on the Yoh Plan calendar for today, with the plan block each was written from. */
  readonly readYohPlanEvents: () => Promise<readonly YohPlanEvent[]>;
  /** What Yoh last wrote to the Yoh Plan calendar for `date`. */
  readonly readPlanCalendarSnapshot: (date: string) => readonly PlanCalendarSnapshotEntry[];
}

export type SyncPlanFromCalendarInput = Record<string, never>;

export type SyncPlanFromCalendarOutput = {
  readonly status: "no-plan" | "unchanged" | "applied" | "skipped-conflict";
  readonly calendarFailedBlockIds?: readonly string[];
};

const NOTIFICATION_TITLE = "Re-fit your day around your calendar change";

export async function syncPlanFromCalendar(
  deps: SyncPlanFromCalendarDeps,
  _input: SyncPlanFromCalendarInput,
): Promise<Result<SyncPlanFromCalendarOutput, YohError>> {
  const nowDate = deps.now();
  const today = localIsoDate(nowDate, deps.timeZone);

  const stored = getPlan(deps.store, today);
  if (!stored) return { ok: true, value: { status: "no-plan" } };
  const plan = stored.data;

  let events: readonly YohPlanEvent[];
  let snapshot: readonly PlanCalendarSnapshotEntry[];
  try {
    events = await deps.readYohPlanEvents();
    snapshot = deps.readPlanCalendarSnapshot(today);
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err), detail: err } };
  }

  const diff = diffPlanCalendar({ snapshot, events, planBlocks: plan.blocks, now: nowDate.toISOString(), date: today });
  if (!diff.changed) return { ok: true, value: { status: "unchanged" } };

  const pinnedTaskIds = new Set<ExternalId>(diff.taskPins.map((p) => p.taskId));
  const pinnedRoutineIds = new Set(diff.routinePins.map((p) => p.routineId));
  const result = await refitToday(deps, {
    plan,
    resolveDay: ({ currentDay }) => {
      const kept = currentDay.pins.filter((p) =>
        p.subject.kind === "task" ? !pinnedTaskIds.has(p.subject.taskId) : !pinnedRoutineIds.has(p.subject.routineId),
      );
      const fresh: DayPin[] = [
        ...diff.taskPins.map((p): DayPin => ({ date: today, subject: { kind: "task", taskId: p.taskId }, start: p.start, durationMinutes: p.durationMinutes })),
        ...diff.routinePins.map((p): DayPin => ({ date: today, subject: { kind: "routine", routineId: p.routineId }, start: p.start })),
      ];
      const drops = [...new Set([...currentDay.drops.filter((d) => !pinnedTaskIds.has(d)), ...diff.drops])];
      // A colliding pin from a sync is released by the refit, never a rejection.
      return { ok: true, value: { pins: [...kept, ...fresh], drops, requested: [] } };
    },
  });
  if (!result.ok) return result;
  const { blocks, day, refit, rawTasks } = result.value;

  const released = refit.releasedPins ?? [];
  const releasedIds = new Set(released.map((r) => r.taskId));
  const keptPins = day.pins.filter((p) => !(p.subject.kind === "task" && releasedIds.has(p.subject.taskId)));

  const titleOf = new Map(rawTasks.map((t) => [t.id, t.title]));
  const blockDiff = diffPlanBlocks(plan.blocks, blocks);
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const movedTitles = blockDiff.movedBlockIds.map((id) => blockById.get(id)?.label ?? id);
  const deferredTitles = refit.deferredTaskIds.map((id) => titleOf.get(id) ?? id);
  const summary = [
    ...(diff.changedTitles.length > 0 ? [`You changed ${diff.changedTitles.slice(0, 3).join(", ")}${diff.changedTitles.length > 3 ? `, +${diff.changedTitles.length - 3} more` : ""}.`] : []),
    ...released.map((r) => `Unpinned ${r.title} — ${r.reason}.`),
    buildReshuffleSummary({ movedTitles, deferredTitles, needsDataCount: result.value.needsDataTaskIds.length, unplacedRoutineLabels: refit.unplacedRoutineLabels ?? [] }),
  ].join(" ");

  const nowIso = nowDate.toISOString();
  const nextPlan = { ...plan, blocks, unplacedRoutineLabels: refit.unplacedRoutineLabels ?? [], version: plan.version + 1, updatedAt: nowIso };
  // The re-fit awaited I/O; if the Plan moved on meanwhile, skip and let the next sync retry.
  if (getPlan(deps.store, today)?.data.version !== plan.version) return { ok: true, value: { status: "skipped-conflict" } };
  try {
    putPlan(deps.store, nextPlan, (db) => {
      replaceDayPinsAndDropsInTx(db, today, keptPins, day.drops);
      appendOutboxInTx(db, { topic: PLAN_TOPIC, entityId: today });
      createNotificationInTx(db, { kind: "plan-calendar-synced", title: NOTIFICATION_TITLE, body: summary, deepLink: "home", createdAt: nowIso });
    });
  } catch (err) {
    if (err instanceof ConflictError) return { ok: true, value: { status: "skipped-conflict" } };
    return { ok: false, error: { kind: "conflict", message: errorCopyForThrown(err), detail: err } };
  }

  const toSync = blocks.filter((b) => b.kind !== "calendar-anchor");
  let failedIds: readonly string[] = [];
  if (deps.writeCalendarPlan) {
    try {
      failedIds = (await deps.writeCalendarPlan(toSync)).failed;
    } catch {
      failedIds = toSync.map((b) => b.id);
    }
  }
  if (failedIds.length > 0) {
    try {
      deps.connection.writeTx((db) =>
        createNotificationInTx(db, {
          kind: "reshuffle-apply-failed",
          title: "Couldn't update your calendar",
          body: "Your Plan is updated, but I couldn't update your calendar for some blocks. Open Home to see the current Plan.",
          deepLink: "home",
          createdAt: nowIso,
        }),
      );
    } catch {
      // The failed ids are still returned to the caller.
    }
  }
  return { ok: true, value: { status: "applied", calendarFailedBlockIds: failedIds } };
}
