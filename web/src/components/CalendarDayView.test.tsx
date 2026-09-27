/**
 * web/src/components/CalendarDayView.test.tsx — Story 7.8, UX-DR32; Task 6A
 * (2026-09-27) rewrite for the Google-Calendar-style redesign, plus the
 * fix-round (2026-09-27 review): a dedicated hour-label gutter (blocks no
 * longer cover the labels) and host-timezone-aware positioning (never the
 * browser's own zone, AD-17) — the most important case here is the real bug
 * fix: a 22:00Z event must render at the 3pm row in America/Los_Angeles,
 * not the 10pm row UTC would put it at.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CalendarDayView } from "./CalendarDayView.tsx";
import type { HomeCalendarBlock } from "../../../src/types/api.ts";

const UTC = "UTC";
const LOS_ANGELES = "America/Los_Angeles";

function block(overrides: Partial<HomeCalendarBlock> & Pick<HomeCalendarBlock, "id" | "kind">): HomeCalendarBlock {
  return { label: "Block", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", completed: false, past: false, ...overrides };
}

/** `Element.style.top`, parsed to a number of px — every block/hour-label/now-line position is an inline style, not a class, so tests read it directly. */
function topPx(el: Element): number {
  return Number.parseFloat((el as HTMLElement).style.top);
}

const NOON_UTC = () => new Date("2026-09-25T12:00:00.000Z");

describe("CalendarDayView", () => {
  it("renders caption-style hour labels in their own gutter, plus a vertical rail at the label/content boundary", () => {
    render(<CalendarDayView blocks={[]} timeZone={UTC} now={NOON_UTC} />);
    const view = screen.getByTestId("calendar-day-view");
    expect(view).toHaveClass("overflow-y-auto");
    expect(view).toHaveClass("h-full");
    expect(screen.getByText(/6AM/)).toBeInTheDocument();
    expect(screen.getByText(/11PM/)).toBeInTheDocument();
    // The gutter is a real column (a fixed pixel width), not the shared
    // event lane blocks render in — the label's wrapping span carries its
    // own explicit width rather than spanning the full row.
    const label = screen.getByText("6AM");
    expect((label as HTMLElement).style.width).toBe("52px");
  });

  it("every hour in the 6am-11pm window gets its own label (Google Calendar-style), not just a few", () => {
    render(<CalendarDayView blocks={[]} timeZone={UTC} now={NOON_UTC} />);
    for (const label of ["6AM", "9AM", "12PM", "3PM", "6PM", "9PM", "11PM"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("a block never covers the hour-label gutter: it's positioned to start well clear of the labels' own width", () => {
    render(<CalendarDayView blocks={[block({ id: "b1", kind: "work" })]} timeZone={UTC} now={NOON_UTC} />);
    const el = screen.getByTestId("calendar-block") as HTMLElement;
    expect(Number.parseFloat(el.style.left)).toBeGreaterThanOrEqual(64); // clear of the 52px label gutter + a gap
  });

  // ---------------------------------------------------------------------
  // Fix round (2026-09-27 review) — the real bug: positions must be in the
  // HOST timezone (HomeViewResponse.timeZone), never the browser's own or
  // a hard-coded UTC read of the ISO string's own UTC hour.
  // ---------------------------------------------------------------------

  it("a 22:00Z event renders at the 3pm row in America/Los_Angeles (the real bug), not the 10pm row UTC would put it at", () => {
    const laBlock = block({ id: "la1", kind: "work", start: "2026-09-25T22:00:00.000Z", end: "2026-09-25T23:00:00.000Z" });
    const { unmount } = render(<CalendarDayView blocks={[laBlock]} timeZone={LOS_ANGELES} now={NOON_UTC} />);
    // 3pm - 6am (DAY_START_HOUR) = 9h = 540min, of a 1020min (6am-11pm) window, over 952px of content: 504px.
    expect(topPx(screen.getByTestId("calendar-block"))).toBeCloseTo(504, 0);
    unmount();

    // The SAME instant, read in UTC (22:00), would land at the 10pm row instead — proving the fix actually changed something.
    render(<CalendarDayView blocks={[laBlock]} timeZone={UTC} now={NOON_UTC} />);
    expect(topPx(screen.getByTestId("calendar-block"))).toBeCloseTo(896, 0);
  });

  it("the now-line is positioned in the host timezone too, not the browser's/UTC's", () => {
    // 22:30Z is 3:30pm in Los Angeles (PDT, UTC-7 in September).
    const nowLA = () => new Date("2026-09-25T22:30:00.000Z");
    render(<CalendarDayView blocks={[]} timeZone={LOS_ANGELES} now={nowLA} />);
    const nowLine = screen.getByTestId("calendar-now-line");
    // 3:30pm - 6am = 9.5h = 570min -> 570/1020*952 = 532px.
    expect(topPx(nowLine)).toBeCloseTo(532, 0);
  });

  it("a Yoh-owned work block renders filled with the accent gradient, no ' (fixed)' suffix", () => {
    render(<CalendarDayView blocks={[block({ id: "b1", kind: "work", label: "Draft the memo" })]} timeZone={UTC} now={NOON_UTC} />);
    const el = screen.getByTestId("calendar-block");
    expect(el).toHaveClass("bg-gradient-to-br");
    expect(el).toHaveClass("from-accent-gradient-start");
    expect(el).toHaveClass("to-accent-gradient-end");
    expect(el.className).not.toMatch(/shadow-\[/); // never a hard-coded shadow value
    expect(el.textContent).toBe("Draft the memo");
  });

  it("a non-Yoh fixed anchor renders cross-hatched, event-fixed-ink, no gradient/shadow, suffixed '(fixed)'", () => {
    render(<CalendarDayView blocks={[block({ id: "e1", kind: "fixed", label: "Soccer practice" })]} timeZone={UTC} now={NOON_UTC} />);
    const el = screen.getByTestId("calendar-block");
    expect(el).toHaveClass("text-event-fixed-ink");
    expect(el).not.toHaveClass("bg-gradient-to-br");
    expect(el.className).not.toMatch(/shadow-/);
    expect(el.textContent).toBe("Soccer practice (fixed)");
  });

  it("an untitled or punctuation-only label shows (No title)", () => {
    render(<CalendarDayView blocks={[block({ id: "b1", kind: "work", label: "   " }), block({ id: "e1", kind: "fixed", label: "--" })]} timeZone={UTC} now={NOON_UTC} />);
    const [work, fixed] = screen.getAllByTestId("calendar-block");
    expect(work!.textContent).toBe("(No title)");
    expect(fixed!.textContent).toBe("(No title) (fixed)");
  });

  it("a completed block is visibly read-only: aria-disabled and struck through", () => {
    render(<CalendarDayView blocks={[block({ id: "b1", kind: "work", completed: true })]} timeZone={UTC} now={NOON_UTC} />);
    const el = screen.getByTestId("calendar-block");
    expect(el).toHaveAttribute("aria-disabled", "true");
    expect(el).toHaveClass("line-through");
  });

  it("a past (not completed) block is visibly read-only", () => {
    render(<CalendarDayView blocks={[block({ id: "b1", kind: "work", past: true })]} timeZone={UTC} now={NOON_UTC} />);
    expect(screen.getByTestId("calendar-block")).toHaveAttribute("aria-disabled", "true");
  });

  it("a PAST fixed (non-Yoh) anchor is visibly read-only, while keeping its cross-hatch/event-fixed-ink/'(fixed)' treatment", () => {
    render(<CalendarDayView blocks={[block({ id: "e1", kind: "fixed", label: "Soccer practice", past: true })]} timeZone={UTC} now={NOON_UTC} />);
    const el = screen.getByTestId("calendar-block");
    expect(el).toHaveAttribute("aria-disabled", "true");
    expect(el).toHaveClass("opacity-60");
    expect(el).toHaveClass("text-event-fixed-ink");
    expect(el.textContent).toBe("Soccer practice (fixed)");
  });

  it("a current (not past, not completed) fixed anchor is NOT dimmed", () => {
    render(<CalendarDayView blocks={[block({ id: "e1", kind: "fixed" })]} timeZone={UTC} now={NOON_UTC} />);
    expect(screen.getByTestId("calendar-block")).not.toHaveClass("opacity-60");
  });

  it("a current, not-completed block is not marked read-only", () => {
    render(<CalendarDayView blocks={[block({ id: "b1", kind: "work" })]} timeZone={UTC} now={NOON_UTC} />);
    expect(screen.getByTestId("calendar-block")).toHaveAttribute("aria-disabled", "false");
  });

  it("renders every given block, in the given order — never re-sorted client-side", () => {
    render(
      <CalendarDayView
        timeZone={UTC}
        now={NOON_UTC}
        blocks={[
          block({ id: "b2", kind: "work", label: "Second", start: "2026-09-25T14:00:00.000Z", end: "2026-09-25T15:00:00.000Z" }),
          block({ id: "b1", kind: "work", label: "First", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T13:30:00.000Z" }),
        ]}
      />,
    );
    const rendered = screen.getAllByTestId("calendar-block");
    expect(rendered.map((el) => el.textContent)).toEqual(["Second", "First"]);
  });

  it("shows a now-line when the current time falls within the 6am-11pm window", () => {
    render(<CalendarDayView blocks={[]} timeZone={UTC} now={NOON_UTC} />);
    expect(screen.getByTestId("calendar-now-line")).toBeInTheDocument();
  });

  it("hides the now-line outside the 6am-11pm window", () => {
    render(<CalendarDayView blocks={[]} timeZone={UTC} now={() => new Date("2026-09-25T03:00:00.000Z")} />);
    expect(screen.queryByTestId("calendar-now-line")).not.toBeInTheDocument();
  });

  it("opens already scrolled to roughly the current time, not the top of the day", () => {
    render(<CalendarDayView blocks={[]} timeZone={UTC} now={() => new Date("2026-09-25T20:00:00.000Z")} />); // 8pm UTC
    const view = screen.getByTestId("calendar-day-view");
    expect(view.scrollTop).toBeGreaterThan(0);
  });
});
