/**
 * web/src/lib/pages.ts
 *
 * Story 7.6: the ONE definition of page order and labels. Every navigation
 * mechanism (swipe, click, arrow key, a notification deep-link in Story
 * 7.7) addresses a page through this array's index, never a re-derived
 * literal.
 */
import { useCallback, useState } from "react";

export const PAGES = [
  { id: "home", label: "Home" },
  { id: "chat", label: "Chat" },
  { id: "tasks", label: "Tasks" },
  { id: "desk", label: "Desk" },
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
 * True when `element` is text-editable — arrow keys must not navigate pages
 * while typing (`<input>`, `<textarea>`, or a `contenteditable` element such
 * as a future rich-text Chat composer).
 */
export function isTextFieldFocused(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (element as HTMLElement).isContentEditable;
}
