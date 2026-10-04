/**
 * web/src/lib/desk.ts
 *
 * Epic 12: the Desk page's own small store, the same `useSyncExternalStore`
 * shape as `homeView.ts`. Fetches `GET /api/desk` on start, refetches on a
 * `tasks` or `plan` hint from the shared event bus (`eventBus.ts`, never a
 * second EventSource) and when the tab becomes visible again
 * (`visibleRefresh.ts`).
 */
import { useSyncExternalStore } from "react";
import { onHint } from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import { onVisibleRefresh } from "./visibleRefresh.ts";
import type { DeskResponse } from "../../../src/types/api.ts";

export type DeskState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly value: DeskResponse; readonly loadedAt: Date; readonly refreshFailed?: { readonly message: string; readonly at: Date } }
  | { readonly status: "error"; readonly message: string; readonly retrying?: boolean };

let state: DeskState = { status: "loading" };
/** Increments per request; only the newest request's answer is applied. */
let latestRequest = 0;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

/** Fixed copy for a thrown failure; a caught Error's own text is never stored or shown. */
const UNREACHABLE_COPY = "I couldn't reach Yoh's server just now.";

function fail(message: string): void {
  // Stale beats blank: after a successful load, keep the view.
  state = state.status === "loaded" ? { ...state, refreshFailed: { message, at: state.loadedAt } } : { status: "error", message };
}

async function load(): Promise<void> {
  const mine = ++latestRequest;
  let next: () => void;
  try {
    const res = await apiClient.api.desk.$get();
    const result = await res.json();
    next = result.ok ? () => (state = { status: "loaded", value: result.value, loadedAt: new Date() }) : () => fail(result.error.message);
  } catch {
    next = () => fail(UNREACHABLE_COPY);
  }
  if (mine !== latestRequest) return; // an older answer never overwrites a newer one
  next();
  notify();
}

export function useDesk(): DeskState {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => state,
  );
}

/** A manual refetch (the error state's "Try again"). */
export function refetchDesk(): Promise<void> {
  if (state.status === "error") {
    state = { ...state, retrying: true };
    notify();
  }
  return load();
}

/**
 * Starts the fetch and the hint / visibility subscriptions. The page calls it
 * when Desk becomes the page in view and stops it when Desk is left, so
 * nothing is fetched while another page is showing. Returns a stop function.
 */
export function startDeskStream(): () => void {
  void load();
  const stopHints = onHint((hint) => {
    if (hint.topic === "tasks" || hint.topic === "plan") void load();
  });
  const stopVisible = onVisibleRefresh(() => void load());
  return () => {
    stopHints();
    stopVisible();
  };
}

/** Test-only: clears module-level state between tests. */
export function __resetDeskForTests(): void {
  state = { status: "loading" };
  latestRequest = 0;
}
