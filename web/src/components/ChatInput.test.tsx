/**
 * web/src/components/ChatInput.test.tsx — Story 8.5, UX-DR36: the glass,
 * always-wide Chat composer. Its draft IS `chatStore.ts`'s draft, so it
 * survives a remount; Enter sends and Shift+Enter doesn't.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatInput } from "./ChatInput.tsx";
import * as chatStore from "../lib/chatStore.ts";
import * as chatStreamModule from "../lib/chatStream.ts";
import * as commands from "../lib/commands.ts";

function box(): HTMLElement {
  return screen.getByRole("textbox", { name: "Message Yoh" });
}

const COMMAND_REGISTRY = [
  { name: "/morning", description: "…", example: "/morning" },
  { name: "/night", description: "…", example: "/night" },
];

describe("ChatInput", () => {
  beforeEach(() => {
    chatStore.__resetChatStoreForTests();
    vi.spyOn(commands, "fetchCommands").mockResolvedValue(COMMAND_REGISTRY);
  });
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

  // ==========================================================================
  // Story 8.7 (UX-DR38): the Command Palette opens on "/"
  // ==========================================================================

  it("typing '/' as the first character opens the Command Palette", async () => {
    render(<ChatInput />);
    fireEvent.change(box(), { target: { value: "/" } });
    await waitFor(() => expect(screen.getByTestId("command-palette")).toBeInTheDocument());
  });

  it("a non-slash first character never opens the palette", () => {
    render(<ChatInput />);
    fireEvent.change(box(), { target: { value: "hi" } });
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
  });

  it("picking a command from the palette sends it and clears the input", async () => {
    const sendSpy = vi.spyOn(chatStore, "send").mockResolvedValue(undefined);
    render(<ChatInput />);
    fireEvent.change(box(), { target: { value: "/" } });
    await waitFor(() => expect(screen.getByTestId("command-row-/night")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("command-row-/night"));
    expect(sendSpy).toHaveBeenCalledWith("/night");
    expect(box()).toHaveValue("");
  });

  it("Esc closes the palette without clearing the typed text", async () => {
    render(<ChatInput />);
    fireEvent.change(box(), { target: { value: "/mor" } });
    await waitFor(() => expect(screen.getByTestId("command-palette")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    expect(box()).toHaveValue("/mor");
  });

  it("typing further after Esc reopens the palette", async () => {
    render(<ChatInput />);
    fireEvent.change(box(), { target: { value: "/mor" } });
    await waitFor(() => expect(screen.getByTestId("command-palette")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.change(box(), { target: { value: "/morn" } });
    await waitFor(() => expect(screen.getByTestId("command-palette")).toBeInTheDocument());
  });

  it("Enter while the palette is open runs the highlighted command, not send", async () => {
    const sendSpy = vi.spyOn(chatStore, "send").mockResolvedValue(undefined);
    render(<ChatInput />);
    fireEvent.change(box(), { target: { value: "/" } });
    await waitFor(() => expect(screen.getByTestId("command-row-/morning")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Enter" });
    expect(sendSpy).toHaveBeenCalledWith("/morning");
    expect(sendSpy).not.toHaveBeenCalledWith("/");
  });

  // ==========================================================================
  // Story 8.8 review carry-in (from 8.7): combobox semantics — the textarea
  // mirrors the palette's highlighted row as its own aria-activedescendant.
  // ==========================================================================

  it("sets aria-activedescendant on the textarea to the highlighted command row's id, and moves it on ArrowDown", async () => {
    render(<ChatInput />);
    fireEvent.change(box(), { target: { value: "/" } });
    await waitFor(() => expect(screen.getByTestId("command-row-/night")).toBeInTheDocument());
    await waitFor(() => expect(box()).toHaveAttribute("aria-activedescendant", screen.getByTestId("command-row-/morning").id));
    fireEvent.keyDown(document, { key: "ArrowDown" });
    await waitFor(() => expect(box()).toHaveAttribute("aria-activedescendant", screen.getByTestId("command-row-/night").id));
  });

  it("has no aria-activedescendant once the palette is closed", async () => {
    render(<ChatInput />);
    fireEvent.change(box(), { target: { value: "/" } });
    await waitFor(() => expect(screen.getByTestId("command-palette")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(box()).not.toHaveAttribute("aria-activedescendant");
  });
});
