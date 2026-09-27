/**
 * web/src/lib/pages.ts
 *
 * Task 6A (Spencer's information-architecture decisions, 2026-09-27): the
 * ONE definition of page order and labels. There is no Chat page — Chat is
 * a panel available on every page (`ChatPanel.tsx`, opened from the Ask Yoh
 * pill / ⌘K), so it is deliberately absent from this array. Every
 * navigation mechanism (the sidebar, on-screen up/down arrow buttons,
 * ↑/↓/Page Up/Page Down, an edge-aware mouse wheel) addresses a page
 * through this array's index, never a re-derived literal. Side swipe is
 * retired everywhere (`web/src/lib/swipe.ts` is deleted); the page stack is
 * now vertical, not horizontal.
 */
import { useCallback, useState } from "react";

export const PAGES = [
  { id: "home", label: "Home" },
  { id: "tasks", label: "Tasks" },
  { id: "desk", label: "Desk" },
  { id: "research", label: "Research Hub" },
] as const;

export type PageId = (typeof PAGES)[number]["id"];

export interface PageNavigation {
  readonly index: number;
  goTo(index: number): void;
  next(): void;
  prev(): void;
}

function clamp(i: number): number {
  return Math.max(0, Math.min(PAGES.length - 1, i));
}

export function usePageNavigation(initialIndex = 0): PageNavigation {
  const [index, setIndex] = useState(initialIndex);
  const goTo = useCallback((i: number) => setIndex(clamp(i)), []);
  const next = useCallback(() => setIndex((i) => clamp(i + 1)), []);
  const prev = useCallback(() => setIndex((i) => clamp(i - 1)), []);
  return { index, goTo, next, prev };
}

/**
 * True when `element` is text-editable — arrow/Page Up/Page Down keys must
 * not navigate pages while typing (`<input>`, `<textarea>`, or a
 * `contenteditable` element such as the Chat Input).
 */
/**
 * Task 6B: true when `element` sits inside a region that owns ↑/↓ itself
 * (marked `data-captures-arrow-keys`) — the Tasks list moves between rows
 * with them, so page navigation must leave them alone while a row has
 * focus. Page Up/Page Down still navigate.
 */
export function capturesArrowKeys(element: Element | null): boolean {
  return element?.closest("[data-captures-arrow-keys]") != null;
}

export function isTextFieldFocused(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (element as HTMLElement).isContentEditable;
}
