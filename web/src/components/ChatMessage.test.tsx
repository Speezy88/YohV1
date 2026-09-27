/**
 * web/src/components/ChatMessage.test.tsx — Story 8.5, UX-DR36/37: one
 * transcript turn. Spencer's turns sit right on surface-sunken, Yoh's left
 * and flat; the Thinking Indicator gives way to text the moment any
 * arrives; receipts render in caption style; a failure is always visible.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage.tsx";
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

  it("renders a follow-up question's text", () => {
    render(
      <ChatMessage
        message={msg({
          text: "Here's the draft.",
          question: { requestId: "proposal:p1", questionId: "confirm", text: "Create it?", options: [], allowsFreeText: true },
        })}
      />,
    );
    expect(screen.getByText("Create it?")).toBeInTheDocument();
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
