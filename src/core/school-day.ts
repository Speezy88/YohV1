/**
 * src/core/school-day.ts
 *
 * Polish-5 Task 3 (school-day rules in the planner). Pure, no I/O, reads no
 * env or clock (AD-2) — `computeSchoolDay` is a plain function of the day's
 * already-read Calendar events, the target `IsoDate`, and a host IANA
 * `timeZone` string, all passed in explicitly.
 *
 * Binding rulings (Spencer confirmed, task-3-brief.md):
 *  - A "school event" is any `CalendarEvent` with `calendarId` set (Task 2:
 *    every extra calendar — Spencer has one, his school calendar — is
 *    tagged this way; Spencer's own primary-calendar events never carry
 *    `calendarId`).
 *  - A "school day" is a weekday (Mon-Fri, host `timeZone`) with at least
 *    one school event, of ANY kind — including a day whose only school
 *    event is itself a Study Block.
 *  - On a school day, a school event titled "Study Block" (case-insensitive,
 *    after trimming) is FREE time — left out of `anchors` entirely. Every
 *    other school event is busy, same as any other Calendar event.
 *  - On a school day, two windows are PROTECTED (busy) regardless of what
 *    Calendar events exist: lunch 10:55-11:40 and community time
 *    12:55-13:45, host-`timeZone` wall clock (`SCHOOL_PROTECTED_WINDOWS`).
 *  - No school events, or a weekend: `anchors` is `events` unchanged and
 *    `protectedWindows` is empty — the day's Plan is byte-for-byte what it
 *    was before this file existed (`morning-ritual.ts` feeds
 *    `[...anchors, ...protectedWindows]` into `fitWorkBreakBlocks` in place
 *    of the raw `calendarEvents` it used to pass directly, and
 *    `validateAndSortAnchors` there doesn't care about input order, so this
 *    is a genuine no-op on a non-school day).
 */
import type { CalendarEvent, IsoDate, IsoDateTime, Result, YohError } from "../types/domain.ts";

export interface SchoolDayResult {
  /** `events` minus Study Blocks on a school day; `events` unchanged (verbatim) otherwise. */
  readonly anchors: readonly CalendarEvent[];
  /** The two protected-window synthetic events on a school day; empty otherwise. */
  readonly protectedWindows: readonly CalendarEvent[];
  /** The earliest instant Yoh places its own work on `date` (`WORK_START_TIMES`, host `timeZone`). */
  readonly workStart: IsoDateTime;
}

/** One `SCHOOL_PROTECTED_WINDOWS` entry — a host-`timeZone` wall-clock span, by hour/minute (never a fixed UTC offset, since `computeSchoolDay` resolves it against the target date via `wallClockToUtcMillis` below, which is DST-correct). */
interface ProtectedWindowSpec {
  readonly key: string;
  readonly label: string;
  readonly startHour: number;
  readonly startMinute: number;
  readonly endHour: number;
  readonly endMinute: number;
}

/**
 * Task 3 binding ruling (lunch end corrected to 11:35 by Spencer, 2026-09-29):
 * lunch 10:55-11:35, community time 12:55-13:45,
 * host-`timeZone` wall clock. One exported constant per the brief ("Put
 * them in one exported constant") so a future change to these times has a
 * single place to edit.
 */
export const SCHOOL_PROTECTED_WINDOWS: readonly ProtectedWindowSpec[] = [
  { key: "lunch", label: "Lunch", startHour: 10, startMinute: 55, endHour: 11, endMinute: 35 },
  { key: "community", label: "Community time", startHour: 12, startMinute: 55, endHour: 13, endMinute: 45 },
];

/**
 * Spencer, 2026-09-29: Yoh never places its own work before 3:15 PM on a
 * school day, or before 9:00 AM on any other day (weekends and non-school
 * weekdays). Host-`timeZone` wall clock. Spencer's own pins and routines
 * are not bound by it.
 */
export const WORK_START_TIMES = {
  schoolDay: { hour: 15, minute: 15 },
  otherDay: { hour: 9, minute: 0 },
} as const;

function workStartMs(year: number, month: number, day: number, isSchoolDay: boolean, timeZone: string): IsoDateTime {
  const start = isSchoolDay ? WORK_START_TIMES.schoolDay : WORK_START_TIMES.otherDay;
  return new Date(wallClockToUtcMillis(year, month, day, start.hour, start.minute, timeZone)).toISOString();
}

/**
 * `workStart` for a day whose calendar isn't at hand (a re-flow of a Plan
 * made before `Plan.workStart` existed): a weekday counts as a school day.
 * `undefined` for a malformed date.
 */
export function workStartWithoutCalendar(date: IsoDate, timeZone: string): IsoDateTime | undefined {
  const match = ISO_DATE_SHAPE_RE.exec(date);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!isRealCalendarDate(year, month, day)) return undefined;
  return workStartMs(year, month, day, isWeekday(year, month, day), timeZone);
}

const STUDY_BLOCK_PREFIX = "study block";

/** A school event (`calendarId` set) whose title, trimmed and lower-cased, starts with "study block". Never true for a primary-calendar event (no `calendarId`), regardless of its own title. */
function isStudyBlockEvent(event: CalendarEvent): boolean {
  return event.calendarId !== undefined && event.title.trim().toLowerCase().startsWith(STUDY_BLOCK_PREFIX);
}

/**
 * Polish-5 final fix (M1): an all-day EXTRA-calendar event (Google's
 * date-only `date` form — `CalendarEvent.allDay`, `adapters/calendar-
 * adapter.ts`'s `toCalendarEvent`) is never real busy time — a school
 * calendar's "Day 3"/"Spirit Week" all-day entry must not become a
 * calendar-anchor spanning the whole host-timeZone day. It still counts
 * toward `isSchoolDay` above (any school event, of any kind, makes a
 * weekday a school day) — only dropped from `anchors`. A PRIMARY all-day
 * event (no `calendarId`) is untouched here — Spencer's own all-day events
 * keep today's behavior (whatever it already was) and are handled instead
 * by `mergeOverlappingAnchors`'s coalescing, same as any other anchor.
 */
function isAllDayExtraCalendarEvent(event: CalendarEvent): boolean {
  return event.calendarId !== undefined && event.allDay === true;
}

// ============================================================================
// Small calendar-shape helpers, duplicated (not imported) from
// core/relative-date.ts / core/derived-priority.ts's own `isRealCalendarDate`/
// `isLeapYear` — the same small, deliberate duplication those two files'
// own doc comments already call out between each other and
// `adapters/iso-datetime.ts`, rather than a new cross-`core/*.ts` import
// AD-1 doesn't otherwise require.
// ============================================================================

const ISO_DATE_SHAPE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day >= 1 && day <= daysInMonth;
}

/** 0 (Sunday) .. 6 (Saturday) for a plain Y/M/D, via `Date.UTC` used purely as a calendar calculator (never a real instant) — same technique as `core/relative-date.ts`'s own `calendarWeekday`. */
function calendarWeekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isWeekday(year: number, month: number, day: number): boolean {
  const dow = calendarWeekday(year, month, day);
  return dow >= 1 && dow <= 5;
}

// ============================================================================
// Wall-clock (host timeZone) -> UTC instant, duplicated (not imported) from
// `adapters/calendar-adapter.ts`'s `zoneOffsetMinutesAt`/`startOfLocalDayUtc`
// — per AD-1, `core/*.ts` may import only `types/` and other `core/*.ts`,
// never `adapters/*.ts`, so this file cannot call that adapter's helper
// even though the fixed-point algorithm is identical; generalized here to
// an arbitrary wall-clock hour:minute rather than only local midnight,
// since a protected window's start/end is never midnight. See that
// adapter's own doc comment for the worked DST-transition-at-midnight
// example this fixed-point iteration guards against — the same
// "verify the offset against the candidate instant it produced, don't
// trust a single un-verified guess" reasoning applies at 10:55/12:55 wall
// clock exactly as it does at 00:00.
// ============================================================================

/** `timeZone`'s offset from UTC (in minutes, positive east of UTC) at the instant `utcMillis`. */
function zoneOffsetMinutesAt(utcMillis: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(utcMillis));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const localWallClockAsUtcMillis = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return (localWallClockAsUtcMillis - utcMillis) / 60_000;
}

/** Safety bound on the fixed-point iteration below — real-world DST shifts converge in 1-2 iterations; this only guards pathological/malformed zone data (mirrors `calendar-adapter.ts`'s own `MAX_OFFSET_ITERATIONS`). */
const MAX_OFFSET_ITERATIONS = 5;

/**
 * The UTC instant for `timeZone`'s local wall-clock `year-month-day
 * hour:minute:00`, resolved via the same offset-fixed-point iteration
 * `adapters/calendar-adapter.ts`'s `startOfLocalDayUtc` uses for local
 * midnight — correct regardless of what wall-clock time a zone's DST
 * transition falls at, because the offset is verified against the
 * candidate instant it actually produced rather than assumed to still
 * hold from a single naive guess.
 */
function wallClockToUtcMillis(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const targetLocalWallClockAsUtcMillis = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let offsetMinutes = zoneOffsetMinutesAt(targetLocalWallClockAsUtcMillis, timeZone);

  for (let iteration = 0; iteration < MAX_OFFSET_ITERATIONS; iteration++) {
    const candidateMillis = targetLocalWallClockAsUtcMillis - offsetMinutes * 60_000;
    const offsetAtCandidate = zoneOffsetMinutesAt(candidateMillis, timeZone);
    if (offsetAtCandidate === offsetMinutes) {
      return candidateMillis;
    }
    offsetMinutes = offsetAtCandidate;
  }

  throw new Error(`school-day: offset for timezone "${timeZone}" did not converge within ${MAX_OFFSET_ITERATIONS} iterations`);
}

function validationError(message: string, detail?: unknown): Result<never, YohError> {
  return { ok: false, error: { kind: "validation", message, detail } };
}

/**
 * Given the day's Calendar events (both Spencer's primary calendar and any
 * extra calendars, Task 2's `CalendarEvent.calendarId` telling them apart),
 * the target `date`, and the host `timeZone`: `anchors` is `events` minus
 * any Study Block school events, and `protectedWindows` holds the two
 * synthetic protected-window events (`SCHOOL_PROTECTED_WINDOWS`, converted
 * to UTC `IsoDateTime`s for `date` in `timeZone`) when `date` is a school
 * day, or is empty otherwise. See the file doc comment for the full set of
 * binding rulings this implements.
 */
export function computeSchoolDay(events: readonly CalendarEvent[], date: IsoDate, timeZone: string): Result<SchoolDayResult, YohError> {
  const match = ISO_DATE_SHAPE_RE.exec(date);
  const year = match ? Number(match[1]) : NaN;
  const month = match ? Number(match[2]) : NaN;
  const day = match ? Number(match[3]) : NaN;
  if (!match || !isRealCalendarDate(year, month, day)) {
    return validationError(`school-day: "${date}" is not a valid YYYY-MM-DD calendar date`, { date });
  }

  const isSchoolDay = isWeekday(year, month, day) && events.some((event) => event.calendarId !== undefined);
  const workStart = workStartMs(year, month, day, isSchoolDay, timeZone);

  if (!isSchoolDay) {
    // Ruling 4: anchors are `events` verbatim, no synthetic protected windows.
    return { ok: true, value: { anchors: events, protectedWindows: [], workStart } };
  }

  const anchors = events.filter((event) => !isStudyBlockEvent(event) && !isAllDayExtraCalendarEvent(event));

  const protectedWindows: CalendarEvent[] = SCHOOL_PROTECTED_WINDOWS.map((window) => {
    const startMs = wallClockToUtcMillis(year, month, day, window.startHour, window.startMinute, timeZone);
    const endMs = wallClockToUtcMillis(year, month, day, window.endHour, window.endMinute, timeZone);
    return {
      id: `school-protected:${window.key}:${date}`,
      title: window.label,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    };
  });

  return { ok: true, value: { anchors, protectedWindows, workStart } };
}

// ============================================================================
// Polish-5 final fix (M1): normalize overlapping busy spans before
// `work-break-fit.ts`'s `fitWorkBreakBlocks` — `validateAndSortAnchors`
// there rejects the WHOLE fit the moment any two anchors overlap, and a
// school calendar (or Spencer's own primary calendar) does not guarantee
// its events never overlap each other or the two protected windows.
// ============================================================================

/** `[start, end)` millis for anything with an `IsoDateTime` start/end (a `CalendarEvent` here). */
function spanMs(event: CalendarEvent): { readonly startMs: number; readonly endMs: number } {
  return { startMs: Date.parse(event.start), endMs: Date.parse(event.end) };
}

/** One or more disjoint `[start, end)` millis pieces of `windowStartMs..windowEndMs` that `blockingSpans` (already merged, non-overlapping, but not necessarily sorted) do NOT cover. Empty when `blockingSpans` covers the window entirely. */
function subtractSpans(
  windowStartMs: number,
  windowEndMs: number,
  blockingSpans: readonly { readonly startMs: number; readonly endMs: number }[],
): { readonly startMs: number; readonly endMs: number }[] {
  let pieces: { startMs: number; endMs: number }[] = [{ startMs: windowStartMs, endMs: windowEndMs }];
  for (const block of blockingSpans) {
    const next: { startMs: number; endMs: number }[] = [];
    for (const piece of pieces) {
      if (block.endMs <= piece.startMs || block.startMs >= piece.endMs) {
        next.push(piece); // no overlap with this piece at all
        continue;
      }
      if (block.startMs > piece.startMs) next.push({ startMs: piece.startMs, endMs: block.startMs });
      if (block.endMs < piece.endMs) next.push({ startMs: block.endMs, endMs: piece.endMs });
    }
    pieces = next;
  }
  return pieces;
}

/**
 * Turns `anchors` (real busy `CalendarEvent`s — Spencer's own events plus
 * any non-Study-Block, non-all-day-extra school events) and
 * `protectedWindows` (the two school-day synthetic windows, or `[]`) into a
 * set `work-break-fit.ts` can always fit around, by:
 *  1. Merging any two `anchors` that overlap OR touch (one's end <= the
 *     next's start leaves a gap; end > start does not) into a single
 *     anchor spanning both, labelled with every merged event's own title
 *     (deduped, joined with " / "). An anchor that never touches another
 *     stays the exact same object — not a copy — so a day with no overlaps
 *     is byte-identical to before this function existed.
 *  2. Clipping each `protectedWindows` entry to the parts no merged anchor
 *     now covers — dropped entirely if a merged anchor covers it fully,
 *     split into more than one piece if a merged anchor sits inside it, and
 *     left as the exact same object when nothing overlaps it at all.
 *
 * Never called from `computeSchoolDay` itself (whose own non-school-day
 * "byte-for-byte unchanged" contract only concerns THAT function's output);
 * `rituals/morning-ritual.ts` calls this on `computeSchoolDay`'s result
 * before `fitWorkBreakBlocks`, on every day — a no-op whenever nothing
 * overlaps, school day or not, per point 1/2 above.
 */
export function mergeOverlappingAnchors(
  anchors: readonly CalendarEvent[],
  protectedWindows: readonly CalendarEvent[],
): Pick<SchoolDayResult, "anchors" | "protectedWindows"> {
  // A zero-length event (end <= start, e.g. a calendar marker) occupies no
  // time, and `fitWorkBreakBlocks` rejects it outright — drop it here.
  const sortedByStart = anchors.filter((e) => spanMs(e).endMs > spanMs(e).startMs).sort((a, b) => spanMs(a).startMs - spanMs(b).startMs);

  interface Group {
    startMs: number;
    endMs: number;
    events: CalendarEvent[];
  }
  const groups: Group[] = [];
  for (const event of sortedByStart) {
    const { startMs, endMs } = spanMs(event);
    const last = groups[groups.length - 1];
    if (last && startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, endMs);
      last.events.push(event);
    } else {
      groups.push({ startMs, endMs, events: [event] });
    }
  }

  const mergedAnchors: CalendarEvent[] = groups.map((group) => {
    if (group.events.length === 1) return group.events[0]!; // no touch/overlap — untouched, same object.
    const titles = [...new Set(group.events.map((e) => e.title))];
    return {
      id: `merged:${group.events.map((e) => e.id).join("+")}`,
      title: titles.join(" / "),
      start: new Date(group.startMs).toISOString(),
      end: new Date(group.endMs).toISOString(),
    };
  });

  const blockingSpans = groups.map((g) => ({ startMs: g.startMs, endMs: g.endMs }));
  const clippedProtectedWindows: CalendarEvent[] = [];
  for (const window of protectedWindows) {
    const { startMs, endMs } = spanMs(window);
    const pieces = subtractSpans(startMs, endMs, blockingSpans);
    if (pieces.length === 1 && pieces[0]!.startMs === startMs && pieces[0]!.endMs === endMs) {
      clippedProtectedWindows.push(window); // untouched — same object.
      continue;
    }
    pieces.forEach((piece, index) => {
      clippedProtectedWindows.push({
        id: pieces.length > 1 ? `${window.id}:${index}` : window.id,
        title: window.title,
        start: new Date(piece.startMs).toISOString(),
        end: new Date(piece.endMs).toISOString(),
      });
    });
  }

  return { anchors: mergedAnchors, protectedWindows: clippedProtectedWindows };
}
