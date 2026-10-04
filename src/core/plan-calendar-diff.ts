/**
 * src/core/plan-calendar-diff.ts
 *
 * Pure: turns what Spencer changed on the Yoh Plan calendar (events now vs the
 * snapshot Yoh last wrote) into Task pins, Routine pins and drops for the rest
 * of today. Only snapshot entries that end after `now` count.
 */
import type { ExternalId, IsoDate, IsoDateTime, PlanBlock, PlanCalendarSnapshotEntry, YohPlanEvent } from "../types/domain.ts";

export interface PlanCalendarDiffInput {
  readonly snapshot: readonly PlanCalendarSnapshotEntry[];
  readonly events: readonly YohPlanEvent[];
  readonly planBlocks: readonly PlanBlock[];
  readonly now: IsoDateTime;
  readonly date: IsoDate;
  /** Task titles, for a deleted block whose id is no longer in `planBlocks`. */
  readonly taskTitles?: ReadonlyMap<ExternalId, string>;
  /**
   * Event ids Google reports as deleted. When given, a snapshot entry missing from `events` counts as
   * Spencer's deletion only if its id is here; any other missing entry is treated as unchanged (a read
   * that lagged or omitted it). When absent, every missing entry counts as deleted.
   */
  readonly confirmedDeletedEventIds?: ReadonlySet<string>;
}

export interface PlanCalendarDiff {
  readonly taskPins: readonly { readonly taskId: ExternalId; readonly start: IsoDateTime; readonly durationMinutes: number }[];
  readonly routinePins: readonly { readonly routineId: string; readonly start: IsoDateTime }[];
  readonly drops: readonly ExternalId[];
  /** An untagged event landed on a future work or break block: re-fit around it without pinning anything. */
  readonly addedOverlap: boolean;
  readonly changed: boolean;
  readonly changedTitles: readonly string[];
}

const MINUTE_MS = 60_000;

export function diffPlanCalendar(input: PlanCalendarDiffInput): PlanCalendarDiff {
  const nowMs = Date.parse(input.now);
  const eventById = new Map(input.events.map((e) => [e.eventId, e]));
  // A missing entry that is not confirmed deleted stands in as an event still at its snapshot time.
  const confirmed = input.confirmedDeletedEventIds;
  const eventFor = (s: PlanCalendarSnapshotEntry): YohPlanEvent | undefined =>
    eventById.get(s.eventId) ?? (confirmed === undefined || confirmed.has(s.eventId) ? undefined : { eventId: s.eventId, blockId: s.blockId, title: "", start: s.start, end: s.end });
  const labelByBlock = new Map(input.planBlocks.map((b) => [b.id, b.label]));
  const future = input.snapshot.filter((s) => Date.parse(s.end) > nowMs);

  const changedTitles: string[] = [];
  const noteTitle = (title: string): void => {
    if (!changedTitles.includes(title)) changedTitles.push(title);
  };
  const moved = (s: PlanCalendarSnapshotEntry, e: YohPlanEvent): boolean => Date.parse(e.start) !== Date.parse(s.start) || Date.parse(e.end) !== Date.parse(s.end);

  // Work entries, grouped by Task in snapshot order.
  const byTask = new Map<ExternalId, PlanCalendarSnapshotEntry[]>();
  for (const s of future) {
    if (s.kind !== "work" || s.taskId === undefined) continue;
    byTask.set(s.taskId, [...(byTask.get(s.taskId) ?? []), s]);
  }
  const taskPins: { taskId: ExternalId; start: IsoDateTime; durationMinutes: number }[] = [];
  const drops: ExternalId[] = [];
  for (const [taskId, entries] of byTask) {
    let changed = false;
    const remaining: YohPlanEvent[] = [];
    for (const s of entries) {
      const e = eventFor(s);
      if (e === undefined) {
        changed = true;
        noteTitle(labelByBlock.get(s.blockId) ?? input.taskTitles?.get(taskId) ?? "a block");
      } else {
        remaining.push(e);
        if (moved(s, e)) {
          changed = true;
          noteTitle(e.title);
        }
      }
    }
    if (!changed) continue;
    if (remaining.length === 0) {
      drops.push(taskId);
      continue;
    }
    const startMs = Math.max(nowMs, Math.min(...remaining.map((e) => Date.parse(e.start))));
    const minutes = Math.round(remaining.reduce((sum, e) => sum + Math.max(0, Date.parse(e.end) - Math.max(Date.parse(e.start), nowMs)), 0) / MINUTE_MS);
    if (minutes <= 0) continue;
    taskPins.push({ taskId, start: new Date(startMs).toISOString(), durationMinutes: minutes });
  }

  // A routine that moved keeps its new start; deleted or resized-only is ignored.
  const routinePins: { routineId: string; start: IsoDateTime }[] = [];
  for (const s of future) {
    if (s.kind !== "routine" || s.routineId === undefined) continue;
    const e = eventFor(s);
    if (e === undefined || Date.parse(e.start) === Date.parse(s.start)) continue;
    routinePins.push({ routineId: s.routineId, start: new Date(e.start).toISOString() });
    noteTitle(e.title);
  }

  // Untagged events only decide whether to re-fit around them.
  const busyBlocks = input.planBlocks.filter((b) => (b.kind === "work" || b.kind === "break") && Date.parse(b.end) > nowMs);
  const addedOverlap = input.events.some(
    (e) =>
      e.blockId === undefined &&
      busyBlocks.some((b) => Date.parse(e.start) < Date.parse(b.end) && Date.parse(e.end) > Date.parse(b.start)),
  );

  return {
    taskPins,
    routinePins,
    drops,
    addedOverlap,
    changed: taskPins.length > 0 || routinePins.length > 0 || drops.length > 0 || addedOverlap,
    changedTitles,
  };
}
