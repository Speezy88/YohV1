/**
 * web/src/components/LaunchSplash.tsx
 *
 * The cold-launch cover: a full-bleed drifting gradient-dot field with the
 * centered "Yoh Meeseek" Montserrat wordmark. Never data or notifications.
 * Dot count/speed/wordmark size are tuned-by-eye constants, exported once
 * here.
 *
 * It sits inside the page-shell root (`absolute inset-0`) and is not a
 * dialog — it's the initial paint, not an interruption of anything the user
 * was doing. `PageShell` owns when it shows and its exit fade.
 */
import { useReducedMotion } from "../hooks/useReducedMotion.ts";

export const SPLASH_DOT_COUNT = 24;
export const SPLASH_DOT_SPEED_S = 18;
export const SPLASH_WORDMARK_SIZE_PX = 40;

export function LaunchSplash(): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const dots = Array.from({ length: SPLASH_DOT_COUNT }, (_, i) => i);

  return (
    <div className="absolute inset-0 z-(--z-splash) bg-surface-base">
      <div data-testid="splash-dots" data-animated={!reducedMotion} className="absolute inset-0 overflow-hidden">
        {dots.map((i) => (
          <span
            key={i}
            className="absolute rounded-full bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end opacity-40"
            style={{
              width: 6 + (i % 5) * 2,
              height: 6 + (i % 5) * 2,
              left: `${(i * 37) % 100}%`,
              top: `${(i * 53) % 100}%`,
              animation: reducedMotion ? "none" : `splash-drift ${SPLASH_DOT_SPEED_S}s ease-in-out infinite alternate`,
              animationDelay: reducedMotion ? undefined : `${i * 0.3}s`,
            }}
          />
        ))}
      </div>
      <div
        className="relative flex h-full items-center justify-center font-wordmark font-bold text-ink-primary"
        style={{ fontSize: SPLASH_WORDMARK_SIZE_PX }}
      >
        Yoh Meeseek
      </div>
    </div>
  );
}
