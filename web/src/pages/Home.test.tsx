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
import { render, screen, fireEvent } from "@testing-library/react";
import HomePage from "./Home.tsx";
import * as homeViewModule from "../lib/homeView.ts";
import * as calendarDayModule from "../lib/calendarDay.ts";
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
    window.localStorage.clear(); // the Day/Month choice persists per-browser (lib/calendarView.ts) — don't leak between tests
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

  // ---------------------------------------------------------------------
  // Polish-2 (Spencer's live-app report — "the google calendar
  // visualization overlaps with the search tasks and tasks filtering
  // section... I want the right section... to primarily have the daily
  // view... and have the option to switch to monthly view"): ONE calendar
  // panel with a Day/Month toggle, Day by default, persisted per browser.
  // ---------------------------------------------------------------------

  it("shows the Calendar Day View by default, not the mini month", () => {
    mockState(loaded({ today: "2026-09-27" }));
    render(<HomePage />);
    expect(screen.getByTestId("calendar-day-view")).toBeInTheDocument();
    expect(screen.queryByText("September 2026")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches to the mini month when Month is clicked, and back to Day when Day is clicked", () => {
    mockState(loaded({ today: "2026-09-27" }));
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-day-view")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    expect(screen.getByTestId("calendar-day-view")).toBeInTheDocument();
    expect(screen.queryByText("September 2026")).not.toBeInTheDocument();
  });

  it("clicking a day in Month view switches back to Day", () => {
    mockState(loaded({ today: "2026-09-27" }));
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    fireEvent.click(screen.getByLabelText("Today, September 27"));
    expect(screen.getByTestId("calendar-day-view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");
  });

  it("remembers the Month choice across a remount (persisted per browser)", () => {
    mockState(loaded({ today: "2026-09-27" }));
    const { unmount } = render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    unmount();

    render(<HomePage />);
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to Day when localStorage.getItem throws", () => {
    const original = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("blocked");
    };
    mockState(loaded({ today: "2026-09-27" }));
    render(<HomePage />);
    expect(screen.getByTestId("calendar-day-view")).toBeInTheDocument();
    window.localStorage.getItem = original;
  });

  // Polish-4 addendum ("only tasks... when it is outside [a card], but
  // still on the same page, it should be able to scroll between pages"):
  // the Plan and Calendar cards opt out of wheel page-navigation
  // (`data-wheel-nav="off"`, `lib/wheelNav.ts`); the greeting above them
  // does not, so a wheel gesture there still changes page.
  it("the Plan and Calendar cards opt out of wheel page-navigation, but the greeting does not", () => {
    mockState(loaded());
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: "Today's Plan" }).closest('[data-wheel-nav="off"]')).not.toBeNull();
    expect(screen.getByRole("complementary", { name: "Calendar" })).toHaveAttribute("data-wheel-nav", "off");
    expect(screen.getByTestId("home-greeting").closest('[data-wheel-nav="off"]')).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Real-use fixes plan, Task 4 (2026-09-27, "I cant see my google calendar
  // on other days when i select a day on the month view. it just reverts
  // back to day"): clicking a Month day now switches Day to THAT date,
  // fetched via `lib/calendarDay.ts` (mocked here — its own behavior is
  // covered by `calendarDay.test.ts`).
  // ---------------------------------------------------------------------

  it("shows the Day header's own short date label, even for today, with no prev/next/Today controls", () => {
    mockState(loaded({ today: "2026-09-27" }));
    render(<HomePage />);
    expect(screen.getByText("Sun, Sep 27")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous day" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next day" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
  });

  it("clicking a non-today day in Month switches to Day for that date, showing its own header and prev/next/Today controls", () => {
    vi.spyOn(calendarDayModule, "useCalendarDay").mockImplementation((date) =>
      date === "2026-09-15" ? { status: "loaded", value: { date: "2026-09-15", blocks: [], timeZone: "America/New_York" } } : { status: "loading" },
    );
    mockState(loaded({ today: "2026-09-27" }));
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    fireEvent.click(screen.getByLabelText("September 15"));

    expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Tue, Sep 15")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByTestId("calendar-day-view")).toBeInTheDocument();
  });

  it("shows a skeleton (never a static spinner) while a non-today date is loading", () => {
    vi.spyOn(calendarDayModule, "useCalendarDay").mockReturnValue({ status: "loading" });
    mockState(loaded({ today: "2026-09-27" }));
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    fireEvent.click(screen.getByLabelText("September 15"));
    expect(screen.getByTestId("calendar-day-loading-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows a plain 'Couldn't load that day' line with a Retry button on error; Retry re-fetches that exact date", () => {
    vi.spyOn(calendarDayModule, "useCalendarDay").mockReturnValue({ status: "error", message: "network down" });
    const retrySpy = vi.spyOn(calendarDayModule, "retryCalendarDay").mockImplementation(() => {});
    mockState(loaded({ today: "2026-09-27" }));
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    fireEvent.click(screen.getByLabelText("September 15"));

    expect(screen.getByText("Couldn't load that day")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retrySpy).toHaveBeenCalledWith("2026-09-15");
  });

  it("clicking Today returns to today's own live Day view, dropping the prev/next/Today controls again", () => {
    vi.spyOn(calendarDayModule, "useCalendarDay").mockReturnValue({ status: "loading" });
    mockState(loaded({ today: "2026-09-27" }));
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    fireEvent.click(screen.getByLabelText("September 15"));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
    expect(screen.getByText("Sun, Sep 27")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-day-view")).toBeInTheDocument();
  });

  it("prev/next-day arrows step the shown date by exactly one calendar day", () => {
    vi.spyOn(calendarDayModule, "useCalendarDay").mockImplementation((date) => ({ status: "loaded", value: { date: date ?? "", blocks: [], timeZone: "America/New_York" } }));
    mockState(loaded({ today: "2026-09-27" }));
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    fireEvent.click(screen.getByLabelText("September 15"));
    expect(screen.getByText("Tue, Sep 15")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByText("Wed, Sep 16")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(screen.getByText("Mon, Sep 14")).toBeInTheDocument();
  });

  it("the shown date resets to today on a fresh mount (a 'full reload'), even after Month navigated elsewhere", () => {
    vi.spyOn(calendarDayModule, "useCalendarDay").mockReturnValue({ status: "loading" });
    mockState(loaded({ today: "2026-09-27" }));
    const { unmount } = render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    fireEvent.click(screen.getByLabelText("September 15"));
    expect(screen.getByText("Tue, Sep 15")).toBeInTheDocument();
    unmount();

    render(<HomePage />);
    expect(screen.getByText("Sun, Sep 27")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
  });

  it("renders the reshuffle preview card, and proposed blocks replace the calendar, only while a preview is open", () => {
    mockState(
      loaded({
        calendar: { blocks: [{ id: "cur", kind: "work", label: "Current block", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", completed: false, past: false }] },
        reshuffle: {
          proposalId: "p1",
          requestId: "proposal:p1",
          date: "2026-09-25",
          summary: "Moves Draft to 2 PM.",
          blocks: [{ id: "new", kind: "work", label: "Proposed block", start: "2026-09-25T14:00:00.000Z", end: "2026-09-25T15:00:00.000Z", completed: false, past: false, moved: true }],
          deferredTaskIds: [],
          needsDataTaskIds: [],
          unplacedRoutineLabels: [],
          expiresAt: "2026-09-25T18:10:00.000Z",
        },
      }),
    );
    render(<HomePage />);
    expect(screen.getByText("Moves Draft to 2 PM.")).toBeInTheDocument();
    expect(screen.getByText(/Proposed block/)).toBeInTheDocument();
    expect(screen.queryByText(/Current block/)).toBeNull();
  });

  it("shows no preview card without an open preview", () => {
    mockState(loaded());
    render(<HomePage />);
    expect(screen.queryByTestId("reshuffle-preview-card")).toBeNull();
  });
});
