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
import { useCallback, useEffect, useRef, useState } from "react";
import { closeChatPanel, isChatPanelOpen } from "./chatPanel.ts";

export const PAGES = [
  { id: "home", label: "Home" },
  { id: "tasks", label: "Tasks" },
  { id: "desk", label: "Desk" },
  { id: "research", label: "Research Hub" },
  { id: "memory", label: "Memory" },
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

/**
 * P6-R12: the index of the page named by `location.hash` (`#tasks`), or
 * `undefined` for an empty or unknown hash.
 */
function indexFromHash(): number | undefined {
  const id = location.hash.replace(/^#/, "");
  const i = PAGES.findIndex((page) => page.id === id);
  return i === -1 ? undefined : i;
}

function hashFor(index: number): string {
  return `#${PAGES[index].id}`;
}

export function usePageNavigation(initialIndex = 0): PageNavigation {
  const [index, setIndex] = useState(() => indexFromHash() ?? clamp(initialIndex));
  const indexRef = useRef(index);

  // Initial normalisation: an empty or unknown hash becomes the real page's
  // hash, replacing the entry (no extra Back step).
  useEffect(() => {
    if (location.hash !== hashFor(indexRef.current)) {
      history.replaceState(null, "", hashFor(indexRef.current));
    }
  }, []);

  // Back/Forward (and a hand-edited hash) move the page; an unknown hash is Home.
  useEffect(() => {
    function onPopState(): void {
      // The Chat panel is modal: Back/Forward closes it rather than changing
      // the page behind it. Put the current page's entry back on top.
      if (isChatPanelOpen()) {
        closeChatPanel();
        history.pushState(null, "", hashFor(indexRef.current));
        return;
      }
      const known = indexFromHash();
      const target = known ?? 0;
      if (known === undefined) history.replaceState(null, "", hashFor(0));
      indexRef.current = target;
      setIndex(target);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // `pushState`, not `location.hash =`, so the browser does not scroll.
  const goTo = useCallback((i: number) => {
    const target = clamp(i);
    if (target === indexRef.current) return;
    indexRef.current = target;
    setIndex(target);
    history.pushState(null, "", hashFor(target));
  }, []);
  const next = useCallback(() => goTo(indexRef.current + 1), [goTo]);
  const prev = useCallback(() => goTo(indexRef.current - 1), [goTo]);
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
