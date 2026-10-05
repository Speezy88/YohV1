/**
 * web/src/components/DeskHeatmap.test.tsx — Epic 12 Task 5: the Desk heatmap
 * (Bklit's chart, patched): week/day → bin mapping, labels, the one roving
 * tab stop, arrow/Home/End movement, tooltip on focus, the legend and
 * reduced motion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { DeskHeatmap } from "./DeskHeatmap.tsx";
import { toHeatmapColumns, heatmapCellLabel, formatHeatmapDay } from "../lib/deskHeatmap.ts";
import { moveHeatmapFocus } from "./charts/heatmap/heatmap-focus.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import type { DeskHeatmapDay } from "../../../src/types/api.ts";

vi.mock("../hooks/useReducedMotion.ts", () => ({ useReducedMotion: vi.fn(() => false) }));
const reduced = useReducedMotion as unknown as ReturnType<typeof vi.fn>;

const day = (date: string, completed: number, active = false): DeskHeatmapDay => ({
  date,
  completed,
  level: completed >= 5 ? 4 : completed >= 3 ? 3 : completed >= 1 ? 2 : active ? 1 : 0,
});
// Sunday Sep 27 .. Saturday Oct 3, then a short week: Sunday Oct 4 .. Wednesday Oct 7 (today).
const WEEK_A: DeskHeatmapDay[] = [day("2026-09-27", 0), day("2026-09-28", 1), day("2026-09-29", 0, true), day("2026-09-30", 3), day("2026-10-01", 5), day("2026-10-02", 0), day("2026-10-03", 2)];
const WEEK_B: DeskHeatmapDay[] = [day("2026-10-04", 0), day("2026-10-05", 0, true), day("2026-10-06", 0), day("2026-10-07", 1)];
const WEEKS = [WEEK_A, WEEK_B];

const cell = (name: string): HTMLElement => screen.getByRole("img", { name });
const cells = (): HTMLElement[] => screen.getAllByRole("img").filter((el) => el.getAttribute("tabindex") !== null);

describe("toHeatmapColumns", () => {
  it("maps weeks to columns of bin (weekday), count (level) and a UTC-midnight date", () => {
    const cols = toHeatmapColumns(WEEKS);
    expect(cols).toHaveLength(2);
    expect(cols[0]!.bins).toHaveLength(7);
    expect(cols[1]!.bins).toHaveLength(4);
    expect(cols[0]!.bins[3]).toMatchObject({ bin: 3, count: 3, completed: 3 });
    expect(cols[0]!.bins[3]!.date.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(cols[1]!.bins.map((b) => b.bin)).toEqual([0, 1, 2, 3]);
    expect(cols[1]!.bins[1]!.count).toBe(1);
  });
});

describe("labels", () => {
  it("formats the date from the ISO parts", () => {
    expect(formatHeatmapDay(new Date("2026-10-03T00:00:00.000Z"))).toBe("Oct 3, 2026");
  });
  it("covers every variant", () => {
    const d = new Date("2026-10-03T00:00:00.000Z");
    expect(heatmapCellLabel(d, 4, 5)).toBe("Oct 3, 2026: 5 Tasks completed");
    expect(heatmapCellLabel(d, 2, 1)).toBe("Oct 3, 2026: 1 Task completed");
    expect(heatmapCellLabel(d, 1, 0)).toBe("Oct 3, 2026: opened Yoh, no Tasks completed");
    expect(heatmapCellLabel(d, 0, 0)).toBe("Oct 3, 2026: no activity");
  });
});

describe("moveHeatmapFocus", () => {
  const data = toHeatmapColumns(WEEKS);
  it("moves by day and week, and clamps at the edges", () => {
    expect(moveHeatmapFocus(data, { column: 0, row: 3 }, "ArrowDown")).toEqual({ column: 0, row: 4 });
    expect(moveHeatmapFocus(data, { column: 0, row: 3 }, "ArrowUp")).toEqual({ column: 0, row: 2 });
    expect(moveHeatmapFocus(data, { column: 0, row: 0 }, "ArrowUp")).toEqual({ column: 0, row: 0 });
    expect(moveHeatmapFocus(data, { column: 0, row: 6 }, "ArrowDown")).toEqual({ column: 0, row: 6 });
    expect(moveHeatmapFocus(data, { column: 1, row: 1 }, "ArrowLeft")).toEqual({ column: 0, row: 1 });
    expect(moveHeatmapFocus(data, { column: 0, row: 1 }, "ArrowLeft")).toEqual({ column: 0, row: 1 });
  });
  it("never lands on a missing day in the short last week", () => {
    expect(moveHeatmapFocus(data, { column: 0, row: 5 }, "ArrowRight")).toEqual({ column: 1, row: 3 });
    expect(moveHeatmapFocus(data, { column: 1, row: 3 }, "ArrowDown")).toEqual({ column: 1, row: 3 });
    expect(moveHeatmapFocus(data, { column: 1, row: 3 }, "ArrowRight")).toEqual({ column: 1, row: 3 });
  });
  it("Home and End go to the first and last day", () => {
    expect(moveHeatmapFocus(data, { column: 1, row: 2 }, "Home")).toEqual({ column: 0, row: 0 });
    expect(moveHeatmapFocus(data, { column: 0, row: 2 }, "End")).toEqual({ column: 1, row: 3 });
  });
  it("ignores other keys", () => {
    expect(moveHeatmapFocus(data, { column: 0, row: 2 }, "a")).toBeNull();
  });
});

describe("DeskHeatmap", () => {
  beforeEach(() => reduced.mockReturnValue(false));

  it("renders a labelled group with one cell per day and no invented future days", () => {
    render(<DeskHeatmap weeks={WEEKS} />);
    expect(screen.getByRole("group", { name: "Activity, last 26 weeks" })).toBeInTheDocument();
    expect(cells()).toHaveLength(11);
    expect(cell("Oct 7, 2026: 1 Task completed")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Oct 8, 2026/ })).toBeNull();
    expect(cell("Sep 30, 2026: 3 Tasks completed")).toBeInTheDocument();
    expect(cell("Sep 29, 2026: opened Yoh, no Tasks completed")).toBeInTheDocument();
    expect(cell("Sep 27, 2026: no activity")).toBeInTheDocument();
  });

  it("has exactly one tab stop, today's cell, and it follows focus", () => {
    render(<DeskHeatmap weeks={WEEKS} />);
    const stops = cells().filter((c) => c.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(cell("Oct 7, 2026: 1 Task completed"));
    fireEvent.focus(cell("Sep 30, 2026: 3 Tasks completed"));
    expect(cell("Sep 30, 2026: 3 Tasks completed")).toHaveAttribute("tabindex", "0");
    expect(cells().filter((c) => c.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("moves focus with the arrow keys, Home and End, never to a missing day", () => {
    render(<DeskHeatmap weeks={WEEKS} />);
    const today = cell("Oct 7, 2026: 1 Task completed");
    today.focus();
    fireEvent.keyDown(today, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cell("Sep 30, 2026: 3 Tasks completed"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell("Oct 1, 2026: 5 Tasks completed"));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(cell("Sep 27, 2026: no activity"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(cell("Sep 27, 2026: no activity"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(today);
    fireEvent.keyDown(today, { key: "ArrowRight" });
    expect(document.activeElement).toBe(today);
  });

  it("shows the tooltip on focus, hides it on Escape and on blur", async () => {
    render(<DeskHeatmap weeks={WEEKS} />);
    const c = cell("Oct 1, 2026: 5 Tasks completed");
    fireEvent.focus(c);
    const tip = await screen.findByText("Oct 1, 2026", { selector: "div" });
    expect(tip).toBeInTheDocument();
    expect(screen.getAllByText("5 Tasks completed").length).toBeGreaterThan(0);
    fireEvent.keyDown(c, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Oct 1, 2026", { selector: "div" })).toBeNull());
    fireEvent.focus(c);
    await screen.findByText("Oct 1, 2026", { selector: "div" });
    fireEvent.blur(c);
    await waitFor(() => expect(screen.queryByText("Oct 1, 2026", { selector: "div" })).toBeNull());
  });

  it("words the tooltip for opened and empty days", async () => {
    render(<DeskHeatmap weeks={WEEKS} />);
    fireEvent.focus(cell("Sep 29, 2026: opened Yoh, no Tasks completed"));
    await screen.findByText("Opened Yoh, no Tasks completed");
    fireEvent.focus(cell("Sep 27, 2026: no activity"));
    await screen.findByText("No activity");
  });

  it("draws the five-step legend under a group label", () => {
    render(<DeskHeatmap weeks={WEEKS} />);
    const legend = screen.getByRole("group", { name: "Tasks completed" });
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["None", "Opened", "1–2", "3–4", "5+"]);
  });

  it("scrolls horizontally, opts out of wheel navigation, and animates unless motion is reduced", () => {
    const { rerender } = render(<DeskHeatmap weeks={WEEKS} />);
    const region = screen.getByRole("region", { name: /Activity heatmap, scrollable/ });
    expect(region).toHaveAttribute("data-wheel-nav", "off");
    expect(region.className).toContain("overflow-x-auto");
    expect(region).toHaveAttribute("data-animate", "true");
    reduced.mockReturnValue(true);
    rerender(<DeskHeatmap weeks={WEEKS} />);
    expect(screen.getByRole("region", { name: /Activity heatmap, scrollable/ })).toHaveAttribute("data-animate", "false");
  });
});
