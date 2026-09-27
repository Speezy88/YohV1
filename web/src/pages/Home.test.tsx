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
import { PageNavigationContext } from "../lib/navigationContext.tsx";
import type { PageNavigation } from "../lib/pages.ts";

function mockState(state: homeViewModule.HomeViewState): void {
  vi.spyOn(homeViewModule, "useHomeView").mockReturnValue(state);
  vi.spyOn(homeViewModule, "startHomeViewStream").mockReturnValue(() => {});
}

// Story 8.8: HomePage now renders `<ChatBubble />`, which reads
// `usePageNavigationContext()` (production always supplies it via
// `PageShell`) — every render/rerender below needs the same provider.
const NAV: PageNavigation = { index: 0, goTo: vi.fn(), next: vi.fn(), prev: vi.fn() };

function HomeWithNav(): React.JSX.Element {
  return (
    <PageNavigationContext.Provider value={NAV}>
      <HomePage />
    </PageNavigationContext.Provider>
  );
}

describe("HomePage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __resetReadinessForTests();
  });

  it("shows skeleton rows and a calendar skeleton while loading, never a static spinner", () => {
    mockState({ status: "loading" });
    render(<HomeWithNav />);
    expect(screen.getAllByTestId("plan-row-skeleton").length).toBeGreaterThan(0);
    expect(screen.getByTestId("calendar-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  // Story 8.8 (Review Focus #5): the Chat Bubble must be focusable before
  // Home's own data has loaded, and register no readiness gate of its own —
  // it renders across every status branch, not just "loaded".
  it("renders the Chat Bubble across every status branch — loading, error, and loaded (UX-DR35: 'the Chat Bubble stays live')", () => {
    mockState({ status: "loading" });
    const { rerender } = render(<HomeWithNav />);
    expect(screen.getByTestId("chat-bubble")).toBeInTheDocument();

    mockState({ status: "error", message: "network down" });
    rerender(<HomeWithNav />);
    expect(screen.getByTestId("chat-bubble")).toBeInTheDocument();

    mockState({ status: "loaded", value: { today: "2026-09-25", plan: undefined, calendar: { blocks: [] } } });
    rerender(<HomeWithNav />);
    expect(screen.getByTestId("chat-bubble")).toBeInTheDocument();
  });

  it("shows 'No Plan yet today. Type /plan to build it now.' when plan is undefined (real-use fixes plan, Task 1)", () => {
    mockState({ status: "loaded", value: { today: "2026-09-25", plan: undefined, calendar: { blocks: [] } } });
    render(<HomeWithNav />);
    expect(screen.getByText("No Plan yet today. Type /plan to build it now.")).toBeInTheDocument();
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
    render(<HomeWithNav />);
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
    render(<HomeWithNav />);
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
    render(<HomeWithNav />);
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
    render(<HomeWithNav />);
    const [row] = screen.getAllByTestId("plan-row");
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveClass("line-through");
  });

  it("registers the home-data readiness gate: not ready while loading, ready once loaded", () => {
    mockState({ status: "loading" });
    const { rerender } = render(<HomeWithNav />);
    const { result } = renderHook(() => useAppReady());
    expect(result.current).toBe(false);

    mockState({ status: "loaded", value: { today: "2026-09-25", plan: undefined, calendar: { blocks: [] } } });
    rerender(<HomeWithNav />);
    expect(result.current).toBe(true);
  });

  it("an error state shows neutral copy, not a crash", () => {
    mockState({ status: "error", message: "network down" });
    render(<HomeWithNav />);
    expect(screen.getByText(/couldn't load home/i)).toBeInTheDocument();
  });

  it("renders the Confetti component with the server's 'today', never the browser's date", () => {
    mockState({ status: "loaded", value: { today: "2026-02-19", plan: undefined, calendar: { blocks: [] } } });
    render(<HomeWithNav />);
    // Confetti itself is unit-tested in Confetti.test.tsx; here we only
    // prove Home passes the SERVER's today through, via its real rendering
    // (reduced motion is off by default in jsdom, so a real Feb 19 burst
    // proves the prop actually reached the component).
    expect(screen.getByTestId("confetti")).toBeInTheDocument();
  });
});
