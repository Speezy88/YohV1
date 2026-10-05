/**
 * web/src/components/LaunchSplash.tsx
 *
 * The cold-launch cover: a full-bleed plain surface with the centered
 * "Yoh Meeseek" Montserrat wordmark. Never data or notifications. The
 * wordmark size is a tuned-by-eye constant, exported once here: it scales
 * with the viewport width so it stays on one line on a phone.
 *
 * It sits inside the page-shell root (`absolute inset-0`) and is not a
 * dialog — it's the initial paint, not an interruption of anything the user
 * was doing. `PageShell` owns when it shows and its exit fade.
 */
export const SPLASH_WORDMARK_SIZE = "clamp(3rem, 12vw, 6rem)";

export function LaunchSplash(): React.JSX.Element {
  return (
    <div
      className="absolute inset-0 z-(--z-splash) flex items-center justify-center bg-surface-base font-wordmark font-bold text-ink-primary"
      style={{ fontSize: SPLASH_WORDMARK_SIZE }}
    >
      Yoh Meeseek
    </div>
  );
}
