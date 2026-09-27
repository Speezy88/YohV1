/**
 * web/src/lib/openItems.ts
 *
 * Story 8.6 (Task 7), UX-DR36/UX-DR38, AD-5/AD-18: the open interaction
 * requests + Structured Questions Chat renders at the top of the stream —
 * the same `useSyncExternalStore` convention as `homeView.ts`/
 * `notifications.ts`. Fetches `GET /api/open-items` once on start, then
 * re-fetches on a `topic: "open-items"` hint from the shared event bus
 * (a ritual, or another open tab, changed something — never a second
 * `EventSource`, AD-18) and immediately after every answer (a just-answered
 * item needs to leave the list without waiting for a poll tick or hint).
 */
import { useSyncExternalStore } from "react";
import { onHint } from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import type { AnswerOpenItemRequest, AnswerOpenItemResponse, OpenItem } from "../../../src/types/api.ts";

export type OpenItemsState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly items: readonly OpenItem[] }
  | { readonly status: "error"; readonly message: string };

let state: OpenItemsState = { status: "loading" };
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}
function snapshot(): OpenItemsState {
  return state;
}

export async function refetchOpenItems(): Promise<void> {
  try {
    const res = await apiClient.api["open-items"].$get();
    const result = await res.json();
    state = result.ok ? { status: "loaded", items: result.value.items } : { status: "error", message: result.error.message };
  } catch (err) {
    state = { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
  notify();
}

export function useOpenItems(): OpenItemsState {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    snapshot,
  );
}

/** Starts this store's subscription to the shared event bus. Call once, near Chat's own mount; returns a stop function. */
export function startOpenItemsStream(): () => void {
  void refetchOpenItems();
  return onHint((hint) => {
    if (hint.topic === "open-items") void refetchOpenItems();
  });
}

export type AnswerOpenItemOutcome =
  | { readonly ok: true; readonly value: AnswerOpenItemResponse }
  | { readonly ok: false; readonly kind: string; readonly message: string };

/**
 * Answers one open item's CURRENT question — a chip pick or a typed "Other"
 * line both call this, the same request either way (UX-DR38: "calls the
 * same `app/` function that a typed answer would call" — this is the one
 * client-side call site both surfaces use). On success or failure alike,
 * refetches the open-items list immediately — a stale-proposal/conflict
 * rejection, or the answered item's own advance to a new question or
 * `"done"`, both need the top-of-Chat list to reflect reality right away.
 */
export async function submitOpenItemAnswer(request: AnswerOpenItemRequest): Promise<AnswerOpenItemOutcome> {
  try {
    const res = await apiClient.api["open-items"].answer.$post({ json: request });
    const result = await res.json();
    void refetchOpenItems();
    return result.ok ? { ok: true, value: result.value } : { ok: false, kind: result.error.kind, message: result.error.message };
  } catch (err) {
    return { ok: false, kind: "unreachable", message: err instanceof Error ? err.message : String(err) };
  }
}

/** Test-only: clears module-level singleton state between tests. Never called from production code. */
export function __resetOpenItemsForTests(): void {
  state = { status: "loading" };
}
