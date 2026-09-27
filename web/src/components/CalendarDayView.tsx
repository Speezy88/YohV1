/**
 * web/src/components/CalendarDayView.tsx — DESIGN.md `Calendar Day View` /
 * `Calendar Block`, UX-DR32. Today only, computed entirely server-side
 * (AD-17) — this component only lays out `blocks` in the order/placement
 * `GET /api/home` already gave it, never re-sorts or re-derives anything.
 *
 * Yoh-owned (`work`/`break`) blocks render filled with the accent
 * gradient. `fixed` (non-Yoh) blocks render cross-hatched,
 * `event-fixed-ink`, no shadow, label suffixed " (fixed)" — drag behavior
 * is Epic 10, out of scope here. Past or completed blocks are visibly
 * read-only (`aria-disabled`, reduced opacity, a struck-through label for a
 * completed work block) — including a past FIXED block, which keeps its
 * cross-hatch/ink/no-shadow/"(fixed)" treatment but dims the same way a
 * past Yoh-owned block does.
 *
 * Task 6A (2026-09-27, Google-Calendar-style day view): the whole day
 * (6am-11pm) lays out at a fixed per-hour pixel height and scrolls WITHIN
 * this component's own fixed-height card (it never stretches the full
 * screen) — `Home.tsx` gives it a bounded height, this component supplies
 * its own internal scroll. It opens already scrolled to the current time
 * (a `useLayoutEffect`, so there's no visible scroll-jump on first paint),
 * and a "now" line — a thin accent bar plus a small dot — marks the
 * current moment, clamped to the visible 6am-11pm window the same way an
 * out-of-window block visually pins to an edge rather than disappearing.
 * `now` is an injectable dependency (defaults to the real clock) purely for
 * testability — it draws only a live-clock UI affordance, never a Plan
 * decision (AD-17's server-computed rule governs the blocks themselves,
 * not where a wall-clock cursor is drawn on top of them).
 *
 * Fix round (2026-09-27 review), two real bugs:
 * 1. Hour labels used to share the event lane with the blocks, so a block
 *    covered them. There is now a dedicated `HOUR_LABEL_WIDTH_PX` label
 *    gutter (mockup: ~52px, right-aligned, like Google Calendar) and every
 *    block/the now-line starts to the right of it, at `CONTENT_LEFT_PX`.
 * 2. Every position (`offsetPx`/`isoOffsetPx`) and the now-line used to
 *    read `Date.prototype.getUTCHours`/`getUTCMinutes` — i.e. always UTC,
 *    regardless of where "today" actually is. A 3pm Pacific event (22:00Z)
 *    rendered at the 10pm row. Positions are now computed in the HOST
 *    timezone (`timeZone`, required, from `HomeViewResponse.timeZone` —
 *    AD-17: never the browser's own zone) via `hostTime.ts`'s
 *    `Intl`-backed helpers.
 *
 * Untitled or punctuation-only labels read as "(No title)" (`labels.ts`),
 * shared with `PlanChecklist.tsx`.
 */
import { useLayoutEffect, useRef } from "react";
import type { HomeCalendarBlock } from "../../../src/types/api.ts";
import { displayLabel } from "../lib/labels.ts";
import { localMinutesSinceMidnight } from "../lib/hostTime.ts";

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;
const WINDOW_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;
/** Per-hour row height, in px — the approved mockup's own Google-style grid. */
const HOUR_HEIGHT_PX = 56;
const CONTENT_HEIGHT_PX = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT_PX;
/** How far above "now" the view opens, so the current moment isn't pinned to the very top edge. */
const SCROLL_LEAD_PX = HOUR_HEIGHT_PX;
/** The hour-label gutter's width, in px — the approved mockup's own ~52px right-aligned label column. */
const HOUR_LABEL_WIDTH_PX = 52;
/** Where blocks/the now-line start — clear of the label gutter, plus a small gap (mockup: labels end ~62px, blocks start ~70px). */
const CONTENT_LEFT_PX = HOUR_LABEL_WIDTH_PX + 12;

/** Pixels from the top of the full-day content, clamped — an event or the now-line outside 6am-11pm visually pins to an edge rather than disappearing or scrolling off into nothing. */
function offsetPx(minutesFromStart: number): number {
  return Math.max(0, Math.min(CONTENT_HEIGHT_PX, (minutesFromStart / WINDOW_MINUTES) * CONTENT_HEIGHT_PX));
}

/** `iso`'s offset within the rendered window, in the HOST `timeZone` — never the browser's own zone (AD-17). */
function isoOffsetPx(iso: string, timeZone: string): number {
  const minutesFromStart = localMinutesSinceMidnight(new Date(iso), timeZone) - DAY_START_HOUR * 60;
  return offsetPx(minutesFromStart);
}

function hourLabel(hour: number): string {
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}${hour < 12 ? "AM" : "PM"}`;
}

export interface CalendarDayViewProps {
  readonly blocks: readonly HomeCalendarBlock[];
  /** The host timezone (`HomeViewResponse.timeZone`, AD-17) every position below is computed in. */
  readonly timeZone: string;
  /** Test seam for the live "now" line/scroll position; defaults to the real clock. */
  readonly now?: () => Date;
}

export function CalendarDayView({ blocks, timeZone, now = () => new Date() }: CalendarDayViewProps): React.JSX.Element {
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nowValue = now();
  const nowMinutes = localMinutesSinceMidnight(nowValue, timeZone) - DAY_START_HOUR * 60;
  const nowTopPx = offsetPx(nowMinutes);
  const nowVisible = nowMinutes >= 0 && nowMinutes <= WINDOW_MINUTES;

  // Opens already scrolled to the current time — a layout effect (before
  // paint) so there is no visible jump from "top of day" to "now".
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, nowTopPx - SCROLL_LEAD_PX);
    // Mount-only: this is where the view OPENS, not something that should
    // fight Spencer's own later scrolling as time passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={scrollRef} data-testid="calendar-day-view" className="relative h-full overflow-y-auto overflow-x-hidden rounded-lg">
      <div className="relative" style={{ height: CONTENT_HEIGHT_PX }}>
        {/* The vertical rail sits at the label/content boundary, not the
            component's own left edge — a dedicated gutter, not a shared lane. */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 border-l border-rim-structural"
          style={{ left: HOUR_LABEL_WIDTH_PX }}
        />
        {hours.map((h) => (
          <div key={h} className="absolute inset-x-0" style={{ top: offsetPx((h - DAY_START_HOUR) * 60) }}>
            <div className="flex items-start">
              <span
                style={{ width: HOUR_LABEL_WIDTH_PX, marginTop: -8 }}
                className="shrink-0 pr-2 text-right font-body text-caption font-bold uppercase tracking-wide text-ink-secondary"
              >
                {hourLabel(h)}
              </span>
              <span className="mt-0 h-0 flex-1 border-t border-rim-structural/30" style={{ marginLeft: 12 }} />
            </div>
          </div>
        ))}
        {blocks.map((b) => {
          const readOnly = b.past || b.completed;
          const isFixed = b.kind === "fixed";
          const label = displayLabel(b.label);
          const top = isoOffsetPx(b.start, timeZone);
          const height = Math.max(HOUR_HEIGHT_PX / 4, isoOffsetPx(b.end, timeZone) - top);
          return (
            <div
              key={b.id}
              data-testid="calendar-block"
              data-kind={b.kind}
              aria-disabled={readOnly}
              className={
                (isFixed
                  ? "border border-rim-structural bg-[repeating-linear-gradient(45deg,var(--color-event-fixed-stripe-a),var(--color-event-fixed-stripe-a)_6px,var(--color-event-fixed-stripe-b)_6px,var(--color-event-fixed-stripe-b)_12px)] text-event-fixed-ink"
                  : "bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end text-on-accent-solid shadow-extruded-sm") +
                ` absolute right-2 overflow-hidden rounded-sm px-3 py-1.5 font-body text-small ${readOnly ? "opacity-60" : ""} ${b.completed ? "line-through" : ""}`
              }
              style={{ top, height, left: CONTENT_LEFT_PX }}
            >
              {isFixed ? `${label} (fixed)` : label}
            </div>
          );
        })}
        {nowVisible && (
          <div data-testid="calendar-now-line" aria-hidden="true" className="absolute right-0" style={{ top: nowTopPx, left: HOUR_LABEL_WIDTH_PX }}>
            <div className="absolute -top-1.5 size-3 rounded-full bg-accent-solid ring-2 ring-surface-raised" style={{ left: CONTENT_LEFT_PX - HOUR_LABEL_WIDTH_PX - 6 }} />
            <div className="h-0.5 bg-accent-solid" style={{ marginLeft: CONTENT_LEFT_PX - HOUR_LABEL_WIDTH_PX }} />
          </div>
        )}
      </div>
    </div>
  );
}
