/**
 * web/src/components/ChatPanel.test.tsx — Task 6A. Ported from the retired
 * `pages/Chat.test.tsx` (Story 8.5/8.6/Task 0): the panel renders nothing
 * while closed, and once open carries the same behavior Chat page had —
 * the synchronous optimistic turn + Thinking Indicator on Enter, the
 * hand-off to streamed text, the three-region no-overlap layout, and
 * auto-scroll — plus Task 6A's own open/close/focus/Esc contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel.tsx";
import { __resetChatStoreForTests } from "../lib/chatStore.ts";
import { __resetChatPanelForTests, openChatPanel } from "../lib/chatPanel.ts";
import * as chatStreamModule from "../lib/chatStream.ts";
import * as missingDataModule from "../lib/missingData.ts";
import * as openItemsModule from "../lib/openItems.ts";
import * as readiness from "../lib/readiness.ts";
import * as reducedMotionModule from "../hooks/useReducedMotion.ts";
import type { ChatStreamEvent, OpenItem } from "../../../src/types/api.ts";

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
    vi.spyOn(missingDataModule, "useMissingDataCount").mockReturnValue({ status: "loading" });
    // Task 6 addendum: no open items by default, and no real network call —
    // individual tests below override these to exercise the injection flow.
    vi.spyOn(openItemsModule, "useOpenItems").mockReturnValue({ status: "loading" });
    vi.spyOn(openItemsModule, "startOpenItemsStream").mockReturnValue(() => {});
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

  // Real-use fixes plan, Task 2 (Spencer: "get rid of the 'waiting on you'
  // section in the chat"): the top-of-Chat OpenItems list is gone from this
  // panel entirely, in every state — no heading, no cards, regardless of
  // whether any open items exist server-side.
  it("never shows a 'Waiting on you' section, in any state", () => {
    renderOpenPanel();
    expect(screen.queryByText(/waiting on you/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("open-items-region")).not.toBeInTheDocument();
    expect(screen.queryByTestId("open-items")).not.toBeInTheDocument();
  });

  describe("the 'N tasks missing data' chip", () => {
    it("is hidden while the count is loading", () => {
      vi.spyOn(missingDataModule, "useMissingDataCount").mockReturnValue({ status: "loading" });
      renderOpenPanel();
      expect(screen.queryByTestId("missing-data-chip")).not.toBeInTheDocument();
    });

    it("is hidden at a count of 0", () => {
      vi.spyOn(missingDataModule, "useMissingDataCount").mockReturnValue({ status: "loaded", count: 0 });
      renderOpenPanel();
      expect(screen.queryByTestId("missing-data-chip")).not.toBeInTheDocument();
    });

    it("shows the singular label for a count of 1", () => {
      vi.spyOn(missingDataModule, "useMissingDataCount").mockReturnValue({ status: "loaded", count: 1 });
      renderOpenPanel();
      expect(screen.getByTestId("missing-data-chip")).toHaveTextContent("1 task missing data");
    });

    it("shows the plural label for a count greater than 1", () => {
      vi.spyOn(missingDataModule, "useMissingDataCount").mockReturnValue({ status: "loaded", count: 3 });
      renderOpenPanel();
      expect(screen.getByTestId("missing-data-chip")).toHaveTextContent("3 tasks missing data");
    });

    it("clicking it calls the one exported click handler, `openMissingData`", () => {
      vi.spyOn(missingDataModule, "useMissingDataCount").mockReturnValue({ status: "loaded", count: 2 });
      const openMissingData = vi.spyOn(missingDataModule, "openMissingData").mockImplementation(() => {});
      renderOpenPanel();
      fireEvent.click(screen.getByTestId("missing-data-chip"));
      expect(openMissingData).toHaveBeenCalledTimes(1);
    });
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

  // Task 6 addendum: Task 2 removed "Waiting on you" with no replacement
  // surface for ritual-raised open interaction requests. This panel now
  // injects each one, on open, as its own Yoh message with an inline
  // Structured Question card.
  describe("pending ritual questions (Task 6 addendum)", () => {
    const PENDING_SELF_CHECK: OpenItem = {
      requestId: "self-check",
      requestKind: "self-check",
      promptText: "Quick Self-Check: on a scale of 1-10, how well is this working for you right now? Give me a number and a short written reason.",
      question: { requestId: "self-check", questionId: "score", text: 'Score (1-10) + a short reason, e.g. "7 feeling on top of things"', options: [], allowsFreeText: true },
    };

    it("a pending self-check request shows as a chat message with its question card, once the panel is open", async () => {
      vi.spyOn(openItemsModule, "useOpenItems").mockReturnValue({ status: "loaded", items: [PENDING_SELF_CHECK] });
      renderOpenPanel();
      await waitFor(() => expect(screen.getByText(/Quick Self-Check/)).toBeInTheDocument());
      expect(screen.getByLabelText("Other")).toBeInTheDocument();
    });

    it("answering a pending self-check inline (\"7, feeling good\") resolves it and the card disappears", async () => {
      vi.spyOn(openItemsModule, "useOpenItems").mockReturnValue({ status: "loaded", items: [PENDING_SELF_CHECK] });
      vi.spyOn(openItemsModule, "submitOpenItemAnswer").mockResolvedValue({
        ok: true,
        value: { message: "Thanks — got it. I'll check in again before too long.", receipts: [], next: "done" },
      });
      renderOpenPanel();
      await waitFor(() => expect(screen.getByLabelText("Other")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText("Other"), { target: { value: "7, feeling good" } });
      fireEvent.click(within(screen.getByTestId("structured-question")).getByRole("button", { name: "Send" }));

      await waitFor(() =>
        expect(openItemsModule.submitOpenItemAnswer).toHaveBeenCalledWith({ requestId: "self-check", questionId: "score", answer: "7, feeling good" }),
      );
      await waitFor(() => expect(screen.queryByLabelText("Other")).not.toBeInTheDocument());
      expect(screen.getByText("Thanks — got it. I'll check in again before too long.")).toBeInTheDocument();
    });

    it("the same pending request is never shown twice in one session, even after a refetch", async () => {
      const { rerender } = render(<>{null}</>);
      vi.spyOn(openItemsModule, "useOpenItems").mockReturnValue({ status: "loaded", items: [PENDING_SELF_CHECK] });
      act(() => openChatPanel());
      rerender(<ChatPanel />);
      await waitFor(() => expect(screen.getAllByText(/Quick Self-Check/)).toHaveLength(1));

      // A second render with the SAME item still pending (e.g. a hint-driven refetch) must not duplicate it.
      rerender(<ChatPanel />);
      expect(screen.getAllByText(/Quick Self-Check/)).toHaveLength(1);
    });
  });
});
