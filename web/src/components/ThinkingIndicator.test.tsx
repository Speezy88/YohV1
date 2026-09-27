/**
 * web/src/components/ThinkingIndicator.test.tsx — Story 8.5, UX-DR37: a
 * dot-matrix loader and live status text in a polite live region; the
 * shimmer runs over ink-primary text, and reduced motion gets static
 * ink-secondary text and static dots (OQ17).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThinkingIndicator } from "./ThinkingIndicator.tsx";
import * as reducedMotionModule from "../hooks/useReducedMotion.ts";

describe("ThinkingIndicator", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the status text in a polite live region", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
    render(<ThinkingIndicator statusText="Thinking…" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Thinking…");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("announces the new text when the status changes", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
    const { rerender } = render(<ThinkingIndicator statusText="Thinking…" />);
    rerender(<ThinkingIndicator statusText="Searching the web…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Searching the web…");
  });

  it("under full motion: ink-primary text with the shimmer overlay, and three pulsing dots hidden from assistive tech", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
    render(<ThinkingIndicator statusText="Thinking…" />);
    const text = screen.getByText("Thinking…");
    expect(text).toHaveClass("thinking-shimmer", "text-ink-primary");
    const dots = screen.getAllByTestId("thinking-dot");
    expect(dots).toHaveLength(3);
    for (const dot of dots) expect(dot).toHaveClass("thinking-dot");
    expect(dots[0]!.parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("under reduced motion: static ink-secondary text, no shimmer, and the dots stay visible but still", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(true);
    render(<ThinkingIndicator statusText="Thinking…" />);
    const text = screen.getByText("Thinking…");
    expect(text).not.toHaveClass("thinking-shimmer");
    expect(text).toHaveClass("text-ink-secondary");
    const dots = screen.getAllByTestId("thinking-dot");
    expect(dots).toHaveLength(3);
    for (const dot of dots) expect(dot).not.toHaveClass("thinking-dot");
  });
});
