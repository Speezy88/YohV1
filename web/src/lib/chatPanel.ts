/**
 * web/src/lib/chatPanel.ts
 *
 * Task 6A, Spencer's information-architecture decisions (2026-09-27): Chat
 * is a panel available on every page, not a page of its own. This is the
 * module-level open/closed store for that panel (the same
 * `useSyncExternalStore` shape `chatStore.ts`/`notifications.ts` already
 * use) — separate from `chatStore.ts` itself, which stays focused on the
 * transcript/draft (AD-17: ephemeral view state is client-only) so a panel
 * close never touches the conversation.
 *
 * `openChatPanel`/`closeChatPanel` record the element that had focus right
 * before opening, so `ChatPanel.tsx` can hand focus back to it on close
 * (the Ask Yoh pill, or wherever else focus was) — the panel returns
 * exactly where Spencer left off, never stranding focus on a now-hidden
 * element or resetting it to `<body>`.
 */
import { useSyncExternalStore } from "react";

interface ChatPanelState {
  readonly open: boolean;
}

let state: ChatPanelState = { open: false };
let restoreFocusTo: HTMLElement | undefined;
const listeners = new Set<() => void>();

function set(next: ChatPanelState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function snapshot(): ChatPanelState {
  return state;
}

export function useChatPanel(): ChatPanelState {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Opens the panel, remembering whatever currently has focus (so `closeChatPanel` can return it there). Idempotent: opening while already open just re-notes the current focus. */
export function openChatPanel(): void {
  const active = document.activeElement;
  restoreFocusTo = active instanceof HTMLElement ? active : undefined;
  set({ open: true });
}

/** Closes the panel and returns focus to whatever had it before `openChatPanel` — a no-op if that element is gone from the DOM. */
export function closeChatPanel(): void {
  set({ open: false });
  restoreFocusTo?.focus();
  restoreFocusTo = undefined;
}

export function toggleChatPanel(): void {
  if (state.open) closeChatPanel();
  else openChatPanel();
}

/** Test-only: clears module-level singleton state between tests. Never called from production code. */
export function __resetChatPanelForTests(): void {
  state = { open: false };
  restoreFocusTo = undefined;
}
