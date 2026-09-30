/**
 * web/src/lib/memory.ts
 *
 * Story 13.9 (T10b): the Memory page's module store. Same trio convention as
 * `openItems.ts`: `useMemoryView()` / `refetchMemory()` / `startMemoryStream()`.
 * One initial fetch, then a refetch on the shared event bus's `memory` hint
 * (never a second EventSource). The rail selection is client state, persisted
 * in localStorage (always in try/catch) and restored on the next load.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { apiClient } from "./apiClient.ts";
import { onHint } from "./eventBus.ts";
import type { ChatConversationView, ChatHistoryListResponse, EditMemoryResponse, MemorySearchResponse, MemoryViewResponse, MemoryWriteResponse, RevertSettingResponse } from "../../../src/types/api.ts";
import type { MemoryFolder, RuleSettingKey } from "../../../src/types/domain.ts";

export type MemoryViewState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly value: MemoryViewResponse }
  | { readonly status: "error" };

export type MemorySelection =
  | { readonly kind: "needs-review" }
  | { readonly kind: "folder"; readonly folder: MemoryFolder; readonly itemId?: string }
  | { readonly kind: "settings" }
  /** Chat history; `conversationId` opens that Conversation, `turnId` scrolls to a turn (both transient, never persisted). */
  | { readonly kind: "history"; readonly conversationId?: string; readonly turnId?: string };

export interface MemoryState {
  readonly view: MemoryViewState;
  readonly selection: MemorySelection;
  /** An item the page should scroll to once its folder is showing. */
  readonly pendingScrollId?: string;
}

const STORAGE_KEY = "yoh.memory.selection";
const FIRST_FOLDER: MemoryFolder = "feedback";
const FOLDERS: readonly MemoryFolder[] = [
  "feedback", "planning-preferences", "corrections", "about-you", "patterns", "goals-projects", "decisions-commitments", "ideas-notes",
];
const DEFAULT_SELECTION: MemorySelection = { kind: "folder", folder: FIRST_FOLDER };

function readStoredSelection(): MemorySelection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SELECTION;
    const parsed = JSON.parse(raw) as { kind?: unknown; folder?: unknown };
    if (parsed.kind === "needs-review" || parsed.kind === "settings" || parsed.kind === "history") return { kind: parsed.kind };
    if (parsed.kind === "folder" && typeof parsed.folder === "string" && (FOLDERS as readonly string[]).includes(parsed.folder)) {
      return { kind: "folder", folder: parsed.folder as MemoryFolder };
    }
  } catch {
    /* storage unavailable or corrupt: fall through to the default */
  }
  return DEFAULT_SELECTION;
}

function writeStoredSelection(selection: MemorySelection): void {
  try {
    // The item id is transient (a scroll target), so only the kind/folder persist.
    const persisted = selection.kind === "folder" ? { kind: "folder", folder: selection.folder } : { kind: selection.kind };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    /* ignore */
  }
}

let state: MemoryState = { view: { status: "loading" }, selection: readStoredSelection() };
const listeners = new Set<() => void>();
let latest = 0;

function setState(next: MemoryState): void {
  state = next;
  listeners.forEach((l) => l());
}

export function getMemoryState(): MemoryState {
  return state;
}

export function useMemoryView(): MemoryState {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getMemoryState,
  );
}

/**
 * Coalesces bursts: at most one run in flight plus one trailing run. Callers
 * that arrive mid-flight share the trailing run's promise, so an awaiting
 * write still sees a view fetched after it.
 */
function coalesce(run: () => Promise<void>): () => Promise<void> {
  let inflight: Promise<void> | undefined;
  let trailing: Promise<void> | undefined;
  const call = (): Promise<void> => {
    if (!inflight) {
      inflight = run().catch(() => undefined).finally(() => {
        inflight = undefined;
      });
      return inflight;
    }
    trailing ??= inflight.then(() => {
      trailing = undefined;
      return call();
    });
    return trailing;
  };
  return call;
}

let coalescedMemoryFetch = coalesce(fetchMemoryView);

export function refetchMemory(): Promise<void> {
  return coalescedMemoryFetch();
}

async function fetchMemoryView(): Promise<void> {
  const seq = ++latest;
  let next: MemoryViewState;
  try {
    const res = await apiClient.api.memory.$get();
    const result = await res.json();
    next = result.ok ? { status: "loaded", value: result.value } : { status: "error" };
  } catch {
    next = { status: "error" };
  }
  if (seq !== latest) return;
  // A failed refresh keeps a good view on screen rather than blanking it.
  if (next.status === "error" && state.view.status === "loaded") return;
  setState({ ...state, view: next });
}

/** Starts the store's subscription to the shared event bus. Returns a stop function. */
export function startMemoryStream(): () => void {
  void refetchMemory();
  return onHint((hint) => {
    if (hint.topic === "memory") void refetchMemory();
  });
}

export function selectMemory(selection: MemorySelection): void {
  writeStoredSelection(selection);
  setState({ ...state, selection, pendingScrollId: undefined });
}

/**
 * Selects the folder holding `itemId` and asks the page to scroll to it.
 * Returns false when the item is not in the loaded view (for example a
 * forgotten item), leaving the selection alone.
 */
export function openMemoryItem(itemId: string): boolean {
  if (state.view.status !== "loaded") return false;
  const folder = state.view.value.folders.find((f) => f.items.some((i) => i.id === itemId));
  if (!folder) return false;
  const selection: MemorySelection = { kind: "folder", folder: folder.folder, itemId };
  writeStoredSelection(selection);
  setState({ ...state, selection, pendingScrollId: itemId });
  return true;
}

export function clearPendingScroll(): void {
  if (state.pendingScrollId !== undefined) setState({ ...state, pendingScrollId: undefined });
}

export function __resetMemoryForTests(options: { readonly keepStorage?: boolean } = {}): void {
  if (!options.keepStorage) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
  latest = 0;
  coalescedMemoryFetch = coalesce(fetchMemoryView);
  listeners.clear();
  state = { view: { status: "loading" }, selection: readStoredSelection() };
}


// ---- Search and chat history (Part 2) ---------------------------------------

/** How long the delete-conversation Undo Toast stays up; the request is sent when it closes. */
export const MEMORY_UNDO_WINDOW_MS = 6000;
const SEARCH_DEBOUNCE_MS = 250;
const UNREACHABLE = "I couldn't reach Yoh's server just now.";

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

async function settle<T>(request: () => Promise<{ json(): Promise<unknown> }>): Promise<Outcome<T>> {
  try {
    const res = await request();
    const result = (await res.json()) as { ok: true; value: T } | { ok: false; error: { message: string } };
    return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message };
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}

export type LoadState<T> =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly value: T }
  | { readonly status: "error"; readonly message: string };

/** Fetch once (and again when `key` changes), refetch on the `memory` hint; out-of-order responses are dropped. */
function useHintedLoad<T>(load: () => Promise<Outcome<T>>, key: string): { readonly state: LoadState<T>; refetch(): Promise<void> } {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const latest = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refetchNow = useCallback(async (): Promise<void> => {
    const seq = ++latest.current;
    const outcome = await loadRef.current();
    if (seq !== latest.current) return;
    setState((prev) => {
      if (outcome.ok) return { status: "loaded", value: outcome.value };
      // A failed refresh keeps a good result on screen.
      return prev.status === "loaded" ? prev : { status: "error", message: outcome.message };
    });
  }, []);
  const refetch = useMemo(() => coalesce(refetchNow), [refetchNow]);

  useEffect(() => {
    // A new key makes any in-flight response for the old key stale.
    latest.current++;
    setState({ status: "loading" });
    void refetch();
  }, [refetch, key]);
  useEffect(
    () =>
      onHint((hint) => {
        if (hint.topic === "memory") void refetch();
      }),
    [refetch],
  );
  return { state, refetch };
}

export function useChatHistoryList(): { readonly state: LoadState<ChatHistoryListResponse>; refetch(): Promise<void> } {
  return useHintedLoad<ChatHistoryListResponse>(() => settle(() => apiClient.api["chat-history"].$get()), "list");
}

export function useChatConversation(conversationId: string): { readonly state: LoadState<ChatConversationView> } {
  const { state } = useHintedLoad<ChatConversationView>(
    () => settle(() => apiClient.api["chat-history"][":conversationId"].$get({ param: { conversationId } })),
    conversationId,
  );
  return { state };
}

export function deleteConversation(conversationId: string): Promise<Outcome<Record<string, never>>> {
  return settle(() => apiClient.api["chat-history"].delete.$post({ json: { conversationId } }));
}

export function clearHistory(): Promise<Outcome<Record<string, never>>> {
  return settle(() => apiClient.api["chat-history"].clear.$post());
}

export type MemorySearchState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "loaded" }
  | { readonly status: "error" };

/** One keyword box over memories and chat turns: debounced, latest response wins, clear returns to idle. */
export function useMemorySearch(): {
  readonly text: string;
  setText(text: string): void;
  clear(): void;
  readonly status: MemorySearchState["status"];
  readonly results?: MemorySearchResponse;
} {
  const [text, setTextState] = useState("");
  const [status, setStatus] = useState<MemorySearchState["status"]>("idle");
  const [results, setResults] = useState<MemorySearchResponse | undefined>(undefined);
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setText = useCallback((next: string): void => {
    setTextState(next);
    clearTimeout(timer.current);
    const q = next.trim();
    const seq = ++latest.current;
    if (q === "") {
      setStatus("idle");
      setResults(undefined);
      return;
    }
    setStatus("loading");
    timer.current = setTimeout(() => {
      void settle<MemorySearchResponse>(() => apiClient.api.memory.search.$get({ query: { q } })).then((outcome) => {
        if (seq !== latest.current) return;
        if (outcome.ok) {
          setResults(outcome.value);
          setStatus("loaded");
        } else {
          setResults(undefined);
          setStatus("error");
        }
      });
    }, SEARCH_DEBOUNCE_MS);
  }, []);
  const clear = useCallback((): void => setText(""), [setText]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return { text, setText, clear, status, ...(results ? { results } : {}) };
}


// ---- Item writes (T11b Part 1) ------------------------------------------------
// Each helper maps the server's Result envelope to an Outcome and never throws.
// After a success it refetches once; the `memory` hint refetches again on its own.

async function write<T>(request: () => Promise<{ json(): Promise<unknown> }>): Promise<Outcome<T>> {
  const outcome = await settle<T>(request);
  if (outcome.ok) await refetchMemory();
  return outcome;
}

export function editItem(
  itemId: string,
  text: string,
  opts: { readonly mergeWithId?: string; readonly allowDuplicate?: boolean } = {},
): Promise<Outcome<EditMemoryResponse>> {
  return write(() => apiClient.api.memory.edit.$post({ json: { itemId, text, ...opts } }));
}

export function moveItem(itemId: string, folder: MemoryFolder): Promise<Outcome<MemoryWriteResponse>> {
  return write(() => apiClient.api.memory.move.$post({ json: { itemId, folder } }));
}

export function setExpiry(itemId: string, expiresOn: string | null): Promise<Outcome<MemoryWriteResponse>> {
  return write(() => apiClient.api.memory.expiry.$post({ json: { itemId, expiresOn } }));
}

export function deleteItem(itemId: string): Promise<Outcome<MemoryWriteResponse>> {
  return write(() => apiClient.api.memory.delete.$post({ json: { itemId } }));
}

/** Needs review: Renew (an expired item takes `expiresOn` or none; an unused item ignores it) or Keep as history. */
export function reviewItem(itemId: string, action: "renew" | "keep", expiresOn?: string): Promise<Outcome<MemoryWriteResponse>> {
  return write(() => apiClient.api.memory.review.$post({ json: { itemId, action, ...(expiresOn ? { expiresOn } : {}) } }));
}

/** Changed settings: Revert is a direct write; the value's `message` ("Reverted to 3:15 PM.") is shown as-is. */
export function revertSetting(key: RuleSettingKey, area?: string): Promise<Outcome<RevertSettingResponse>> {
  return write(() => apiClient.api.settings.revert.$post({ json: { key, ...(area ? { area } : {}) } }));
}

// ---- "Saved" marks ------------------------------------------------------------
// A save creates a new version id, so the row can remount; the mark lives here
// (keyed by the new id) rather than in row state, and clears itself after ~2 s.

export const MEMORY_SAVED_MS = 2000;
const savedIds = new Set<string>();
const savedTimers = new Map<string, ReturnType<typeof setTimeout>>();
const savedListeners = new Set<() => void>();
const notifySaved = (): void => savedListeners.forEach((l) => l());

export function markMemorySaved(itemId: string): void {
  clearTimeout(savedTimers.get(itemId));
  savedIds.add(itemId);
  savedTimers.set(
    itemId,
    setTimeout(() => {
      savedIds.delete(itemId);
      savedTimers.delete(itemId);
      notifySaved();
    }, MEMORY_SAVED_MS),
  );
  notifySaved();
}

export function useMemorySaved(itemId: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      savedListeners.add(onChange);
      return () => savedListeners.delete(onChange);
    },
    () => savedIds.has(itemId),
  );
}

export function __resetMemorySavedForTests(): void {
  savedTimers.forEach((t) => clearTimeout(t));
  savedTimers.clear();
  savedIds.clear();
}
