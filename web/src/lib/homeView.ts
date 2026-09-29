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
  | { readonly status: "loaded"; readonly value: HomeViewResponse }
  | { readonly status: "error"; readonly message: string };

let state: HomeViewState = { status: "loading" };
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}
function snapshot(): HomeViewState {
  return state;
}

async function refetch(): Promise<void> {
  try {
    const res = await apiClient.api.home.$get();
    const result = await res.json();
    state = result.ok ? { status: "loaded", value: result.value } : { status: "error", message: result.error.message };
  } catch (err) {
    state = { status: "error", message: err instanceof Error ? err.message : String(err) };
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
  const stopVisible = onVisibleRefresh(() => void refetch());
  return () => {
    stopHints();
    stopVisible();
  };
}

/** Test-only: clears module-level singleton state between tests. Never called from production code. */
export function __resetHomeViewForTests(): void {
  state = { status: "loading" };
}
