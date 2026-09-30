/**
 * web/src/lib/chatStore.ts
 *
 * Story 8.5, contract C6, extended by Story 9.2: the ONE chat transcript +
 * unsent-draft store, shared by the Chat page and (Story 8.8) the Home Chat
 * Bubble. Module-level state behind `useSyncExternalStore`, the same shape
 * as `homeView.ts` and `notifications.ts`. Client memory only for Phase 2
 * (`[DECISION DEFAULT]`, AD-10): never persisted, so the transcript lasts
 * for the page session. It survives a page swipe or the Screensaver because
 * `PageShell.tsx` keeps every page mounted and this state lives outside any
 * component.
 *
 * `ChatStoreState.entries` is a `StreamEntry` union — `"message"` (an
 * ordinary turn, unchanged `ChatViewMessage` payload) or `"sandbox-card"` (a
 * Sandbox Card rendered inline, Story 9.2) — so a card genuinely interleaves
 * with turns in one ordered stream and "stays in chat history" once
 * settled. The server owns the transcript for the model (Story 13.1); the
 * client sends `{message}` only and restores today's turns on first open
 * (`hydrateChatHistory`). `appendStreamEntry`/`updateStreamEntry` are
 * generic over any future `StreamEntry` kind (Story 9.3 adds a
 * `"sandbox-finale"` kind and reuses these two verbatim).
 */
import { useSyncExternalStore } from "react";
import { apiClient } from "./apiClient.ts";
import { streamChat } from "./chatStream.ts";
import { startSandbox } from "./sandbox.ts";
import { addLocalFailureNotice } from "./notifications.ts";
import type { ChatStreamEvent, ChatTurnRequest, OpenItem, OpenItemQuestion, RememberedReceipt, SandboxCardView } from "../../../src/types/api.ts";

/** Story 13.4: a Remembered Receipt offers Undo (`undoable`) until Spencer's next message (`settled`), or shows the outcome of an Undo (`removed`). */
export type ReceiptState = "undoable" | "removed" | "settled";

/**
 * Story 13.11: the "How is Yoh doing?" prompt under a reply. `answered` is the
 * folded "Rated N" line, `note` (score 1) also shows the optional note field,
 * `done` is the folded line after Send or Skip, `dismissed` renders nothing.
 */
export interface MessageRating {
  readonly promptId: string;
  readonly phase: "open" | "answered" | "note" | "done" | "dismissed";
  readonly score?: 1 | 2 | 3;
}

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
  /** Story 13.4: the `remembered` event's receipt, rendered as the muted line under the reply. */
  readonly receipt?: RememberedReceipt;
  readonly receiptState?: ReceiptState;
  /** The server's message after an Undo, or a refusal. */
  readonly receiptNote?: string;
  /** Story 13.11: the `rating` event's prompt. */
  readonly rating?: MessageRating;
}

/** One entry in the chat stream: an ordinary turn, (Story 9.2) an inline Sandbox Card, or (Story 9.3) the session-ending Finale. */
export type StreamEntry =
  | { readonly kind: "message"; readonly id: string; readonly message: ChatViewMessage }
  | {
      readonly kind: "sandbox-card";
      readonly id: string;
      readonly view: SandboxCardView;
      readonly status: "pending" | "saved" | "skipped" | "failed";
      readonly receipt?: string;
    }
  // Story 9.3: the Finale — a loading bar (pending) while `finishSandbox()` waits
  // for the batch to settle, then the resolved outcome (done). AD-17: on a
  // `POST /api/sandbox/finish` request failure itself (not a server-reported
  // per-Task failure), the client never computes its own savedCount/failedTitles
  // — `summaryFailed` says only that the summary couldn't be confirmed; C2
  // renders that as its own distinct copy, with no invented counts.
  | {
      readonly kind: "sandbox-finale";
      readonly id: string;
      readonly status: "pending" | "done";
      readonly savedCount?: number;
      readonly failedTitles?: readonly string[];
      readonly summaryFailed?: true;
    };

/** `Omit` over a union collapses to the union's shared keys only — this distributes it per member, so `appendStreamEntry`/`updateStreamEntry` keep each branch's own fields (`message`, `view`, `status`, ...). */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export interface ChatStoreState {
  readonly entries: readonly StreamEntry[];
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

const EMPTY: ChatStoreState = { entries: [], draft: "", sending: false };

let state: ChatStoreState = EMPTY;
let nextId = 0;
const listeners = new Set<() => void>();
/**
 * C1 (final-review): which ritual-raised open-item questions have already
 * been injected into this session's transcript (`appendPendingOpenItem`),
 * keyed on `requestId + questionId` rather than `requestId` alone — every
 * ritual (`night-close-out`, `data-completeness`) reuses one
 * fixed `requestId` across every run, so keying on `requestId` alone meant
 * a re-raised question, weeks later, stayed permanently invisible once the
 * FIRST one had ever been shown. `resolveMessageQuestion` deletes an entry
 * the moment its question is actually resolved, so a later re-raise (even
 * one that reuses the exact same requestId+questionId, as a ritual
 * question always does) is no longer in this Set and shows again. Client state only,
 * never persisted.
 */
const shownPendingRequestIds = new Set<string>();

function pendingItemKey(requestId: string, questionId: string): string {
  return `${requestId}::${questionId}`;
}

function set(next: ChatStoreState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

/**
 * Task 7 (polish-5): exported subscribe/snapshot seam — the same
 * `useSyncExternalStore` pair this store already uses internally for
 * `useChatStore`, now also usable from plain (non-React) module code.
 * `chatPanel.ts`'s command queue subscribes here to notice the moment
 * `sending` flips back to `false`, without `chatStore.ts` needing to know
 * anything about panels or queues.
 */
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}
export { subscribe };

function snapshot(): ChatStoreState {
  return state;
}
export { snapshot };

export function useChatStore(): ChatStoreState {
  return useSyncExternalStore(subscribe, snapshot);
}

export function setDraft(draft: string): void {
  set({ ...state, draft });
}

/** Generic append (Story 9.2) — any future `StreamEntry` kind (Story 9.3's `"sandbox-finale"`) reuses this unchanged. */
export function appendStreamEntry(entry: DistributiveOmit<StreamEntry, "id">): string {
  const id = `entry-${++nextId}`;
  set({ ...state, entries: [...state.entries, { ...entry, id }] });
  return id;
}

/**
 * Generic patch (Story 9.2), typed per `kind` (Task 10 hygiene) so a caller's
 * `patch` can only name fields that entry kind actually has — no
 * `as StreamEntry` cast. Ignores the patch if the found entry's `kind`
 * doesn't match `kind` (e.g. a stale id from a prior entry of a different
 * kind), rather than merging mismatched fields onto it.
 */
export function updateStreamEntry<K extends StreamEntry["kind"]>(
  id: string,
  kind: K,
  patch: Partial<Omit<Extract<StreamEntry, { kind: K }>, "kind" | "id">>,
): void {
  set({
    ...state,
    entries: state.entries.map((e) => (e.id === id && e.kind === kind ? { ...e, ...patch } : e)),
  });
}

function messageEntries(entries: readonly StreamEntry[]): ReadonlyArray<Extract<StreamEntry, { kind: "message" }>> {
  return entries.filter((e): e is Extract<StreamEntry, { kind: "message" }> => e.kind === "message");
}

function patchMessage(id: string, patch: (message: ChatViewMessage) => Partial<ChatViewMessage>): void {
  set({
    ...state,
    entries: state.entries.map((e) => (e.kind === "message" && e.message.id === id ? { ...e, message: { ...e.message, ...patch(e.message) } } : e)),
  });
}

/** Story 13.4: Spencer's next message closes the Undo window locally: every undoable receipt becomes settled. */
function settleUndoableReceipts(): void {
  if (!messageEntries(state.entries).some((e) => e.message.receiptState === "undoable")) return;
  set({
    ...state,
    entries: state.entries.map((e) =>
      e.kind === "message" && e.message.receiptState === "undoable" ? { ...e, message: { ...e.message, receiptState: "settled" as const } } : e,
    ),
  });
}

/** Story 13.4: records the outcome of an Undo attempt on one message's receipt. */
export function setReceiptOutcome(messageId: string, receiptState: ReceiptState, receiptNote?: string): void {
  patchMessage(messageId, () => ({ receiptState, ...(receiptNote !== undefined ? { receiptNote } : {}) }));
}

/** Story 13.11: folds a change into one message's rating prompt. */
export function setMessageRating(messageId: string, patch: Partial<MessageRating>): void {
  patchMessage(messageId, (m) => (m.rating ? { rating: { ...m.rating, ...patch } } : {}));
}

/** Story 13.11: a note that filed to memory is that message's Remembered Receipt (Undo until the next message). */
export function setMessageReceipt(messageId: string, receipt: RememberedReceipt): void {
  patchMessage(messageId, () => ({ receipt, receiptState: "undoable" as const }));
}

/** Story 13.11: a new message closes an open prompt locally; the server records the dismissal itself. */
function dismissOpenRatings(): void {
  if (!messageEntries(state.entries).some((e) => e.message.rating?.phase === "open")) return;
  set({
    ...state,
    entries: state.entries.map((e) =>
      e.kind === "message" && e.message.rating?.phase === "open" ? { ...e, message: { ...e.message, rating: { ...e.message.rating, phase: "dismissed" as const } } } : e,
    ),
  });
}

function appendMessage(message: ChatViewMessage): void {
  set({ ...state, entries: [...state.entries, { kind: "message", id: message.id, message }] });
}

let hydrateStarted = false;

/**
 * Story 13.1: restores today's Conversation from the server, once per page
 * load (the first open of the Chat panel). Stored turns render as plain
 * done messages, in front of anything already present (a pending open item
 * may have been appended first). A stored question is text only — nothing
 * here re-runs an action. A failed fetch leaves the panel as it was.
 */
export async function hydrateChatHistory(): Promise<void> {
  if (hydrateStarted) return;
  hydrateStarted = true;
  try {
    const res = await apiClient.api["chat-history"].today.$get();
    const result = await res.json();
    if (!result.ok || result.value.turns.length === 0) return;
    const restored: StreamEntry[] = result.value.turns.map((turn) => {
      const message: ChatViewMessage = { id: `stored-${turn.id}`, role: turn.role, text: turn.text, receipts: [], status: "done" };
      return { kind: "message", id: message.id, message };
    });
    set({ ...state, entries: [...restored, ...state.entries] });
  } catch {
    // The panel simply starts empty.
  }
}

/**
 * Sends `message` as Spencer's turn. His turn and a placeholder for Yoh's
 * (showing the Thinking Indicator) appear in the same synchronous update
 * that clears the draft, before any network activity (NFR-Latency). Stream
 * events then fold into the placeholder: `status` replaces its status text,
 * `delta` appends, `done` sets the final reply/receipts/question (and, when
 * the response carries a `sandboxCard`, starts a Sandbox session — Story
 * 9.2), and `error` marks it failed with the server's message, keeping any
 * text that already streamed.
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
  const request: ChatTurnRequest = { message: trimmed };
  settleUndoableReceipts();
  dismissOpenRatings();
  appendMessage({ id: userId, role: "user", text: trimmed, receipts: [], status: "done" });
  appendMessage({ id: assistantId, role: "assistant", text: "", receipts: [], status: "streaming", statusText: INITIAL_STATUS_TEXT });
  set({ ...state, draft: "", sending: true });

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
        if (event.response.sandboxCard) startSandbox(event.response.sandboxCard);
        set({ ...state, sending: false });
        return;
      case "remembered":
        patchMessage(assistantId, () => ({ receipt: event.receipt, receiptState: "undoable" as const }));
        return;
      case "proposal":
        appendProposalQuestion(event.question);
        return;
      case "rating":
        patchMessage(assistantId, () => ({ rating: { promptId: event.promptId, phase: "open" as const } }));
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
    const partial = messageEntries(state.entries).find((e) => e.id === assistantId)?.message;
    if (partial && partial.text !== "") {
      patchMessage(assistantId, () => ({ status: "error" }));
      set({ ...state, sending: false });
      return;
    }
    set({
      entries: state.entries.filter((e) => !(e.kind === "message" && (e.id === userId || e.id === assistantId))),
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
export function recordAnsweredOpenItem(
  youText: string,
  yoh: { message?: string; receipts: readonly string[]; next?: OpenItemQuestion },
): void {
  const userId = `chat-${++nextId}`;
  const assistantId = `chat-${++nextId}`;
  settleUndoableReceipts();
  appendMessage({ id: userId, role: "user", text: youText, receipts: [], status: "done" });
  appendMessage({
    id: assistantId,
    role: "assistant",
    text: yoh.message ?? "",
    receipts: yoh.receipts,
    status: "done",
    ...(yoh.next ? { question: yoh.next } : {}),
  });
}

/**
 * Task 6 addendum: appends one ritual-raised pending open interaction
 * request (data-completeness, night close-out) as a Yoh message
 * — `item.promptText` as the message text, `item.question` as its inline
 * Structured Question card, answerable exactly like any other inline
 * question (`ChatMessage.tsx`'s own `answerInline`). A no-op past the first
 * call for a given `item.requestId + item.question.questionId` combination
 * in this session (C1: NOT `requestId` alone — see `shownPendingRequestIds`
 * — a reopen or a later `GET /api/open-items` refetch never duplicates a
 * still-pending item), so `ChatPanel.tsx` can call this on every fetch/hint
 * without tracking what it already showed. `resolveMessageQuestion` frees
 * the entry once the item is actually answered, so a ritual re-raise under
 * the same id later shows again instead of staying hidden forever.
 */
export function appendPendingOpenItem(item: OpenItem): void {
  const key = pendingItemKey(item.requestId, item.question.questionId);
  if (shownPendingRequestIds.has(key)) return;
  shownPendingRequestIds.add(key);
  const id = `chat-${++nextId}`;
  appendMessage({ id, role: "assistant", text: item.promptText, receipts: [], question: item.question, status: "done" });
}

/**
 * Story 13.8: the `proposal` stream event (a rule-change card raised by post-done filing).
 * Same dedupe as `appendPendingOpenItem` (`requestId::questionId`), so the next chat-panel
 * open's `GET /api/open-items` never re-appends it. Empty text: the card renders the
 * question text itself, so the words are not shown twice.
 */
export function appendProposalQuestion(question: OpenItemQuestion): void {
  const key = pendingItemKey(question.requestId, question.questionId);
  if (shownPendingRequestIds.has(key)) return;
  shownPendingRequestIds.add(key);
  appendMessage({ id: `chat-${++nextId}`, role: "assistant", text: "", receipts: [], question, status: "done" });
}

/**
 * I2/C1 (final-review): the ONE place a Structured Question's card is
 * actually resolved — called by `ChatMessage.tsx`'s `answerInline` whenever
 * the server genuinely resolves the question (`next === "done"`, a
 * genuinely different `next` question, or a `conflict`/`stale-proposal`
 * outcome, which means it's already resolved elsewhere). Clears
 * `question` from the stored message itself (not component state), so a
 * later remount of `ChatMessage` — closing and reopening the panel — reads
 * the SAME resolved state from the store and never shows the card again
 * (I2). Also frees this question's dedupe entry (C1), so a ritual that
 * re-raises under the same requestId+questionId later is treated as new.
 */
export function resolveMessageQuestion(messageId: string): void {
  const entry = messageEntries(state.entries).find((e) => e.message.id === messageId);
  if (entry?.message.question) {
    shownPendingRequestIds.delete(pendingItemKey(entry.message.question.requestId, entry.message.question.questionId));
  }
  patchMessage(messageId, () => ({ question: undefined }));
}

/** Test-only: clears the module-level transcript (and the pending-item dedupe set) between tests. Never called from production code. */
export function __resetChatStoreForTests(): void {
  state = EMPTY;
  nextId = 0;
  shownPendingRequestIds.clear();
  hydrateStarted = false;
}
