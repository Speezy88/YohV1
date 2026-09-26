import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PageShell } from "./PageShell.tsx";
import * as reducedMotionModule from "../hooks/useReducedMotion.ts";
import { SCREENSAVER_IDLE_MS } from "../lib/idle.ts";
import { __resetReadinessForTests, useReadinessGate } from "../lib/readiness.ts";

/** A controllable readiness gate for a test to flip, mirroring the pattern
 * `readiness.test.ts` already uses — lets a test observe "splash visible
 * while not ready" before flipping to "ready" and observing the fade. */
function ControllableGate({ ready }: { ready: boolean }): null {
  useReadinessGate("pageshell-test-gate", ready);
  return null;
}

describe("PageShell", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // Fix round 2 (ruling R16): useLaunchSplash's one-way latch is
    // module-level singleton state (by design — it has no React lifecycle
    // to hang off) and would otherwise leak across tests in this file.
    __resetReadinessForTests();
  });

  afterEach(() => {
    // Fix round 1: a leaked `vi.spyOn(reducedMotionModule, ...)` from one
    // test (the reduced-motion cross-fade test below) was silently changing
    // the *next* test's behavior, since the splash's fade-vs-instant-hide
    // decision now reads `useReducedMotion` too. Restore after every test.
    vi.restoreAllMocks();
  });

  it("starts on Home", () => {
    render(<PageShell />);
    expect(screen.getByTestId("page-home")).toBeVisible();
  });

  it("← → move pages when no text field is focused", () => {
    render(<PageShell />);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: /chat/i })).toHaveAttribute("aria-current", "page");
    fireEvent.keyDown(document, { key: "ArrowLeft" });
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
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: /^home$/i })).toHaveAttribute("aria-current", "page");
  });

  it("clicking a Page Indicator dot navigates there", () => {
    render(<PageShell />);
    // fireEvent.click (not a raw `.click()`) so React 19's event dispatch is
    // wrapped in `act()` and the resulting state update is flushed before
    // the assertion below runs.
    fireEvent.click(screen.getByRole("button", { name: /tasks/i }));
    expect(screen.getByRole("button", { name: /tasks/i })).toHaveAttribute("aria-current", "page");
  });

  it("arrow keys at the boundary silently no-op instead of wrapping", () => {
    render(<PageShell />);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByRole("button", { name: /^home$/i })).toHaveAttribute("aria-current", "page");
  });

  it("a horizontal wheel gesture outside a scrollable region swipes one page", () => {
    render(<PageShell />);
    const shell = screen.getByTestId("page-home").parentElement!.parentElement!;
    fireEvent.wheel(shell, { deltaX: 80, deltaY: 0 });
    expect(screen.getByRole("button", { name: /chat/i })).toHaveAttribute("aria-current", "page");
  });

  it("one continuous swipe fires exactly one page change, not one per wheel tick", () => {
    render(<PageShell />);
    const shell = screen.getByTestId("page-home").parentElement!.parentElement!;
    fireEvent.wheel(shell, { deltaX: 20, deltaY: 0 });
    fireEvent.wheel(shell, { deltaX: 20, deltaY: 0 });
    fireEvent.wheel(shell, { deltaX: 20, deltaY: 0 });
    fireEvent.wheel(shell, { deltaX: 20, deltaY: 0 });
    expect(screen.getByRole("button", { name: /chat/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /tasks/i })).not.toHaveAttribute("aria-current");
  });

  it("a vertical-dominant wheel gesture never swipes", () => {
    render(<PageShell />);
    const shell = screen.getByTestId("page-home").parentElement!.parentElement!;
    fireEvent.wheel(shell, { deltaX: 5, deltaY: 200 });
    expect(screen.getByRole("button", { name: /^home$/i })).toHaveAttribute("aria-current", "page");
  });

  it("under reduced motion, the previous page cross-fades out instead of sliding, and stays mounted", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(true);
    render(<PageShell />);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    const home = screen.getByTestId("page-home");
    const chat = screen.getByTestId("page-chat");
    expect(chat.className).toMatch(/opacity-100/);
    expect(home.className).toMatch(/opacity-0/);
    // still mounted (not removed from the DOM) — ephemeral state (AD-17) survives
    expect(home).toBeInTheDocument();
  });

  it("the launch splash covers the initial render and resolves once the shell is ready", () => {
    render(<PageShell />);
    expect(screen.getByText("Yoh Meeseek")).toBeInTheDocument();
  });

  // Fix round 1 (ruling R14 #1): off-screen pages must be aria-hidden/inert
  // in BOTH layouts, not only the reduced-motion cross-fade stack — the
  // default slide layout previously left an off-screen page fully in the
  // tab order.
  it("off-screen pages are aria-hidden and inert in the default slide layout too, not only under reduced motion", () => {
    render(<PageShell />);
    const home = screen.getByTestId("page-home");
    const chat = screen.getByTestId("page-chat");
    const tasks = screen.getByTestId("page-tasks");
    const desk = screen.getByTestId("page-desk");
    expect(home).not.toHaveAttribute("aria-hidden");
    expect(home).not.toHaveAttribute("inert");
    for (const offScreen of [chat, tasks, desk]) {
      expect(offScreen).toHaveAttribute("aria-hidden", "true");
      expect(offScreen).toHaveAttribute("inert");
    }
  });

  it("aria-hidden/inert tracks the active page as navigation happens", () => {
    render(<PageShell />);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByTestId("page-home")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("page-chat")).not.toHaveAttribute("aria-hidden");
  });

  it("focus landing inside an off-screen (aria-hidden) page is blurred away — its content is unreachable", () => {
    // jsdom doesn't implement `inert`'s native focus-blocking behavior, so
    // this exercises PageShell's own `focusin` guard (paired with
    // `inert`/`aria-hidden` as defense-in-depth) directly: a focusable
    // element placed inside the off-screen Chat page must not be able to
    // keep focus.
    render(<PageShell />);
    const chatContainer = screen.getByTestId("page-chat");
    const probe = document.createElement("button");
    probe.textContent = "probe";
    chatContainer.appendChild(probe);
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

  // Fix round 1 (ruling R14 #2): the launch splash fades out, then unmounts
  // only once that fade's real CSS transition completes (via
  // `onTransitionEnd`, not a JS timer duplicating the CSS duration).
  it("the launch splash fades out, then unmounts once the fade's transition completes", () => {
    render(<PageShell />);
    const splash = screen.getByTestId("launch-splash");
    // Ready immediately (no gate registered in this story) — already fading.
    expect(splash.className).toMatch(/opacity-0/);
    expect(screen.getByText("Yoh Meeseek")).toBeInTheDocument();
    fireEvent.transitionEnd(splash);
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();
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

  // Fix round 2 (ruling R16): once the app has been ready, the splash must
  // never come back this session, even if a real gate later flips back to
  // not-ready (e.g. Home's `planLoaded` going false again on a background
  // refetch-on-focus/reconnect) — the idle Screensaver already owns "no
  // input for a while."
  it("once ready, the launch splash never reappears even if the gate later flips back to not-ready", () => {
    const { rerender } = render(
      <>
        <ControllableGate ready={true} />
        <PageShell />
      </>,
    );
    fireEvent.transitionEnd(screen.getByTestId("launch-splash")); // let the (already-fading) splash finish unmounting
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();

    rerender(
      <>
        <ControllableGate ready={false} />
        <PageShell />
      </>,
    );
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument(); // must NOT reappear

    rerender(
      <>
        <ControllableGate ready={true} />
        <PageShell />
      </>,
    );
    expect(screen.queryByTestId("launch-splash")).not.toBeInTheDocument();
  });

  it("the idle Screensaver overlays without navigating away or unmounting the current page", () => {
    vi.useFakeTimers();
    render(<PageShell />);
    // Story 7.7: PageShell now also starts the SSE notification stream,
    // which arms its own (deliberately perpetual, once truly unreachable)
    // reconnect timer — `vi.runAllTimers()` would spin that forever and hit
    // the "possible infinite loop" guard. `advanceTimersByTime(0)` still
    // flushes any zero-delay effect timers to resolve the launch splash,
    // without also draining a timer that is meant to keep recurring.
    act(() => vi.advanceTimersByTime(0)); // resolve the launch splash first
    fireEvent.keyDown(document, { key: "ArrowRight" }); // move to Chat
    act(() => vi.advanceTimersByTime(SCREENSAVER_IDLE_MS));
    expect(screen.getByRole("dialog", { name: /idle/i })).toBeInTheDocument();
    expect(screen.getByTestId("page-chat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /chat/i })).toHaveAttribute("aria-current", "page");
    vi.useRealTimers();
  });
});
