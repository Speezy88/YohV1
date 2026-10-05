/**
 * web/src/lib/deskFeedFormat.ts — Ruling E12-R22: pure formatting for the
 * Desk's feed widgets (prices, signed changes, "updated" times in the host
 * zone). Shared by every feed widget.
 */

/** `$67,123` (whole dollars) at 1,000 and above, `$142.57` below. */
export function formatUsdPrice(price: number): string {
  return price >= 1000
    ? `$${Math.round(price).toLocaleString("en-US")}`
    : `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `+1.2%`, `−0.8%` (U+2212), `0.0%`; an empty string for `null`. The sign is always text, never color alone. */
export function formatChangePercent(change: number | null): string {
  if (change === null || !Number.isFinite(change)) return "";
  const rounded = Math.round(Math.abs(change) * 10) / 10;
  if (rounded === 0) return "0.0%";
  return `${change > 0 ? "+" : "−"}${rounded.toFixed(1)}%`;
}

/** `3:30 PM` in `timeZone` (the host's, never the browser's). */
export function formatFeedTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).replace(/ /g, " ");
}

/** `Oct 4, 2:10 PM` in `timeZone` (the host's, never the browser's). */
export function formatFeedDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).replace(/ /g, " ");
}

/** The host-zone calendar date of `date` as `YYYY-MM-DD`. */
function zoneDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/**
 * Ruling E12-R23: a feed caption time. `3:30 PM` when the value is from the
 * host's today, `Oct 3, 3:30 PM` otherwise; always in the host zone.
 */
export function formatFeedStamp(iso: string, timeZone: string, now: Date = new Date()): string {
  return zoneDate(new Date(iso), timeZone) === zoneDate(now, timeZone) ? formatFeedTime(iso, timeZone) : formatFeedDateTime(iso, timeZone);
}

/** The caption for a feed that is not `ok`: `Unavailable · last updated 3:30 PM` (with the date when not today), or `Unavailable` with no value ever fetched. */
export function unavailableCaption(fetchedAt: string | undefined, timeZone: string, now: Date = new Date()): string {
  return fetchedAt === undefined ? "Unavailable" : `Unavailable · last updated ${formatFeedStamp(fetchedAt, timeZone, now)}`;
}
