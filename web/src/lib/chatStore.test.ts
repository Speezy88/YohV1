/**
 * web/src/lib/chatStore.test.ts — Story 8.5: the one client-memory chat
 * transcript + unsent-draft store. The optimistic turn pair appears
 * synchronously on send (NFR-Latency), stream events fold into Yoh's turn,
 * and a transport failure never leaves `sending` stuck or loses the draft.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { __resetChatStoreForTests, appendPendingOpenItem, recordAnsweredOpenItem, resolveMessageQuestion, send, setDraft, useChatStore } from "./chatStore.ts";
import * as chatStreamModule from "./chatStream.ts";
import * as notifications from "./notifications.ts";
import type { ChatStreamEvent, ChatTurnRequest, OpenItem, OpenItemQuestion } from "../../../src/types/api.ts";

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
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: "user", text: "Hello Yoh", status: "done" });
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", status: "streaming", text: "", statusText: "Thinking…" });
    expect(result.current.draft).toBe("");
    expect(result.current.sending).toBe(true);
    await stream.finish();
  });

  it("sends the prior transcript plus this message as history, skipping turns with no text", async () => {
    const stream = controllableStream();
    act(() => void send("first"));
    stream.emit({ type: "done", response: { reply: "one", receipts: [] } });
    await stream.finish();
    act(() => void send("second"));
    stream.emit({ type: "error", error: { kind: "unreachable", message: "llm down" } });
    await stream.finish();
    act(() => void send("third"));
    expect(stream.requests[2]).toEqual({
      message: "third",
      history: [
        { role: "user", content: "first" },
        { role: "assistant", content: "one" },
        { role: "user", content: "second" },
        { role: "user", content: "third" },
      ],
    });
    await stream.finish();
  });

  it("a status event replaces the placeholder's status text; delta events append to its text", async () => {
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("Hi"));
    stream.emit({ type: "status", text: "Searching the web…" });
    expect(result.current.messages[1]!.statusText).toBe("Searching the web…");
    stream.emit({ type: "delta", text: "Sure" });
    stream.emit({ type: "delta", text: ", one sec." });
    expect(result.current.messages[1]!.text).toBe("Sure, one sec.");
    expect(result.current.messages[1]!.status).toBe("streaming");
    await stream.finish();
  });

  it("a done event sets the final reply, receipts, and question, and clears sending", async () => {
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("Hi"));
    stream.emit({ type: "delta", text: "Do" });
    stream.emit({ type: "done", response: { reply: "Done.", receipts: ['Created "Draft the memo" in Tasks.'], question: QUESTION } });
    await stream.finish();
    expect(result.current.messages[1]).toMatchObject({ status: "done", text: "Done.", receipts: ['Created "Draft the memo" in Tasks.'], question: QUESTION });
    expect(result.current.sending).toBe(false);
  });

  it("an error event marks the turn 'error' with the server's message, keeping any partial text", async () => {
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("Hi"));
    stream.emit({ type: "delta", text: "Sure, I" });
    stream.emit({ type: "error", error: { kind: "unreachable", message: "llm down" } });
    await stream.finish();
    expect(result.current.messages[1]).toMatchObject({ status: "error", text: "Sure, I", errorText: "llm down" });
    expect(result.current.sending).toBe(false);
  });

  it("a transport failure before any reply text removes the optimistic pair, restores the draft, and raises a failure notice", async () => {
    const notice = vi.spyOn(notifications, "addLocalFailureNotice").mockImplementation(() => {});
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("Hello Yoh"));
    stream.emit({ type: "status", text: "Thinking…" });
    await stream.fail(new Error("network down"));
    expect(result.current.messages).toHaveLength(0);
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
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({ status: "error", text: "Sure, I" });
    expect(result.current.sending).toBe(false);
    expect(notice).not.toHaveBeenCalled();
  });

  it("send() with only whitespace, or while a turn is in flight, is a no-op", async () => {
    const stream = controllableStream();
    const { result } = renderHook(() => useChatStore());
    act(() => void send("   "));
    expect(result.current.messages).toHaveLength(0);
    act(() => void send("one"));
    act(() => void send("two"));
    expect(stream.spy).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toHaveLength(2);
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
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: "user", text: "Work", status: "done" });
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", text: "Got it — Work.", receipts: ["Set area to Work"], status: "done" });
  });

  it("recordAnsweredOpenItem with no message still appends Yoh's turn, as an empty reply", () => {
    const { result } = renderHook(() => useChatStore());
    act(() => recordAnsweredOpenItem("no", { receipts: [] }));
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", text: "", receipts: [], status: "done" });
  });

  // ==========================================================================
  // appendPendingOpenItem / resolveMessageQuestion (C1, final-review)
  // ==========================================================================

  const SELF_CHECK_ITEM: OpenItem = {
    requestId: "self-check",
    requestKind: "self-check",
    promptText: "How are things going?",
    question: { requestId: "self-check", questionId: "score", text: "Score (1-10)?", options: [], allowsFreeText: true },
  };

  it("appendPendingOpenItem shows one Yoh message per requestId+questionId, a no-op on a repeat of the SAME pending item", () => {
    const { result } = renderHook(() => useChatStore());
    act(() => appendPendingOpenItem(SELF_CHECK_ITEM));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ role: "assistant", text: "How are things going?", question: SELF_CHECK_ITEM.question });

    act(() => appendPendingOpenItem(SELF_CHECK_ITEM));
    expect(result.current.messages).toHaveLength(1); // still just the one — same request, still pending, never shown twice
  });

  it("C1 (final-review): once resolveMessageQuestion clears an item, a LATER re-raise under the same requestId (a ritual reusing its fixed id) shows again", () => {
    const { result } = renderHook(() => useChatStore());
    act(() => appendPendingOpenItem(SELF_CHECK_ITEM));
    const messageId = result.current.messages[0]!.id;

    // Spencer answers it — the app resolves this message's question (Task 6's
    // "the card hides only when the server actually resolves it").
    act(() => resolveMessageQuestion(messageId));
    expect(result.current.messages[0]!.question).toBeUndefined();

    // The ritual runs again later and re-raises under the SAME fixed
    // requestId/questionId (self-check's questionId is always "score") — it
    // must show again, not be silently swallowed by the dedupe forever.
    act(() => appendPendingOpenItem(SELF_CHECK_ITEM));
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", text: "How are things going?", question: SELF_CHECK_ITEM.question });
  });

  it("resolveMessageQuestion clears the question from the stored message, so a remounted component reading the SAME message never shows it again", () => {
    const { result } = renderHook(() => useChatStore());
    act(() => appendPendingOpenItem(SELF_CHECK_ITEM));
    const messageId = result.current.messages[0]!.id;
    act(() => resolveMessageQuestion(messageId));
    expect(result.current.messages[0]).toMatchObject({ role: "assistant", text: "How are things going?" });
    expect(result.current.messages[0]!.question).toBeUndefined();
  });
});
