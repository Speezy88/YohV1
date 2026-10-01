/**
 * web/src/components/MiniMonth.tsx — Task 6A, DESIGN.md Layout & Spacing
 * ("plus today's Time Budget, always visible, and a mini month alongside
 * the day view"), the approved mockup's Main.dc.html calendar card.
 *
 * A plain month grid highlighting `today` (the server's host-timezone date,
 * AD-17 — never the browser's `new Date()`) in the gradient pill. Prev/next
 * month is pure client-side date math — Home's own data never changes
 * because Spencer looked at October — so no server round trip is needed;
 * the highlight only ever appears on the month/year that actually contains
 * `today`.
 *
 * Polish-2 (Spencer's live-app report: "I want the right section... to
 * primarily have the daily view in the entire section and have the option
 * to switch to monthly view"): this no longer renders as its own separate
 * card above the Calendar Day View — `Home.tsx` now hosts ONE calendar
 * panel with a Day/Month toggle, and this component is that panel's Month
 * content, sized to fill whatever space the panel gives it (`h-full`, no
 * own card chrome/shadow) rather than a small fixed-size widget.
 *
 * Real-use fixes plan, Task 4 (2026-09-27, "I cant see my google calendar
 * on other days when i select a day on the month view. it just reverts
 * back to day"): `onSelectDay` now carries the CLICKED day's own ISO date
 * (`YYYY-MM-DD`) — polish-2 deliberately dropped it because only today's
 * data existed client-side; `Home.tsx` now fetches any date's calendar
 * server-side (`lib/calendarDay.ts`), so a click switches Day to the
 * clicked date instead of always reverting to today.
 */
import { useState } from "react";
import { ICON_BUTTON, ROW_HOVER_FLAT } from "../lib/controlStyles.ts";

const WEEKDAY_LABELS = [
  { short: "S", full: "Sunday" },
  { short: "M", full: "Monday" },
  { short: "T", full: "Tuesday" },
  { short: "W", full: "Wednesday" },
  { short: "T", full: "Thursday" },
  { short: "F", full: "Friday" },
  { short: "S", full: "Saturday" },
] as const;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export interface MiniMonthProps {
  /** ISO-8601 `YYYY-MM-DD`, the server's "today" (AD-17). */
  readonly today: string;
  /** Task 4: called with the clicked day's own ISO `YYYY-MM-DD` date — Home's signal to switch to Day view for THAT date (see this file's doc comment). */
  readonly onSelectDay?: (date: string) => void;
}

/** Zero-padded `YYYY-MM-DD` for a grid cell — `month` 0-based, matching `buildMonthGrid`. */
function isoDateForCell(year: number, month: number, day: number): string {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Every calendar day-of-month cell for `(year, month)` (`month` 0-based), padded with `undefined` so the grid always starts on the correct weekday column. */
function buildMonthGrid(year: number, month: number): readonly (number | undefined)[] {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | undefined)[] = Array.from({ length: firstWeekday }, () => undefined);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);
  return cells;
}

export function MiniMonth({ today, onSelectDay }: MiniMonthProps): React.JSX.Element {
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number) as [number, number, number];
  const [viewed, setViewed] = useState({ year: todayYear, month: todayMonth - 1 });

  const cells = buildMonthGrid(viewed.year, viewed.month);
  const isViewingCurrentMonth = viewed.year === todayYear && viewed.month === todayMonth - 1;

  const goToPreviousMonth = (): void => setViewed((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }));
  const goToNextMonth = (): void => setViewed((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }));

  return (
    <section aria-label={`${MONTH_NAMES[viewed.month]} ${viewed.year}`} className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="font-body text-heading font-bold text-ink-primary">
          {MONTH_NAMES[viewed.month]} {viewed.year}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={goToPreviousMonth}
            className={`size-11 ${ICON_BUTTON}`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={goToNextMonth}
            className={`size-11 ${ICON_BUTTON}`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
      {/* Polish-2: "larger, filling the panel" (this task's own brief) — a
          fluid grid (min-h-0 flex-1) instead of a small fixed-size widget,
          each row sharing the panel's remaining height evenly. */}
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[auto_repeat(6,minmax(0,1fr))] gap-1 text-center font-body">
        {WEEKDAY_LABELS.map((label, i) => (
          <span key={i} className="py-1 text-small font-bold text-ink-secondary">
            <span aria-hidden="true">{label.short}</span>
            <span className="sr-only">{label.full}</span>
          </span>
        ))}
        {cells.map((day, i) =>
          day === undefined ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => onSelectDay?.(isoDateForCell(viewed.year, viewed.month, day))}
              aria-label={isViewingCurrentMonth && day === todayDay ? `Today, ${MONTH_NAMES[viewed.month]} ${day}` : `${MONTH_NAMES[viewed.month]} ${day}`}
              aria-current={isViewingCurrentMonth && day === todayDay ? "date" : undefined}
              className={`flex items-center justify-center rounded-md tabular-nums ${ROW_HOVER_FLAT}`}
            >
              {isViewingCurrentMonth && day === todayDay ? (
                <span className="flex size-11 items-center justify-center rounded-full bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end text-title font-bold text-on-accent-solid">
                  {day}
                </span>
              ) : (
                <span className="text-body text-ink-primary">{day}</span>
              )}
            </button>
          ),
        )}
      </div>
    </section>
  );
}
