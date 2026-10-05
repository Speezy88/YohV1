/**
 * web/src/lib/deskHeatmap.ts — Epic 12 Task 5: `GET /api/desk`'s heatmap
 * weeks → Bklit's column shape, and the cell/tooltip wording. Dates are
 * handled as UTC-midnight so the browser's zone can never shift a day.
 */
import type { DeskHeatmapDay } from "../../../src/types/api.ts";
import type { HeatmapColumn } from "../components/charts/heatmap/heatmap-context.tsx";

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A week/day list (Sunday first, no day after today) → columns of `{ bin: weekday 0–6, count: level 0–4, completed, date }`. */
export function toHeatmapColumns(weeks: readonly (readonly DeskHeatmapDay[])[]): HeatmapColumn[] {
  return weeks.map((week, i) => ({
    bin: i,
    bins: week.map((d) => {
      const date = new Date(`${d.date}T00:00:00.000Z`);
      return { bin: date.getUTCDay(), count: d.level, completed: d.completed, date };
    }),
  }));
}

/** `Oct 3, 2026`, from the UTC-midnight date's own parts. */
export function formatHeatmapDay(date: Date): string {
  return DAY_FORMAT.format(date);
}

function completedPhrase(completed: number): string {
  return `${completed} ${completed === 1 ? "Task" : "Tasks"} completed`;
}

/** The text after the date: `5 Tasks completed`, `Opened Yoh, no Tasks completed` or `No activity`. */
export function heatmapCountLine(level: number, completed: number): string {
  if (completed > 0) return completedPhrase(completed);
  return level >= 1 ? "Opened Yoh, no Tasks completed" : "No activity";
}

/** A cell's accessible name. */
export function heatmapCellLabel(date: Date, level: number, completed: number): string {
  const when = formatHeatmapDay(date);
  if (completed > 0) return `${when}: ${completedPhrase(completed)}`;
  return level >= 1 ? `${when}: opened Yoh, no Tasks completed` : `${when}: no activity`;
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });

/** `Saturday`, from the UTC-midnight date. */
export function formatHeatmapWeekday(date: Date): string {
  return WEEKDAY_FORMAT.format(date);
}
