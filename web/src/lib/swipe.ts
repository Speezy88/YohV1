/**
 * web/src/lib/swipe.ts
 *
 * Story 7.6, EXPERIENCE.md Interaction Primitives: a two-finger horizontal
 * trackpad swipe (macOS/Windows precision touchpads report this as `wheel`
 * events with a dominant `deltaX`, not touch events, which are for
 * touchscreens only) moves one page, PROVIDED the gesture didn't start
 * inside a horizontally-scrollable descendant of the page-shell root (the
 * calendar, a ticker row, a heatmap). One physical swipe — many `wheel`
 * ticks — fires exactly one page change: ticks accumulate into one
 * "gesture" until `GESTURE_IDLE_MS` passes with no further ticks, and only
 * the first tick to cross `SWIPE_THRESHOLD_PX` within a gesture fires
 * `onSwipe`.
 */
import { useEffect, useRef } from "react";

const SWIPE_THRESHOLD_PX = 40;
const GESTURE_IDLE_MS = 150;

export function isInsideHorizontallyScrollable(target: Element, root: Element): boolean {
  let el: Element | null = target;
  while (el && el !== root) {
    const style = getComputedStyle(el);
    const scrollableStyle = style.overflowX === "auto" || style.overflowX === "scroll";
    if (scrollableStyle && el.scrollWidth > el.clientWidth) return true;
    el = el.parentElement;
  }
  return false;
}

export function useSwipeNavigation(rootRef: React.RefObject<HTMLElement | null>, onSwipe: (direction: 1 | -1) => void): void {
  const gesture = useRef<{ accumulated: number; fired: boolean; idleTimer: ReturnType<typeof setTimeout> | undefined }>({
    accumulated: 0,
    fired: false,
    idleTimer: undefined,
  });
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || e.ctrlKey) return; // vertical-dominant, zero-delta, or pinch-zoom
      if (e.target instanceof Element && isInsideHorizontallyScrollable(e.target, root)) return;

      e.preventDefault();
      const g = gesture.current;
      clearTimeout(g.idleTimer);
      g.accumulated += e.deltaX;
      g.idleTimer = setTimeout(() => {
        g.accumulated = 0;
        g.fired = false;
      }, GESTURE_IDLE_MS);

      if (!g.fired && Math.abs(g.accumulated) >= SWIPE_THRESHOLD_PX) {
        g.fired = true;
        onSwipeRef.current(g.accumulated > 0 ? 1 : -1);
      }
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      root.removeEventListener("wheel", onWheel);
      clearTimeout(gesture.current.idleTimer);
    };
  }, [rootRef]);
}
