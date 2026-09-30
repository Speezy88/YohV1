/**
 * web/src/components/ChatMessage.test.tsx — Story 8.5, UX-DR36/37: one
 * transcript turn. Spencer's turns sit right on surface-sunken, Yoh's left
 * and flat; the Thinking Indicator gives way to text the moment any
 * arrives; receipts render in caption style; a failure is always visible.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage.tsx";
import * as openItemsLib from "../lib/openItems.ts";
import * as chatStore from "../lib/chatStore.ts";
import type { ChatViewMessage } from "../lib/chatStore.ts";

function msg(overrides: Partial<ChatViewMessage> = {}): ChatViewMessage {
  return { id: "m1", role: "assistant", text: "", receipts: [], status: "done", ...overrides };
}

describe("ChatMessage", () => {
  it("right-aligns Spencer's turn on surface-sunken", () => {
    render(<ChatMessage message={msg({ role: "user", text: "Hi Yoh" })} />);
    expect(screen.getByTestId("chat-message-m1")).toHaveClass("justify-end");
    expect(screen.getByText("Hi Yoh").closest(".bg-surface-sunken")).not.toBeNull();
  });

  it("left-aligns Yoh's turn, flat (no surface-sunken)", () => {
    render(<ChatMessage message={msg({ text: "Hi Spencer" })} />);
    expect(screen.getByTestId("chat-message-m1")).toHaveClass("justify-start");
    expect(screen.getByText("Hi Spencer").closest(".bg-surface-sunken")).toBeNull();
  });

  it("shows the Thinking Indicator, with the live status text, while streaming with no text yet", () => {
    render(<ChatMessage message={msg({ status: "streaming", statusText: "Searching the web…" })} />);
    expect(screen.getByTestId("thinking-indicator")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Searching the web…");
  });

  it("gives way to streaming text the moment any arrives, while still streaming", () => {
    render(<ChatMessage message={msg({ status: "streaming", statusText: "Thinking…", text: "Hel" })} />);
    expect(screen.queryByTestId("thinking-indicator")).not.toBeInTheDocument();
    expect(screen.getByText("Hel")).toBeInTheDocument();
  });

  it("renders each receipt as its own caption-style line, in the small type-scale token (never text-caption)", () => {
    render(<ChatMessage message={msg({ text: "Done.", receipts: ['Created "Draft the memo" in Tasks.', "Moved Standup to 10:30."] })} />);
    for (const receipt of ['Created "Draft the memo" in Tasks.', "Moved Standup to 10:30."]) {
      expect(screen.getByText(receipt)).toHaveClass("text-small", "text-ink-secondary");
      expect(screen.getByText(receipt)).not.toHaveClass("text-caption");
    }
  });

  it("renders nothing for a turn with no visible text, receipt, question, or error (Polish 4 Task 3: no empty bubbles)", () => {
    const { container } = render(<ChatMessage message={msg({ text: "", receipts: [], status: "done" })} />);
    expect(screen.queryByTestId("chat-message-m1")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a follow-up question as a Structured Question — text plus a chip per option", () => {
    render(
      <ChatMessage
        message={msg({
          text: "Here's the draft.",
          question: {
            requestId: "proposal:p1",
            questionId: "confirm",
            text: "Create it?",
            options: [
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ],
            allowsFreeText: false,
          },
        })}
      />,
    );
    expect(screen.getByText("Create it?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
  });

  it("picking an inline question's chip calls submitOpenItemAnswer with the question's ids, then records the exchange and hides the chips", async () => {
    vi.spyOn(openItemsLib, "submitOpenItemAnswer").mockResolvedValue({ ok: true, value: { message: "Done.", receipts: ["Created it."], next: "done" } });
    const recordSpy = vi.spyOn(chatStore, "recordAnsweredOpenItem").mockImplementation(() => {});
    render(
      <ChatMessage
        message={msg({
          text: "Here's the draft.",
          question: { requestId: "proposal:p1", questionId: "confirm", text: "Create it?", options: [{ label: "Yes", value: "yes" }], allowsFreeText: false },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(openItemsLib.submitOpenItemAnswer).toHaveBeenCalledWith({ requestId: "proposal:p1", questionId: "confirm", answer: "yes" }));
    await waitFor(() => expect(recordSpy).toHaveBeenCalledWith("yes", { message: "Done.", receipts: ["Created it."] }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument());
  });

  it("I2 (final-review): an inline question's stale-proposal/conflict rejection resolves and hides the card, recording a short neutral note instead", async () => {
    vi.spyOn(openItemsLib, "submitOpenItemAnswer").mockResolvedValue({ ok: false, kind: "stale-proposal", message: "entity changed since suggested" });
    const recordSpy = vi.spyOn(chatStore, "recordAnsweredOpenItem").mockImplementation(() => {});
    const resolveSpy = vi.spyOn(chatStore, "resolveMessageQuestion").mockImplementation(() => {});
    render(
      <ChatMessage
        message={msg({
          text: "Here's the draft.",
          question: { requestId: "proposal:p1", questionId: "confirm", text: "Create it?", options: [{ label: "Yes", value: "yes" }], allowsFreeText: false },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(resolveSpy).toHaveBeenCalledWith("m1"));
    expect(recordSpy).toHaveBeenCalledWith("yes", { message: "That proposal is out of date — nothing was changed.", receipts: [] });
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
  });

  it("Task 6: a 'try again' response (next = the SAME question) keeps the card and shows the server's message inline", async () => {
    const sameQuestion = { requestId: "data-completeness", questionId: "score", text: 'Score (1-10) + a short reason, e.g. "7 feeling on top of things"', options: [], allowsFreeText: true };
    vi.spyOn(openItemsLib, "submitOpenItemAnswer").mockResolvedValue({
      ok: true,
      value: { message: "Just send a number from 1 to 10, plus an optional reason.", receipts: [], next: sameQuestion },
    });
    const recordSpy = vi.spyOn(chatStore, "recordAnsweredOpenItem").mockImplementation(() => {});
    render(<ChatMessage message={msg({ text: "Quick check-in…", question: sameQuestion })} />);

    fireEvent.change(screen.getByLabelText("Other"), { target: { value: "not sure" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("Just send a number from 1 to 10, plus an optional reason.")).toBeInTheDocument());
    expect(recordSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("Task 6: a response with a DIFFERENT next question hides this card and appends the new one via recordAnsweredOpenItem", async () => {
    const nextQuestion = { requestId: "night-close-out", questionId: "t2", text: "Task 2 — completed or slipped?", options: [], allowsFreeText: true };
    vi.spyOn(openItemsLib, "submitOpenItemAnswer").mockResolvedValue({ ok: true, value: { message: 'Recorded "Task 1" as completed.', receipts: [], next: nextQuestion } });
    const recordSpy = vi.spyOn(chatStore, "recordAnsweredOpenItem").mockImplementation(() => {});
    render(
      <ChatMessage
        message={msg({
          text: "Close-out.",
          question: { requestId: "night-close-out", questionId: "t1", text: "Task 1 — completed or slipped?", options: [{ label: "Completed", value: "completed" }], allowsFreeText: false },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Completed" }));

    await waitFor(() =>
      expect(recordSpy).toHaveBeenCalledWith("completed", { message: 'Recorded "Task 1" as completed.', receipts: [], next: nextQuestion }),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Completed" })).not.toBeInTheDocument());
  });

  it("a failed turn with no text shows the server's reason in a caption", () => {
    render(<ChatMessage message={msg({ status: "error", errorText: "server: chat dependencies not configured" })} />);
    expect(screen.getByText("Couldn't get a reply: server: chat dependencies not configured")).toHaveClass("text-small");
  });

  it("a failed turn with no text and no reason still says it failed", () => {
    render(<ChatMessage message={msg({ status: "error" })} />);
    expect(screen.getByText("Couldn't get a reply. Try again.")).toBeInTheDocument();
  });

  it("a turn interrupted mid-reply keeps its partial text and says it was interrupted", () => {
    render(<ChatMessage message={msg({ status: "error", text: "Sure, I" })} />);
    expect(screen.getByText("Sure, I")).toBeInTheDocument();
    expect(screen.getByText("The reply was interrupted.")).toHaveClass("text-small");
  });
  describe("Remembered Receipt (Story 13.4)", () => {
    const receipt = { receiptId: "r1", kind: "remembered" as const, items: [{ id: "i1", text: "Chem club is a club", folder: "corrections" as const }] };

    it("renders the receipt line under a finished reply, even with no reply text", () => {
      render(<ChatMessage message={msg({ text: "Got it.", receipt, receiptState: "undoable" })} />);
      expect(screen.getByTestId("remembered-receipt")).toHaveTextContent("Remembered: Chem club is a club · Corrections · Undo");
    });

    it("always mounts the polite live region on a finished assistant turn, and not on a user turn", () => {
      const { container, rerender } = render(<ChatMessage message={msg({ text: "Hi" })} />);
      expect(container.querySelector("[aria-live='polite']")).not.toBeNull();
      rerender(<ChatMessage message={msg({ role: "user", text: "Hi" })} />);
      expect(container.querySelector("[aria-live='polite']")).toBeNull();
    });
  });
});
