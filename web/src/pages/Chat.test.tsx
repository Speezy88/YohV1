/**
 * web/src/pages/Chat.test.tsx — Story 8.5, UX-DR36/40: the Chat page
 * layout, the synchronous optimistic turn + Thinking Indicator on Enter,
 * the hand-off to streamed text, and no launch-splash gate.
 *
 * Task 0 (real-use fix, 2026-09-27): once a conversation grows, three
 * regions must never overlap — open items (capped, own scroll), the
 * message stream (the only flexible/scrollable region), and the Chat Input
 * (pinned below, in normal flow). Auto-scroll follows the newest message
 * unless Spencer has scrolled up, which pauses it and surfaces "Jump to
 * latest".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import ChatPage from "./Chat.tsx";
import { __resetChatStoreForTests } from "../lib/chatStore.ts";
import * as chatStreamModule from "../lib/chatStream.ts";
import * as openItemsLib from "../lib/openItems.ts";
import * as readiness from "../lib/readiness.ts";
import * as reducedMotionModule from "../hooks/useReducedMotion.ts";
import type { ChatStreamEvent } from "../../../src/types/api.ts";

/** Marks a scrollable `<div>` as if it had real box-model geometry — jsdom never computes layout, so `scrollHeight`/`clientHeight`/`scrollTop` stay 0 unless a test sets them itself. */
function setScrollGeometry(el: HTMLElement, geometry: { scrollHeight: number; clientHeight: number; scrollTop: number }): void {
  Object.defineProperty(el, "scrollHeight", { value: geometry.scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: geometry.clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: geometry.scrollTop, configurable: true, writable: true });
}

function pressEnterWith(text: string): void {
  const input = screen.getByRole("textbox", { name: "Message Yoh" });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("Chat page", () => {
  beforeEach(() => {
    __resetChatStoreForTests();
    readiness.__resetReadinessForTests();
    // Every pre-existing test in this file is about the transcript/input,
    // not open items — default to "loading" (renders nothing) so those
    // tests are unaffected; the open-items-specific tests below override
    // this with their own `mockReturnValue`.
    vi.spyOn(openItemsLib, "useOpenItems").mockReturnValue({ status: "loading" });
    vi.spyOn(openItemsLib, "startOpenItemsStream").mockReturnValue(() => {});
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

  it("the stream is the only flexible, scrollable region, and the Chat Input stays in normal flow (never absolutely positioned over it)", () => {
    render(<ChatPage />);
    const stream = screen.getByTestId("chat-stream");
    // "min-height: 0" is required alongside "flex-1" — without it a flex
    // item can't shrink below its content size, which is exactly what let
    // the stream refuse to shrink and push the Input off in the reported bug.
    expect(stream.className).toMatch(/\bmin-h-0\b/);
    expect(stream.className).toMatch(/\bflex-1\b/);
    expect(stream.className).toMatch(/\boverflow-y-auto\b/);

    const inputRegion = screen.getByTestId("chat-input-region");
    expect(inputRegion.className).not.toMatch(/\b(absolute|fixed)\b/);
  });

  it("open items render in their own region, before the stream in DOM order, and don't grow to share the stream's flex space", () => {
    vi.spyOn(openItemsLib, "useOpenItems").mockReturnValue({
      status: "loaded",
      items: [
        {
          requestId: "data-completeness",
          requestKind: "data-completeness",
          promptText: "I need a bit more.",
          question: { requestId: "data-completeness", questionId: "t1:area", text: "What area?", options: [], allowsFreeText: true },
        },
      ],
    });
    vi.spyOn(openItemsLib, "startOpenItemsStream").mockReturnValue(() => {});
    render(<ChatPage />);

    const region = screen.getByTestId("open-items-region");
    const stream = screen.getByTestId("chat-stream");
    expect(region.compareDocumentPosition(stream) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.className).not.toMatch(/\bflex-1\b/);
    expect(region.className).toMatch(/\bshrink-0\b/);
  });

  it("renders nothing in the open-items region when there are none (no empty capped box left behind)", () => {
    vi.spyOn(openItemsLib, "useOpenItems").mockReturnValue({ status: "loaded", items: [] });
    vi.spyOn(openItemsLib, "startOpenItemsStream").mockReturnValue(() => {});
    render(<ChatPage />);
    expect(screen.queryByTestId("open-items-region")).not.toBeInTheDocument();
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

  it("renders open items above the transcript, and starts the open-items stream once on mount", () => {
    vi.spyOn(openItemsLib, "useOpenItems").mockReturnValue({
      status: "loaded",
      items: [
        {
          requestId: "data-completeness",
          requestKind: "data-completeness",
          promptText: "I need a bit more.",
          question: { requestId: "data-completeness", questionId: "t1:area", text: "What area is Draft the memo?", options: [], allowsFreeText: true },
        },
      ],
    });
    const startSpy = vi.spyOn(openItemsLib, "startOpenItemsStream").mockReturnValue(() => {});
    render(<ChatPage />);
    expect(screen.getByText("What area is Draft the memo?")).toBeInTheDocument();
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("sending unrelated chat while an open item is rendered is never blocked (Review Focus #5)", () => {
    vi.spyOn(openItemsLib, "useOpenItems").mockReturnValue({
      status: "loaded",
      items: [
        {
          requestId: "data-completeness",
          requestKind: "data-completeness",
          promptText: "I need a bit more.",
          question: { requestId: "data-completeness", questionId: "t1:area", text: "What area?", options: [], allowsFreeText: true },
        },
      ],
    });
    const streamChat = vi.spyOn(chatStreamModule, "streamChat").mockReturnValue(new Promise(() => {}));
    render(<ChatPage />);
    const input = screen.getByRole("textbox", { name: "Message Yoh" });
    expect(input).toBeEnabled();
    pressEnterWith("what's on my plan today");
    expect(screen.getByText("what's on my plan today")).toBeInTheDocument();
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  describe("auto-scroll (Task 0)", () => {
    it("scrolling away from the bottom pauses auto-scroll and shows Jump to latest; scrolling back down resumes it", () => {
      render(<ChatPage />);
      const stream = screen.getByTestId("chat-stream");
      expect(screen.queryByTestId("jump-to-latest")).not.toBeInTheDocument();

      setScrollGeometry(stream, { scrollHeight: 1000, clientHeight: 300, scrollTop: 200 });
      fireEvent.scroll(stream);
      expect(screen.getByTestId("jump-to-latest")).toBeInTheDocument();

      setScrollGeometry(stream, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
      fireEvent.scroll(stream);
      expect(screen.queryByTestId("jump-to-latest")).not.toBeInTheDocument();
    });

    it("a new message never moves the scroll position while Spencer has scrolled up", () => {
      const streamChat = vi.spyOn(chatStreamModule, "streamChat").mockReturnValue(new Promise(() => {}));
      render(<ChatPage />);
      const stream = screen.getByTestId("chat-stream");
      setScrollGeometry(stream, { scrollHeight: 1000, clientHeight: 300, scrollTop: 200 });
      fireEvent.scroll(stream);
      expect(screen.getByTestId("jump-to-latest")).toBeInTheDocument();

      pressEnterWith("one more while scrolled up");
      expect(streamChat).toHaveBeenCalledTimes(1);
      expect(stream.scrollTop).toBe(200);
      expect(screen.getByTestId("jump-to-latest")).toBeInTheDocument();
    });

    it("clicking Jump to latest resumes auto-scroll, jumps to the bottom, and hides the control", () => {
      render(<ChatPage />);
      const stream = screen.getByTestId("chat-stream");
      setScrollGeometry(stream, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
      fireEvent.scroll(stream);
      fireEvent.click(screen.getByTestId("jump-to-latest"));

      expect(screen.queryByTestId("jump-to-latest")).not.toBeInTheDocument();
      expect(stream.scrollTop).toBe(1000);
    });

    it("scrolls smoothly by default", () => {
      const streamChat = vi.spyOn(chatStreamModule, "streamChat").mockReturnValue(new Promise(() => {}));
      vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
      render(<ChatPage />);
      const stream = screen.getByTestId("chat-stream");
      const scrollTo = vi.fn();
      Object.defineProperty(stream, "scrollTo", { value: scrollTo, configurable: true });
      pressEnterWith("motion allowed");
      expect(streamChat).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
    });

    it("scrolls instantly, never smoothly, when reduced motion is set", () => {
      const streamChat = vi.spyOn(chatStreamModule, "streamChat").mockReturnValue(new Promise(() => {}));
      vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(true);
      render(<ChatPage />);
      const stream = screen.getByTestId("chat-stream");
      const scrollTo = vi.fn();
      Object.defineProperty(stream, "scrollTo", { value: scrollTo, configurable: true });
      pressEnterWith("motion reduced");
      expect(streamChat).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    });
  });
});
