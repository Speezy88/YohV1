/**
 * src/core/local-time.ts
 *
 * Shared clock helpers: the R8 bare-time rule (1-7 -> PM, 8-11 -> AM, 12 ->
 * noon) and DST-safe conversion of local minutes to an instant.
 */
import type { IsoDate, IsoDateTime } from "../types/domain.ts";

/** Minutes after midnight for a clock time; a bare hour follows R8 unless `meridiem` says otherwise. */
export function resolveClockMinutes(hour: number, minute: number, meridiem?: "am" | "pm"): number {
  if (meridiem === "am") return (hour % 12) * 60 + minute;
  if (meridiem === "pm") return ((hour % 12) + 12) * 60 + minute;
  if (hour >= 13 || hour === 0) return hour * 60 + minute;
  if (hour === 12) return 12 * 60 + minute;
  if (hour >= 8) return hour * 60 + minute; // 8-11 -> AM
  return (hour + 12) * 60 + minute; // 1-7 -> PM
}

const zoneOffsetMinutes = (ms: number, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const g = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(ms / 1000) * 1000) / 60_000;
};

/** The instant at `minutes` past local midnight on `date` in `timeZone` (DST-safe fixed-point). */
export function localMinutesToMs(date: IsoDate, minutes: number, timeZone: string): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, mo - 1, d, 0, 0, 0) + minutes * 60_000;
  let offset = zoneOffsetMinutes(wall, timeZone);
  for (let i = 0; i < 4; i++) {
    const next = zoneOffsetMinutes(wall - offset * 60_000, timeZone);
    if (next === offset) break;
    offset = next;
  }
  return wall - offset * 60_000;
}

export function localMinutesToIso(date: IsoDate, minutes: number, timeZone: string): IsoDateTime {
  return new Date(localMinutesToMs(date, minutes, timeZone)).toISOString();
}
