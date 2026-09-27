/**
 * web/src/lib/chatStore.ts
 *
 * Story 8.5, contract C6: the ONE chat transcript + unsent-draft store,
 * shared by the Chat page and (Story 8.8) the Home Chat Bubble. Module-level
 * state behind `useSyncExternalStore`, the same shape as `homeView.ts` and
 * `notifications.ts`. Client memory only for Phase 2 (`[DECISION DEFAULT]`,
 * AD-10): never persisted, so the transcript lasts for the page session. It
 * survives a page swipe or the Screensaver because `PageShell.tsx` keeps
 * every page mounted and this state lives outside any component.
 */
import { useSyncExternalStore } from "react";
import { streamChat } from "./chatStream.ts";
import { addLocalFailureNotice } from "./notifications.ts";
import type { ChatStreamEvent, ChatTurnRequest, OpenItemQuestion } from "../../../src/types/api.ts";

export interface ChatViewMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly receipts: readonly string[];
  /** A follow-up question from `ChatTurnResponse.question`. Rendered as plain text here; Story 8.6 renders it as a Structured Question. */
  readonly question?: OpenItemQuestion;
  readonly status: "done" | "streaming" | "error";
  /** The latest `status` event's text, shown by the Thinking Indicator while `status === "streaming"`. */
  readonly statusText?: string;
  /** Why the turn failed (`status === "error"`): the server's error message, when it sent one. */
  readonly errorText?: string;
}

export interface ChatStoreState {
  readonly messages: readonly ChatViewMessage[];
  readonly draft: string;
  readonly sending: boolean;
}

/**
 * What the Thinking Indicator says before the server's first `status` event
 * arrives. The server's own first event (`app/chat-turn.ts`'s
 * `STATUS_THINKING`) carries the same words, so the text doesn't flicker;
 * `web/` can't import that runtime constant (AD-17), hence this copy.
 */
const INITIAL_STATUS_TEXT = "Thinking…";

const EMPTY: ChatStoreState = { messages: [], draft: "", sending: false };

let state: ChatStoreState = EMPTY;
let nextId = 0;
const listeners = new Set<() => void>();

function set(next: ChatStoreState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function snapshot(): ChatStoreState {
  return state;
}

export function useChatStore(): ChatStoreState {
  return useSyncExternalStore(subscribe, snapshot);
}

export function setDraft(draft: string): void {
  set({ ...state, draft });
}

function patchMessage(id: string, patch: (message: ChatViewMessage) => Partial<ChatViewMessage>): void {
  set({ ...state, messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)) });
}

/** The transcript as `ChatTurnRequest.history`. A turn with no text (a failed reply) is left out: the Messages API rejects empty content. */
function historyOf(messages: readonly ChatViewMessage[]): ChatTurnRequest["history"] {
  return messages.filter((m) => m.status !== "streaming" && m.text.trim() !== "").map((m) => ({ role: m.role, content: m.text }));
}

/**
 * Sends `message` as Spencer's turn. His turn and a placeholder for Yoh's
 * (showing the Thinking Indicator) appear in the same synchronous update
 * that clears the draft, before any network activity (NFR-Latency). Stream
 * events then fold into the placeholder: `status` replaces its status text,
 * `delta` appends, `done` sets the final reply/receipts/question, and
 * `error` marks it failed with the server's message, keeping any text that
 * already streamed.
 *
 * A transport failure (the request never completed) is handled by what it
 * left behind. With no reply text yet, the exchange never happened: both
 * turns are removed, the message goes back into an empty draft, and a local
 * failure notice says so (UX-DR48). With partial text, the turn stays,
 * marked interrupted. Only one turn is in flight at a time.
 */
export async function send(message: string): Promise<void> {
  const trimmed = message.trim();
  if (trimmed === "" || state.sending) return;

  const userId = `chat-${++nextId}`;
  const assistantId = `chat-${++nextId}`;
  const request: ChatTurnRequest = { message: trimmed, history: [...historyOf(state.messages), { role: "user", content: trimmed }] };
  set({
    messages: [
      ...state.messages,
      { id: userId, role: "user", text: trimmed, receipts: [], status: "done" },
      { id: assistantId, role: "assistant", text: "", receipts: [], status: "streaming", statusText: INITIAL_STATUS_TEXT },
    ],
    draft: "",
    sending: true,
  });

  const onEvent = (event: ChatStreamEvent): void => {
    switch (event.type) {
      case "status":
        patchMessage(assistantId, () => ({ statusText: event.text }));
        return;
      case "delta":
        patchMessage(assistantId, (m) => ({ text: m.text + event.text }));
        return;
      case "done":
        patchMessage(assistantId, () => ({
          text: event.response.reply,
          receipts: event.response.receipts,
          status: "done",
          ...(event.response.question ? { question: event.response.question } : {}),
        }));
        set({ ...state, sending: false });
        return;
      case "error":
        patchMessage(assistantId, () => ({ status: "error", errorText: event.error.message }));
        set({ ...state, sending: false });
        return;
    }
  };

  try {
    await streamChat(request, { onEvent });
  } catch {
    const partial = state.messages.find((m) => m.id === assistantId);
    if (partial && partial.text !== "") {
      patchMessage(assistantId, () => ({ status: "error" }));
      set({ ...state, sending: false });
      return;
    }
    set({
      messages: state.messages.filter((m) => m.id !== userId && m.id !== assistantId),
      draft: state.draft === "" ? trimmed : state.draft,
      sending: false,
    });
    addLocalFailureNotice("Couldn't reach Yoh. Your message is back in the box to try again.");
  }
}

/**
 * Story 8.6 (Task 7): appends one answered Structured Question as an
 * ordinary transcript exchange — Spencer's pick or typed line, then Yoh's
 * message/receipts. A chip answering a Structured Question is "recorded as
 * Spencer's turn" exactly like typed chat (UX-DR38). Shared by
 * `OpenItems.tsx` (the top-of-Chat list) and `ChatMessage.tsx` (an inline
 * `turn.question`) — the one place a Structured Question's answer becomes
 * part of the conversation, regardless of which surface asked it. Both
 * turns land `status: "done"` immediately (unlike `send()`'s own
 * placeholder-then-stream shape): the answer already settled server-side by
 * the time this is called, so there's nothing left to stream.
 */
export function recordAnsweredOpenItem(youText: string, yoh: { message?: string; receipts: readonly string[] }): void {
  const userId = `chat-${++nextId}`;
  const assistantId = `chat-${++nextId}`;
  set({
    ...state,
    messages: [
      ...state.messages,
      { id: userId, role: "user", text: youText, receipts: [], status: "done" },
      { id: assistantId, role: "assistant", text: yoh.message ?? "", receipts: yoh.receipts, status: "done" },
    ],
  });
}

/** Test-only: clears the module-level transcript between tests. Never called from production code. */
export function __resetChatStoreForTests(): void {
  state = EMPTY;
  nextId = 0;
}
