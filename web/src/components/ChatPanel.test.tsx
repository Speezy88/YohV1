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
import * as chatStoreModule from "../lib/chatStore.ts";
import { __resetChatStoreForTests, appendStreamEntry } from "../lib/chatStore.ts";
import { __resetChatPanelForTests, openChatPanel } from "../lib/chatPanel.ts";
import * as chatStreamModule from "../lib/chatStream.ts";
import * as missingDataModule from "../lib/missingData.ts";
import * as openItemsModule from "../lib/openItems.ts";
import * as patternOfferModule from "../lib/patternOffer.ts";
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

  it("exposes the transcript as a log, so a screen reader announces each new turn", () => {
    renderOpenPanel();
    expect(screen.getByRole("log", { name: "Conversation" })).toBeInTheDocument();
  });

  it("hydrates today's conversation when the panel opens, not while closed (Story 13.1)", () => {
    const hydrate = vi.spyOn(chatStoreModule, "hydrateChatHistory").mockResolvedValue();
    render(<ChatPanel />);
    expect(hydrate).not.toHaveBeenCalled();
    act(() => openChatPanel());
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it("asks the server for today's pattern offer when the panel opens, not while closed (Story 13.13)", () => {
    const offer = vi.spyOn(patternOfferModule, "offerTodaysPattern").mockResolvedValue();
    render(<ChatPanel />);
    expect(offer).not.toHaveBeenCalled();
    act(() => openChatPanel());
    expect(offer).toHaveBeenCalledTimes(1);
  });

  it("shows the welcome line with no entries, outside the log, and drops it once there is a turn", () => {
    renderOpenPanel();
    const welcome = screen.getByText("Ask about your day, add a Task, or type / for commands.");
    expect(welcome).toBeInTheDocument();
    expect(screen.getByRole("log", { name: "Conversation" })).not.toContainElement(welcome);
    act(() => {
      appendStreamEntry({ kind: "sandbox-finale", status: "done", savedCount: 1, failedTitles: [] });
    });
    expect(screen.queryByText("Ask about your day, add a Task, or type / for commands.")).not.toBeInTheDocument();
  });

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

  it("dims the page behind the panel with the scrim token", () => {
    renderOpenPanel();
    expect(screen.getByTestId("chat-panel-backdrop")).toHaveClass("bg-scrim");
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

  it("a sandbox-card entry renders inline in the stream", () => {
    appendStreamEntry({ kind: "sandbox-card", view: { taskId: "t1", taskTitle: "Chem problem set", remaining: 0, options: { area: [], energy: [] } }, status: "pending" });
    renderOpenPanel();
    expect(screen.getByTestId("chat-stream")).toContainElement(screen.getByTestId("sandbox-card"));
  });

  // Story 9.3, chunk C2: the "sandbox-finale" StreamEntry renders as
  // SandboxFinale inline in the stream — chunk C1 left a placeholder here.
  it("a sandbox-finale entry renders inline in the stream", () => {
    appendStreamEntry({ kind: "sandbox-finale", status: "done", savedCount: 2, failedTitles: [] });
    renderOpenPanel();
    expect(screen.getByTestId("chat-stream")).toContainElement(screen.getByTestId("sandbox-finale-result"));
    expect(screen.getByText("Saved 2 Tasks")).toBeInTheDocument();
  });

  describe("the 'N need data' chip", () => {
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

    it("shows 'N need data' for a count of 1", () => {
      vi.spyOn(missingDataModule, "useMissingDataCount").mockReturnValue({ status: "loaded", count: 1 });
      renderOpenPanel();
      expect(screen.getByTestId("missing-data-chip")).toHaveTextContent("1 need data");
    });

    // Final-review Chunk 4B gap: the AC/brief call for tabular numerals, same as SandboxCard's own "N remaining".
    it("renders its count in tabular numerals", () => {
      vi.spyOn(missingDataModule, "useMissingDataCount").mockReturnValue({ status: "loaded", count: 1 });
      renderOpenPanel();
      expect(screen.getByTestId("missing-data-chip").className).toContain("tabular-nums");
    });

    it("is a pill with the shared Secondary hover/press states, and Close is a shared icon button", () => {
      vi.spyOn(missingDataModule, "useMissingDataCount").mockReturnValue({ status: "loaded", count: 1 });
      renderOpenPanel();
      expect(screen.getByTestId("missing-data-chip")).toHaveClass("rounded-full", "hover:shadow-extruded-md", "active:shadow-inset");
      expect(screen.getByRole("button", { name: "Close chat" })).toHaveClass("hover:shadow-extruded-md", "h-11", "w-11");
    });

    it("shows 'N need data' for a count greater than 1", () => {
      vi.spyOn(missingDataModule, "useMissingDataCount").mockReturnValue({ status: "loaded", count: 3 });
      renderOpenPanel();
      expect(screen.getByTestId("missing-data-chip")).toHaveTextContent("3 need data");
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
    const PENDING_ITEM: OpenItem = {
      requestId: "data-completeness",
      requestKind: "data-completeness",
      promptText: "Quick check-in: on a scale of 1-10, how well is this working for you right now? Give me a number and a short written reason.",
      question: { requestId: "data-completeness", questionId: "score", text: 'Score (1-10) + a short reason, e.g. "7 feeling on top of things"', options: [], allowsFreeText: true },
    };

    it("a pending ritual request shows as a chat message with its question card, once the panel is open", async () => {
      vi.spyOn(openItemsModule, "useOpenItems").mockReturnValue({ status: "loaded", items: [PENDING_ITEM] });
      renderOpenPanel();
      await waitFor(() => expect(screen.getByText(/Quick check-in/)).toBeInTheDocument());
      expect(screen.getByLabelText("Other")).toBeInTheDocument();
    });

    it("answering a pending ritual inline (\"7, feeling good\") resolves it and the card disappears", async () => {
      vi.spyOn(openItemsModule, "useOpenItems").mockReturnValue({ status: "loaded", items: [PENDING_ITEM] });
      vi.spyOn(openItemsModule, "submitOpenItemAnswer").mockResolvedValue({
        ok: true,
        value: { message: "Thanks — got it. I'll check in again before too long.", receipts: [], next: "done" },
      });
      renderOpenPanel();
      await waitFor(() => expect(screen.getByLabelText("Other")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText("Other"), { target: { value: "7, feeling good" } });
      fireEvent.click(within(screen.getByTestId("structured-question")).getByRole("button", { name: "Send" }));

      await waitFor(() =>
        expect(openItemsModule.submitOpenItemAnswer).toHaveBeenCalledWith({ requestId: "data-completeness", questionId: "score", answer: "7, feeling good" }),
      );
      await waitFor(() => expect(screen.queryByLabelText("Other")).not.toBeInTheDocument());
      expect(screen.getByText("Thanks — got it. I'll check in again before too long.")).toBeInTheDocument();
    });

    it("the same pending request is never shown twice in one session, even after a refetch", async () => {
      const { rerender } = render(<>{null}</>);
      vi.spyOn(openItemsModule, "useOpenItems").mockReturnValue({ status: "loaded", items: [PENDING_ITEM] });
      act(() => openChatPanel());
      rerender(<ChatPanel />);
      await waitFor(() => expect(screen.getAllByText(/Quick check-in/)).toHaveLength(1));

      // A second render with the SAME item still pending (e.g. a hint-driven refetch) must not duplicate it.
      rerender(<ChatPanel />);
      expect(screen.getAllByText(/Quick check-in/)).toHaveLength(1);
    });
  });
});
