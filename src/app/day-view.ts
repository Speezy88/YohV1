/**
 * src/app/day-view.ts
 *
 * Real-use fixes plan, Task 5: "what's happening tomorrow" (read any day).
 * Spencer asked "what is happening tomorrow" and Yoh couldn't answer — the
 * only Calendar read anywhere in the app (`app/plan-view.ts`'s `showPlan`,
 * `app/calendar-edit.ts`'s own read) only ever looked at TODAY's events.
 * `dayView` is the second caller of `adapters/calendar-adapter.ts`'s
 * `readCalendarEvents`, this time with Task 5's new optional `date` — same
 * read-only client, same host-TZ day-window logic, just a different day.
 *
 * Behavior (brief): lists that day's Calendar events in local time, plus
 * that day's stored Plan if one exists. A FUTURE day with no stored Plan
 * yet gets a plain hint to type "/plan" that morning, rather than silently
 * showing nothing. An empty day (no events, no Plan) says so plainly —
 * never fabricated, never an error.
 *
 * `core/chat-commands.ts`'s `parseDayViewCommand` recognizes the trigger
 * phrase ("what's happening tomorrow", "what do I have on Thursday", ...)
 * and returns the raw trailing date phrase; `app/chat-turn.ts` resolves
 * that phrase into a real `IsoDate` via the shared
 * `core/relative-date.ts` resolver (`resolveRelativeDate`) BEFORE ever
 * calling this function — `input.date` here is always already a resolved,
 * real calendar date, never a literal phrase like `"tomorrow"`.
 */
import { getPlan, type MemoryStore } from "../adapters/memory-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { formatPlanDate, localIsoDate, renderPlan } from "../rituals/ritual-shared.ts";
import type { ChatTurnResponse } from "../types/api.ts";
import type { CalendarEvent, IsoDate, Result, YohError } from "../types/domain.ts";

export interface DayViewDeps {
  readonly store: MemoryStore;
  readonly timeZone: string;
  readonly now: () => Date;
  /**
   * `adapters/calendar-adapter.ts`'s `readCalendarEvents`, pre-bound to its
   * client/timeZone, taking the target date Task 5's `config.date` added.
   * Throws on I/O failure (AD-8) — caught below and turned into an honest,
   * non-crashing reply via `errorCopyForThrown` (same convention
   * `app/calendar-edit.ts`'s own Calendar read already uses).
   */
  readonly readCalendarEventsForDate: (date: IsoDate) => Promise<readonly CalendarEvent[]>;
}

export interface DayViewInput {
  readonly date: IsoDate;
}

/** `"2026-10-05"` and later "isn't today" (future) vs. `"2026-09-01"` and earlier (today or past) — plain string comparison, since `IsoDate`'s `YYYY-MM-DD` shape sorts lexicographically exactly like calendar order. */
function isFutureDay(date: IsoDate, today: IsoDate): boolean {
  return date > today;
}

/** A stored UTC `IsoDateTime` as `HH:MM` wall-clock time in `timeZone` — the same small, deliberate duplication `rituals/ritual-shared.ts`'s own private `formatLocalTime` already represents elsewhere in this codebase (that helper isn't exported, and `app/` has no other reason to import `rituals/*.ts` internals). */
function formatLocalTime(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

function formatEventLine(event: CalendarEvent, timeZone: string): string {
  const range = `${formatLocalTime(event.start, timeZone)}-${formatLocalTime(event.end, timeZone)}`;
  const title = event.title.trim().length > 0 ? event.title : "(untitled event)";
  return `  ${range}  ${title}`;
}

/** The honest, plain "type /plan that morning" hint for a future day with no Plan yet — never a fabricated Plan, never silence. */
const NO_PLAN_YET_HINT = 'No Plan yet for that day — type "/plan" (or say "plan my day") that morning and I\'ll build it.';

export async function dayView(deps: DayViewDeps, input: DayViewInput): Promise<Result<ChatTurnResponse, YohError>> {
  let events: readonly CalendarEvent[];
  try {
    events = await deps.readCalendarEventsForDate(input.date);
  } catch (err) {
    return { ok: true, value: { reply: errorCopyForThrown(err, { service: "Google Calendar" }), receipts: [] } };
  }

  const label = formatPlanDate(input.date);
  const eventsSection =
    events.length === 0
      ? `Nothing on the calendar for ${label}.`
      : [`Calendar for ${label}:`, ...events.map((event) => formatEventLine(event, deps.timeZone))].join("\n");

  const sections: string[] = [eventsSection];

  const stored = getPlan(deps.store, input.date);
  if (stored) {
    sections.push(renderPlan(stored.data, { color: false, includeHeader: false }));
  } else {
    const today = localIsoDate(deps.now(), deps.timeZone);
    if (isFutureDay(input.date, today)) {
      sections.push(NO_PLAN_YET_HINT);
    }
  }

  return { ok: true, value: { reply: sections.join("\n\n"), receipts: [] } };
}
