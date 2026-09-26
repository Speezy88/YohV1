/**
 * web/src/pages/Home.test.tsx — Story 7.8.
 *
 * Covers every AC directly: server-ordered Plan Rows + skeletons (AC1),
 * "No Plan yet today." (AC3), "Nothing left on today's Plan." with the
 * calendar staying (AC4), and the "home-data" readiness gate (Ruling R16).
 * AC2 (Calendar Day View rendering) and AC5 (SSE re-fetch)/AC6 (confetti)
 * are covered by `CalendarDayView.test.tsx`, `homeView.test.ts`, and
 * `Confetti.test.tsx` respectively — this file mocks those collaborators
 * out rather than re-proving their own behavior.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "./Home.tsx";
import * as homeViewModule from "../lib/homeView.ts";
import { __resetReadinessForTests, useAppReady } from "../lib/readiness.ts";
import { renderHook } from "@testing-library/react";

function mockState(state: homeViewModule.HomeViewState): void {
  vi.spyOn(homeViewModule, "useHomeView").mockReturnValue(state);
  vi.spyOn(homeViewModule, "startHomeViewStream").mockReturnValue(() => {});
}

describe("HomePage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __resetReadinessForTests();
  });

  it("shows skeleton rows and a calendar skeleton while loading, never a static spinner", () => {
    mockState({ status: "loading" });
    render(<HomePage />);
    expect(screen.getAllByTestId("plan-row-skeleton").length).toBeGreaterThan(0);
    expect(screen.getByTestId("calendar-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows 'No Plan yet today.' when plan is undefined", () => {
    mockState({ status: "loaded", value: { today: "2026-09-25", plan: undefined, calendar: { blocks: [] } } });
    render(<HomePage />);
    expect(screen.getByText("No Plan yet today.")).toBeInTheDocument();
  });

  it("shows 'Nothing left on today's Plan.' when every row is completed, and the calendar still renders", () => {
    mockState({
      status: "loaded",
      value: {
        today: "2026-09-25",
        plan: { rows: [{ blockId: "b1", taskId: "t1", label: "Draft the memo", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", completed: true, past: true }] },
        calendar: { blocks: [{ id: "b1", kind: "work", label: "Draft the memo", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", completed: true, past: true }] },
      },
    });
    render(<HomePage />);
    expect(screen.getByText("Nothing left on today's Plan.")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-day-view")).toBeInTheDocument();
  });

  it("renders Plan rows in the given order with no re-sort", () => {
    mockState({
      status: "loaded",
      value: {
        today: "2026-09-25",
        plan: {
          rows: [
            { blockId: "b1", taskId: "t1", label: "Z Task", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", completed: false, past: false },
            { blockId: "b2", taskId: "t2", label: "A Task", start: "2026-09-25T14:00:00.000Z", end: "2026-09-25T15:00:00.000Z", completed: false, past: false },
          ],
        },
        calendar: { blocks: [] },
      },
    });
    render(<HomePage />);
    const rows = screen.getAllByTestId("plan-row");
    expect(rows.map((r) => r.textContent)).toEqual(["Z Task", "A Task"]);
  });

  // Ruling R18 (Story 7.10 fix round 1): "past blocks read-only" governs the
  // Calendar Day View's blocks, not checklist rows — a past, incomplete Plan
  // row stays checkable, keeping only its visual "past" cue.
  it("a past, incomplete Plan row stays interactive (Ruling R18), keeping its past cue", () => {
    mockState({
      status: "loaded",
      value: {
        today: "2026-09-25",
        plan: { rows: [{ blockId: "b1", taskId: "t1", label: "Draft the memo", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", completed: false, past: true }] },
        calendar: { blocks: [] },
      },
    });
    render(<HomePage />);
    expect(screen.getByTestId("plan-row")).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByTestId("plan-row")).toHaveClass("opacity-70");
    expect(screen.getByRole("checkbox", { name: "Draft the memo" })).toBeEnabled();
  });

  it("a completed row (alongside an incomplete one, so the checklist isn't fully empty) is read-only and struck through", () => {
    mockState({
      status: "loaded",
      value: {
        today: "2026-09-25",
        plan: {
          rows: [
            { blockId: "b1", taskId: "t1", label: "Draft the memo", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", completed: true, past: false },
            { blockId: "b2", taskId: "t2", label: "Call the dentist", start: "2026-09-25T14:00:00.000Z", end: "2026-09-25T15:00:00.000Z", completed: false, past: false },
          ],
        },
        calendar: { blocks: [] },
      },
    });
    render(<HomePage />);
    const [row] = screen.getAllByTestId("plan-row");
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveClass("line-through");
  });

  it("registers the home-data readiness gate: not ready while loading, ready once loaded", () => {
    mockState({ status: "loading" });
    const { rerender } = render(<HomePage />);
    const { result } = renderHook(() => useAppReady());
    expect(result.current).toBe(false);

    mockState({ status: "loaded", value: { today: "2026-09-25", plan: undefined, calendar: { blocks: [] } } });
    rerender(<HomePage />);
    expect(result.current).toBe(true);
  });

  it("an error state shows neutral copy, not a crash", () => {
    mockState({ status: "error", message: "network down" });
    render(<HomePage />);
    expect(screen.getByText(/couldn't load home/i)).toBeInTheDocument();
  });

  it("renders the Confetti component with the server's 'today', never the browser's date", () => {
    mockState({ status: "loaded", value: { today: "2026-02-19", plan: undefined, calendar: { blocks: [] } } });
    render(<HomePage />);
    // Confetti itself is unit-tested in Confetti.test.tsx; here we only
    // prove Home passes the SERVER's today through, via its real rendering
    // (reduced motion is off by default in jsdom, so a real Feb 19 burst
    // proves the prop actually reached the component).
    expect(screen.getByTestId("confetti")).toBeInTheDocument();
  });
});
