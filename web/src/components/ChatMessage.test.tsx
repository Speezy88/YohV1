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

  it("renders each receipt as its own caption-style line", () => {
    render(<ChatMessage message={msg({ text: "Done.", receipts: ['Created "Draft the memo" in Tasks.', "Moved Standup to 10:30."] })} />);
    for (const receipt of ['Created "Draft the memo" in Tasks.', "Moved Standup to 10:30."]) {
      expect(screen.getByText(receipt)).toHaveClass("text-caption", "text-ink-secondary");
    }
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

  it("an inline question's stale-proposal rejection renders honestly, never the raw error message", async () => {
    vi.spyOn(openItemsLib, "submitOpenItemAnswer").mockResolvedValue({ ok: false, kind: "stale-proposal", message: "entity changed since suggested" });
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

    await waitFor(() => expect(recordSpy).toHaveBeenCalledWith("yes", { message: "That proposal is out of date — nothing was changed.", receipts: [] }));
  });

  it("a failed turn with no text shows the server's reason in a caption", () => {
    render(<ChatMessage message={msg({ status: "error", errorText: "server: chat dependencies not configured" })} />);
    expect(screen.getByText("Couldn't get a reply: server: chat dependencies not configured")).toHaveClass("text-caption");
  });

  it("a failed turn with no text and no reason still says it failed", () => {
    render(<ChatMessage message={msg({ status: "error" })} />);
    expect(screen.getByText("Couldn't get a reply. Try again.")).toBeInTheDocument();
  });

  it("a turn interrupted mid-reply keeps its partial text and says it was interrupted", () => {
    render(<ChatMessage message={msg({ status: "error", text: "Sure, I" })} />);
    expect(screen.getByText("Sure, I")).toBeInTheDocument();
    expect(screen.getByText("The reply was interrupted.")).toHaveClass("text-caption");
  });
});
