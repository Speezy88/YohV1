/**
 * web/src/lib/chatStore.test.ts — Story 8.5: the one client-memory chat
 * transcript + unsent-draft store. The optimistic turn pair appears
 * synchronously on send (NFR-Latency), stream events fold into Yoh's turn,
 * and a transport failure never leaves `sending` stuck or loses the draft.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  __resetChatStoreForTests,
  setReceiptOutcome,
  appendPendingOpenItem,
  appendStreamEntry,
  hydrateChatHistory,
  recordAnsweredOpenItem,
  resolveMessageQuestion,
  send,
  setDraft,
  updateStreamEntry,
  useChatStore,
} from "./chatStore.ts";
import type { ChatViewMessage, ChatStoreState } from "./chatStore.ts";
import * as chatStreamModule from "./chatStream.ts";
import { apiClient } from "./apiClient.ts";
import * as notifications from "./notifications.ts";
import type { ChatStreamEvent, ChatTurnRequest, OpenItem, OpenItemQuestion, SandboxCardView } from "../../../src/types/api.ts";

vi.mock("./apiClient.ts", () => ({
  apiClient: { api: { "chat-history": { today: { $get: vi.fn() } } } },
}));
const historyGet = apiClient.api["chat-history"].today.$get as unknown as ReturnType<typeof vi.fn>;
const TURNS = [
  { id: "t1", role: "user", text: "hello", truncated: false, createdAt: "2026-08-22T10:00:00Z" },
  { id: "t2", role: "assistant", text: "hi there", truncated: true, createdAt: "2026-08-22T10:00:01Z" },
];

/** Every existing test in this file asserted on `result.current.messages` — the message-kind entries, in order, unwrapped back to the old shape so none of the existing assertions below need to change their own expected values. */
function messagesOf(state: ChatStoreState): readonly ChatViewMessage[] {
  return state.entries.filter((e): e is Extract<typeof e, { kind: "message" }> => e.kind === "message").map((e) => e.message);
}

/** A `streamChat` stand-in the test drives by hand: `emit` pushes an event, `finish`/`fail` settle it. */
function controllableStream() {
  let handlers!: { onEvent(e: ChatStreamEvent): void };
  let finish!: () => void;
  let fail!: (err: Error) => void;
  const requests: ChatTurnRequest[] = [];
  const spy = vi.spyOn(chatStreamModule, "streamChat").mockImplementation((request, h) => {
    requests.push(request);
    handlers = h;
    return new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
  });
  return {
    spy,
    requests,
    emit: (e: ChatStreamEvent) => act(() => handlers.onEvent(e)),
    finish: async () => act(async () => finish()),
    fail: async (err: Error) => act(async () => fail(err)),
  };
}

const QUESTION: OpenItemQuestion = { requestId: "proposal:p1", questionId: "confirm", text: "Create it?", options: [], allowsFreeText: true };

describe("chatStore", () => {
  beforeEach(() => __resetChatStoreForTests());
  afterEach(() => vi.restoreAllMocks());

  it("setDraft updates the draft immediately", () => {
    const { result } = renderHook(() => useChatStore());
    act(() => setDraft("hello"));
    expect(result.current.draft).toBe("hello");
  });

  it("send() shows Spencer's turn and a thinking placeholder synchronously, before streamChat ever settles (NFR-Latency)", async () => {
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => setDraft("Hello Yoh"));
    act(() => void send("Hello Yoh"));
    expect(messagesOf(result.current)).toHaveLength(2);
    expect(messagesOf(result.current)[0]).toMatchObject({ role: "user", text: "Hello Yoh", status: "done" });
    expect(messagesOf(result.current)[1]).toMatchObject({ role: "assistant", status: "streaming", text: "", statusText: "Thinking…" });
    expect(result.current.draft).toBe("");
    expect(result.current.sending).toBe(true);
    await stream.finish();
  });

  it("sends only { message } to the server (it owns history)", async () => {
    const stream = controllableStream();
    act(() => void send("first"));
    stream.emit({ type: "done", response: { reply: "one", receipts: [] } });
    await stream.finish();
    act(() => void send("second"));
    expect(stream.requests[1]).toEqual({ message: "second" });
    await stream.finish();
  });

  it("hydrateChatHistory prepends today's stored turns as done messages, once per page load", async () => {
    historyGet.mockReset();
    historyGet.mockResolvedValue({ json: async () => ({ ok: true, value: { date: "2026-08-22", turns: TURNS } }) });
    const { result } = renderHook(() => useChatStore());
    act(() => appendPendingOpenItem({ requestId: "r", promptText: "Pending?", question: QUESTION } as OpenItem));
    await act(async () => hydrateChatHistory());
    await act(async () => hydrateChatHistory());
    expect(historyGet).toHaveBeenCalledTimes(1);
    expect(messagesOf(result.current).map((m) => [m.role, m.text, m.status])).toEqual([
      ["user", "hello", "done"],
      ["assistant", "hi there", "done"],
      ["assistant", "Pending?", "done"],
    ]);
  });

  it("a failed hydrate leaves the transcript empty", async () => {
    historyGet.mockReset();
    historyGet.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useChatStore());
    await act(async () => hydrateChatHistory());
    expect(result.current.entries).toEqual([]);
  });

  it("a status event replaces the placeholder's status text; delta events append to its text", async () => {
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("Hi"));
    stream.emit({ type: "status", text: "Searching the web…" });
    expect(messagesOf(result.current)[1]!.statusText).toBe("Searching the web…");
    stream.emit({ type: "delta", text: "Sure" });
    stream.emit({ type: "delta", text: ", one sec." });
    expect(messagesOf(result.current)[1]!.text).toBe("Sure, one sec.");
    expect(messagesOf(result.current)[1]!.status).toBe("streaming");
    await stream.finish();
  });

  it("a done event sets the final reply, receipts, and question, and clears sending", async () => {
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("Hi"));
    stream.emit({ type: "delta", text: "Do" });
    stream.emit({ type: "done", response: { reply: "Done.", receipts: ['Created "Draft the memo" in Tasks.'], question: QUESTION } });
    await stream.finish();
    expect(messagesOf(result.current)[1]).toMatchObject({ status: "done", text: "Done.", receipts: ['Created "Draft the memo" in Tasks.'], question: QUESTION });
    expect(result.current.sending).toBe(false);
  });

  it("an error event marks the turn 'error' with the server's message, keeping any partial text", async () => {
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("Hi"));
    stream.emit({ type: "delta", text: "Sure, I" });
    stream.emit({ type: "error", error: { kind: "unreachable", message: "llm down" } });
    await stream.finish();
    expect(messagesOf(result.current)[1]).toMatchObject({ status: "error", text: "Sure, I", errorText: "llm down" });
    expect(result.current.sending).toBe(false);
  });

  it("a transport failure before any reply text removes the optimistic pair, restores the draft, and raises a failure notice", async () => {
    const notice = vi.spyOn(notifications, "addLocalFailureNotice").mockImplementation(() => {});
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("Hello Yoh"));
    stream.emit({ type: "status", text: "Thinking…" });
    await stream.fail(new Error("network down"));
    expect(messagesOf(result.current)).toHaveLength(0);
    expect(result.current.draft).toBe("Hello Yoh");
    expect(result.current.sending).toBe(false);
    expect(notice).toHaveBeenCalledWith("Couldn't reach Yoh. Your message is back in the box to try again.");
  });

  it("a transport failure never overwrites a new draft typed while the turn was in flight", async () => {
    vi.spyOn(notifications, "addLocalFailureNotice").mockImplementation(() => {});
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("first"));
    act(() => setDraft("something newer"));
    await stream.fail(new Error("network down"));
    expect(result.current.draft).toBe("something newer");
  });

  it("a transport failure after reply text arrived keeps the partial turn, marked interrupted", async () => {
    const notice = vi.spyOn(notifications, "addLocalFailureNotice").mockImplementation(() => {});
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("Hi"));
    stream.emit({ type: "delta", text: "Sure, I" });
    await stream.fail(new Error("chat: the reply stream ended before Yoh finished"));
    expect(messagesOf(result.current)).toHaveLength(2);
    expect(messagesOf(result.current)[1]).toMatchObject({ status: "error", text: "Sure, I" });
    expect(result.current.sending).toBe(false);
    expect(notice).not.toHaveBeenCalled();
  });

  it("send() with only whitespace, or while a turn is in flight, is a no-op", async () => {
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("   "));
    expect(messagesOf(result.current)).toHaveLength(0);
    act(() => void send("one"));
    act(() => void send("two"));
    expect(stream.spy).toHaveBeenCalledTimes(1);
    expect(messagesOf(result.current)).toHaveLength(2);
    await stream.finish();
  });

  it("never touches browser storage (client memory only, [DECISION DEFAULT])", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const stream = controllableStream();
    act(() => setDraft("x"));
    act(() => void send("x"));
    stream.emit({ type: "done", response: { reply: "y", receipts: [] } });
    await stream.finish();
    expect(setItem).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // recordAnsweredOpenItem (Story 8.6, Task 7)
  // ==========================================================================

  it("recordAnsweredOpenItem appends Spencer's pick and Yoh's reply as an ordinary turn pair (UX-DR38)", () => {
    const { result } = renderHook(() => useChatStore());
    act(() => recordAnsweredOpenItem("Work", { message: "Got it — Work.", receipts: ["Set area to Work"] }));
    expect(messagesOf(result.current)).toHaveLength(2);
    expect(messagesOf(result.current)[0]).toMatchObject({ role: "user", text: "Work", status: "done" });
    expect(messagesOf(result.current)[1]).toMatchObject({ role: "assistant", text: "Got it — Work.", receipts: ["Set area to Work"], status: "done" });
  });

  it("recordAnsweredOpenItem with no message still appends Yoh's turn, as an empty reply", () => {
    const { result } = renderHook(() => useChatStore());
    act(() => recordAnsweredOpenItem("no", { receipts: [] }));
    expect(messagesOf(result.current)[1]).toMatchObject({ role: "assistant", text: "", receipts: [], status: "done" });
  });

  // ==========================================================================
  // appendPendingOpenItem / resolveMessageQuestion (C1, final-review)
  // ==========================================================================

  const PENDING_ITEM: OpenItem = {
    requestId: "data-completeness",
    requestKind: "data-completeness",
    promptText: "How are things going?",
    question: { requestId: "data-completeness", questionId: "score", text: "Score (1-10)?", options: [], allowsFreeText: true },
  };

  it("appendPendingOpenItem shows one Yoh message per requestId+questionId, a no-op on a repeat of the SAME pending item", () => {
    const { result } = renderHook(() => useChatStore());
    act(() => appendPendingOpenItem(PENDING_ITEM));
    expect(messagesOf(result.current)).toHaveLength(1);
    expect(messagesOf(result.current)[0]).toMatchObject({ role: "assistant", text: "How are things going?", question: PENDING_ITEM.question });

    act(() => appendPendingOpenItem(PENDING_ITEM));
    expect(messagesOf(result.current)).toHaveLength(1); // still just the one — same request, still pending, never shown twice
  });

  it("C1 (final-review): once resolveMessageQuestion clears an item, a LATER re-raise under the same requestId (a ritual reusing its fixed id) shows again", () => {
    const { result } = renderHook(() => useChatStore());
    act(() => appendPendingOpenItem(PENDING_ITEM));
    const messageId = messagesOf(result.current)[0]!.id;

    // Spencer answers it — the app resolves this message's question (Task 6's
    // "the card hides only when the server actually resolves it").
    act(() => resolveMessageQuestion(messageId));
    expect(messagesOf(result.current)[0]!.question).toBeUndefined();

    // The ritual runs again later and re-raises under the SAME fixed
    // requestId/questionId (the score question's questionId is always "score") — it
    // must show again, not be silently swallowed by the dedupe forever.
    act(() => appendPendingOpenItem(PENDING_ITEM));
    expect(messagesOf(result.current)).toHaveLength(2);
    expect(messagesOf(result.current)[1]).toMatchObject({ role: "assistant", text: "How are things going?", question: PENDING_ITEM.question });
  });

  it("resolveMessageQuestion clears the question from the stored message, so a remounted component reading the SAME message never shows it again", () => {
    const { result } = renderHook(() => useChatStore());
    act(() => appendPendingOpenItem(PENDING_ITEM));
    const messageId = messagesOf(result.current)[0]!.id;
    act(() => resolveMessageQuestion(messageId));
    expect(messagesOf(result.current)[0]).toMatchObject({ role: "assistant", text: "How are things going?" });
    expect(messagesOf(result.current)[0]!.question).toBeUndefined();
  });

  // ==========================================================================
  // StreamEntry / sandboxCard (Story 9.2, Task 6)
  // ==========================================================================

  const CARD: SandboxCardView = { taskId: "t1", taskTitle: "Chem problem set", estimatedDurationMinutes: 45, remaining: 2, options: { area: [], energy: [] } };

  it("a done event carrying sandboxCard appends a pending sandbox-card entry AFTER the (empty) assistant reply", async () => {
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("/sandbox"));
    stream.emit({ type: "done", response: { reply: "", receipts: [], sandboxCard: CARD } });
    await stream.finish();
    const kinds = result.current.entries.map((e) => e.kind);
    expect(kinds).toEqual(["message", "message", "sandbox-card"]);
    const cardEntry = result.current.entries.at(-1);
    expect(cardEntry).toMatchObject({ kind: "sandbox-card", view: CARD, status: "pending" });
  });

  it("a done event with NO sandboxCard never appends a sandbox-card entry", async () => {
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("hi"));
    stream.emit({ type: "done", response: { reply: "hello", receipts: [] } });
    await stream.finish();
    expect(result.current.entries.some((e) => e.kind === "sandbox-card")).toBe(false);
  });

  describe("appendStreamEntry / updateStreamEntry (generic, reused by Story 9.3's own sandbox-finale kind)", () => {
    it("appendStreamEntry returns a fresh id and adds the entry at the end", () => {
      const { result } = renderHook(() => useChatStore());
      let id!: string;
      act(() => {
        id = appendStreamEntry({ kind: "sandbox-card", view: CARD, status: "pending" });
      });
      expect(result.current.entries.at(-1)).toMatchObject({ id, kind: "sandbox-card", view: CARD, status: "pending" });
    });

    it("updateStreamEntry merges a patch onto the matching entry only", () => {
      const { result } = renderHook(() => useChatStore());
      let id!: string;
      let otherId!: string;
      act(() => {
        id = appendStreamEntry({ kind: "sandbox-card", view: CARD, status: "pending" });
        otherId = appendStreamEntry({ kind: "sandbox-card", view: { ...CARD, taskId: "t2" }, status: "pending" });
        updateStreamEntry(id, "sandbox-card", { status: "saved", receipt: "Due Date, Estimated Duration saved." });
      });
      const patched = result.current.entries.find((e) => e.id === id);
      const other = result.current.entries.find((e) => e.id === otherId);
      expect(patched).toMatchObject({ status: "saved", receipt: "Due Date, Estimated Duration saved." });
      expect(other).toMatchObject({ status: "pending" });
    });

    it("Task 10 hygiene: ignores the patch if the found entry's kind doesn't match the given kind", () => {
      const { result } = renderHook(() => useChatStore());
      let id!: string;
      act(() => {
        id = appendStreamEntry({ kind: "sandbox-card", view: CARD, status: "pending" });
        // `id` actually names a "sandbox-card" entry — this call names the WRONG kind on purpose.
        updateStreamEntry(id, "sandbox-finale", { status: "done" });
      });
      expect(result.current.entries.find((e) => e.id === id)).toMatchObject({ kind: "sandbox-card", status: "pending" });
    });
  });
  describe("Remembered Receipt (Story 13.4)", () => {
    const RECEIPT = { receiptId: "r1", kind: "remembered" as const, items: [{ id: "i1", text: "Chem club is a club", folder: "corrections" as const }] };

    it("a remembered event after done attaches an undoable receipt to the assistant message", async () => {
      const stream = controllableStream();
      const { result } = renderHook(() => useChatStore());
      act(() => void send("remember that Chem club is a club"));
      stream.emit({ type: "done", response: { reply: "Got it.", receipts: [] } });
      stream.emit({ type: "remembered", receipt: RECEIPT });
      await stream.finish();
      expect(messagesOf(result.current)[1]).toMatchObject({ status: "done", receipt: RECEIPT, receiptState: "undoable" });
    });

    it("a proposal event appends one text-less question card, and appendPendingOpenItem does not re-append it", async () => {
      const stream = controllableStream();
      const { result } = renderHook(() => useChatStore());
      const question = { requestId: "proposal:rule-change-i1", questionId: "confirm", text: "Change school-day work start from 3:15 PM to 2:30 PM?", options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }], allowsFreeText: false };
      act(() => void send("start work at 2:30 on school days"));
      stream.emit({ type: "done", response: { reply: "Got it.", receipts: [] } });
      stream.emit({ type: "remembered", receipt: RECEIPT });
      stream.emit({ type: "proposal", question });
      await stream.finish();
      const cards = messagesOf(result.current).filter((m) => m.question);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ role: "assistant", text: "", question });
      act(() => appendPendingOpenItem({ requestId: question.requestId, promptText: question.text, question } as unknown as OpenItem));
      expect(messagesOf(result.current).filter((m) => m.question)).toHaveLength(1);
    });

    it("the next send() settles every undoable receipt", async () => {
      const stream = controllableStream();
      const { result } = renderHook(() => useChatStore());
      act(() => void send("remember that Chem club is a club"));
      stream.emit({ type: "done", response: { reply: "Got it.", receipts: [] } });
      stream.emit({ type: "remembered", receipt: RECEIPT });
      await stream.finish();
      act(() => void send("thanks"));
      expect(messagesOf(result.current)[1]!.receiptState).toBe("settled");
    });

    it("setReceiptOutcome records the state and the server's note", async () => {
      const stream = controllableStream();
      const { result } = renderHook(() => useChatStore());
      act(() => void send("remember x"));
      stream.emit({ type: "done", response: { reply: "Got it.", receipts: [] } });
      stream.emit({ type: "remembered", receipt: RECEIPT });
      await stream.finish();
      const id = messagesOf(result.current)[1]!.id;
      act(() => setReceiptOutcome(id, "removed", "Removed from memory."));
      expect(messagesOf(result.current)[1]).toMatchObject({ receiptState: "removed", receiptNote: "Removed from memory." });
    });
  });
});
