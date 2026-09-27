/**
 * src/core/relative-date.ts
 *
 * Real-use fixes plan, Task 3 (FR-26/FR-27, AD-1, AD-12). A pure,
 * deterministic resolver for a date phrase written in prose — "tomorrow",
 * "Thursday", "next week Friday", "Oct 3", "10/3" — or an already-ISO
 * "YYYY-MM-DD"/full ISO datetime, into a real calendar date (or datetime).
 * Anchored to a HOST-LOCAL "today", computed from `now` + `timeZone` via
 * `Intl`, never the process's own OS timezone and never a raw UTC date —
 * the after-midnight-local case (Spencer's local calendar day can differ
 * from the UTC calendar day of the same instant) is exactly the kind of
 * bug this guards against.
 *
 * The incident this task fixes: a Notion Task draft carried Due Date = the
 * literal text "tomorrow at 10:45 AM" — never resolved by the LLM draft,
 * shown to Spencer, and rejected by Notion only after he confirmed.
 * `app/create-item.ts` now runs `resolveRelativeDateTime`/`resolveRelativeDate`
 * over every drafted date field BEFORE a Proposal is ever shown: an already-
 * ISO value passes through unchanged, a relative phrase resolves
 * deterministically, and anything neither returns `undefined`, which
 * `create-item.ts` turns into a plain clarifying question instead of a
 * draft.
 *
 * `core/` may import only `types/` and other `core/` (AD-1) — so this file
 * duplicates the small ISO-calendar-validity check
 * `adapters/iso-datetime.ts` already has for its own full datetime string,
 * rather than importing back across that boundary (the same small,
 * deliberate duplication already present between `core/time-budget.ts` and
 * `core/derived-priority.ts`).
 *
 * Exported for Task 5's reuse as well as this task's own callers.
 */

export interface RelativeDateContext {
  /** The real current instant — always `deps.now()`, never `new Date()` read again here. */
  readonly now: Date;
  /** IANA timezone name (e.g. "America/Los_Angeles") — "today"/"tomorrow"/a weekday all resolve against THIS calendar day, never the host process's own OS timezone or a raw UTC date. */
  readonly timeZone: string;
}

interface CalendarDate {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
}

interface TimeOfDay {
  readonly hour: number; // 0-23
  readonly minute: number; // 0-59
}

// ----------------------------------------------------------------------------
// Small calendar-arithmetic helpers — every one operates on plain
// {year,month,day} numbers via `Date.UTC`, used ONLY as a calendar
// calculator (never as a real instant), so results never depend on the
// host process's own timezone.
// ----------------------------------------------------------------------------

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function pad4(n: number): string {
  return n.toString().padStart(4, "0");
}

function formatIsoDate(date: CalendarDate): string {
  return `${pad4(date.year)}-${pad2(date.month)}-${pad2(date.day)}`;
}

function addDays(date: CalendarDate, delta: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day));
  d.setUTCDate(d.getUTCDate() + delta);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 0 (Sunday) .. 6 (Saturday), computed purely from the calendar date — never the host process's own timezone. */
function calendarWeekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** `now`'s calendar date IN `timeZone` — Spencer's own "today", via `Intl`, never `now.getUTCDate()`/`now.getDate()`. */
function zonedCalendarDate(now: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Minutes `timeZone` is AHEAD of UTC at `instant` (negative for a zone behind UTC, e.g. America/Los_Angeles). */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - instant.getTime()) / 60000;
}

/**
 * The UTC instant (ISO string, "Z" suffix) that reads as `year-month-day
 * hour:minute:second` wall-clock time in `timeZone`. Two-pass offset
 * correction (guess, then re-check the offset AT that guess) so a wall time
 * that falls right around a DST transition still resolves consistently.
 */
function zonedDateTimeToUtcIso(year: number, month: number, day: number, hour: number, minute: number, second: number, timeZone: string): string {
  const naiveUtcMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = tzOffsetMinutes(new Date(naiveUtcMillis), timeZone);
  let utcMillis = naiveUtcMillis - offset1 * 60000;
  const offset2 = tzOffsetMinutes(new Date(utcMillis), timeZone);
  if (offset2 !== offset1) utcMillis = naiveUtcMillis - offset2 * 60000;
  return new Date(utcMillis).toISOString();
}

// ----------------------------------------------------------------------------
// Full ISO-8601 datetime passthrough — mirrors
// `adapters/iso-datetime.ts`'s `isValidIsoDateTime` (duplicated locally;
// see file header).
// ----------------------------------------------------------------------------

const FULL_ISO_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;

function isValidFullIsoDateTime(raw: string): boolean {
  const match = FULL_ISO_DATETIME_RE.exec(raw);
  if (!match) return false;
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = secondStr === undefined ? 0 : Number(secondStr);
  if (!isRealCalendarDate(year, month, day)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  return !Number.isNaN(Date.parse(raw));
}

// ----------------------------------------------------------------------------
// Weekday / month name tables
// ----------------------------------------------------------------------------

const WEEKDAY_ALIASES: Readonly<Record<string, number>> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  weds: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTH_ALIASES: Readonly<Record<string, number>> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

// ----------------------------------------------------------------------------
// Time-of-day clause splitting — "tomorrow at 10:45 AM" -> datePart
// "tomorrow", time {hour:10,minute:45}. Shared by `resolveRelativeDate`
// (which only ever needs `datePart`, defensively) and
// `resolveRelativeDateTime` (which needs both).
// ----------------------------------------------------------------------------

const TIME_CLAUSE_WITH_AT_RE = /^(.*?)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i;
const TIME_CLAUSE_BARE_RE = /^(.*?),?\s+(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?$/i;

function splitTimeClause(text: string): { readonly datePart: string; readonly time?: TimeOfDay } {
  const match = TIME_CLAUSE_WITH_AT_RE.exec(text) ?? TIME_CLAUSE_BARE_RE.exec(text);
  if (!match) return { datePart: text };
  const [, datePart, hourStr, minuteStr, meridiem] = match;
  let hour = Number(hourStr);
  const minute = minuteStr === undefined ? 0 : Number(minuteStr);
  if (meridiem) {
    const isPm = /p/i.test(meridiem);
    hour = hour % 12;
    if (isPm) hour += 12;
  }
  if (hour > 23 || minute > 59) return { datePart: text };
  return { datePart: datePart!.trim(), time: { hour, minute } };
}

// ----------------------------------------------------------------------------
// Month-day resolution — rolls into next year (or uses an explicit year) —
// this is the month-boundary case: "Oct 3" asked for in December resolves
// to next year, not a date already in the past.
// ----------------------------------------------------------------------------

function resolveMonthDay(month: number, day: number, explicitYear: number | undefined, today: CalendarDate): string | undefined {
  const year = explicitYear ?? today.year;
  if (!isRealCalendarDate(year, month, day)) return undefined;
  if (explicitYear === undefined) {
    const isBeforeToday = month < today.month || (month === today.month && day < today.day);
    if (isBeforeToday) return formatIsoDate({ year: year + 1, month, day });
  }
  return formatIsoDate({ year, month, day });
}

const MONTH_DAY_NAME_RE = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/i;
// "10/3" is read as month/day (US convention, matching Spencer's own locale), not day/month — deliberate, not an oversight.
const NUMERIC_MONTH_DAY_RE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;
const WEEKDAY_PHRASE_RE = /^(?:(next\s+week|next|this)\s+)?([a-z]+)$/i;

/**
 * Resolves `text` — a relative or already-ISO date phrase — into a
 * `YYYY-MM-DD` calendar date, anchored to `ctx.now`/`ctx.timeZone`, or
 * `undefined` if it can't be confidently resolved. Never throws.
 *
 * Recognizes (case-insensitive):
 *  - an already-valid `YYYY-MM-DD` (passed through unchanged after
 *    confirming it's a real calendar day — Feb 30 still fails)
 *  - `today` / `tomorrow` / `yesterday`
 *  - a bare weekday name (`Thursday`) — the NEXT occurrence, counting today
 *    itself if today IS that weekday (0-6 days out)
 *  - `this <weekday>` — identical to the bare form (0-6 days out)
 *  - `next <weekday>` / `next week <weekday>` — the occurrence exactly one
 *    week after the bare/`this` form (7-13 days out; always genuinely
 *    "not this week")
 *  - a month-day, by name (`Oct 3`, `October 3rd`, optionally with a
 *    trailing year) or numeric slash (`10/3`, `10/3/2026`) — with no
 *    explicit year, rolls into NEXT year if that month/day has already
 *    passed this year (the month-boundary case)
 *
 * A trailing time-of-day clause (`"... at 10:45 AM"`) is tolerated and
 * ignored here — this function only ever returns a bare date; use
 * `resolveRelativeDateTime` when a time matters.
 */
/**
 * Real-use fixes plan, Polish 4 Task 1: whether `word` alone reads as a date
 * word — a bare weekday/month alias or "today"/"tomorrow"/"yesterday" — used
 * only as a cheap heuristic (`core/quick-add.ts`'s `hasUnresolvedFieldWords`)
 * to decide whether a quick-add title still looks like it has an
 * unrecognized date phrase in it, never to resolve an actual date itself.
 */
export function isDateWord(word: string): boolean {
  const lower = word.trim().toLowerCase();
  if (lower === "today" || lower === "tomorrow" || lower === "yesterday") return true;
  return WEEKDAY_ALIASES[lower] !== undefined || MONTH_ALIASES[lower] !== undefined;
}

export function resolveRelativeDate(text: string, ctx: RelativeDateContext): string | undefined {
  const { datePart } = splitTimeClause(text.trim());
  const normalized = datePart.trim();
  if (!normalized) return undefined;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    return isRealCalendarDate(year, month, day) ? normalized : undefined;
  }

  const today = zonedCalendarDate(ctx.now, ctx.timeZone);
  const lower = normalized.toLowerCase();

  if (lower === "today") return formatIsoDate(today);
  if (lower === "tomorrow") return formatIsoDate(addDays(today, 1));
  if (lower === "yesterday") return formatIsoDate(addDays(today, -1));

  const weekdayMatch = WEEKDAY_PHRASE_RE.exec(lower);
  if (weekdayMatch) {
    const qualifier = weekdayMatch[1]?.replace(/\s+/g, " ");
    const targetWeekday = WEEKDAY_ALIASES[weekdayMatch[2]!];
    if (targetWeekday !== undefined) {
      const todayWeekday = calendarWeekday(today);
      let delta = (targetWeekday - todayWeekday + 7) % 7; // 0-6: this week's occurrence (today counts as 0)
      if (qualifier === "next" || qualifier === "next week") delta += 7; // always the FOLLOWING week's occurrence
      return formatIsoDate(addDays(today, delta));
    }
  }

  const monthDayNameMatch = MONTH_DAY_NAME_RE.exec(normalized);
  if (monthDayNameMatch) {
    const month = MONTH_ALIASES[monthDayNameMatch[1]!.toLowerCase()];
    if (month !== undefined) {
      const day = Number(monthDayNameMatch[2]);
      const explicitYear = monthDayNameMatch[3] ? Number(monthDayNameMatch[3]) : undefined;
      return resolveMonthDay(month, day, explicitYear, today);
    }
  }

  const numericMatch = NUMERIC_MONTH_DAY_RE.exec(normalized);
  if (numericMatch) {
    const month = Number(numericMatch[1]);
    const day = Number(numericMatch[2]);
    let explicitYear: number | undefined;
    if (numericMatch[3]) {
      const rawYear = Number(numericMatch[3]);
      explicitYear = rawYear < 100 ? 2000 + rawYear : rawYear;
    }
    return resolveMonthDay(month, day, explicitYear, today);
  }

  return undefined;
}

/**
 * Resolves `text` into a full ISO-8601 UTC datetime (`Z` suffix) when it
 * carries BOTH a resolvable date phrase (per `resolveRelativeDate`) AND a
 * time-of-day clause (`"at 10:45 AM"`, `"at 14:30"`, `"10:45am"`) — or
 * passes an already-valid full ISO datetime straight through, normalized to
 * UTC. Returns `undefined` when `text` has no time clause at all (the
 * caller should fall back to `resolveRelativeDate` for a bare date) or the
 * date part doesn't resolve. Never throws.
 */
export function resolveRelativeDateTime(text: string, ctx: RelativeDateContext): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  if (FULL_ISO_DATETIME_RE.test(trimmed)) {
    return isValidFullIsoDateTime(trimmed) ? new Date(trimmed).toISOString() : undefined;
  }

  const { datePart, time } = splitTimeClause(trimmed);
  if (!time) return undefined;

  const dateIso = resolveRelativeDate(datePart, ctx);
  if (!dateIso) return undefined;

  const [yearStr, monthStr, dayStr] = dateIso.split("-");
  return zonedDateTimeToUtcIso(Number(yearStr), Number(monthStr), Number(dayStr), time.hour, time.minute, 0, ctx.timeZone);
}
