/**
 * web/src/components/PageShell.test.tsx — Task 6A rewrite: the vertical
 * page stack (Home → Tasks → Desk → Research Hub), the sidebar's up/down
 * arrow buttons, ↑/↓/Page Up/Page Down keys, an edge-aware vertical wheel,
 * the Chat panel's ⌘K toggle and its dimming of every page while open, and
 * the same launch-splash contract Story 7.6/7.7 built.
 * Side swipe is retired: no horizontal gesture or ← → key moves a page.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PageShell } from "./PageShell.tsx";
import * as reducedMotionModule from "../hooks/useReducedMotion.ts";
import { __resetReadinessForTests, useReadinessGate } from "../lib/readiness.ts";
import { __resetChatPanelForTests } from "../lib/chatPanel.ts";

function ControllableGate({ ready }: { ready: boolean }): null {
  useReadinessGate("pageshell-test-gate", ready);
  return null;
}

describe("PageShell", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    __resetReadinessForTests();
    __resetChatPanelForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts on Home", () => {
    render(<PageShell />);
    expect(screen.getByTestId("page-home")).toBeVisible();
  });

  it("opens on the page named by the URL hash and keeps the hash in step with navigation (P6-R12)", () => {
    window.history.replaceState(null, "", "/#research");
    render(<PageShell />);
    expect(screen.getByTestId("page-research")).toBeVisible();
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(window.location.hash).toBe("#desk");
  });

  // Task 6B: arriving on Tasks focuses its quick-add row, so the NEXT key
  // lands on that input (as it would in a real browser) — fired at the
  // focused element, not at `document` directly. The quick-add hands an
  // ↑ / Page Up / Page Down it doesn't need back to page navigation.
  const keyOnFocused = (key: string): void => {
    fireEvent.keyDown(document.activeElement ?? document, { key });
  };

  it("↓ / ↑ move pages when no text field is focused", () => {
    render(<PageShell />);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /^tasks$/i })).toHaveAttribute("aria-current", "page");
    keyOnFocused("ArrowUp");
    expect(screen.getByRole("button", { name: /^home$/i })).toHaveAttribute("aria-current", "page");
  });

  it("Page Down / Page Up also move pages", () => {
    render(<PageShell />);
    fireEvent.keyDown(document, { key: "PageDown" });
    expect(screen.getByRole("button", { name: /^tasks$/i })).toHaveAttribute("aria-current", "page");
    keyOnFocused("PageUp");
    expect(screen.getByRole("button", { name: /^home$/i })).toHaveAttribute("aria-current", "page");
  });

  it("Task 6B: arriving on Tasks focuses the quick-add row", () => {
    render(<PageShell />);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "New task" }));
  });

  it("Task 6B: ↑/↓ inside an element that captures arrow keys (the Tasks list) never move pages", () => {
    render(
      <div>
        <PageShell />
        <div data-captures-arrow-keys="">
          <button type="button">row</button>
        </div>
      </div>,
    );
    screen.getByRole("button", { name: "row" }).focus();
    fireEvent.keyDown(screen.getByRole("button", { name: "row" }), { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /^home$/i })).toHaveAttribute("aria-current", "page");
  });

  it("arrow keys do nothing while a text field is focused", () => {
    render(
      <div>
        <PageShell />
        <input aria-label="scratch" />
      </div>,
    );
    screen.getByLabelText("scratch").focus();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /^home$/i })).toHaveAttribute("aria-current", "page");
  });

  it("clicking a sidebar link navigates there", () => {
    render(<PageShell />);
    fireEvent.click(screen.getByRole("button", { name: /^tasks$/i }));
    expect(screen.getByRole("button", { name: /^tasks$/i })).toHaveAttribute("aria-current", "page");
  });

  it("the sidebar's on-screen up/down arrow buttons move one page and disable at either end", () => {
    render(<PageShell />);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("button", { name: /^tasks$/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });

  it("arrow keys at the boundary silently no-op instead of wrapping", () => {
    render(<PageShell />);
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(screen.getByRole("button", { name: /^home$/i })).toHaveAttribute("aria-current", "page");
  });

  it("a vertical wheel gesture outside a scrollable region moves one page", () => {
    render(<PageShell />);
    fireEvent.wheel(screen.getByTestId("page-shell-root"), { deltaY: 80, deltaX: 0 });
    expect(screen.getByRole("button", { name: /^tasks$/i })).toHaveAttribute("aria-current", "page");
  });

  it("a horizontal-dominant wheel gesture never moves a page (side swipe is retired)", () => {
    render(<PageShell />);
    fireEvent.wheel(screen.getByTestId("page-shell-root"), { deltaX: 200, deltaY: 5 });
    expect(screen.getByRole("button", { name: /^home$/i })).toHaveAttribute("aria-current", "page");
  });

  it("under reduced motion, the previous page cross-fades out instead of sliding, and stays mounted", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(true);
    render(<PageShell />);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    const home = screen.getByTestId("page-home");
    const tasks = screen.getByTestId("page-tasks");
    expect(tasks.className).toMatch(/opacity-100/);
    expect(home.className).toMatch(/opacity-0/);
    expect(home).toBeInTheDocument();
  });

  it("the launch splash covers the initial render and resolves once the shell is ready", () => {
    render(<PageShell />);
    expect(screen.getByTestId("launch-splash")).toHaveTextContent("Meeseek");
  });

  it("off-screen pages are aria-hidden and inert in the default slide layout too, not only under reduced motion", () => {
    render(<PageShell />);
    const home = screen.getByTestId("page-home");
    const tasks = screen.getByTestId("page-tasks");
    const desk = screen.getByTestId("page-desk");
    const research = screen.getByTestId("page-research");
    const memory = screen.getByTestId("page-memory");
    expect(home).not.toHaveAttribute("aria-hidden");
    expect(home).not.toHaveAttribute("inert");
    for (const offScreen of [tasks, desk, research, memory]) {
      expect(offScreen).toHaveAttribute("aria-hidden", "true");
      expect(offScreen).toHaveAttribute("inert");
    }
  });

  it("aria-hidden/inert tracks the active page as navigation happens", () => {
    render(<PageShell />);
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByTestId("page-home")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("page-tasks")).not.toHaveAttribute("aria-hidden");
  });

  it("focus landing inside an off-screen (aria-hidden) page is blurred away — its content is unreachable", () => {
    render(<PageShell />);
    const tasksContainer = screen.getByTestId("page-tasks");
    const probe = document.createElement("button");
    probe.textContent = "probe";
    tasksContainer.appendChild(probe);
    probe.focus();
    expect(document.activeElement).not.toBe(probe);
  });

  it("focus on the active page's own content is left alone", () => {
    render(<PageShell />);
    const homeContainer = screen.getByTestId("page-home");
    const probe = document.createElement("button");
    probe.textContent = "probe";
    homeContainer.appendChild(probe);
    probe.focus();
    expect(document.activeElement).toBe(probe);
  });

  it("the launch splash fades out, then unmounts once the fade's transition completes", () => {
    render(<PageShell />);
    const splash = screen.getByTestId("launch-splash");
    expect(splash.className).toMatch(/opacity-0/);
    expect(screen.getByTestId("launch-splash")).toHaveTextContent("Meeseek");
    fireEvent.transitionEnd(splash);
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();
  });

  it("a fading splash never intercepts clicks and is hidden from assistive tech, even if its transitionend never fires", () => {
    render(<PageShell />);
    const splash = screen.getByTestId("launch-splash");
    expect(splash.className).toMatch(/opacity-0/);
    expect(splash).toHaveClass("pointer-events-none");
    expect(splash).toHaveAttribute("aria-hidden", "true");
  });

  it("under reduced motion, the launch splash disappears instantly with no fade", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(true);
    render(<PageShell />);
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();
  });

  it("the launch splash stays fully visible while a readiness gate is not ready, then starts fading once it flips true", () => {
    const { rerender } = render(
      <>
        <ControllableGate ready={false} />
        <PageShell />
      </>,
    );
    expect(screen.getByTestId("launch-splash").className).toMatch(/opacity-100/);
    rerender(
      <>
        <ControllableGate ready={true} />
        <PageShell />
      </>,
    );
    expect(screen.getByTestId("launch-splash").className).toMatch(/opacity-0/);
  });

  it("once ready, the launch splash never reappears even if the gate later flips back to not-ready", () => {
    const { rerender } = render(
      <>
        <ControllableGate ready={true} />
        <PageShell />
      </>,
    );
    fireEvent.transitionEnd(screen.getByTestId("launch-splash"));
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();

    rerender(
      <>
        <ControllableGate ready={false} />
        <PageShell />
      </>,
    );
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();

    rerender(
      <>
        <ControllableGate ready={true} />
        <PageShell />
      </>,
    );
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();
  });

  // ==========================================================================
  // Task 6A: the Chat panel — ⌘K toggles it, it dims every page while open,
  // and page-navigation keys are inert while it has the foreground.
  // ==========================================================================

  it("⌘K opens the Chat panel, focused on its input; ⌘K again closes it", () => {
    render(<PageShell />);
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument();
  });

  it("Ctrl+K also toggles the Chat panel (non-Mac keyboards)", () => {
    render(<PageShell />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("while the Chat panel is open, every page is aria-hidden/inert — 'the page behind is dimmed context, not functional'", () => {
    render(<PageShell />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByTestId("page-home")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("page-home")).toHaveAttribute("inert");
  });

  it("while the Chat panel is open, ArrowDown/ArrowUp do not change pages", () => {
    render(<PageShell />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "k", metaKey: true }); // close it to inspect the sidebar again
    expect(screen.getByRole("button", { name: /^home$/i })).toHaveAttribute("aria-current", "page");
  });

  it("clicking the Ask Meeseek pill also opens the Chat panel", () => {
    render(<PageShell />);
    fireEvent.click(screen.getByRole("button", { name: /ask meeseek/i }));
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });
  // Task 8 (polish-6): landmarks and the modal chat panel.
  it("renders one main landmark around the page stack, with a Skip to content link first in tab order", () => {
    render(<PageShell />);
    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(mains[0]).toContainElement(screen.getByTestId("page-home"));
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveAttribute("href", `#${mains[0]!.id}`);
    const focusables = Array.from(document.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), textarea, input"));
    expect(focusables[0]).toBe(skip);
  });

  it("activating Skip to content moves focus to the main landmark", () => {
    render(<PageShell />);
    fireEvent.click(screen.getByRole("link", { name: "Skip to content" }));
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("the skip link is not tabbable while the Chat panel is open (its target is inert)", () => {
    render(<PageShell />);
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).not.toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(skip).toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(skip).not.toHaveAttribute("inert");
  });

  it("while the Chat panel is open everything outside it (sidebar, pill) is inert; closing restores it", () => {
    render(<PageShell />);
    const root = screen.getByTestId("page-shell-root");
    expect(root).not.toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(root).toHaveAttribute("inert");
    expect(root).toContainElement(screen.getByRole("navigation"));
    expect(root).not.toContainElement(screen.getByTestId("chat-panel"));
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(root).not.toHaveAttribute("inert");
  });

  it("closing the Chat panel returns focus to the opener only after the shell is no longer inert", () => {
    render(<PageShell />);
    const pill = screen.getByRole("button", { name: /ask meeseek/i });
    pill.focus();
    const root = screen.getByTestId("page-shell-root");
    let inertWhenFocused: boolean | undefined;
    const realFocus = pill.focus.bind(pill);
    pill.focus = () => {
      inertWhenFocused = root.hasAttribute("inert");
      realFocus();
    };
    fireEvent.click(pill);
    fireEvent.keyDown(screen.getByTestId("chat-panel"), { key: "Escape" });
    expect(inertWhenFocused).toBe(false);
    expect(document.activeElement).toBe(pill);
  });
});
