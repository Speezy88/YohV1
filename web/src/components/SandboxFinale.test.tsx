import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SandboxFinale } from "./SandboxFinale.tsx";
import * as reducedMotionModule from "../hooks/useReducedMotion.ts";

afterEach(() => vi.restoreAllMocks());

describe("SandboxFinale", () => {
  it("pending: shows a right-aligned, politely-announced loading bar", () => {
    render(<SandboxFinale status="pending" />);
    const bar = screen.getByTestId("sandbox-finale-bar");
    expect(bar).toHaveAttribute("role", "status");
    expect(bar).toHaveAttribute("aria-live", "polite");
  });

  it("done, every write succeeded: shows 'Saved {n} Tasks' and nothing else", () => {
    render(<SandboxFinale status="done" savedCount={2} failedTitles={[]} />);
    expect(screen.getByText("Saved 2 Tasks")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't save/)).not.toBeInTheDocument();
  });

  it("done, one or more failed: names each failed Task on its own line, and never claims completion", () => {
    render(<SandboxFinale status="done" savedCount={1} failedTitles={["Chem problem set", "History essay"]} />);
    expect(screen.getByText("Couldn't save Chem problem set.")).toBeInTheDocument();
    expect(screen.getByText("Couldn't save History essay.")).toBeInTheDocument();
    expect(screen.queryByText(/^Saved/)).not.toBeInTheDocument();
  });

  it("done, savedCount 0 with failures (failed-then-skipped cards): renders only the failure lines, never 'Saved 0 Tasks'", () => {
    render(<SandboxFinale status="done" savedCount={0} failedTitles={["Chem problem set"]} />);
    expect(screen.getByText("Couldn't save Chem problem set.")).toBeInTheDocument();
    expect(screen.queryByText(/^Saved/)).not.toBeInTheDocument();
  });

  it("done, summaryFailed: renders the fixed summary-failed copy and nothing else", () => {
    render(<SandboxFinale status="done" summaryFailed />);
    expect(screen.getByText("Couldn't load the summary. Your saved cards above are in Notion.")).toBeInTheDocument();
    expect(screen.queryByText(/^Saved/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn't save /)).not.toBeInTheDocument();
  });

  it("reduced motion: the bar has no shimmer class (instant fallback), still visible", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(true);
    render(<SandboxFinale status="pending" />);
    const fill = screen.getByTestId("sandbox-finale-bar").firstElementChild;
    expect(fill?.className).not.toMatch(/sandbox-finale-shimmer/);
  });
});
