/**
 * web/src/lib/deskFeeds.ts
 *
 * Ruling E12-R21: the Desk's public-feed widgets' store (`GET /api/desk/feeds`),
 * the same `useSyncExternalStore` shape as `desk.ts`. The page starts it when
 * Desk becomes the page in view: one fetch, then every 5 minutes while the
 * document is visible, and again on becoming visible (`visibleRefresh.ts`).
 * Leaving Desk stops it. No outbox hint. The browser never contacts a provider.
 */
import { useSyncExternalStore } from "react";
import { apiClient } from "./apiClient.ts";
import { onVisibleRefresh } from "./visibleRefresh.ts";
import type { DeskFeedsResponse } from "../../../src/types/api.ts";

export type DeskFeedsState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly value: DeskFeedsResponse; readonly loadedAt: Date }
  | { readonly status: "error"; readonly message: string };

let state: DeskFeedsState = { status: "loading" };
/** Increments per request; only the newest request's answer is applied. */
let latestRequest = 0;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

/** Fixed copy for a failed request; a caught Error's own text is never stored or shown. */
const UNREACHABLE_COPY = "I couldn't reach Yoh's server just now.";

async function load(): Promise<void> {
  const mine = ++latestRequest;
  let next: DeskFeedsState | undefined;
  try {
    const res = await apiClient.api.desk.feeds.$get();
    const result = await res.json();
    next = result.ok ? { status: "loaded", value: result.value, loadedAt: new Date() } : undefined;
    if (!result.ok && state.status !== "loaded") next = { status: "error", message: result.error.message };
  } catch {
    if (state.status !== "loaded") next = { status: "error", message: UNREACHABLE_COPY };
  }
  if (mine !== latestRequest) return; // an older answer never overwrites a newer one
  // Stale beats blank: after a successful load, a failed refetch keeps what is on screen.
  if (next) {
    state = next;
    notify();
  }
}

export function useDeskFeeds(): DeskFeedsState {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => state,
  );
}

/** Starts the fetch, the 5-minute visible-only poll and the refetch on becoming visible; returns a stop function. */
export function startDeskFeedsStream(): () => void {
  void load();
  return onVisibleRefresh(() => void load());
}

/** Test-only: clears module-level state between tests. */
export function __resetDeskFeedsForTests(): void {
  state = { status: "loading" };
  latestRequest = 0;
}
