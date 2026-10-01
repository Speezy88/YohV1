/**
 * web/src/components/Screensaver.tsx
 *
 * Story 7.6, DESIGN.md `Screensaver`: a full-bleed drifting gradient-dot
 * field with the centered "Yoh Meeseek" Montserrat wordmark. Never data or
 * notifications. `[ASSUMPTION: resolves UX OQ15]` dot count/speed/wordmark
 * size are tuned-by-eye constants, exported once here.
 *
 * Two variants:
 *  - "splash": the cold-launch cover. It sits inside the page-shell root
 *    (`absolute inset-0`) and is not a dialog — it's the initial paint, not
 *    an interruption of anything the user was doing.
 *  - "idle": the 10-min-idle overlay. `position: fixed` and `role="dialog"`
 *    so it reads as a real overlay layer, not a navigation — dismissing it
 *    (any input, `useIdleScreensaver`) restores the still-mounted page tree
 *    untouched (AD-17).
 */
import { useReducedMotion } from "../hooks/useReducedMotion.ts";

export const SCREENSAVER_DOT_COUNT = 24;
export const SCREENSAVER_DOT_SPEED_S = 18;
export const SCREENSAVER_WORDMARK_SIZE_PX = 40;

export interface ScreensaverProps {
  readonly variant: "splash" | "idle";
}

export function Screensaver({ variant }: ScreensaverProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const dots = Array.from({ length: SCREENSAVER_DOT_COUNT }, (_, i) => i);

  return (
    <div
      className={`${variant === "idle" ? "fixed" : "absolute"} inset-0 z-(--z-splash) bg-surface-base`}
      role={variant === "idle" ? "dialog" : undefined}
      aria-label={variant === "idle" ? "Idle — any input returns to Yoh" : undefined}
    >
      <div data-testid="screensaver-dots" data-animated={!reducedMotion} className="absolute inset-0 overflow-hidden">
        {dots.map((i) => (
          <span
            key={i}
            className="absolute rounded-full bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end opacity-40"
            style={{
              width: 6 + (i % 5) * 2,
              height: 6 + (i % 5) * 2,
              left: `${(i * 37) % 100}%`,
              top: `${(i * 53) % 100}%`,
              animation: reducedMotion ? "none" : `screensaver-drift ${SCREENSAVER_DOT_SPEED_S}s ease-in-out infinite alternate`,
              animationDelay: reducedMotion ? undefined : `${i * 0.3}s`,
            }}
          />
        ))}
      </div>
      <div
        className="relative flex h-full items-center justify-center font-wordmark font-bold text-ink-primary"
        style={{ fontSize: SCREENSAVER_WORDMARK_SIZE_PX }}
      >
        Yoh Meeseek
      </div>
    </div>
  );
}
