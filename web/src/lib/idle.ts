/**
 * web/src/lib/idle.ts
 *
 * Story 7.6, FR-45/EXPERIENCE.md "Idle 10 min": the ONE defining export for
 * the idle timeout (Shared tuning constants convention — no other file in
 * web/ redeclares 10 minutes as a literal). Keys, pointer movement, and
 * scroll all count as input — not only key presses.
 */
import { useEffect, useState } from "react";

export const SCREENSAVER_IDLE_MS = 10 * 60 * 1000;

const ACTIVITY_EVENTS = ["keydown", "pointermove", "scroll", "wheel"] as const;

export function useIdleScreensaver(): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const reset = (): void => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), SCREENSAVER_IDLE_MS);
    };

    reset();
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, reset);
    return () => {
      clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, reset);
    };
  }, []);

  return idle;
}
