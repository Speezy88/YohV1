/**
 * web/src/lib/visibleRefresh.ts
 *
 * Hotfix: changes made directly in Google Calendar send no SSE hint, so
 * Home's calendar showed them only after a reload. A store passes its
 * refresh here to re-fetch when the tab regains focus or becomes visible,
 * and every `VISIBLE_REFRESH_INTERVAL_MS` while the tab stays visible. A
 * hidden tab never polls. The shared `EventSource` (`eventBus.ts`) still
 * carries every server-side change; this only covers outside edits.
 */

/** How often a visible tab re-fetches Calendar-backed data. */
export const VISIBLE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Starts focus/visibility refreshes and visible-only polling; returns a stop function. */
export function onVisibleRefresh(refresh: () => void): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;

  const startPolling = (): void => {
    if (timer === undefined) timer = setInterval(refresh, VISIBLE_REFRESH_INTERVAL_MS);
  };
  const stopPolling = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const onFocus = (): void => refresh();
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      refresh();
      startPolling();
    } else {
      stopPolling();
    }
  };

  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (document.visibilityState === "visible") startPolling();

  return () => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    stopPolling();
  };
}
