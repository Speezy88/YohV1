/**
 * web/src/components/ChatBubble.test.tsx — Story 8.8, UX-DR35.
 *
 * Home's docked capture surface: focusable synchronously (no readiness
 * gate, no wait on Home's own data), Enter sends via chatStore.ts's real
 * `send`/`setDraft` and moves to Chat, "/" opens the Command Palette in
 * place, and Esc collapses it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ChatBubble } from "./ChatBubble.tsx";
import * as chatStore from "../lib/chatStore.ts";
import * as commands from "../lib/commands.ts";
import { PageNavigationContext } from "../lib/navigationContext.tsx";
import { PAGES } from "../lib/pages.ts";
import type { PageNavigation } from "../lib/pages.ts";

function renderWithNav(goTo: (i: number) => void, overrides: Partial<chatStore.ChatStoreState> = {}) {
  vi.spyOn(chatStore, "useChatStore").mockReturnValue({ messages: [], draft: "", sending: false, ...overrides });
  const nav: PageNavigation = { index: 0, goTo, next: vi.fn(), prev: vi.fn() };
  return render(
    <PageNavigationContext.Provider value={nav}>
      <ChatBubble />
    </PageNavigationContext.Provider>,
  );
}

function box(): HTMLElement {
  return screen.getByRole("textbox", { name: /ask yoh, or type \/ for commands/i });
}

describe("ChatBubble", () => {
  beforeEach(() => {
    vi.spyOn(chatStore, "send").mockResolvedValue(undefined);
    vi.spyOn(chatStore, "setDraft").mockImplementation(() => {});
    vi.spyOn(commands, "fetchCommands").mockResolvedValue([
      { name: "/morning", description: "…", example: "/morning" },
      { name: "/night", description: "…", example: "/night" },
    ]);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a focusable textbox synchronously — no gate, no wait", () => {
    renderWithNav(vi.fn());
    const input = box();
    input.focus();
    expect(input).toHaveFocus();
  });

  it("Enter sends the typed text and navigates to Chat", () => {
    const goTo = vi.fn();
    renderWithNav(goTo, { draft: "Lab report draft, due Thursday" });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(chatStore.send).toHaveBeenCalledWith("Lab report draft, due Thursday");
    expect(goTo).toHaveBeenCalledWith(PAGES.findIndex((p) => p.id === "chat"));
  });

  it("Enter on an empty/whitespace-only draft sends nothing and does not navigate", () => {
    const goTo = vi.fn();
    renderWithNav(goTo, { draft: "   " });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(chatStore.send).not.toHaveBeenCalled();
    expect(goTo).not.toHaveBeenCalled();
  });

  it("Enter while a turn is already sending does nothing", () => {
    const goTo = vi.fn();
    renderWithNav(goTo, { draft: "another message", sending: true });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(chatStore.send).not.toHaveBeenCalled();
    expect(goTo).not.toHaveBeenCalled();
  });

  it("focus expands the bubble; blur on an empty draft collapses it", () => {
    renderWithNav(vi.fn());
    const input = box();
    const pill = screen.getByTestId("chat-bubble");
    expect(pill.className).toMatch(/w-64/);
    fireEvent.focus(input);
    expect(pill.className).toMatch(/w-\[min/);
    fireEvent.blur(input);
    expect(pill.className).toMatch(/w-64/);
  });

  it("blur while the draft has text does not collapse the bubble", () => {
    renderWithNav(vi.fn(), { draft: "still typing" });
    const input = box();
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(screen.getByTestId("chat-bubble").className).toMatch(/w-\[min/);
  });

  it("typing '/' opens the Command Palette in place", async () => {
    renderWithNav(vi.fn(), { draft: "/" });
    expect(await screen.findByTestId("command-palette")).toBeInTheDocument();
  });

  it("picking a command from the palette sends it directly and clears the draft", async () => {
    const goTo = vi.fn();
    renderWithNav(goTo, { draft: "/" });
    await screen.findByTestId("command-row-/morning");
    fireEvent.click(screen.getByTestId("command-row-/morning"));
    expect(chatStore.send).toHaveBeenCalledWith("/morning");
    expect(chatStore.setDraft).toHaveBeenCalledWith("");
    expect(goTo).toHaveBeenCalledWith(PAGES.findIndex((p) => p.id === "chat"));
  });

  it("Enter while the palette is open runs the highlighted command (not a plain send), and still navigates to Chat", async () => {
    const goTo = vi.fn();
    renderWithNav(goTo, { draft: "/" });
    await screen.findByTestId("command-row-/night");
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(chatStore.send).toHaveBeenCalledWith("/night");
    expect(chatStore.send).not.toHaveBeenCalledWith("/");
    expect(goTo).toHaveBeenCalledWith(PAGES.findIndex((p) => p.id === "chat"));
  });

  // ==========================================================================
  // Story 8.8 review carry-in (from 8.7): combobox semantics — the bubble's
  // input mirrors the palette's highlighted row as its own
  // aria-activedescendant, same as ChatInput.tsx.
  // ==========================================================================

  it("sets aria-activedescendant on its input to the highlighted command row's id", async () => {
    renderWithNav(vi.fn(), { draft: "/" });
    await screen.findByTestId("command-row-/morning");
    await waitFor(() => expect(box()).toHaveAttribute("aria-activedescendant", screen.getByTestId("command-row-/morning").id));
  });

  it("Esc collapses the bubble and blurs the input", () => {
    renderWithNav(vi.fn(), { draft: "unsent" });
    const input = box();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).not.toHaveFocus();
    expect(screen.getByTestId("chat-bubble").className).toMatch(/w-64/);
  });
});
