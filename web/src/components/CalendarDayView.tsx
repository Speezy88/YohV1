/**
 * web/src/components/CalendarDayView.tsx — DESIGN.md `Calendar Day View` /
 * `Calendar Block`, UX-DR32. Today only, computed entirely server-side
 * (AD-17) — this component only lays out `blocks` in the order/placement
 * `GET /api/home` already gave it, never re-sorts or re-derives anything.
 *
 * Yoh-owned (`work`/`break`) blocks render filled with the accent
 * gradient. `fixed` (non-Yoh) blocks render cross-hatched,
 * `event-fixed-ink`, no shadow, label suffixed " · fixed" *(fix round 2,
 * 2026-09-27 review finding 2: was " (fixed)" — DESIGN.md's own literal
 * suggestion — until a narrow, long fixed block was found clipping its own
 * text; see this file's later fix-round doc block)* — drag behavior is
 * Epic 10, out of scope here. Past or completed blocks are visibly
 * read-only (`aria-disabled`, reduced opacity, a struck-through label for a
 * completed work block) — including a past FIXED block, which keeps its
 * cross-hatch/ink/no-shadow/"· fixed" treatment but dims the same way a
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
 *
 * Polish-1 (2026-09-27) fix round, two more real bugs from the live app:
 * 3. Overlapping events used to render full-lane-width, on top of one
 *    another (every block was `left: CONTENT_LEFT_PX, right: 8px`,
 *    regardless of what else occupied the same time range). Blocks now
 *    share the lane in side-by-side columns, Google-Calendar-style, via
 *    `lib/calendarLayout.ts`'s pure `layoutOverlappingIntervals` — a
 *    non-overlapping block still gets the full lane (unchanged), an
 *    overlapping one gets `1/columnCount` of it at `column/columnCount`
 *    offset. Column 0's `left` stays the same literal `CONTENT_LEFT_PX`
 *    pixel number as before (existing tests read it directly); a non-zero
 *    column's `left`/`width` are `calc()` expressions against the lane's
 *    actual (fluid) rendered width, since that width isn't known ahead of
 *    real layout.
 * 4. A block's label now scales down with how much room it has: under
 *    `TITLE_ONLY_MINUTES` (~20min) shows just the truncated title (no
 *    room for anything else); under `VERY_SHORT_MINUTES` (~45min) shows a
 *    one-line "Title · 10:30" (`hostTime.ts`'s `formatClockTime`,
 *    HOST-timezone, same as every other position/format in this file); at
 *    or above that, the existing full label (unchanged).
 *
 * Fix round (2026-09-27 review of the above): finding 2 — the old minimum
 * height (`HOUR_HEIGHT_PX / 4` = 14px) was smaller than a block's own
 * padding + one line of text, so a very short block's title was clipped
 * away entirely rather than truncated. `capBlockHeight` now bumps a short
 * block up to `MIN_BLOCK_HEIGHT_PX` (enough for one compact line), capped so
 * it never grows past where the NEXT block anywhere in the day starts —
 * never overlapping another block's own rendered text — and a single-line
 * block gets reduced vertical padding (`py-0.5` + `items-center`, not the
 * normal block's `py-1.5`) so that minimum height is actually enough.
 *
 * Fix round 2 (2026-09-27 review, finding 2): a FIXED (cross-hatched)
 * anchor's own duration doesn't determine how NARROW its column is (that's
 * `layoutOverlappingIntervals`'s job, driven by how many OTHER events it
 * overlaps) — a long-but-narrow fixed block was still wrapping onto more
 * lines than its (duration-derived, not room-capped) height could show,
 * clipping the tail of its own label. `blockLabelContent`'s new
 * `alwaysSingleLine` parameter (`isFixed`, always true for a fixed anchor)
 * skips the duration tiers entirely and always renders compact/
 * single-line/truncated, the same treatment a very-short block gets. The
 * "(fixed)" suffix is also now the shorter "· fixed" (matching the
 * "Title · 10:30" separator convention already used elsewhere in this
 * file) so it reliably fits alongside the title before truncating.
 *
 * Polish-2 (2026-09-27, Spencer's live-app report — "the daily google
 * calendar visualization also is hard to see" — real bugs, not a redesign):
 * `Home.tsx` now gives this component the calendar panel's ENTIRE column
 * height (no more fixed 380px card), so 1. `HOUR_HEIGHT_PX` grows 56->72px
 * and every text size/min-height here grows with it (hour labels >=12px,
 * event titles >=13px semibold); 2. a fixed `BLOCK_GAP_PX` is trimmed off
 * every block at/above the readable-height floor so back-to-back blocks
 * read as separate boxes, not one seamless slab (`applyBlockGap`); 3. break
 * blocks get their own quiet (outline, no fill/shadow/bold) treatment, with
 * a label only once the box is tall enough to hold it
 * (`BREAK_LABEL_MIN_HEIGHT_PX`); 4. the mount-time auto-scroll now targets
 * "now" (or the first event, if it starts earlier) sitting about a third
 * of the way down the panel, rather than a fixed lead above the top edge.
 */
import { useLayoutEffect, useRef } from "react";
import type { HomeCalendarBlock } from "../../../src/types/api.ts";
import { displayLabel } from "../lib/labels.ts";
import { formatClockTime, localMinutesSinceMidnight } from "../lib/hostTime.ts";
import { layoutOverlappingIntervals } from "../lib/calendarLayout.ts";

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;
const WINDOW_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;
/**
 * Per-hour row height, in px. Polish-2 (Spencer's live-app report: "the
 * daily google calendar visualization also is hard to see" — back-to-back
 * short Plan blocks collapsed into unreadable stacked slivers at the old
 * 56px/hour): bumped to 72px/hour, this task's own readability floor, now
 * that the panel takes the calendar's full column height instead of a
 * fixed 380px card (`Home.tsx`) — there's room for it.
 */
const HOUR_HEIGHT_PX = 72;
const CONTENT_HEIGHT_PX = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT_PX;
/** The hour-label gutter's width, in px — the approved mockup's own ~52px right-aligned label column. */
const HOUR_LABEL_WIDTH_PX = 52;
/** Where blocks/the now-line start — clear of the label gutter, plus a small gap (mockup: labels end ~62px, blocks start ~70px). */
const CONTENT_LEFT_PX = HOUR_LABEL_WIDTH_PX + 12;
/** The lane's own right-edge gap, matching the `right-2` Tailwind class (0.5rem = 8px) every block already used. */
const CONTENT_RIGHT_PX = 8;
/** Gap between side-by-side columns of overlapping blocks, in px. */
const COLUMN_GAP_PX = 3;
/**
 * Polish-2 (Spencer's live-app report, the other half of the "hard to see"
 * bug): a small fixed visual gap trimmed off a block's rendered bottom edge
 * so two vertically back-to-back blocks (one ending exactly when the next
 * starts) read as two separate boxes, not one seamless slab. Only trimmed
 * off a block that's already comfortably at/above `MIN_BLOCK_HEIGHT_PX`
 * (see `applyBlockGap`) — a block still being bumped UP toward that floor
 * (capped by how close its neighbor is) keeps every px it can get instead.
 */
const BLOCK_GAP_PX = 2;
/**
 * A break block's label is dropped entirely below this rendered height —
 * "a label only if tall enough" (this task's own brief) — rather than
 * clipping/truncating text into an unreadable sliver. The block itself
 * still renders (so its low-emphasis fill/outline stays visible as a time
 * marker), just without text that wouldn't fit legibly anyway.
 */
const BREAK_LABEL_MIN_HEIGHT_PX = 18;
/** Polish-1: a block shorter than this shows just its (truncated) title — no time, no room for anything else. */
const TITLE_ONLY_MINUTES = 20;
/** Polish-1: a block shorter than this (but at/above `TITLE_ONLY_MINUTES`) shows a single-line "Title · 10:30" label instead of the full multi-line treatment. */
const VERY_SHORT_MINUTES = 45;
/**
 * Fix round (review finding 2): the old floor (`HOUR_HEIGHT_PX / 4` = 14px)
 * was smaller than the compact single-line block's own padding + text, so a
 * very short block's title was clipped away entirely — a 10-minute block at
 * `HOUR_HEIGHT_PX` = 56px/hour rendered at just ~9px tall. 22px comfortably
 * fits one `text-small` line plus the compact block's own minimal vertical
 * padding (`py-0.5`, see the single-line className below).
 * Polish-2: bumped from 22px to 28px alongside the hour-height/font-size
 * increase, so a bumped-up block comfortably fits the now-`font-semibold`,
 * >=13px event title.
 */
const MIN_BLOCK_HEIGHT_PX = 28;

/**
 * Polish-2: trims `BLOCK_GAP_PX` off a block's rendered height, but only
 * once it's already at/above `MIN_BLOCK_HEIGHT_PX` — a block still relying
 * on `capBlockHeight`'s bump-up-toward-the-floor logic (a genuinely tiny
 * block squeezed by a close neighbor) keeps its full computed height
 * instead of losing even more room to the gap.
 */
function applyBlockGap(height: number): number {
  return height > MIN_BLOCK_HEIGHT_PX ? height - BLOCK_GAP_PX : height;
}

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

/**
 * `left`/`width` for a block at `column` of `columnCount` within the
 * day-content lane (`CONTENT_LEFT_PX` to `right: CONTENT_RIGHT_PX`). A
 * non-overlapping block (`columnCount` 1) keeps the exact literal
 * `CONTENT_LEFT_PX` px number `left` value the pre-existing tests read
 * directly, and no `width` override — it still relies on the `right-2`
 * Tailwind class for full-lane width, unchanged from before this fix. A
 * genuinely shared lane needs an explicit `calc()` against the lane's own
 * (fluid) rendered width, which isn't known ahead of real layout — column 0
 * of a shared lane still starts at the literal `CONTENT_LEFT_PX` (0 of any
 * fraction is 0), so only `column > 0` needs the `calc()` for `left`.
 */
function columnStyle(column: number, columnCount: number): { left: number | string; width?: string } {
  if (columnCount <= 1) {
    return { left: CONTENT_LEFT_PX };
  }
  const laneWidth = `(100% - ${CONTENT_LEFT_PX}px - ${CONTENT_RIGHT_PX}px)`;
  const left = column === 0 ? CONTENT_LEFT_PX : `calc(${CONTENT_LEFT_PX}px + ${laneWidth} * ${column} / ${columnCount})`;
  const width = `calc(${laneWidth} / ${columnCount} - ${COLUMN_GAP_PX}px)`;
  return { left, width };
}

/**
 * Fix round (review finding 2): a very short block's rendered height is
 * bumped up to `MIN_BLOCK_HEIGHT_PX` so its (now compact, single-line) title
 * actually has room to show — but never past where the NEXT block anywhere
 * in the day starts, so a bumped-up box can never visually run into (and
 * clip/overlap) another block's own text. `positions` is every OTHER
 * block's own natural (un-bumped) `{top, bottom}`; the cap is the nearest
 * `top` at or after `naturalBottom`, or the end of the rendered day if none.
 * The result is always >= `naturalBottom - top` (never shrinks a block
 * below its own real duration) — `desired` and `cap` are both floored by
 * that in `capBlockHeight`'s single `Math.min`/`Math.max` combination.
 */
function capBlockHeight(top: number, naturalBottom: number, positions: readonly { readonly id: string; readonly top: number }[], selfId: string): number {
  const rawHeight = naturalBottom - top;
  const desired = Math.max(rawHeight, MIN_BLOCK_HEIGHT_PX);
  let nextBoundary = CONTENT_HEIGHT_PX;
  for (const p of positions) {
    if (p.id === selfId) continue;
    if (p.top >= naturalBottom && p.top < nextBoundary) nextBoundary = p.top;
  }
  const room = Math.max(rawHeight, nextBoundary - top);
  return Math.min(desired, room);
}

/**
 * A block's label scales down with how much room it has (this task's own
 * brief): under `TITLE_ONLY_MINUTES` shows just the (truncated) title, no
 * time; under `VERY_SHORT_MINUTES` shows a single-line "Title · 10:30"; at
 * or above that, the full `baseLabel` unchanged (multi-line if it wraps).
 *
 * Fix round 2 (review finding 2): `alwaysSingleLine` (fixed/cross-hatched
 * anchors — see `columnStyle`'s own doc comment: a fixed anchor can land in
 * a NARROW column purely from how many other events it happens to overlap,
 * independent of its own duration) skips the duration-based tiers entirely
 * and always renders compact/single-line/truncated — a fixed block that
 * happens to be both long AND narrow used to wrap onto more lines than its
 * (duration-derived) height could show, clipping the tail of its own label.
 */
function blockLabelContent(baseLabel: string, durationMinutes: number, startIso: string, timeZone: string, alwaysSingleLine: boolean): { text: string; singleLine: boolean } {
  if (alwaysSingleLine || durationMinutes < TITLE_ONLY_MINUTES) {
    return { text: baseLabel, singleLine: true };
  }
  if (durationMinutes < VERY_SHORT_MINUTES) {
    return { text: `${baseLabel} · ${formatClockTime(new Date(startIso), timeZone)}`, singleLine: true };
  }
  return { text: baseLabel, singleLine: false };
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
  // Polish-1: one pure layout pass over every block's HOST-timezone pixel
  // interval, up front — `layoutOverlappingIntervals` (lib/calendarLayout.ts)
  // never re-sorts/re-derives the blocks themselves (AD-17 stays server's
  // job), it only decides how many columns an overlapping cluster shares.
  const columns = layoutOverlappingIntervals(blocks.map((b) => ({ id: b.id, start: isoOffsetPx(b.start, timeZone), end: isoOffsetPx(b.end, timeZone) })));
  // Every block's own natural (un-bumped) top, for `capBlockHeight`'s "don't grow past where the next block starts" guard.
  const naturalTops = blocks.map((b) => ({ id: b.id, top: isoOffsetPx(b.start, timeZone) }));

  // Opens already scrolled so the current time — or the first event, if it
  // starts EARLIER than now (this task's own brief) — sits about a third of
  // the way down the panel, not pinned to the very top. A layout effect
  // (before paint) so there is no visible jump from "top of day" to this
  // position.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstBlockTopPx = blocks.length > 0 ? Math.min(...blocks.map((b) => isoOffsetPx(b.start, timeZone))) : undefined;
    const anchorPx = firstBlockTopPx === undefined ? nowTopPx : Math.min(nowTopPx, firstBlockTopPx);
    el.scrollTop = Math.max(0, anchorPx - el.clientHeight / 3);
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
                // Polish-2 (real bug: "hard to see"): `text-caption` (10.6px)
                // was below the 12px readability floor this task sets for
                // hour labels; `text-caption-lg` (tokens.css) is the new
                // >=12px token, ink-secondary unchanged.
                className="shrink-0 pr-2 text-right font-body text-caption-lg font-bold uppercase tracking-wide text-ink-secondary"
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
          // Polish-2 (this task's brief): break blocks are visually quiet —
          // a low-emphasis outline, no fill/shadow/bold — so they never
          // compete with Work/fixed events for attention.
          const isBreak = b.kind === "break";
          const label = displayLabel(b.label);
          // Fix round 2 (review finding 2): "· fixed" (short, always fits
          // one truncated line with the label) instead of " (fixed)" (long
          // enough that a narrow column could wrap/clip it) — see
          // `blockLabelContent`'s own doc comment.
          const baseLabel = isFixed ? `${label} · fixed` : label;
          const top = isoOffsetPx(b.start, timeZone);
          const bottom = isoOffsetPx(b.end, timeZone);
          // A break never gets bumped up toward `MIN_BLOCK_HEIGHT_PX` the
          // way a Work/fixed block does — "a label only if tall enough"
          // (this task's own brief) is decided against its REAL duration,
          // not an artificially grown box; it just renders at its true
          // size (still gap-trimmed like every other block).
          const height = applyBlockGap(isBreak ? Math.max(bottom - top, 0) : capBlockHeight(top, bottom, naturalTops, b.id));
          const placement = columns.get(b.id) ?? { column: 0, columnCount: 1 };
          const { left, width } = columnStyle(placement.column, placement.columnCount);
          const durationMinutes = (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60_000;
          const content = blockLabelContent(baseLabel, durationMinutes, b.start, timeZone, isFixed);
          // Polish-2: a break's label only shows once the (post-gap)
          // rendered box is tall enough to hold it legibly — the box itself
          // still renders either way, as a quiet time marker.
          const showLabel = !isBreak || height >= BREAK_LABEL_MIN_HEIGHT_PX;
          // Fix round (review finding 2): a compact single-line block gets
          // minimal vertical padding plus flex-centering (so its one line of
          // text stays vertically centered regardless of exactly how much
          // `capBlockHeight` could grant it) instead of the normal block's
          // fixed top-anchored padding.
          const layoutClasses = content.singleLine ? "flex items-center py-0.5" : "py-1.5";
          // Event titles are semibold, >=13px (--text-small, 15px), on a
          // solid/opaque fill (this task's brief) — except a break block,
          // deliberately quiet (an outline, no fill, not bold) so it never
          // competes with Work/fixed events.
          const kindClasses = isFixed
            ? "border border-rim-structural bg-[repeating-linear-gradient(45deg,var(--color-event-fixed-stripe-a),var(--color-event-fixed-stripe-a)_6px,var(--color-event-fixed-stripe-b)_6px,var(--color-event-fixed-stripe-b)_12px)] text-event-fixed-ink font-semibold"
            : isBreak
              ? "border border-dashed border-rim-structural/60 bg-transparent text-ink-secondary"
              : "bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end text-on-accent-solid shadow-extruded-sm font-semibold";
          return (
            <div
              key={b.id}
              data-testid="calendar-block"
              data-kind={b.kind}
              aria-disabled={readOnly}
              aria-label={showLabel ? undefined : content.text}
              className={
                `${kindClasses} absolute right-2 overflow-hidden rounded-sm px-3 ${layoutClasses} font-body text-small ` +
                `${readOnly ? "opacity-60" : ""} ${b.completed ? "line-through" : ""} ${content.singleLine ? "truncate whitespace-nowrap" : ""}`
              }
              style={{ top, height, left, ...(width !== undefined ? { width } : {}) }}
            >
              {showLabel ? content.text : null}
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
