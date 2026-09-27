/**
 * web/src/lib/missingDataFilter.ts
 *
 * Real-use fixes plan, Task 2: the Tasks page's "Missing data" filter
 * chip's own tiny external store — the same `useSyncExternalStore` shape
 * `chatPanel.ts`/`openItems.ts` already use. Kept separate from
 * `lib/tasks.ts` (the list itself) so arming it — from the Chat header's
 * "N tasks missing data" chip, `missingData.ts`'s `openMissingData` — never
 * needs to import anything about the Tasks list, and Tasks.tsx never needs
 * to import anything about Chat.
 */
import { useSyncExternalStore } from "react";

let active = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  active = next;
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function snapshot(): boolean {
  return active;
}

/** Whether the Tasks page's "Missing data" filter chip is currently applied. */
export function useMissingDataFilterActive(): boolean {
  return useSyncExternalStore(subscribe, snapshot);
}

export function setMissingDataFilterActive(value: boolean): void {
  set(value);
}

/** Test-only: clears module-level singleton state between tests. Never called from production code. */
export function __resetMissingDataFilterForTests(): void {
  active = false;
}
