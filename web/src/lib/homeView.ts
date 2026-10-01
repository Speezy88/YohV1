/**
 * web/src/lib/homeView.ts
 *
 * Story 7.8: Home's own small store, the same `useSyncExternalStore` shape
 * as `notifications.ts`. Fetches `GET /api/home` once on start, then
 * re-fetches on a `topic: "plan"` hint from the shared event bus
 * (`eventBus.ts`) — no separate SSE connection (AD-18) — and on tab focus /
 * visible-only polling (`visibleRefresh.ts`) for edits made directly in
 * Google Calendar, which send no hint.
 */
import { useSyncExternalStore } from "react";
import { onHint } from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import { onVisibleRefresh } from "./visibleRefresh.ts";
import type { HomeViewResponse } from "../../../src/types/api.ts";

export type HomeViewState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly value: HomeViewResponse; readonly refreshFailed?: { readonly message: string; readonly at: Date } }
  | { readonly status: "error"; readonly message: string };

let state: HomeViewState = { status: "loading" };
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}
function snapshot(): HomeViewState {
  return state;
}

/** Fixed copy for a thrown failure — a caught Error's own text is never stored or shown. */
const UNREACHABLE_COPY = "I couldn't reach Yoh's server just now.";

function fail(message: string): void {
  // Stale beats blank (P6-R7): after a successful load, keep the view.
  state = state.status === "loaded" ? { ...state, refreshFailed: { message, at: new Date() } } : { status: "error", message };
}

async function refetch(): Promise<void> {
  try {
    const res = await apiClient.api.home.$get();
    const result = await res.json();
    if (result.ok) state = { status: "loaded", value: result.value };
    else fail(result.error.message);
  } catch {
    fail(UNREACHABLE_COPY);
  }
  notify();
}

export function useHomeView(): HomeViewState {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    snapshot,
  );
}

/**
 * Task 6A: a manual re-fetch for a direct outcome of Spencer's own action
 * (saving the Time Budget widget's inline edit) — not a new polling
 * mechanism, and not a substitute for the "plan" hint above, which still
 * covers every server-side Plan change.
 */
export function refetchHomeView(): Promise<void> {
  return refetch();
}

/**
 * Starts this store's subscription to the shared event bus. Call once, near
 * Home's own mount; returns a stop function.
 */
export function startHomeViewStream(): () => void {
  void refetch();
  const stopHints = onHint((hint) => {
    if (hint.topic === "plan" || hint.topic === "open-items") void refetch();
  });
  // Focus / visible polling: first fold any Yoh Plan calendar edits into the
  // Plan (a failed sync must never block the refresh), then refetch Home.
  const stopVisible = onVisibleRefresh(async () => {
    try {
      await apiClient.api.plan.sync.$post();
    } catch {
      // Best effort; Home still refetches below.
    }
    await refetch();
  });
  return () => {
    stopHints();
    stopVisible();
  };
}

/** Test-only: clears module-level singleton state between tests. Never called from production code. */
export function __resetHomeViewForTests(): void {
  state = { status: "loading" };
}
