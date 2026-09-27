// ============================================================================
// Shared ISO-8601 datetime validation (Story 6.6 / FR-27) — a pure helper
// colocated with adapters (no I/O of its own), mirroring notion-select-match.ts.
// Both calendar-adapter.ts and llm-adapter.ts need to reject an
// LLM/user-supplied datetime that merely LOOKS like ISO-8601 but isn't a real
// calendar/clock value (e.g. Feb 30, hour 24) — `Date.parse` alone accepts
// those and silently rolls them into a different day instead of throwing.
// ============================================================================

const FULL_ISO_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;
const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

/**
 * True only for a full ISO-8601 datetime with an explicit UTC offset ("Z" or
 * "+hh:mm") whose date/time fields are real calendar/clock values. Field
 * ranges (day-of-month, hour, minute, second) are checked against the
 * LITERAL digits in `raw`, not against `Date.parse`'s UTC-shifted result —
 * checking the UTC result would wrongly reject a valid non-"Z" offset
 * datetime whose UTC hour/day differs from its literal local one.
 */
export function isValidIsoDateTime(raw: string): boolean {
  const match = FULL_ISO_DATETIME_RE.exec(raw);
  if (!match) return false;
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = secondStr === undefined ? 0 : Number(secondStr);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  return !Number.isNaN(Date.parse(raw));
}

/** Canonical UTC form (`toISOString`) of an already-validated datetime — call only after `isValidIsoDateTime` confirms `raw` is real. */
export function normalizeIsoDateTime(raw: string): string {
  return new Date(raw).toISOString();
}

/**
 * True only for a bare "YYYY-MM-DD" calendar date (no time component)
 * whose fields are a real calendar day — real-use fixes plan, Task 3's
 * draft-time backstop: `notion-adapter.ts`'s `resolveNotionPageDraftProperties`
 * rejects a Notion `date`-typed property value that is neither this nor a
 * full `isValidIsoDateTime` datetime, so a relative phrase like "tomorrow
 * at 10:45 AM" can never reach Notion's own write-time validation as the
 * first place it's caught.
 */
export function isValidIsoDate(raw: string): boolean {
  const match = ISO_DATE_ONLY_RE.exec(raw);
  if (!match) return false;
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}
