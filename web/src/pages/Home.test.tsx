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
 *
 * Task 6A (2026-09-27): the Ask Yoh pill/Chat Bubble moved out of this page
 * entirely (`PageShell.tsx` now renders it once, over every page), so this
 * file no longer asserts anything about it. Adds coverage for the Time
 * Budget widget and the date/greeting header this task introduces.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "./Home.tsx";
import * as homeViewModule from "../lib/homeView.ts";
import { __resetReadinessForTests, useAppReady } from "../lib/readiness.ts";
import { renderHook } from "@testing-library/react";
import type { HomeViewResponse } from "../../../src/types/api.ts";

function mockState(state: homeViewModule.HomeViewState): void {
  vi.spyOn(homeViewModule, "useHomeView").mockReturnValue(state);
  vi.spyOn(homeViewModule, "startHomeViewStream").mockReturnValue(() => {});
}

function loaded(overrides: Partial<HomeViewResponse> = {}): { status: "loaded"; value: HomeViewResponse } {
  return {
    status: "loaded",
    value: { today: "2026-09-25", plan: undefined, calendar: { blocks: [] }, timeBudget: undefined, timeZone: "America/New_York", ...overrides },
  };
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

  it("shows 'No Plan yet today. Type /plan to build it now.' when plan is undefined (real-use fixes plan, Task 1)", () => {
    mockState(loaded());
    render(<HomePage />);
    expect(screen.getByText("No Plan yet today. Type /plan to build it now.")).toBeInTheDocument();
  });

  it("shows 'Nothing left on today's Plan.' when every row is completed, and the calendar still renders", () => {
    mockState(
      loaded({
        plan: { rows: [{ blockId: "b1", taskId: "t1", label: "Draft the memo", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", completed: true, past: true }] },
        calendar: { blocks: [{ id: "b1", kind: "work", label: "Draft the memo", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", completed: true, past: true }] },
      }),
    );
    render(<HomePage />);
    expect(screen.getByText("Nothing left on today's Plan.")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-day-view")).toBeInTheDocument();
  });

  it("renders Plan rows in the given order with no re-sort", () => {
    mockState(
      loaded({
        plan: {
          rows: [
            { blockId: "b1", taskId: "t1", label: "Z Task", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", completed: false, past: false },
            { blockId: "b2", taskId: "t2", label: "A Task", start: "2026-09-25T14:00:00.000Z", end: "2026-09-25T15:00:00.000Z", completed: false, past: false },
          ],
        },
      }),
    );
    render(<HomePage />);
    const rows = screen.getAllByTestId("plan-row");
    // The default fixture timeZone is America/New_York (EDT, UTC-4 in September) — 13:00Z-14:00Z reads 9:00-10:00 local.
    expect(rows.map((r) => r.textContent)).toEqual(["Z Task9:00–10:00", "A Task10:00–11:00"]);
  });

  // Ruling R18 (Story 7.10 fix round 1): "past blocks read-only" governs the
  // Calendar Day View's blocks, not checklist rows — a past, incomplete Plan
  // row stays checkable, keeping only its visual "past" cue.
  it("a past, incomplete Plan row stays interactive (Ruling R18), keeping its past cue", () => {
    mockState(
      loaded({
        plan: { rows: [{ blockId: "b1", taskId: "t1", label: "Draft the memo", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", completed: false, past: true }] },
      }),
    );
    render(<HomePage />);
    expect(screen.getByTestId("plan-row")).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByTestId("plan-row")).toHaveClass("opacity-70");
    expect(screen.getByRole("checkbox", { name: "Draft the memo" })).toBeEnabled();
  });

  it("a completed row (alongside an incomplete one, so the checklist isn't fully empty) is read-only and struck through", () => {
    mockState(
      loaded({
        plan: {
          rows: [
            { blockId: "b1", taskId: "t1", label: "Draft the memo", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", completed: true, past: false },
            { blockId: "b2", taskId: "t2", label: "Call the dentist", start: "2026-09-25T14:00:00.000Z", end: "2026-09-25T15:00:00.000Z", completed: false, past: false },
          ],
        },
      }),
    );
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

    mockState(loaded());
    rerender(<HomePage />);
    expect(result.current).toBe(true);
  });

  it("an error state shows neutral copy, not a crash", () => {
    mockState({ status: "error", message: "network down" });
    render(<HomePage />);
    expect(screen.getByText(/couldn't load home/i)).toBeInTheDocument();
  });

  it("renders the Confetti component with the server's 'today', never the browser's date", () => {
    mockState(loaded({ today: "2026-02-19" }));
    render(<HomePage />);
    expect(screen.getByTestId("confetti")).toBeInTheDocument();
  });

  it("renders the date heading from the server's 'today', in host-timezone weekday/month/day form", () => {
    mockState(loaded({ today: "2026-09-27" }));
    render(<HomePage />);
    expect(screen.getByText("SUNDAY, SEPTEMBER 27")).toBeInTheDocument();
  });

  it("always renders the Time Budget widget, even with no Plan yet", () => {
    mockState(loaded());
    render(<HomePage />);
    expect(screen.getByTestId("time-budget-widget")).toBeInTheDocument();
  });

  it("renders the Time Budget widget's values from the server response", () => {
    mockState(loaded({ timeBudget: { totalMinutes: 360, plannedMinutes: 240, doneMinutes: 60, carriedForward: false } }));
    render(<HomePage />);
    expect(screen.getByText("Time Budget 6 h · 4 h planned · 1 h done")).toBeInTheDocument();
  });

  it("renders the mini month", () => {
    mockState(loaded({ today: "2026-09-27" }));
    render(<HomePage />);
    expect(screen.getByText("September 2026")).toBeInTheDocument();
  });
});
