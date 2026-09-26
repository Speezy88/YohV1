/**
 * web/src/components/Confetti.tsx — DESIGN.md `Birthday Confetti`, UX-DR46.
 *
 * `today` comes from the SERVER's `HomeViewResponse` (host timezone) —
 * never the browser's own clock (Consistency Conventions: "today" is never
 * computed client-side). Plays a single short burst the first time Spencer
 * views Home on Feb 19, never again the same day (a remount, a re-fetch, or
 * a re-render must not replay it) — "already shown today" is remembered in
 * `localStorage`, wrapped so a private window or blocked storage degrades
 * to "may replay on a later view the same day," never a thrown error.
 *
 * **Fix round 1 (reviewer finding #5).** The per-piece fall duration is
 * `tokens.css`'s `--duration-confetti` (read via `var(...)`, the same
 * pattern `PageShell.tsx` uses for its own splash-fade duration) — ONE
 * defining place, not a second hard-coded `1.4s` in this file. The
 * per-piece animation-delay spread is `STAGGER_MS`, this file's own ONE
 * defining place for that number (it isn't a shared cross-component design
 * token — it's a layout constant of this component's own piece count).
 * Removal no longer races a `setTimeout` guess against those two numbers:
 * each piece's real `animationend` is counted, and the whole burst unmounts
 * only once every piece has actually finished falling — so a piece can
 * never be unmounted mid-fall regardless of how the two numbers above are
 * tuned later.
 */
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";

const STORAGE_KEY = "yoh-confetti-shown";
const PIECE_COUNT = 30;
/** The one defining place for the per-piece animation-delay spread (ms) — used both to stagger pieces and, implicitly, by the animationend-counting removal below (no separate number needs to "know" the total burst length). */
const STAGGER_MS = 400;

function alreadyShownToday(today: string): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === today;
  } catch {
    return false;
  }
}
function markShown(today: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, today);
  } catch {
    // Blocked storage — confetti may replay on a later view the same day; harmless.
  }
}

export function Confetti({ today }: { readonly today: string }): React.JSX.Element | null {
  const reducedMotion = useReducedMotion();
  const [show, setShow] = useState(false);
  const finishedCount = useRef(0);

  useEffect(() => {
    if (reducedMotion) return; // UX-DR46: never under reduced motion.
    if (!today.endsWith("-02-19")) return;
    if (alreadyShownToday(today)) return;
    markShown(today);
    finishedCount.current = 0;
    setShow(true);
  }, [today, reducedMotion]);

  if (!show) return null;

  const pieces = Array.from({ length: PIECE_COUNT }, (_, i) => i);
  /** Unmounts the whole burst once every piece's OWN animation has actually finished — never a `setTimeout` racing the CSS duration/stagger. */
  const onPieceFinished = (): void => {
    finishedCount.current += 1;
    if (finishedCount.current >= PIECE_COUNT) setShow(false);
  };

  return (
    <div data-testid="confetti" aria-hidden="true" className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {pieces.map((i) => (
        <span
          key={i}
          data-testid="confetti-piece"
          onAnimationEnd={onPieceFinished}
          className={`absolute size-2 rounded-full ${i % 2 === 0 ? "bg-accent-solid" : "bg-ink-secondary"}`}
          style={{
            left: `${(i * 37) % 100}%`,
            top: "-5%",
            animationName: "confetti-fall",
            animationDuration: "var(--duration-confetti)",
            animationTimingFunction: "ease-in",
            animationFillMode: "forwards",
            animationDelay: `${(i * 53) % STAGGER_MS}ms`,
          }}
        />
      ))}
    </div>
  );
}
