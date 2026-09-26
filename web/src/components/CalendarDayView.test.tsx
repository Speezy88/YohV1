/**
 * web/src/components/CalendarDayView.test.tsx — Story 7.8, UX-DR32.
 *
 * Covers the AC directly: "Yoh-owned blocks (Work/Break, Task) render as
 * raised blocks; events Yoh didn't create render as fixed anchors:
 * cross-hatch, event-fixed-ink, label suffixed '(fixed)', no shadow;
 * completed and past blocks are visibly read-only."
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CalendarDayView } from "./CalendarDayView.tsx";
import type { HomeCalendarBlock } from "../../../src/types/api.ts";

function block(overrides: Partial<HomeCalendarBlock> & Pick<HomeCalendarBlock, "id" | "kind">): HomeCalendarBlock {
  return { label: "Block", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T14:00:00.000Z", completed: false, past: false, ...overrides };
}

describe("CalendarDayView", () => {
  it("renders caption-style hour labels and a structural rail", () => {
    render(<CalendarDayView blocks={[]} />);
    expect(screen.getByTestId("calendar-day-view")).toHaveClass("border-rim-structural");
    expect(screen.getByText(/6AM/)).toBeInTheDocument();
    expect(screen.getByText(/11PM/)).toBeInTheDocument();
  });

  it("a Yoh-owned work block renders as a raised block via the shadow-extruded-sm token utility (fix round 1, finding #3), surface-raised, no ' (fixed)' suffix", () => {
    render(<CalendarDayView blocks={[block({ id: "b1", kind: "work", label: "Draft the memo" })]} />);
    const el = screen.getByTestId("calendar-block");
    expect(el).toHaveClass("bg-surface-raised");
    expect(el).toHaveClass("shadow-extruded-sm");
    expect(el.className).not.toMatch(/shadow-\[/); // never a hard-coded shadow value — the token utility only
    expect(el.textContent).toBe("Draft the memo");
  });

  it("a non-Yoh fixed anchor renders cross-hatched, event-fixed-ink, no shadow, suffixed '(fixed)'", () => {
    render(<CalendarDayView blocks={[block({ id: "e1", kind: "fixed", label: "Soccer practice" })]} />);
    const el = screen.getByTestId("calendar-block");
    expect(el).toHaveClass("text-event-fixed-ink");
    expect(el).not.toHaveClass("bg-surface-raised");
    expect(el.className).not.toMatch(/shadow-/);
    expect(el.textContent).toBe("Soccer practice (fixed)");
  });

  it("a completed block is visibly read-only: aria-disabled and struck through", () => {
    render(<CalendarDayView blocks={[block({ id: "b1", kind: "work", completed: true })]} />);
    const el = screen.getByTestId("calendar-block");
    expect(el).toHaveAttribute("aria-disabled", "true");
    expect(el).toHaveClass("line-through");
  });

  it("a past (not completed) block is visibly read-only", () => {
    render(<CalendarDayView blocks={[block({ id: "b1", kind: "work", past: true })]} />);
    expect(screen.getByTestId("calendar-block")).toHaveAttribute("aria-disabled", "true");
  });

  it("Fix round 1 (finding #4): a PAST fixed (non-Yoh) anchor is visibly read-only, while keeping its cross-hatch/event-fixed-ink/no-shadow/'(fixed)' treatment", () => {
    render(<CalendarDayView blocks={[block({ id: "e1", kind: "fixed", label: "Soccer practice", past: true })]} />);
    const el = screen.getByTestId("calendar-block");
    expect(el).toHaveAttribute("aria-disabled", "true");
    expect(el).toHaveClass("opacity-60"); // the same visible dimming a past Yoh-owned block gets
    // Still a fixed anchor in every other respect — the read-only treatment never replaces it.
    expect(el).toHaveClass("text-event-fixed-ink");
    expect(el).not.toHaveClass("bg-surface-raised");
    expect(el.className).not.toMatch(/shadow-/);
    expect(el.textContent).toBe("Soccer practice (fixed)");
  });

  it("a current (not past, not completed) fixed anchor is NOT dimmed", () => {
    render(<CalendarDayView blocks={[block({ id: "e1", kind: "fixed" })]} />);
    expect(screen.getByTestId("calendar-block")).not.toHaveClass("opacity-60");
  });

  it("a current, not-completed block is not marked read-only", () => {
    render(<CalendarDayView blocks={[block({ id: "b1", kind: "work" })]} />);
    expect(screen.getByTestId("calendar-block")).toHaveAttribute("aria-disabled", "false");
  });

  it("renders every given block, in the given order — never re-sorted client-side", () => {
    render(
      <CalendarDayView
        blocks={[
          block({ id: "b2", kind: "work", label: "Second", start: "2026-09-25T14:00:00.000Z", end: "2026-09-25T15:00:00.000Z" }),
          block({ id: "b1", kind: "work", label: "First", start: "2026-09-25T13:00:00.000Z", end: "2026-09-25T13:30:00.000Z" }),
        ]}
      />,
    );
    const rendered = screen.getAllByTestId("calendar-block");
    expect(rendered.map((el) => el.textContent)).toEqual(["Second", "First"]);
  });
});
