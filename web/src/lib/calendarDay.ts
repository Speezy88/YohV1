/**
 * web/src/lib/calendarDay.ts
 *
 * Real-use fixes plan, Task 4 ("pick any day in Month to see its
 * calendar"): a per-date fetch of `GET /api/calendar/day?date=`, cached for
 * the session (keyed by date) so switching Day <-> Month <-> Day for the
 * same date never re-fetches — same `useSyncExternalStore`-free "module
 * state + listener set" shape `lib/homeView.ts` uses, just keyed rather
 * than singleton, since more than one date can be cached at once.
 *
 * Today's own date never goes through here — `Home.tsx` already has
 * today's Calendar Day View blocks from `GET /api/home` (`lib/homeView.ts`),
 * live and re-fetched on every "plan" hint; `useCalendarDay` is passed
 * `undefined` for today so it never fetches a duplicate, stale-cached copy.
 */
import { useEffect, useState } from "react";
import { onHint } from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import type { CalendarDayResponse } from "../../../src/types/api.ts";

export type CalendarDayState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly value: CalendarDayResponse }
  | { readonly status: "error"; readonly message: string };

const cache = new Map<string, CalendarDayState>();
const listeners = new Map<string, Set<() => void>>();

function notify(date: string): void {
  listeners.get(date)?.forEach((l) => l());
}

async function fetchDay(date: string): Promise<void> {
  cache.set(date, { status: "loading" });
  notify(date);
  try {
    const res = await apiClient.api.calendar.day.$get({ query: { date } });
    const result = await res.json();
    cache.set(date, result.ok ? { status: "loaded", value: result.value } : { status: "error", message: result.error.message });
  } catch (err) {
    cache.set(date, { status: "error", message: err instanceof Error ? err.message : String(err) });
  }
  notify(date);
}

/** A direct outcome of Spencer's own action (the "Retry" line on a failed date) — not a new polling mechanism. */
export function retryCalendarDay(date: string): void {
  void fetchDay(date);
}

/**
 * `date === undefined` (today, handled by `lib/homeView.ts` instead) never
 * fetches and always reports `"loading"` — a caller conditionally ignores
 * that state rather than conditionally calling this hook (Rules of Hooks).
 */
export function useCalendarDay(date: string | undefined): CalendarDayState {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (date === undefined) return;
    if (!cache.has(date)) void fetchDay(date);
    let set = listeners.get(date);
    if (!set) {
      set = new Set();
      listeners.set(date, set);
    }
    const onChange = (): void => setTick((n) => n + 1);
    set.add(onChange);
    return () => {
      set!.delete(onChange);
    };
  }, [date]);

  // Refetches a cached date on its own "plan" hint (Calendar/Plan-block
  // change) — the single shared SSE (`eventBus.ts`), never a second
  // `EventSource` (AD-18).
  useEffect(() => {
    if (date === undefined) return;
    return onHint((hint) => {
      if (hint.topic === "plan" && hint.entityId === date) void fetchDay(date);
    });
  }, [date]);

  if (date === undefined) return { status: "loading" };
  return cache.get(date) ?? { status: "loading" };
}

/** Test-only: clears module-level singleton state between tests. Never called from production code. */
export function __resetCalendarDayForTests(): void {
  cache.clear();
  listeners.clear();
}
