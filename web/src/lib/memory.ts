/**
 * web/src/lib/memory.ts
 *
 * Story 13.9 (T10b): the Memory page's module store. Same trio convention as
 * `openItems.ts`: `useMemoryView()` / `refetchMemory()` / `startMemoryStream()`.
 * One initial fetch, then a refetch on the shared event bus's `memory` hint
 * (never a second EventSource). The rail selection is client state, persisted
 * in localStorage (always in try/catch) and restored on the next load.
 */
import { useSyncExternalStore } from "react";
import { apiClient } from "./apiClient.ts";
import { onHint } from "./eventBus.ts";
import type { MemoryViewResponse } from "../../../src/types/api.ts";
import type { MemoryFolder } from "../../../src/types/domain.ts";

export type MemoryViewState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly value: MemoryViewResponse }
  | { readonly status: "error" };

export type MemorySelection =
  | { readonly kind: "needs-review" }
  | { readonly kind: "folder"; readonly folder: MemoryFolder; readonly itemId?: string }
  | { readonly kind: "settings" }
  | { readonly kind: "history" };

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

export async function refetchMemory(): Promise<void> {
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
  listeners.clear();
  state = { view: { status: "loading" }, selection: readStoredSelection() };
}
