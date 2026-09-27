/**
 * src/core/calendar-blocks.ts
 *
 * Real-use fixes plan, Task 4 ("pick any day in Month to see its
 * calendar"): the pure block-shaping logic `app/home-view.ts`'s
 * `getHomeView` (today only) and the new `app/calendar-day.ts`'s
 * `getCalendarDay` (any date) both need — moved here rather than exported
 * from `app/home-view.ts` and imported by a second `app/*.ts` file, since
 * `tests/layering-rules.test.ts`'s AD-16 rule requires every `app/*.ts`
 * export to be `(deps, input) => Promise<Result<...>>`; `toFixedBlock`
 * isn't shaped that way, so it — and the sibling "owned block" mapping
 * `getHomeView` also does inline — belong in `core/` (pure, no I/O),
 * imported by both call sites instead of copied.
 */
import type { CalendarEvent, PlanBlock } from "../types/domain.ts";
import type { HomeCalendarBlock } from "../types/api.ts";

/** A live-read primary-calendar event, not a Yoh-owned Plan block — never the stored Plan's own `"calendar-anchor"` snapshot (see `app/home-view.ts`'s doc comment for why). */
export function toFixedBlock(event: CalendarEvent, nowMs: number): HomeCalendarBlock {
  return { id: event.id, kind: "fixed", label: event.title, start: event.start, end: event.end, completed: false, past: Date.parse(event.end) < nowMs };
}

/** A stored Plan's own `"work"`/`"break"` block, Yoh-owned — `completed` is the caller's own live-status lookup (today's Home view has one; a read of another day currently doesn't, and passes a constant `false`). */
export function toOwnedBlock(block: PlanBlock & { kind: "work" | "break" }, completed: boolean, nowMs: number): HomeCalendarBlock {
  return { id: block.id, kind: block.kind, label: block.label, start: block.start, end: block.end, completed, past: Date.parse(block.end) < nowMs };
}

/** Every calendar block, Yoh-owned and fixed alike, in start-time order — the one order `CalendarDayView` ever renders (AD-17: decided server-side, never re-sorted client-side). */
export function sortBlocksByStart(blocks: readonly HomeCalendarBlock[]): HomeCalendarBlock[] {
  return [...blocks].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
