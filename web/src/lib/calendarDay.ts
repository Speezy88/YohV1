/**
 * web/src/lib/calendarDay.ts
 *
 * Real-use fixes plan, Task 4 ("pick any day in Month to see its
 * calendar"): a per-date fetch of `GET /api/calendar/day?date=`, cached for
 * the session (keyed by date) so switching Day <-> Month <-> Day for the
 * same date shows the cached copy INSTANTLY — same `useSyncExternalStore`-
 * free "module state + listener set" shape `lib/homeView.ts` uses, just
 * keyed rather than singleton, since more than one date can be cached at
 * once.
 *
 * Today's own date never goes through here — `Home.tsx` already has
 * today's Calendar Day View blocks from `GET /api/home` (`lib/homeView.ts`),
 * live and re-fetched on every "plan" hint; `useCalendarDay` is passed
 * `undefined` for today so it never fetches a duplicate, stale-cached copy.
 *
 * Polish-5, Task 8: a cached date re-selected (this hook mounting again, or
 * its `date` changing back to one already cached) refreshes in the
 * background, stale-while-revalidate — the cached value stays visible the
 * whole time, since a confirmed Calendar edit elsewhere could have changed
 * that day's blocks without a "plan" hint ever reaching this date (a
 * `"resize"` change, or any other case the hint's own date can't be
 * derived, is announced topic-only — see the second `onHint` below).
 */
import { useEffect, useState } from "react";
import { onHint } from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import { onVisibleRefresh } from "./visibleRefresh.ts";
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

/**
 * `background: true` (Task 8, stale-while-revalidate) skips the "loading"
 * reset so a re-selected, already-cached date keeps showing its stale value
 * until the refresh resolves, rather than flashing back to a loading state.
 */
async function fetchDay(date: string, options: { readonly background?: boolean } = {}): Promise<void> {
  if (!options.background) {
    cache.set(date, { status: "loading" });
    notify(date);
  }
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
    if (!cache.has(date)) {
      void fetchDay(date);
    } else {
      // Task 8: re-selecting a cached non-today date (this hook mounting
      // again, or `date` changing back to one already cached) refreshes it
      // in the background — the cached value stays visible the whole time
      // (stale-while-revalidate), never resetting to "loading".
      void fetchDay(date, { background: true });
    }
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
      // Task 8: a confirmed calendar edit whose event date couldn't be
      // derived (`app/confirm-proposal.ts`'s `"calendar-edit"` branch) sends
      // a topic-only "plan" hint — no entityId — meaning "refetch every
      // cached date" rather than a specific one.
      if (hint.topic === "plan" && (hint.entityId === date || hint.entityId === "")) void fetchDay(date);
    });
  }, [date]);

  // Hotfix: edits made directly in Google Calendar send no hint — refresh
  // the shown date in the background on tab focus and while visible.
  useEffect(() => {
    if (date === undefined) return;
    return onVisibleRefresh(() => void fetchDay(date, { background: true }));
  }, [date]);

  if (date === undefined) return { status: "loading" };
  return cache.get(date) ?? { status: "loading" };
}

/** Test-only: clears module-level singleton state between tests. Never called from production code. */
export function __resetCalendarDayForTests(): void {
  cache.clear();
  listeners.clear();
}
