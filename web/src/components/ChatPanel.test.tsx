/**
 * web/src/components/ChatPanel.test.tsx — Task 6A. Ported from the retired
 * `pages/Chat.test.tsx` (Story 8.5/8.6/Task 0): the panel renders nothing
 * while closed, and once open carries the same behavior Chat page had —
 * the synchronous optimistic turn + Thinking Indicator on Enter, the
 * hand-off to streamed text, the three-region no-overlap layout, and
 * auto-scroll — plus Task 6A's own open/close/focus/Esc contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel.tsx";
import { __resetChatStoreForTests } from "../lib/chatStore.ts";
import { __resetChatPanelForTests, openChatPanel } from "../lib/chatPanel.ts";
import * as chatStreamModule from "../lib/chatStream.ts";
import * as openItemsLib from "../lib/openItems.ts";
import * as readiness from "../lib/readiness.ts";
import * as reducedMotionModule from "../hooks/useReducedMotion.ts";
import type { ChatStreamEvent } from "../../../src/types/api.ts";

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

function renderOpenPanel(): void {
  act(() => openChatPanel());
  render(<ChatPanel />);
}

describe("ChatPanel", () => {
  beforeEach(() => {
    __resetChatStoreForTests();
    __resetChatPanelForTests();
    readiness.__resetReadinessForTests();
    vi.spyOn(openItemsLib, "useOpenItems").mockReturnValue({ status: "loading" });
    vi.spyOn(openItemsLib, "startOpenItemsStream").mockReturnValue(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders nothing while closed", () => {
    render(<ChatPanel />);
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument();
  });

  it("renders as a modal dialog once open, with the Chat Input below the stream", () => {
    renderOpenPanel();
    const panel = screen.getByTestId("chat-panel");
    expect(panel).toHaveAttribute("role", "dialog");
    expect(panel).toHaveAttribute("aria-modal", "true");
    const stream = screen.getByTestId("chat-stream");
    const input = screen.getByTestId("chat-input");
    expect(stream.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("focuses the Chat Input's textarea as soon as it opens (capture flow: click/⌘K, type, Enter)", () => {
    renderOpenPanel();
    expect(screen.getByRole("textbox", { name: "Message Yoh" })).toHaveFocus();
  });

  it("Esc closes the panel", () => {
    renderOpenPanel();
    fireEvent.keyDown(screen.getByTestId("chat-panel"), { key: "Escape" });
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument();
  });

  it("clicking the backdrop closes the panel", () => {
    renderOpenPanel();
    fireEvent.click(screen.getByTestId("chat-panel-backdrop"));
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument();
  });

  it("clicking Close closes the panel", () => {
    renderOpenPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument();
  });

  it("the stream is the only flexible, scrollable region, and the Chat Input stays in normal flow", () => {
    renderOpenPanel();
    const stream = screen.getByTestId("chat-stream");
    expect(stream.className).toMatch(/\bmin-h-0\b/);
    expect(stream.className).toMatch(/\bflex-1\b/);
    expect(stream.className).toMatch(/\boverflow-y-auto\b/);
    const inputRegion = screen.getByTestId("chat-input-region");
    expect(inputRegion.className).not.toMatch(/\b(absolute|fixed)\b/);
  });

  it("open items render in their own region, before the stream, and don't grow to share the stream's flex space", () => {
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
    renderOpenPanel();
    const region = screen.getByTestId("open-items-region");
    const stream = screen.getByTestId("chat-stream");
    expect(region.compareDocumentPosition(stream) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.className).not.toMatch(/\bflex-1\b/);
    expect(region.className).toMatch(/\bshrink-0\b/);
  });

  it("renders nothing in the open-items region when there are none", () => {
    vi.spyOn(openItemsLib, "useOpenItems").mockReturnValue({ status: "loaded", items: [] });
    renderOpenPanel();
    expect(screen.queryByTestId("open-items-region")).not.toBeInTheDocument();
  });

  it("on Enter, Spencer's turn and the Thinking Indicator render synchronously, before streamChat has done anything", () => {
    const streamChat = vi.spyOn(chatStreamModule, "streamChat").mockReturnValue(new Promise(() => {}));
    renderOpenPanel();
    pressEnterWith("Hello Yoh");
    expect(screen.getByText("Hello Yoh")).toBeInTheDocument();
    expect(screen.getByTestId("thinking-indicator")).toBeInTheDocument();
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  it("the Thinking Indicator gives way to Yoh's streamed text as deltas arrive", async () => {
    let onEvent!: (e: ChatStreamEvent) => void;
    vi.spyOn(chatStreamModule, "streamChat").mockImplementation((_request, handlers) => {
      onEvent = (e) => handlers.onEvent(e);
      return new Promise(() => {});
    });
    renderOpenPanel();
    pressEnterWith("Hello Yoh");
    act(() => onEvent({ type: "delta", text: "Here's what " }));
    act(() => onEvent({ type: "delta", text: "I found." }));
    expect(screen.queryByTestId("thinking-indicator")).not.toBeInTheDocument();
    expect(screen.getByText("Here's what I found.")).toBeInTheDocument();
  });

  it("registers no launch-splash gate (Home's \"home-data\" stays the only one)", () => {
    const gate = vi.spyOn(readiness, "useReadinessGate");
    renderOpenPanel();
    pressEnterWith("Hello Yoh");
    expect(gate).not.toHaveBeenCalled();
    const { result } = renderHook(() => readiness.useAppReady());
    expect(result.current).toBe(true);
  });

  describe("auto-scroll (Task 0)", () => {
    it("scrolling away from the bottom pauses auto-scroll and shows Jump to latest", () => {
      renderOpenPanel();
      const stream = screen.getByTestId("chat-stream");
      expect(screen.queryByTestId("jump-to-latest")).not.toBeInTheDocument();
      setScrollGeometry(stream, { scrollHeight: 1000, clientHeight: 300, scrollTop: 200 });
      fireEvent.scroll(stream);
      expect(screen.getByTestId("jump-to-latest")).toBeInTheDocument();
    });

    it("scrolls smoothly by default, instantly under reduced motion", () => {
      const streamChat = vi.spyOn(chatStreamModule, "streamChat").mockReturnValue(new Promise(() => {}));
      vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(true);
      renderOpenPanel();
      const stream = screen.getByTestId("chat-stream");
      const scrollTo = vi.fn();
      Object.defineProperty(stream, "scrollTo", { value: scrollTo, configurable: true });
      pressEnterWith("motion reduced");
      expect(streamChat).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    });
  });
});
