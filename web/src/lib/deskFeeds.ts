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
import type { DeskFeedsResponse, FeedResult } from "../../../src/types/api.ts";

/** Ruling E12-R23: when a refetch fails and the last good load is older than this, `ok` feeds are shown as stale. */
export const DESK_FEEDS_MAX_AGE_MS = 15 * 60 * 1000;

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

function staled<T>(feed: FeedResult<T>): FeedResult<T> {
  return feed.status === "ok" ? { ...feed, status: "stale" } : feed;
}

/** After a failed refetch: keep the values, but once the last load is over 15 minutes old show each `ok` feed as stale. */
function degraded(current: DeskFeedsState): DeskFeedsState | undefined {
  if (current.status !== "loaded" || Date.now() - current.loadedAt.getTime() <= DESK_FEEDS_MAX_AGE_MS) return undefined;
  const { crypto, weather, news } = current.value;
  if (crypto.status !== "ok" && weather.status !== "ok" && news.status !== "ok") return undefined;
  return { ...current, value: { ...current.value, crypto: staled(crypto), weather: staled(weather), news: staled(news) } };
}

async function load(): Promise<void> {
  const mine = ++latestRequest;
  let next: DeskFeedsState | undefined;
  try {
    const res = await apiClient.api.desk.feeds.$get();
    const result = await res.json();
    if (result.ok) next = { status: "loaded", value: result.value, loadedAt: new Date() };
    else next = state.status === "loaded" ? degraded(state) : { status: "error", message: result.error.message };
  } catch {
    next = state.status === "loaded" ? degraded(state) : { status: "error", message: UNREACHABLE_COPY };
  }
  if (mine !== latestRequest) return; // an older answer never overwrites a newer one
  // Stale beats blank: after a successful load, a failed refetch keeps what is on screen (marked stale once it is over 15 minutes old).
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
