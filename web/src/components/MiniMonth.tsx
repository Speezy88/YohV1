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
 */
import { useState } from "react";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
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
}

/** Every calendar day-of-month cell for `(year, month)` (`month` 0-based), padded with `undefined` so the grid always starts on the correct weekday column. */
function buildMonthGrid(year: number, month: number): readonly (number | undefined)[] {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | undefined)[] = Array.from({ length: firstWeekday }, () => undefined);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);
  return cells;
}

export function MiniMonth({ today }: MiniMonthProps): React.JSX.Element {
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number) as [number, number, number];
  const [viewed, setViewed] = useState({ year: todayYear, month: todayMonth - 1 });

  const cells = buildMonthGrid(viewed.year, viewed.month);
  const isViewingCurrentMonth = viewed.year === todayYear && viewed.month === todayMonth - 1;

  const goToPreviousMonth = (): void => setViewed((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }));
  const goToNextMonth = (): void => setViewed((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }));

  return (
    <section aria-label={`${MONTH_NAMES[viewed.month]} ${viewed.year}`} className="flex flex-col gap-2.5 rounded-2xl bg-surface-raised px-6 py-5 shadow-extruded-lg">
      <div className="flex items-center justify-between">
        <span className="font-body text-title font-bold text-ink-primary">
          {MONTH_NAMES[viewed.month]} {viewed.year}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={goToPreviousMonth}
            className="flex size-[34px] items-center justify-center rounded-md border-[length:var(--rim-width)] border-rim-interactive text-ink-primary shadow-extruded-sm"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={goToNextMonth}
            className="flex size-[34px] items-center justify-center rounded-md border-[length:var(--rim-width)] border-rim-interactive text-ink-primary shadow-extruded-sm"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center font-body text-small">
        {WEEKDAY_LABELS.map((label, i) => (
          <span key={i} className="py-1 font-bold text-ink-secondary">
            {label}
          </span>
        ))}
        {cells.map((day, i) =>
          day === undefined ? (
            <span key={i} />
          ) : (
            <span key={i} className="flex items-center justify-center py-1.5">
              {isViewingCurrentMonth && day === todayDay ? (
                <span
                  aria-label={`Today, ${MONTH_NAMES[viewed.month]} ${day}`}
                  className="flex size-[30px] items-center justify-center rounded-full bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end font-bold text-on-accent-solid"
                >
                  {day}
                </span>
              ) : (
                day
              )}
            </span>
          ),
        )}
      </div>
    </section>
  );
}
