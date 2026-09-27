/**
 * web/src/lib/calendarView.ts
 *
 * Polish-2 (Spencer's live-app report: "I want the right section... to
 * primarily have the daily view in the entire section and have the option
 * to switch to monthly view"): which of the two views `Home.tsx`'s one
 * calendar panel shows, remembered per browser — same shape/pattern as
 * `tasks.ts`'s `loadGroupBy`/`saveGroupBy`. Day is the default: a missing,
 * corrupt, or unreadable stored value (and any thrown storage access, e.g.
 * a private window or blocked site data) all fall back to `"day"`, never
 * throw, and never crash the render.
 */

export type CalendarView = "day" | "month";

const CALENDAR_VIEW_KEY = "yoh.home.calendarView";

export function loadCalendarView(): CalendarView {
  try {
    return window.localStorage.getItem(CALENDAR_VIEW_KEY) === "month" ? "month" : "day";
  } catch {
    return "day";
  }
}

export function saveCalendarView(view: CalendarView): void {
  try {
    window.localStorage.setItem(CALENDAR_VIEW_KEY, view);
  } catch {
    // A private window or blocked storage: the choice just isn't remembered.
  }
}
