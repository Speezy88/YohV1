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
import { PLAN_CALENDAR_WRITE_FRESH_MS, type PlanCalendarWriteState } from "../adapters/plan-calendar-snapshot-store.ts";
import { listDayDrops, listDayPins, replaceDayPinsAndDropsInTx } from "../adapters/plan-state-store.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import type { LogEntry } from "../adapters/logger.ts";
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
  /** Events on the Yoh Plan calendar for today, with the plan block each was written from; `undefined` when there is no Yoh Plan calendar id yet (never read as "everything deleted"). */
  readonly readYohPlanEvents: () => Promise<readonly YohPlanEvent[] | undefined>;
  /** Ids of today's Yoh Plan events Google reports as deleted (cancelled); read only when every tagged event is missing. */
  readonly readDeletedYohPlanEventIds?: () => Promise<readonly string[]>;
  readonly log?: (entry: LogEntry) => void;
  /** What Yoh last wrote to the Yoh Plan calendar for `date`. */
  readonly readPlanCalendarSnapshot: (date: string) => readonly PlanCalendarSnapshotEntry[];
  /** Whether Yoh is (or just was) writing the calendar for `date`; omitted means no guard. */
  readonly readPlanCalendarWriteState?: (date: string) => PlanCalendarWriteState;
}

export type SyncPlanFromCalendarInput = Record<string, never>;

export type SyncPlanFromCalendarOutput = {
  readonly status: "no-plan" | "unchanged" | "applied" | "skipped-conflict";
  readonly calendarFailedBlockIds?: readonly string[];
};

const MINUTE_MS = 60_000;
const subjectKey = (p: DayPin): string => (p.subject.kind === "task" ? `t:${p.subject.taskId}` : `r:${p.subject.routineId}`);
/** The pin's end when it has a length; an in-progress pin's start is clamped to now, so its end is the stable part. */
const pinEndMs = (p: DayPin): number | undefined => (p.durationMinutes === undefined ? undefined : Date.parse(p.start) + p.durationMinutes * MINUTE_MS);
const samePin = (a: DayPin, b: DayPin, nowMs: number): boolean => {
  if (subjectKey(a) !== subjectKey(b)) return false;
  if (Date.parse(a.start) === Date.parse(b.start) && a.durationMinutes === b.durationMinutes) return true;
  const [ea, eb] = [pinEndMs(a), pinEndMs(b)];
  const underWay = Math.min(Date.parse(a.start), Date.parse(b.start)) <= nowMs;
  return underWay && ea !== undefined && eb !== undefined && Math.abs(ea - eb) <= MINUTE_MS;
};
const samePins = (a: readonly DayPin[], b: readonly DayPin[], nowMs: number): boolean => {
  if (a.length !== b.length) return false;
  const rest = [...b];
  for (const p of a) {
    const i = rest.findIndex((q) => samePin(p, q, nowMs));
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  return true;
};
const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/** Logged when a Plan event is missing from the calendar and Google has not confirmed a deletion. */
export const PLAN_SYNC_MISSING_UNCONFIRMED_EVENT = "plan-sync.missing-unconfirmed";

const NOTIFICATION_TITLE = "Your day is re-fit around your calendar change";

export async function syncPlanFromCalendar(
  deps: SyncPlanFromCalendarDeps,
  _input: SyncPlanFromCalendarInput,
): Promise<Result<SyncPlanFromCalendarOutput, YohError>> {
  const nowDate = deps.now();
  const today = localIsoDate(nowDate, deps.timeZone);

  const stored = getPlan(deps.store, today);
  if (!stored) return { ok: true, value: { status: "no-plan" } };
  const plan = stored.data;

  // Yoh's own in-flight calendar write must not read as Spencer's edit.
  const nowMs = nowDate.getTime();
  const writing = (w: PlanCalendarWriteState): boolean => w.writingSince !== undefined && nowMs - Date.parse(w.writingSince) < PLAN_CALENDAR_WRITE_FRESH_MS;
  let events: readonly YohPlanEvent[] | undefined;
  let snapshot: readonly PlanCalendarSnapshotEntry[];
  try {
    const before = deps.readPlanCalendarWriteState?.(today) ?? {};
    if (writing(before)) return { ok: true, value: { status: "unchanged" } };
    if (before.writingSince !== undefined) {
      // A writer that died mid-write left the snapshot untrustworthy: don't diff, rewrite the calendar from the stored Plan.
      if (deps.writeCalendarPlan) {
        try {
          await deps.writeCalendarPlan(plan.blocks.filter((b) => b.kind !== "calendar-anchor"));
        } catch {
          // The marker stays stale; the next sync retries the rewrite.
        }
      }
      return { ok: true, value: { status: "unchanged" } };
    }
    events = await deps.readYohPlanEvents();
    snapshot = deps.readPlanCalendarSnapshot(today);
    const after = deps.readPlanCalendarWriteState?.(today) ?? {};
    if (writing(after) || after.writtenAt !== before.writtenAt) return { ok: true, value: { status: "unchanged" } };
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err), detail: err } };
  }
  // No Yoh Plan calendar yet: there is nothing to compare against.
  if (events === undefined) return { ok: true, value: { status: "unchanged" } };
  // Snapshot has future work but the calendar has no Yoh events at all: a mass deletion only when Google
  // confirms every missing event as deleted; otherwise a read anomaly.
  const future = snapshot.filter((s) => Date.parse(s.end) > nowMs);
  // A snapshot entry missing from the read is Spencer's deletion only when Google lists it as deleted;
  // a list that lags an insert or omits one event must not drop a Task.
  const presentIds = new Set(events.map((e) => e.eventId));
  let deleted: ReadonlySet<string> = new Set();
  if (future.some((s) => !presentIds.has(s.eventId))) {
    try {
      deleted = new Set((await deps.readDeletedYohPlanEventIds?.()) ?? []);
    } catch {
      // Treated as unconfirmed.
    }
  }
  if (!events.some((e) => e.blockId !== undefined) && future.length > 0 && !future.every((s) => deleted.has(s.eventId))) {
    deps.log?.({ level: "warn", event: "plan-sync.no-tagged-events", detail: { date: today, snapshotEntries: snapshot.length } });
    return { ok: true, value: { status: "unchanged" } };
  }
  // A missing event Google has not confirmed as deleted stays in the Plan; say so, since nothing else shows it.
  const unconfirmed = future.filter((e) => !presentIds.has(e.eventId) && !deleted.has(e.eventId)).length;
  if (unconfirmed > 0) deps.log?.({ level: "warn", event: PLAN_SYNC_MISSING_UNCONFIRMED_EVENT, detail: { date: today, events: unconfirmed } });

  const diff = diffPlanCalendar({ snapshot, events, planBlocks: plan.blocks, now: nowDate.toISOString(), date: today, confirmedDeletedEventIds: deleted });
  if (!diff.changed) return { ok: true, value: { status: "unchanged" } };

  // Merge the new pins and drops into the day's stored ones.
  const storedPins = deps.store.withDb((db) => listDayPins(db, today));
  const storedDrops = deps.store.withDb((db) => listDayDrops(db, today));
  const pinnedTaskIds = new Set<ExternalId>(diff.taskPins.map((p) => p.taskId));
  const pinnedRoutineIds = new Set(diff.routinePins.map((p) => p.routineId));
  const mergedDrops = [...new Set([...storedDrops.filter((d) => !pinnedTaskIds.has(d)), ...diff.drops])];
  const mergedPins: DayPin[] = [
    ...storedPins.filter((p) =>
      p.subject.kind === "task" ? !pinnedTaskIds.has(p.subject.taskId) && !mergedDrops.includes(p.subject.taskId) : !pinnedRoutineIds.has(p.subject.routineId),
    ),
    ...diff.taskPins.map((p): DayPin => ({ date: today, subject: { kind: "task", taskId: p.taskId }, start: p.start, durationMinutes: p.durationMinutes })),
    ...diff.routinePins.map((p): DayPin => ({ date: today, subject: { kind: "routine", routineId: p.routineId }, start: p.start })),
  ];
  // Nothing new to apply (e.g. the calendar write failed or the snapshot lags): stay quiet.
  if (!diff.addedOverlap && samePins(mergedPins, storedPins, nowMs) && sameIds(mergedDrops, storedDrops)) return { ok: true, value: { status: "unchanged" } };

  // A colliding pin from a sync is released by the refit, never a rejection.
  const result = await refitToday(deps, { plan, now: nowDate, resolveDay: () => ({ ok: true, value: { pins: mergedPins, drops: mergedDrops, requested: [] } }) });
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
  const changedTitles = diffPlanCalendar({ snapshot, events, planBlocks: plan.blocks, now: nowDate.toISOString(), date: today, taskTitles: titleOf, confirmedDeletedEventIds: deleted }).changedTitles;
  const summary = [
    ...(changedTitles.length > 0 ? [`You changed ${changedTitles.slice(0, 3).join(", ")}${changedTitles.length > 3 ? `, +${changedTitles.length - 3} more` : ""}.`] : []),
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
