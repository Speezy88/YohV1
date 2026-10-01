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
 *
 * Task 7 (polish-5): `openChatWithCommand`'s command used to reach
 * `chatStore.ts`'s `send`, which silently no-ops while a turn is already
 * `sending` (e.g. a notification's chip tapped mid-turn) — dropping the
 * command with no trace. `queuedCommand` below is a one-slot queue (latest
 * request wins) subscribed to `chatStore.ts`'s own store via its exported
 * `subscribe`/`snapshot` seam; the moment `sending` flips back to `false`,
 * whatever is queued is sent, exactly as if typed then.
 */
import { useSyncExternalStore } from "react";
import { send, subscribe as subscribeChatStore, snapshot as chatStoreSnapshot } from "./chatStore.ts";

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

/** Non-reactive read of the open state (for event handlers outside React). */
export function isChatPanelOpen(): boolean {
  return state.open;
}

export function useChatPanel(): ChatPanelState {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Opens the panel, remembering whatever currently has focus (so `closeChatPanel` can return it there). Opening while already open keeps the original opener: focus is inside the panel by then, and that element (a chip, a notification button) may be gone at close. */
export function openChatPanel(): void {
  if (!state.open) {
    const active = document.activeElement;
    restoreFocusTo = active instanceof HTMLElement ? active : undefined;
  }
  set({ open: true });
}

/** Closes the panel. Focus goes back to the opener via `restoreChatPanelFocus`, which `ChatPanel` calls once React has committed the close (while the page was still inert, a focus call here would be ignored). */
export function closeChatPanel(): void {
  set({ open: false });
}

/** Returns focus to whatever had it before `openChatPanel`; if that element is gone or no longer focusable, to the Ask Yoh pill. Called after the close has rendered. */
export function restoreChatPanelFocus(): void {
  const target = restoreFocusTo;
  restoreFocusTo = undefined;
  if (target && target.isConnected && target !== document.body && !(target as HTMLButtonElement).disabled && !target.closest("[hidden], [inert]")) {
    target.focus();
    return;
  }
  document.querySelector<HTMLElement>('[data-testid="ask-yoh-pill"]')?.focus();
}

export function toggleChatPanel(): void {
  if (state.open) closeChatPanel();
  else openChatPanel();
}

/**
 * Task 7 (polish-5): a one-slot command queue — the latest command
 * requested while a turn is `sending` wins; an earlier queued command is
 * simply replaced, never dropped without eventually being replaced by
 * something that does get sent. `undefined` means nothing is queued.
 */
let queuedCommand: string | undefined;

/** Fires on every `chatStore.ts` state change; sends the queued command the moment `sending` is no longer true. A no-op whenever nothing is queued, which is most of the time. */
subscribeChatStore(() => {
  if (queuedCommand === undefined || chatStoreSnapshot().sending) return;
  const command = queuedCommand;
  queuedCommand = undefined;
  void send(command);
});

/** Story 9.3, E8: the ONE deep-link entry point every "deep-links to Chat" notification goes through — opens the panel, and with a command sends it exactly as if typed (`chatStore.ts`'s `send`), so `"chat:/sandbox"` re-opens the queue. Task 7: if a turn is already `sending`, the command is queued instead of silently dropped by `send`'s own in-flight guard, and sent as soon as that turn resolves. */
export function openChatWithCommand(command?: string): void {
  openChatPanel();
  if (!command) return;
  if (chatStoreSnapshot().sending) {
    queuedCommand = command;
    return;
  }
  void send(command);
}

/** Test-only: clears module-level singleton state between tests. Never called from production code. */
export function __resetChatPanelForTests(): void {
  state = { open: false };
  restoreFocusTo = undefined;
  queuedCommand = undefined;
}
