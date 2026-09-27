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
  // Polish-2 (Spencer's live-app report: "the daily google calendar
  // visualization also is hard to see") — hour height/label size, event
  // title weight/contrast, the vertical gap between back-to-back blocks,
  // and the quiet break-block treatment.
  // ---------------------------------------------------------------------

  it("hour rows are at least 72px tall (this task's own readability floor)", () => {
    render(<CalendarDayView blocks={[]} timeZone={UTC} now={NOON_UTC} />);
    // "6AM"'s label span -> the row's flex wrapper -> the positioned (top-styled) hour row div.
    const sixAm = screen.getByText("6AM").parentElement!.parentElement as HTMLElement;
    const sevenAm = screen.getByText("7AM").parentElement!.parentElement as HTMLElement;
    const rowHeight = topPx(sevenAm) - topPx(sixAm);
    expect(rowHeight).toBeGreaterThanOrEqual(72);
  });

  it("hour labels render at least 12px (text-caption-lg), in ink-secondary", () => {
    render(<CalendarDayView blocks={[]} timeZone={UTC} now={NOON_UTC} />);
    const label = screen.getByText("6AM");
    expect(label).toHaveClass("text-caption-lg");
    expect(label).toHaveClass("text-ink-secondary");
  });

  it("a Work event's title is semibold on its solid (non-translucent) accent fill", () => {
    render(<CalendarDayView blocks={[block({ id: "b1", kind: "work" })]} timeZone={UTC} now={NOON_UTC} />);
    const el = screen.getByTestId("calendar-block");
    expect(el).toHaveClass("font-semibold");
    expect(el).toHaveClass("text-small"); // 15px, >= the 13px floor
    expect(el.className).not.toMatch(/\/\d\d\)|opacity-[0-5]\d\b/); // no translucency modifier on the fill itself
  });

  it("a fixed anchor's title is also semibold", () => {
    render(<CalendarDayView blocks={[block({ id: "e1", kind: "fixed" })]} timeZone={UTC} now={NOON_UTC} />);
    expect(screen.getByTestId("calendar-block")).toHaveClass("font-semibold");
  });

  it("two back-to-back (touching) blocks, both above the min-height floor, render with a visible gap between them — not seamlessly flush", () => {
    render(
      <CalendarDayView
        timeZone={UTC}
        now={NOON_UTC}
        blocks={[
          block({ id: "a", kind: "work", label: "First", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T13:30:00.000Z" }),
          block({ id: "b", kind: "work", label: "Second", start: "2026-09-25T13:30:00.000Z", end: "2026-09-25T14:00:00.000Z" }),
        ]}
      />,
    );
    const [first, second] = screen.getAllByTestId("calendar-block") as HTMLElement[];
    const firstBottom = topPx(first!) + Number.parseFloat(first!.style.height);
    const secondTop = topPx(second!);
    expect(secondTop - firstBottom).toBeGreaterThanOrEqual(2);
  });

  it("a break block renders a quiet outline, no fill/shadow/bold, distinct from Work/fixed", () => {
    render(<CalendarDayView blocks={[block({ id: "brk", kind: "break", label: "Break", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z" })]} timeZone={UTC} now={NOON_UTC} />);
    const el = screen.getByTestId("calendar-block");
    expect(el).toHaveClass("border-dashed");
    expect(el).not.toHaveClass("bg-gradient-to-br");
    expect(el).not.toHaveClass("font-semibold");
    expect(el.className).not.toMatch(/shadow-/);
    expect(el.textContent).toBe("Break");
  });

  it("a break block too short to hold a label renders no visible text (the box itself still renders, as a quiet time marker)", () => {
    render(<CalendarDayView blocks={[block({ id: "brk", kind: "break", label: "Break", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T13:05:00.000Z" })]} timeZone={UTC} now={NOON_UTC} />);
    const el = screen.getByTestId("calendar-block");
    expect(el.textContent).toBe("");
    expect(el).toHaveAttribute("aria-label", "Break"); // still announced to screen readers
  });

  // ---------------------------------------------------------------------
  // Fix round (2026-09-27 review) — the real bug: positions must be in the
  // HOST timezone (HomeViewResponse.timeZone), never the browser's own or
  // a hard-coded UTC read of the ISO string's own UTC hour.
  // ---------------------------------------------------------------------

  it("a 22:00Z event renders at the 3pm row in America/Los_Angeles (the real bug), not the 10pm row UTC would put it at", () => {
    const laBlock = block({ id: "la1", kind: "work", start: "2026-09-25T22:00:00.000Z", end: "2026-09-25T23:00:00.000Z" });
    const { unmount } = render(<CalendarDayView blocks={[laBlock]} timeZone={LOS_ANGELES} now={NOON_UTC} />);
    // 3pm - 6am (DAY_START_HOUR) = 9h = 540min, of a 1020min (6am-11pm) window, over 1224px of content (72px/hour, Polish-2): 648px.
    expect(topPx(screen.getByTestId("calendar-block"))).toBeCloseTo(648, 0);
    unmount();

    // The SAME instant, read in UTC (22:00), would land at the 10pm row instead — proving the fix actually changed something.
    render(<CalendarDayView blocks={[laBlock]} timeZone={UTC} now={NOON_UTC} />);
    expect(topPx(screen.getByTestId("calendar-block"))).toBeCloseTo(1152, 0);
  });

  it("the now-line is positioned in the host timezone too, not the browser's/UTC's", () => {
    // 22:30Z is 3:30pm in Los Angeles (PDT, UTC-7 in September).
    const nowLA = () => new Date("2026-09-25T22:30:00.000Z");
    render(<CalendarDayView blocks={[]} timeZone={LOS_ANGELES} now={nowLA} />);
    const nowLine = screen.getByTestId("calendar-now-line");
    // 3:30pm - 6am = 9.5h = 570min -> 570/1020*1224 = 684px (72px/hour, Polish-2).
    expect(topPx(nowLine)).toBeCloseTo(684, 0);
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

  it("a non-Yoh fixed anchor renders cross-hatched, event-fixed-ink, no gradient/shadow, suffixed '· fixed', always compact/single-line/truncated (fix round 2, review finding 2)", () => {
    render(<CalendarDayView blocks={[block({ id: "e1", kind: "fixed", label: "Soccer practice" })]} timeZone={UTC} now={NOON_UTC} />);
    const el = screen.getByTestId("calendar-block");
    expect(el).toHaveClass("text-event-fixed-ink");
    expect(el).not.toHaveClass("bg-gradient-to-br");
    expect(el.className).not.toMatch(/shadow-/);
    expect(el.textContent).toBe("Soccer practice · fixed");
    expect(el).toHaveClass("truncate");
  });

  it("an untitled or punctuation-only label shows (No title)", () => {
    render(<CalendarDayView blocks={[block({ id: "b1", kind: "work", label: "   " }), block({ id: "e1", kind: "fixed", label: "--" })]} timeZone={UTC} now={NOON_UTC} />);
    const [work, fixed] = screen.getAllByTestId("calendar-block");
    expect(work!.textContent).toBe("(No title)");
    expect(fixed!.textContent).toBe("(No title) · fixed");
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

  it("a PAST fixed (non-Yoh) anchor is visibly read-only, while keeping its cross-hatch/event-fixed-ink/'· fixed' treatment", () => {
    render(<CalendarDayView blocks={[block({ id: "e1", kind: "fixed", label: "Soccer practice", past: true })]} timeZone={UTC} now={NOON_UTC} />);
    const el = screen.getByTestId("calendar-block");
    expect(el).toHaveAttribute("aria-disabled", "true");
    expect(el).toHaveClass("opacity-60");
    expect(el).toHaveClass("text-event-fixed-ink");
    expect(el.textContent).toBe("Soccer practice · fixed");
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
          // A full hour (not the old 30min) — this test is about render
          // ORDER, not the polish-1 short-block label tiers covered below.
          block({ id: "b1", kind: "work", label: "First", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z" }),
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

  // ---------------------------------------------------------------------
  // Polish-1 — "side-by-side calendar events": overlapping blocks share the
  // lane in columns instead of drawing directly on top of one another.
  // ---------------------------------------------------------------------

  describe("side-by-side overlapping events", () => {
    it("a single (non-overlapping) block still starts at the literal CONTENT_LEFT_PX pixel offset — unchanged from before this fix", () => {
      render(<CalendarDayView blocks={[block({ id: "b1", kind: "work" })]} timeZone={UTC} now={NOON_UTC} />);
      const el = screen.getByTestId("calendar-block") as HTMLElement;
      expect(el.style.left).toBe("64px");
      expect(el.style.width).toBe("");
    });

    it("two overlapping blocks get DIFFERENT left offsets and an explicit shared width — never the same full-lane position", () => {
      render(
        <CalendarDayView
          timeZone={UTC}
          now={NOON_UTC}
          blocks={[
            block({ id: "a", kind: "work", label: "A", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z" }),
            block({ id: "b", kind: "work", label: "B", start: "2026-09-25T13:30:00.000Z", end: "2026-09-25T14:30:00.000Z" }),
          ]}
        />,
      );
      const [a, b] = screen.getAllByTestId("calendar-block") as HTMLElement[];
      expect(a!.style.left).not.toBe(b!.style.left);
      // Column 0 keeps the literal pixel left; column 1 is a calc() expression against the lane's real rendered width.
      expect(a!.style.left).toBe("64px");
      expect(b!.style.left).toMatch(/^calc\(/);
      // Both share an equal, explicit width (never the old implicit full-lane sizing).
      expect(a!.style.width).toMatch(/^calc\(/);
      expect(b!.style.width).toMatch(/^calc\(/);
      expect(a!.style.width).toBe(b!.style.width);
    });

    it("three mutually overlapping blocks each get their own column, all sharing one 3-way width", () => {
      render(
        <CalendarDayView
          timeZone={UTC}
          now={NOON_UTC}
          blocks={[
            block({ id: "a", kind: "work", label: "A", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z" }),
            block({ id: "b", kind: "work", label: "B", start: "2026-09-25T13:10:00.000Z", end: "2026-09-25T14:10:00.000Z" }),
            block({ id: "c", kind: "work", label: "C", start: "2026-09-25T13:20:00.000Z", end: "2026-09-25T14:20:00.000Z" }),
          ]}
        />,
      );
      const [a, b, c] = screen.getAllByTestId("calendar-block") as HTMLElement[];
      const lefts = new Set([a!.style.left, b!.style.left, c!.style.left]);
      expect(lefts.size).toBe(3); // three distinct columns
      expect(a!.style.width).toBe(b!.style.width);
      expect(b!.style.width).toBe(c!.style.width);
      // 3-way width divides the lane further than a 2-way split would (jsdom
      // reserializes calc() into a multiplication factor, e.g. "* 0.333…"
      // rather than "/ 3" literally, so this checks the fraction, not the
      // exact operator text).
      expect(a!.style.width).toMatch(/0\.333/);
    });

    it("two touching (not overlapping) blocks — one ends exactly when the next starts — both keep the full-lane literal left, not a shared column", () => {
      render(
        <CalendarDayView
          timeZone={UTC}
          now={NOON_UTC}
          blocks={[
            block({ id: "a", kind: "work", label: "A", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z" }),
            block({ id: "b", kind: "work", label: "B", start: "2026-09-25T14:00:00.000Z", end: "2026-09-25T15:00:00.000Z" }),
          ]}
        />,
      );
      const [a, b] = screen.getAllByTestId("calendar-block") as HTMLElement[];
      expect(a!.style.left).toBe("64px");
      expect(b!.style.left).toBe("64px");
      expect(a!.style.width).toBe("");
      expect(b!.style.width).toBe("");
    });
  });

  // ---------------------------------------------------------------------
  // Polish-1 — short blocks scale their label down: under ~20min shows
  // just the truncated title; under ~45min shows a one-line "Title · h:mm".
  // ---------------------------------------------------------------------

  describe("short-block label tiers", () => {
    it("a block under ~20min shows just the title, truncated single-line, no time", () => {
      render(
        <CalendarDayView
          blocks={[block({ id: "b1", kind: "work", label: "Quick sync", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T13:15:00.000Z" })]}
          timeZone={UTC}
          now={NOON_UTC}
        />,
      );
      const el = screen.getByTestId("calendar-block");
      expect(el.textContent).toBe("Quick sync");
      expect(el).toHaveClass("truncate");
    });

    it("a 'very short' block (20-45min) shows a one-line 'Title · h:mm' label", () => {
      render(
        <CalendarDayView
          blocks={[block({ id: "b1", kind: "work", label: "Standup", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T13:30:00.000Z" })]}
          timeZone={UTC}
          now={NOON_UTC}
        />,
      );
      const el = screen.getByTestId("calendar-block");
      expect(el.textContent).toBe("Standup · 1:00");
      expect(el).toHaveClass("truncate");
    });

    it("a normal-length block (>=45min) shows just the title, not single-line-truncated", () => {
      render(<CalendarDayView blocks={[block({ id: "b1", kind: "work", label: "Draft the memo" })]} timeZone={UTC} now={NOON_UTC} />); // default 1hr
      const el = screen.getByTestId("calendar-block");
      expect(el.textContent).toBe("Draft the memo");
      expect(el).not.toHaveClass("truncate");
    });

    it("a very short FIXED block still shows the title only, truncated — the ' · fixed' suffix is part of the truncated text, not dropped", () => {
      render(
        <CalendarDayView
          blocks={[block({ id: "e1", kind: "fixed", label: "Soccer", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T13:10:00.000Z" })]}
          timeZone={UTC}
          now={NOON_UTC}
        />,
      );
      expect(screen.getByTestId("calendar-block").textContent).toBe("Soccer · fixed");
    });

    it("a NORMAL-length (>=45min) FIXED block is still compact/single-line/truncated — a fixed anchor never gets the multi-line treatment, since its column width (not its duration) is what risks clipping it (fix round 2, review finding 2)", () => {
      render(
        <CalendarDayView
          blocks={[block({ id: "e1", kind: "fixed", label: "Soccer practice", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z" })]} // 1hr — well above VERY_SHORT_MINUTES
          timeZone={UTC}
          now={NOON_UTC}
        />,
      );
      const el = screen.getByTestId("calendar-block");
      expect(el.textContent).toBe("Soccer practice · fixed");
      expect(el).toHaveClass("truncate");
      expect(el).toHaveClass("items-center");
      expect(el).not.toHaveClass("py-1.5");
    });

    it("a NORMAL-length WORK block (not fixed) still gets the full multi-line treatment, unaffected by the fixed-anchor-only compact rule", () => {
      render(<CalendarDayView blocks={[block({ id: "b1", kind: "work", label: "Draft the memo" })]} timeZone={UTC} now={NOON_UTC} />); // default 1hr
      const el = screen.getByTestId("calendar-block");
      expect(el).not.toHaveClass("truncate");
      expect(el).not.toHaveClass("items-center");
    });

    // ---------------------------------------------------------------------
    // Fix round (review finding 2): the old 14px floor was smaller than a
    // block's own padding + one line of text, so a very short block's title
    // was clipped away entirely. The rendered height must now be tall
    // enough to actually show one compact line, and the title text itself
    // must render (not just be present but visually clipped to nothing).
    // ---------------------------------------------------------------------

    it("a 10-minute block renders its title, at a height tall enough for one compact line — not clipped to nothing", () => {
      render(
        <CalendarDayView
          blocks={[block({ id: "b1", kind: "work", label: "Quick standup", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T13:10:00.000Z" })]}
          timeZone={UTC}
          now={NOON_UTC}
        />,
      );
      const el = screen.getByTestId("calendar-block") as HTMLElement;
      expect(el.textContent).toBe("Quick standup");
      // 10min at 56px/hour is ~9.3px raw — well under one readable line.
      expect(Number.parseFloat(el.style.height)).toBeGreaterThanOrEqual(20);
      // Compact single-line layout: reduced padding + vertical centering, not the normal block's top-anchored py-1.5.
      expect(el).toHaveClass("py-0.5");
      expect(el).toHaveClass("items-center");
      expect(el).not.toHaveClass("py-1.5");
    });

    it("a bumped-up short block's height never grows past where the very next block (anywhere) starts — never overlapping its text", () => {
      render(
        <CalendarDayView
          timeZone={UTC}
          now={NOON_UTC}
          blocks={[
            // A 4-minute block immediately followed (8 minutes later) by another block — MIN_BLOCK_HEIGHT_PX would ordinarily push the first block's box well past the second's own start.
            block({ id: "b1", kind: "work", label: "Ping the team", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T13:04:00.000Z" }),
            block({ id: "b2", kind: "work", label: "Next thing", start: "2026-09-25T13:08:00.000Z", end: "2026-09-25T14:00:00.000Z" }),
          ]}
        />,
      );
      const [first, second] = screen.getAllByTestId("calendar-block") as HTMLElement[];
      const firstTop = Number.parseFloat(first!.style.top);
      const firstHeight = Number.parseFloat(first!.style.height);
      const secondTop = Number.parseFloat(second!.style.top);
      expect(firstTop + firstHeight).toBeLessThanOrEqual(secondTop);
    });

    it("a bumped-up short block's height still never shrinks below its own real duration, even when capped by a close neighbor", () => {
      render(
        <CalendarDayView
          timeZone={UTC}
          now={NOON_UTC}
          blocks={[
            block({ id: "b1", kind: "work", label: "Ping the team", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T13:04:00.000Z" }),
            block({ id: "b2", kind: "work", label: "Right after", start: "2026-09-25T13:04:00.000Z", end: "2026-09-25T14:00:00.000Z" }),
          ]}
        />,
      );
      const [first] = screen.getAllByTestId("calendar-block") as HTMLElement[];
      // 4min at 56px/hour ≈ 3.7px — the true floor even when there's no room to grow.
      expect(Number.parseFloat(first!.style.height)).toBeGreaterThan(3);
    });
  });

  // -------------------------------------------------------------------
  // Real-use fixes plan, Task 4 ("pick any day in Month to see its
  // calendar"): `isToday={false}` governs the now-line and the mount-time
  // auto-scroll target; every test above (no `isToday` prop) proves the
  // default (`true`) is unchanged.
  // -------------------------------------------------------------------
  describe("isToday: false (a non-today shown date)", () => {
    it("never shows the now-line, even when 'now' falls within the 6am-11pm window", () => {
      render(<CalendarDayView blocks={[]} timeZone={UTC} now={NOON_UTC} isToday={false} />);
      expect(screen.queryByTestId("calendar-now-line")).not.toBeInTheDocument();
    });

    it("with events, auto-scrolls to the first event's start rather than 'now'", () => {
      // "Now" (8pm) would ordinarily scroll deep into the day; the first
      // event is much earlier (9am) — isToday: false anchors there instead.
      render(
        <CalendarDayView
          timeZone={UTC}
          now={() => new Date("2026-09-25T20:00:00.000Z")}
          isToday={false}
          blocks={[block({ id: "b1", kind: "work", start: "2026-09-25T09:00:00.000Z", end: "2026-09-25T10:00:00.000Z" })]}
        />,
      );
      const view = screen.getByTestId("calendar-day-view");
      // (9am - 6am) * 72px/hour = 216px, minus a third of the (jsdom, 0px) clientHeight.
      expect(view.scrollTop).toBeCloseTo(216, 0);
    });

    it("with no events, auto-scrolls to a plain 8am anchor rather than 'now'", () => {
      render(<CalendarDayView blocks={[]} timeZone={UTC} now={() => new Date("2026-09-25T20:00:00.000Z")} isToday={false} />);
      const view = screen.getByTestId("calendar-day-view");
      // (8am - 6am) * 72px/hour = 144px.
      expect(view.scrollTop).toBeCloseTo(144, 0);
    });

    it("an empty non-today day says 'Nothing on the calendar'", () => {
      render(<CalendarDayView blocks={[]} timeZone={UTC} now={NOON_UTC} isToday={false} />);
      expect(screen.getByTestId("calendar-day-empty")).toHaveTextContent("Nothing on the calendar");
    });

    it("a non-empty non-today day never shows the empty message", () => {
      render(<CalendarDayView blocks={[block({ id: "b1", kind: "work" })]} timeZone={UTC} now={NOON_UTC} isToday={false} />);
      expect(screen.queryByTestId("calendar-day-empty")).not.toBeInTheDocument();
    });

    it("isToday defaults to true: an empty TODAY view never shows the non-today empty message", () => {
      render(<CalendarDayView blocks={[]} timeZone={UTC} now={NOON_UTC} />);
      expect(screen.queryByTestId("calendar-day-empty")).not.toBeInTheDocument();
    });
  });
});
