/**
 * web/src/pages/Chat.test.tsx — Story 8.5, UX-DR36/40: the Chat page
 * layout, the synchronous optimistic turn + Thinking Indicator on Enter,
 * the hand-off to streamed text, and no launch-splash gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import ChatPage from "./Chat.tsx";
import { __resetChatStoreForTests } from "../lib/chatStore.ts";
import * as chatStreamModule from "../lib/chatStream.ts";
import * as readiness from "../lib/readiness.ts";
import type { ChatStreamEvent } from "../../../src/types/api.ts";

function pressEnterWith(text: string): void {
  const input = screen.getByRole("textbox", { name: "Message Yoh" });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("Chat page", () => {
  beforeEach(() => {
    __resetChatStoreForTests();
    readiness.__resetReadinessForTests();
  });
  afterEach(() => vi.restoreAllMocks());

  it("reserves an empty left bar for the hidden Skill Switcher, and puts the Chat Input below the stream", () => {
    render(<ChatPage />);
    const reserved = screen.getByTestId("skill-switcher-reserved");
    expect(reserved).toBeEmptyDOMElement();
    expect(reserved).toHaveAttribute("aria-hidden", "true");
    const stream = screen.getByTestId("chat-stream");
    const input = screen.getByTestId("chat-input");
    expect(stream.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("on Enter, Spencer's turn and the Thinking Indicator render synchronously, before streamChat has done anything", () => {
    const streamChat = vi.spyOn(chatStreamModule, "streamChat").mockReturnValue(new Promise(() => {}));
    render(<ChatPage />);
    pressEnterWith("Hello Yoh");
    // No await, no act flush beyond fireEvent's own: the optimistic update is synchronous.
    expect(screen.getByText("Hello Yoh")).toBeInTheDocument();
    expect(screen.getByTestId("thinking-indicator")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  it("the Thinking Indicator gives way to Yoh's streamed text as deltas arrive", async () => {
    let onEvent!: (e: ChatStreamEvent) => void;
    vi.spyOn(chatStreamModule, "streamChat").mockImplementation((_request, handlers) => {
      onEvent = (e) => handlers.onEvent(e);
      return new Promise(() => {});
    });
    render(<ChatPage />);
    pressEnterWith("Hello Yoh");
    act(() => onEvent({ type: "status", text: "Searching the web…" }));
    expect(screen.getByRole("status")).toHaveTextContent("Searching the web…");
    act(() => onEvent({ type: "delta", text: "Here's what " }));
    act(() => onEvent({ type: "delta", text: "I found." }));
    expect(screen.queryByTestId("thinking-indicator")).not.toBeInTheDocument();
    expect(screen.getByText("Here's what I found.")).toBeInTheDocument();
  });

  it("registers no launch-splash gate (Home's \"home-data\" stays the only one), so Chat never holds readiness", () => {
    const gate = vi.spyOn(readiness, "useReadinessGate");
    render(<ChatPage />);
    pressEnterWith("Hello Yoh");
    expect(gate).not.toHaveBeenCalled();
    const { result } = renderHook(() => readiness.useAppReady());
    expect(result.current).toBe(true);
  });
});
