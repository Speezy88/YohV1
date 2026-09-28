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

  // Task 7 (polish-5): plural copy — "Saved 1 Task" (singular), not "Saved 1 Tasks".
  it("done, exactly one write succeeded: shows the singular 'Saved 1 Task'", () => {
    render(<SandboxFinale status="done" savedCount={1} failedTitles={[]} />);
    expect(screen.getByText("Saved 1 Task")).toBeInTheDocument();
    expect(screen.queryByText("Saved 1 Tasks")).not.toBeInTheDocument();
  });

  // Task 7 (polish-5): the result region is persistent — mounted from the
  // very first (pending) render, same idiom as `SandboxCard.tsx`'s Task 6
  // status region, so a screen reader's aria-live region is already
  // attached and announces the settle-time text change.
  it("the result region is mounted from the first (pending) render, empty until resolve", () => {
    render(<SandboxFinale status="pending" />);
    const region = screen.getByTestId("sandbox-finale-result");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("");
  });

  // C2 fix round 1: the resolved state must itself be announced — a screen
  // reader heard "Saving your answers" on the pending bar but nothing when
  // it resolved. The resolved text lives inside a role="status"
  // aria-live="polite" region (every "done" case shares this one wrapper).
  it("done: the resolved text lives in a role=status, aria-live=polite region, so its arrival is announced", () => {
    render(<SandboxFinale status="done" savedCount={2} failedTitles={[]} />);
    const region = screen.getByTestId("sandbox-finale-result");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("Saved 2 Tasks");
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
