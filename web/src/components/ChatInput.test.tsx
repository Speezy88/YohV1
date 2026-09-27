/**
 * web/src/components/ChatInput.test.tsx — Story 8.5, UX-DR36: the glass,
 * always-wide Chat composer. Its draft IS `chatStore.ts`'s draft, so it
 * survives a remount; Enter sends and Shift+Enter doesn't.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatInput } from "./ChatInput.tsx";
import * as chatStore from "../lib/chatStore.ts";
import * as chatStreamModule from "../lib/chatStream.ts";

function box(): HTMLElement {
  return screen.getByRole("textbox", { name: "Message Yoh" });
}

describe("ChatInput", () => {
  beforeEach(() => chatStore.__resetChatStoreForTests());
  afterEach(() => vi.restoreAllMocks());

  it("is glass, full width, and pill-shaped, with the focus ring + glow on focus", () => {
    render(<ChatInput />);
    const shell = screen.getByTestId("chat-input");
    expect(shell).toHaveClass("notification-glass", "w-full", "rounded-full", "focus-within:shadow-focus-glow");
  });

  it("the draft lives in chatStore, so it survives the component remounting", () => {
    const { unmount } = render(<ChatInput />);
    fireEvent.change(box(), { target: { value: "Hello" } });
    expect(box()).toHaveValue("Hello");
    unmount();
    render(<ChatInput />);
    expect(box()).toHaveValue("Hello");
  });

  it("Enter sends the draft", () => {
    const sendSpy = vi.spyOn(chatStore, "send").mockResolvedValue(undefined);
    render(<ChatInput />);
    fireEvent.change(box(), { target: { value: "Hi Yoh" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(sendSpy).toHaveBeenCalledWith("Hi Yoh");
  });

  it("Shift+Enter, and Enter mid-IME-composition, never send", () => {
    const sendSpy = vi.spyOn(chatStore, "send").mockResolvedValue(undefined);
    render(<ChatInput />);
    fireEvent.change(box(), { target: { value: "Hi" } });
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("the Send button sends too, and is disabled while the draft is blank", () => {
    const sendSpy = vi.spyOn(chatStore, "send").mockResolvedValue(undefined);
    render(<ChatInput />);
    const button = screen.getByRole("button", { name: "Send" });
    expect(button).toBeDisabled();
    fireEvent.change(box(), { target: { value: "   " } });
    expect(button).toBeDisabled();
    fireEvent.change(box(), { target: { value: "Hi" } });
    fireEvent.click(button);
    expect(sendSpy).toHaveBeenCalledWith("Hi");
  });

  it("while a turn is in flight, Send is disabled but typing the next message still works", () => {
    vi.spyOn(chatStreamModule, "streamChat").mockReturnValue(new Promise(() => {}));
    render(<ChatInput />);
    fireEvent.change(box(), { target: { value: "Hi" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(box()).toHaveValue("");
    fireEvent.change(box(), { target: { value: "next" } });
    expect(box()).toHaveValue("next");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
