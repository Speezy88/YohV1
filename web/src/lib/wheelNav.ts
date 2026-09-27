/**
 * web/src/lib/wheelNav.ts
 *
 * Task 6A (Spencer's information-architecture decisions, 2026-09-27): side
 * swipe is retired. The page stack is now vertical, and the mouse wheel
 * changes page ONLY when the hovered scroll area is already at its edge —
 * a vertical-dominant wheel gesture inside, say, the Calendar Day View or
 * the Tasks list must scroll that content first, and only page-navigate
 * once it has nowhere further to scroll in the gesture's direction. This
 * mirrors `swipe.ts`'s retired gesture-accumulation debounce (one
 * continuous trackpad flick fires exactly one page change, not one per
 * `wheel` tick), but the gate is "at the scroll edge" rather than "past a
 * distance threshold," and the axis is vertical, not horizontal.
 */
import { useEffect, useRef } from "react";

const GESTURE_IDLE_MS = 150;
/** A small tolerance for the "already at the edge" check — real browsers can report a fractional-pixel scrollTop/scrollHeight even when visually at rest. */
const EDGE_TOLERANCE_PX = 2;

/**
 * True when `target`'s nearest scrollable-Y ancestor (up to `root`) is
 * already at the edge a `direction`-signed gesture would push past — or
 * when there is no such ancestor at all (the gesture started over
 * non-scrolling chrome, e.g. the sidebar or a card's own padding), which
 * trivially counts as "at the edge": nothing there to scroll first.
 */
export function isAtVerticalScrollEdge(target: Element, root: Element, direction: 1 | -1): boolean {
  let el: Element | null = target;
  while (el && el !== root) {
    const style = getComputedStyle(el);
    const scrollableStyle = style.overflowY === "auto" || style.overflowY === "scroll";
    if (scrollableStyle && el.scrollHeight > el.clientHeight) {
      if (direction > 0) return el.scrollTop + el.clientHeight >= el.scrollHeight - EDGE_TOLERANCE_PX;
      return el.scrollTop <= EDGE_TOLERANCE_PX;
    }
    el = el.parentElement;
  }
  return true;
}

/**
 * Wires an edge-aware vertical wheel gesture to `onNavigate(1 | -1)` —
 * `1` for "wheel down" (next page), `-1` for "wheel up" (previous page).
 * A horizontal-dominant or zero-delta tick, or one over a scrollable region
 * not yet at its edge, is left alone (no `preventDefault`, so normal
 * scrolling still happens); one continuous gesture past the edge still
 * fires only once, via the same idle-timeout debounce `swipe.ts` used.
 *
 * Polish-2 (Spencer's live-app report: "I do not want to be able to scroll
 * pages while my cursor is in the tasks section"): a generic opt-out. Any
 * ancestor of the wheel target marked `data-wheel-nav="off"` (the Tasks
 * page root, see `pages/Tasks.tsx`) makes this hook ignore the event
 * entirely — no `preventDefault`, no `onNavigate` — even at a scroll edge.
 * Other pages are unaffected and keep the existing edge-aware behavior.
 */
export function useWheelPageNavigation(rootRef: React.RefObject<HTMLElement | null>, onNavigate: (direction: 1 | -1) => void): void {
  const gesture = useRef<{ fired: boolean; idleTimer: ReturnType<typeof setTimeout> | undefined }>({ fired: false, idleTimer: undefined });
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || e.deltaY === 0 || e.ctrlKey) return; // horizontal-dominant, zero-delta, or pinch-zoom
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('[data-wheel-nav="off"]')) return; // an opted-out subtree (e.g. the Tasks page) owns every wheel gesture inside it
      const direction: 1 | -1 = e.deltaY > 0 ? 1 : -1;
      if (!isAtVerticalScrollEdge(e.target, root, direction)) return;

      e.preventDefault();
      const g = gesture.current;
      clearTimeout(g.idleTimer);
      g.idleTimer = setTimeout(() => {
        g.fired = false;
      }, GESTURE_IDLE_MS);

      if (!g.fired) {
        g.fired = true;
        onNavigateRef.current(direction);
      }
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      root.removeEventListener("wheel", onWheel);
      clearTimeout(gesture.current.idleTimer);
    };
  }, [rootRef]);
}
