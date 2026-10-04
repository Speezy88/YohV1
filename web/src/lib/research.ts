/**
 * web/src/lib/research.ts
 *
 * Task 6C / Story 11.2: the Research Hub page's server calls, its list hook
 * (paged 20 at a time), its Research Box document hook and the selection.
 * Everything the list means — most-recent-first ordering, the paging — is
 * computed server-side (`GET /api/research`, AD-17); this file fetches it
 * and refetches on a `research` hint from the ONE shared event bus
 * (`eventBus.ts`, AD-18 — never a second EventSource). A `research` hint
 * follows a successful "save that" (`app/save-search-result.ts`'s own
 * outbox append).
 *
 * Every call resolves to an outcome and never throws, the same convention
 * `lib/tasks.ts` already establishes.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiClient } from "./apiClient.ts";
import { onHint } from "./eventBus.ts";
import type { ResearchDocumentResponse, ResearchListResponse } from "../../../src/types/api.ts";

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

export function fetchResearch(pages = 1): Promise<Outcome<ResearchListResponse>> {
  return settle(() => apiClient.api.research.$get({ query: { pages: String(pages) } }));
}

/** No id asks for the newest document; an id the server no longer has also falls back to the newest (E11-R5). */
export function fetchResearchDocument(id?: string): Promise<Outcome<ResearchDocumentResponse>> {
  return settle(() => apiClient.api.research.document.$get({ query: id ? { id } : {} }));
}

// --- Selection (E11-R5): the document Spencer picked. Module-level so a notification deep link can set it while the page is already mounted. ---
let selectedId: string | undefined;
const selectionListeners = new Set<() => void>();

/** Picks a document for the Research Box. Any selection counts as "picked": live refresh stops following the newest. */
export function openResearchDocument(id: string): void {
  selectedId = id;
  selectionListeners.forEach((l) => l());
}

/** Back to "follow the newest". Used by tests. */
export function resetResearchSelection(): void {
  selectedId = undefined;
  selectionListeners.forEach((l) => l());
}

function subscribeSelection(l: () => void): () => void {
  selectionListeners.add(l);
  return () => {
    selectionListeners.delete(l);
  };
}

export function useSelectedResearchId(): string | undefined {
  return useSyncExternalStore(subscribeSelection, () => selectedId);
}

export type ResearchListState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly value: ResearchListResponse; readonly loadedAt: Date; readonly refreshFailed?: { readonly message: string; readonly at: Date } }
  | { readonly status: "error"; readonly message: string };

/**
 * Fetches the list once, then refetches on a `research` hint with the
 * current `pages`. `showMore` asks for `pages + 1` and replaces the list
 * with the response (E11-R1: the page never sorts or slices); a failed one
 * keeps the rows and sets `moreFailed`. A failed refresh keeps the last good
 * list visible with `refreshFailed` set (the same "stale but shown"
 * treatment `lib/tasks.ts`'s `useTasksList` gives Notion-unreachable).
 * Out-of-order responses are dropped: only the newest request may land.
 */
export function useResearchList(): {
  readonly state: ResearchListState;
  readonly moreFailed: boolean;
  readonly loadingMore: boolean;
  refetch(): Promise<void>;
  showMore(): Promise<void>;
} {
  const [state, setState] = useState<ResearchListState>({ status: "loading" });
  const [moreFailed, setMoreFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef(0);
  const pages = useRef(1);

  const refetch = useCallback(async (): Promise<void> => {
    const seq = ++latest.current;
    const outcome = await fetchResearch(pages.current);
    if (seq !== latest.current) return;
    setState((prev) => {
      if (outcome.ok) return { status: "loaded", value: outcome.value, loadedAt: new Date() };
      if (prev.status === "loaded") return { ...prev, refreshFailed: { message: outcome.message, at: prev.loadedAt } };
      return { status: "error", message: outcome.message };
    });
  }, []);

  const showMore = useCallback(async (): Promise<void> => {
    const seq = ++latest.current;
    const previous = pages.current;
    const next = previous + 1;
    // Set before fetching so a refetch that supersedes this one asks for the larger page too.
    pages.current = next;
    setLoadingMore(true);
    try {
      const outcome = await fetchResearch(next);
      if (outcome.ok) {
        if (seq !== latest.current) return;
        setMoreFailed(false);
        setState({ status: "loaded", value: outcome.value, loadedAt: new Date() });
      } else {
        // Roll back only when this request is still the newest; a superseding refetch owns the page count.
        if (seq === latest.current) {
          pages.current = previous;
          setMoreFailed(true);
        }
      }
    } finally {
      setLoadingMore(false);
    }
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

  return { state, moreFailed, loadingMore, refetch, showMore };
}

export type ResearchDocumentState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly value: ResearchDocumentResponse }
  | { readonly status: "error"; readonly message: string };

/**
 * The document in the Research Box: the selected one, else the newest. A
 * `research` hint refetches only when nothing was picked (E11-R7). The
 * document actually returned decides which row is current (an unknown id
 * falls back to the newest, server-side).
 */
export function useResearchDocument(): { readonly state: ResearchDocumentState; refetch(): Promise<void> } {
  const id = useSelectedResearchId();
  const [state, setState] = useState<ResearchDocumentState>({ status: "loading" });
  const latest = useRef(0);
  const idRef = useRef(id);
  idRef.current = id;

  const load = useCallback(async (): Promise<void> => {
    const seq = ++latest.current;
    const outcome = await fetchResearchDocument(idRef.current);
    if (seq !== latest.current) return;
    setState((prev) => {
      if (outcome.ok) return { status: "loaded", value: outcome.value };
      // A failed background refresh keeps the document on screen.
      if (prev.status === "loaded") return prev;
      return { status: "error", message: outcome.message };
    });
  }, []);

  const refetch = useCallback(async (): Promise<void> => {
    setState({ status: "loading" });
    await load();
  }, [load]);

  useEffect(() => {
    if (id !== undefined) setState({ status: "loading" });
    void load();
  }, [id, load]);

  useEffect(
    () =>
      onHint((hint) => {
        if (hint.topic === "research" && idRef.current === undefined) void load();
      }),
    [load],
  );

  return { state, refetch };
}

/** "Sep 27, 2026" — a Research Vault row's Date isn't relative to "today" the way a Task's due date is, so this always shows the real date. */
export function formatResearchDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
