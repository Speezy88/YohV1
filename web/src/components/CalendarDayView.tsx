/**
 * web/src/components/CalendarDayView.tsx — DESIGN.md `Calendar Day View` /
 * `Calendar Block`, UX-DR32. Today only, computed entirely server-side
 * (AD-17) — this component only lays out `blocks` in the order/placement
 * `GET /api/home` already gave it, never re-sorts or re-derives anything.
 *
 * Yoh-owned (`work`/`break`) blocks render as raised (`shadow-extruded-sm`,
 * the `--shadow-extruded-sm` token — never a hard-coded shadow value, so
 * dark mode gets its own themed shadow the same way `ThemeToggle.tsx`
 * does) cards. `fixed` (non-Yoh) blocks render cross-hatched,
 * `event-fixed-ink`, no shadow, label suffixed " (fixed)" — drag behavior
 * is Epic 10, out of scope here. Past or completed blocks are visibly
 * read-only (`aria-disabled`, reduced opacity, a struck-through label for a
 * completed work block) — including a past FIXED block, which keeps its
 * cross-hatch/ink/no-shadow/"(fixed)" treatment but dims the same way a
 * past Yoh-owned block does (fix round 1, reviewer finding #4).
 */
import type { HomeCalendarBlock } from "../../../src/types/api.ts";

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;
const WINDOW_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;

function minutesSinceDayStart(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes() - DAY_START_HOUR * 60;
}

/** Percent from the top of the rendered window, clamped — an event outside 6am-11pm visually pins to an edge rather than disappearing. */
function offsetPercent(iso: string): number {
  return Math.max(0, Math.min(100, (minutesSinceDayStart(iso) / WINDOW_MINUTES) * 100));
}

function hourLabel(hour: number): string {
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}${hour < 12 ? "AM" : "PM"}`;
}

export function CalendarDayView({ blocks }: { readonly blocks: readonly HomeCalendarBlock[] }): React.JSX.Element {
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);

  return (
    <div data-testid="calendar-day-view" className="relative h-full overflow-hidden rounded-lg border-l border-rim-structural pl-8">
      {hours.map((h) => (
        <div
          key={h}
          className="absolute left-0 w-full border-t border-rim-structural/30 pl-1 font-body text-caption font-bold uppercase tracking-wide text-ink-secondary"
          style={{ top: `${((h - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)) * 100}%` }}
        >
          {hourLabel(h)}
        </div>
      ))}
      {blocks.map((b) => {
        const readOnly = b.past || b.completed;
        const isFixed = b.kind === "fixed";
        return (
          <div
            key={b.id}
            data-testid="calendar-block"
            data-kind={b.kind}
            aria-disabled={readOnly}
            className={
              (isFixed
                ? "border border-rim-structural bg-[repeating-linear-gradient(45deg,var(--color-event-fixed-stripe-a),var(--color-event-fixed-stripe-a)_6px,var(--color-event-fixed-stripe-b)_6px,var(--color-event-fixed-stripe-b)_12px)] text-event-fixed-ink"
                : "bg-surface-raised text-ink-primary shadow-extruded-sm") +
              ` absolute left-9 right-2 overflow-hidden rounded-sm px-2 py-1 font-body text-body ${readOnly ? "opacity-60" : ""} ${b.completed ? "line-through" : ""}`
            }
            style={{ top: `${offsetPercent(b.start)}%`, height: `${Math.max(2, offsetPercent(b.end) - offsetPercent(b.start))}%` }}
          >
            {isFixed ? `${b.label} (fixed)` : b.label}
          </div>
        );
      })}
    </div>
  );
}
