/**
 * web/src/lib/memoryApi.ts
 *
 * Story 13.4: the web side of the Remembered Receipt. `undoMemoryReceipt`
 * calls `POST /api/memory/undo`; the folder labels are duplicated here once
 * (web imports only types from `src/`), pinned by `memoryApi.test.ts`.
 */
import { useContext } from "react";
import { apiClient } from "./apiClient.ts";
import { openMemoryItem, selectMemory } from "./memory.ts";
import { PageNavigationContext } from "./navigationContext.tsx";
import { PAGES } from "./pages.ts";
import type { MemoryFolder } from "../../../src/types/domain.ts";

export const MEMORY_FOLDER_LABELS: Readonly<Record<MemoryFolder, string>> = {
  feedback: "Feedback",
  "planning-preferences": "Planning preferences",
  corrections: "Corrections",
  "about-you": "About you",
  patterns: "Patterns",
  "goals-projects": "Goals & projects",
  "decisions-commitments": "Decisions & commitments",
  "ideas-notes": "Ideas & notes",
};

/** The Memory page arrives with Story 13.7 (T10b); until it is in `PAGES` there is nowhere for "View in Memory" to go. */
export function hasMemoryPage(): boolean {
  return PAGES.some((page) => (page.id as string) === "memory");
}

function memoryPageIndex(): number {
  return PAGES.findIndex((page) => (page.id as string) === "memory");
}

/**
 * Returns a function that opens a memory item on the Memory page, or
 * `undefined` outside `PageShell` (no navigation to offer). An item that is
 * no longer listed (a forgotten one) falls back to its folder when given.
 */
export function useOpenInMemory(): ((itemId: string, fallbackFolder?: MemoryFolder) => void) | undefined {
  const nav = useContext(PageNavigationContext);
  if (!nav) return undefined;
  return (itemId, fallbackFolder) => {
    if (!openMemoryItem(itemId) && fallbackFolder) selectMemory({ kind: "folder", folder: fallbackFolder });
    nav.goTo(memoryPageIndex());
  };
}

export type UndoOutcome =
  | { readonly status: "ok"; readonly message: string }
  /** The server refused (the undo window closed, or it was already undone): the line stops offering Undo. */
  | { readonly status: "refused"; readonly message: string }
  /** The request itself failed; the line keeps its Undo. */
  | { readonly status: "failed" };

export async function undoMemoryReceipt(receiptId: string): Promise<UndoOutcome> {
  try {
    const res = await apiClient.api.memory.undo.$post({ json: { receiptId } });
    const result = await res.json();
    if (result.ok) return { status: "ok", message: result.value.message };
    if (result.error.kind === "conflict") return { status: "refused", message: result.error.message };
    return { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
