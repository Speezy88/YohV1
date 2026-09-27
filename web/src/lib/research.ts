/**
 * web/src/lib/research.ts
 *
 * Task 6C: the Research Hub page's one server call and its list hook.
 * Everything the list means — most-recent-first ordering, the 20-item cap
 * — is computed server-side (`GET /api/research`, AD-17); this file fetches
 * it and refetches on a `research` hint from the ONE shared event bus
 * (`eventBus.ts`, AD-18 — never a second EventSource). A `research` hint
 * follows a successful "save that" (`app/save-search-result.ts`'s own
 * outbox append).
 *
 * Every call resolves to an outcome and never throws, the same convention
 * `lib/tasks.ts` already establishes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "./apiClient.ts";
import { onHint } from "./eventBus.ts";
import type { ResearchListResponse } from "../../../src/types/api.ts";

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

async function settle<T>(request: () => Promise<{ json(): Promise<unknown> }>): Promise<Outcome<T>> {
  try {
    const res = await request();
    const result = (await res.json()) as { ok: true; value: T } | { ok: false; error: { message: string } };
    return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message };
  } catch {
    return { ok: false, message: "I couldn't reach Yoh's server just now." };
  }
}

export function fetchResearch(): Promise<Outcome<ResearchListResponse>> {
  return settle(() => apiClient.api.research.$get());
}

export type ResearchListState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly value: ResearchListResponse; readonly refreshFailed?: { readonly message: string; readonly at: Date } }
  | { readonly status: "error"; readonly message: string };

/**
 * Fetches the list once, then refetches on a `research` hint. A failed
 * refresh keeps the last good list visible with `refreshFailed` set (the
 * same "stale but shown" treatment `lib/tasks.ts`'s `useTasksList` gives
 * Notion-unreachable). Out-of-order responses are dropped: only the newest
 * request may land.
 */
export function useResearchList(): { readonly state: ResearchListState; refetch(): Promise<void> } {
  const [state, setState] = useState<ResearchListState>({ status: "loading" });
  const latest = useRef(0);

  const refetch = useCallback(async (): Promise<void> => {
    const seq = ++latest.current;
    const outcome = await fetchResearch();
    if (seq !== latest.current) return;
    setState((prev) => {
      if (outcome.ok) return { status: "loaded", value: outcome.value };
      if (prev.status === "loaded") return { ...prev, refreshFailed: { message: outcome.message, at: new Date() } };
      return { status: "error", message: outcome.message };
    });
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(
    () =>
      onHint((hint) => {
        if (hint.topic === "research") void refetch();
      }),
    [refetch],
  );

  return { state, refetch };
}

/** "Sep 27, 2026" — a Research Vault row's Date isn't relative to "today" the way a Task's due date is, so this always shows the real date. */
export function formatResearchDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
