/**
 * web/src/lib/activity.ts
 *
 * Ruling E12-R14: a day counts as "opened Yoh" only when Spencer clicked or
 * typed. One module-level listener on `window` sends `POST /api/activity` on
 * the first pointerdown or keydown, then again on the first one after the
 * host day changes. The host's day comes from the zone the server returned
 * (Ruling E12-R15), never the browser's own. One ping in flight at a time; a
 * failed ping changes nothing, so the next input tries again. Never on a
 * timer, focus, visibility or stream event.
 */
import { apiClient } from "./apiClient.ts";
import { hostIsoDate } from "./hostTime.ts";

const INPUT_EVENTS = ["pointerdown", "keydown"] as const;

/** The host's date and zone from the last successful ping. */
let last: { readonly date: string; readonly timeZone: string } | undefined;
let inFlight = false;

async function ping(): Promise<void> {
  inFlight = true;
  try {
    const res = await apiClient.api.activity.$post({ json: {} });
    const body = await res.json();
    if (body.ok) last = { date: body.value.date, timeZone: body.value.timeZone };
  } catch {
    // Nothing visible: the next input tries again.
  } finally {
    inFlight = false;
  }
}

function onInput(): void {
  if (inFlight) return;
  if (last !== undefined && hostIsoDate(new Date(), last.timeZone) === last.date) return;
  void ping();
}

/** Starts the one listener; returns its stop function. */
export function startActivityPing(): () => void {
  for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { passive: true, capture: true });
  return () => {
    for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true });
  };
}

export function __resetActivityForTests(): void {
  last = undefined;
  inFlight = false;
}
