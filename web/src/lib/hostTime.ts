/**
 * web/src/lib/hostTime.ts
 *
 * Fix round (2026-09-27 review): Home's Calendar Day View and Plan
 * checklist must position/format times in the HOST timezone `GET
 * /api/home` computes "today" in (AD-17: "'Today' uses the configured host
 * TZ, never the browser's date" — the same rule extends to wall-clock
 * position/formatting, not just the calendar date). The server sends its
 * `timeZone` string (an IANA zone id, e.g. "America/Los_Angeles") on
 * `HomeViewResponse`; these helpers use the browser's own `Intl` engine
 * only as a *formatter*, forced to that explicit zone — never the
 * browser's own local zone (`Intl.DateTimeFormat()` with no `timeZone`
 * option would use the browser's zone; every call here always passes one).
 */

/** The wall-clock hour (0-23) and minute `date` falls on in `timeZone`, regardless of the browser's own zone. */
export function localHourMinute(date: Date, timeZone: string): { readonly hour: number; readonly minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "numeric", minute: "numeric" }).formatToParts(date);
  const hourPart = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // A handful of ICU builds report midnight as "24" even under h23 — normalize.
  const hour = hourPart === 24 ? 0 : hourPart;
  return { hour, minute };
}

/** Minutes since local midnight, in `timeZone`. */
export function localMinutesSinceMidnight(date: Date, timeZone: string): number {
  const { hour, minute } = localHourMinute(date, timeZone);
  return hour * 60 + minute;
}

/** "9:00", "10:30", "1:00" — 12-hour, no AM/PM (matches the approved mockup's Plan row times), in `timeZone`. */
export function formatClockTime(date: Date, timeZone: string): string {
  const { hour, minute } = localHourMinute(date, timeZone);
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}:${String(minute).padStart(2, "0")}`;
}
