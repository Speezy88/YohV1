/**
 * src/core/desk-metrics.ts
 *
 * Epic 12: the Desk page's metrics, pure functions over plain rows. Dates are
 * local dates in the host timezone. Nothing here reads a clock: callers pass
 * `today` / `now`.
 */
import type { DeskCompletedItem, DeskHeatmapDay } from "../types/api.ts";
import type { IsoDate, IsoDateTime } from "../types/domain.ts";
import { localIsoDate } from "./local-time.ts";
import { costForRow, type LlmUsageCostRow } from "./llm-cost.ts";

/** The heatmap's width in week columns (Ruling E12-R5). */
export const DESK_HEATMAP_WEEKS = 26;
/** Completions per day at which the heatmap level reaches 2, 3 and 4. */
export const DESK_HEATMAP_LEVEL_2_MIN = 1;
export const DESK_HEATMAP_LEVEL_3_MIN = 3;
export const DESK_HEATMAP_LEVEL_4_MIN = 5;

/** One completion, as the metrics read it. */
export interface DeskCompletionRow {
  readonly taskName: string;
  readonly dueDate: IsoDate | null;
  readonly estimatedMinutes: number | null;
  readonly completedAt: IsoDateTime;
}

/** One Claude API call: the cost fields plus when it happened. */
export interface DeskUsageRow extends LlmUsageCostRow {
  readonly at: string;
}

const DAY_MS = 86_400_000;
const dayMs = (d: IsoDate): number => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: IsoDate, n: number): IsoDate => new Date(dayMs(d) + n * DAY_MS).toISOString().slice(0, 10);
/**
 * One formatter per call of a metric (not per row), returning each instant's local date, or null when the
 * instant does not parse: such a row is skipped, never thrown on. A bad `timeZone` still throws, on creation.
 */
function localDateReader(timeZone: string): (instant: string) => IsoDate | null {
  const format = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (instant) => {
    const ms = Date.parse(instant);
    if (Number.isNaN(ms)) return null;
    const parts = format.formatToParts(new Date(ms));
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
}

/** Every completion whose local date is `today`, newest first. */
export function completedToday(rows: readonly DeskCompletionRow[], today: IsoDate, timeZone: string): DeskCompletedItem[] {
  const localDateOf = localDateReader(timeZone);
  return rows
    .filter((r) => localDateOf(r.completedAt) === today)
    .map((r) => ({ taskName: r.taskName, completedAt: r.completedAt }))
    .sort((a, b) => (a.completedAt < b.completedAt ? 1 : a.completedAt > b.completedAt ? -1 : 0));
}

/** Estimated minutes of today's completions; a null estimate adds 0. */
export function minutesToday(rows: readonly DeskCompletionRow[], today: IsoDate, timeZone: string): number {
  const localDateOf = localDateReader(timeZone);
  return rows.filter((r) => localDateOf(r.completedAt) === today).reduce((sum, r) => sum + (r.estimatedMinutes ?? 0), 0);
}

/** Estimated minutes over every completion, as whole hours. */
export function hoursWithYoh(rows: readonly DeskCompletionRow[]): number {
  return Math.round(rows.reduce((sum, r) => sum + (r.estimatedMinutes ?? 0), 0) / 60);
}

/** Of completions that have a due date, how many finished on or before it. */
export function onTimeRate(rows: readonly DeskCompletionRow[], timeZone: string): { onTime: number; counted: number; percent: number | null } {
  const localDateOf = localDateReader(timeZone);
  let counted = 0;
  let onTime = 0;
  for (const r of rows) {
    if (r.dueDate === null) continue;
    const done = localDateOf(r.completedAt);
    if (done === null) continue;
    counted += 1;
    if (done <= r.dueDate) onTime += 1;
  }
  return { onTime, counted, percent: counted === 0 ? null : Math.round((onTime / counted) * 100) };
}

/**
 * Ruling E12-R2: a streak day has a Plan and a finished night close-out.
 * Current = the run ending today, or yesterday when today is not (yet) a
 * streak day. Any other gap ends a run.
 */
export function streakOf(planDates: readonly IsoDate[], closeOutDates: readonly IsoDate[], today: IsoDate): { current: number; longest: number } {
  const plans = new Set(planDates);
  const days = new Set(closeOutDates.filter((d) => plans.has(d)));
  let current = 0;
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) current += 1;
  let longest = 0;
  for (const d of days) {
    if (days.has(addDays(d, -1))) continue; // not the start of a run
    let n = 0;
    for (let e = d; days.has(e); e = addDays(e, 1)) n += 1;
    longest = Math.max(longest, n);
  }
  return { current, longest };
}

function levelFor(completed: number, active: boolean): DeskHeatmapDay["level"] {
  if (completed >= DESK_HEATMAP_LEVEL_4_MIN) return 4;
  if (completed >= DESK_HEATMAP_LEVEL_3_MIN) return 3;
  if (completed >= DESK_HEATMAP_LEVEL_2_MIN) return 2;
  return active ? 1 : 0;
}

/** Ruling E12-R5: `DESK_HEATMAP_WEEKS` Sunday-start columns ending with today's week; no day after today. */
export function heatmapWeeks(rows: readonly DeskCompletionRow[], activityDates: readonly IsoDate[], today: IsoDate, timeZone: string): DeskHeatmapDay[][] {
  const localDateOf = localDateReader(timeZone);
  const counts = new Map<IsoDate, number>();
  for (const r of rows) {
    const d = localDateOf(r.completedAt);
    if (d === null) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const active = new Set(activityDates);
  const thisSunday = addDays(today, -new Date(dayMs(today)).getUTCDay());
  const weeks: DeskHeatmapDay[][] = [];
  for (let w = DESK_HEATMAP_WEEKS - 1; w >= 0; w--) {
    const sunday = addDays(thisSunday, -7 * w);
    const week: DeskHeatmapDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(sunday, i);
      if (date > today) break;
      const completed = counts.get(date) ?? 0;
      week.push({ date, completed, level: levelFor(completed, active.has(date)) });
    }
    weeks.push(week);
  }
  return weeks;
}

/** Ruling E12-R6: this calendar month's Claude spend. A call whose model has no price is left out and counted. */
export function monthlySpend(rows: readonly DeskUsageRow[], now: Date, timeZone: string): { monthUsd: number; unpricedCalls: number } {
  const month = localIsoDate(now, timeZone).slice(0, 7);
  const localDateOf = localDateReader(timeZone);
  let total = 0;
  let unpricedCalls = 0;
  for (const r of rows) {
    const d = localDateOf(r.at);
    if (d === null) {
      unpricedCalls += 1;
      continue;
    }
    if (d.slice(0, 7) !== month) continue;
    try {
      total += costForRow(r);
    } catch {
      unpricedCalls += 1;
    }
  }
  return { monthUsd: Math.round(total * 100) / 100, unpricedCalls };
}
