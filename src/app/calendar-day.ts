/**
 * src/app/calendar-day.ts
 *
 * Real-use fixes plan, Task 4: "I cant see my google calendar on other days
 * when i select a day on the month view. it just reverts back to day" —
 * polish-2 deliberately showed only today, because only today's data was
 * loaded client-side; this is the read-only server-side read that lifts
 * that limit, for `GET /api/calendar/day?date=`. A sibling of
 * `app/home-view.ts`'s `getHomeView` (today only) and `app/day-view.ts`'s
 * `dayView` (chat-shaped, same per-date Calendar read) — this one returns
 * the same `HomeCalendarBlock[]` shape `CalendarDayView` already renders,
 * for any date, not a chat reply.
 *
 * Unlike `getHomeView`, there is no live Notion Tasks read here (no
 * `readTasks`/`connection`/Completion Log dependency for a date that isn't
 * "today") — a stored Plan's own `"work"` block on another day always
 * reports `completed: false`; only `past` (real "now" vs. the block's own
 * `end`) distinguishes a read-only block from an upcoming one. Rulings:
 * `toFixedBlock`/`toOwnedBlock`/`sortBlocksByStart` (`core/calendar-blocks.ts`)
 * are the SAME pure mapping `getHomeView` uses — moved to `core/` rather
 * than exported from `app/home-view.ts`, since `tests/layering-rules.test.ts`
 * requires every `app/*.ts` export to be `(deps, input) =>
 * Promise<Result<...>>`.
 */
import { getPlan, type MemoryStore } from "../adapters/memory-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { sortBlocksByStart, toFixedBlock, toOwnedBlock } from "../core/calendar-blocks.ts";
import type { LogEntry } from "../adapters/logger.ts";
import type { HomeCalendarBlock } from "../types/api.ts";
import type { CalendarEvent, IsoDate, PlanBlock, Result, YohError } from "../types/domain.ts";

export interface CalendarDayDeps {
  readonly store: MemoryStore;
  readonly timeZone: string;
  /** `adapters/calendar-adapter.ts`'s `readCalendarEvents`, pre-bound, taking the target date — the same per-date read `app/day-view.ts`'s `DayViewDeps.readCalendarEventsForDate` already uses. May throw (AD-8). */
  readonly readCalendarEventsForDate: (date: IsoDate) => Promise<readonly CalendarEvent[]>;
  readonly now: () => Date;
  /** One structured log line (Consistency Conventions) on a Calendar read failure — optional, defaults to a no-op; `shell/server.ts` binds the real writer. */
  readonly log?: (entry: LogEntry) => void;
}

export interface CalendarDayInput {
  readonly date: IsoDate;
}

export interface CalendarDayOutput {
  readonly date: IsoDate;
  readonly blocks: readonly HomeCalendarBlock[];
  readonly timeZone: string;
}

export async function getCalendarDay(deps: CalendarDayDeps, input: CalendarDayInput): Promise<Result<CalendarDayOutput, YohError>> {
  const log = deps.log ?? ((): void => {});
  const nowMs = deps.now().getTime();

  let events: readonly CalendarEvent[];
  try {
    events = await deps.readCalendarEventsForDate(input.date);
  } catch (err) {
    log({ level: "error", event: "calendar-day.read-calendar-failed", detail: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err, { service: "Google Calendar" }) } };
  }
  const fixedBlocks = events.map((e) => toFixedBlock(e, nowMs));

  const stored = getPlan(deps.store, input.date);
  const ownedBlocks: HomeCalendarBlock[] = stored
    ? stored.data.blocks
        .filter((b): b is PlanBlock & { kind: "work" | "break" } => b.kind === "work" || b.kind === "break")
        .map((b) => toOwnedBlock(b, false, nowMs))
    : [];

  const blocks = sortBlocksByStart([...ownedBlocks, ...fixedBlocks]);

  return { ok: true, value: { date: input.date, blocks, timeZone: deps.timeZone } };
}
