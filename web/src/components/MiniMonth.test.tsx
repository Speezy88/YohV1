import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MiniMonth } from "./MiniMonth.tsx";

describe("MiniMonth", () => {
  it("renders the month/year heading for today's month", () => {
    render(<MiniMonth today="2026-09-27" />);
    expect(screen.getByText("September 2026")).toBeInTheDocument();
  });

  it("highlights today's day number", () => {
    render(<MiniMonth today="2026-09-27" />);
    expect(screen.getByLabelText("Today, September 27")).toHaveTextContent("27");
  });

  it("Next month advances the grid and today is no longer highlighted", () => {
    render(<MiniMonth today="2026-09-27" />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Today,/)).not.toBeInTheDocument();
  });

  it("Previous month then Next month returns to today's highlighted month", () => {
    render(<MiniMonth today="2026-09-27" />);
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    expect(screen.getByLabelText("Today, September 27")).toBeInTheDocument();
  });

  it("December -> January rolls the year forward", () => {
    render(<MiniMonth today="2026-12-15" />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("January 2027")).toBeInTheDocument();
  });

  // Task 4 (2026-09-27, "I cant see my google calendar on other days when i
  // select a day on the month view. it just reverts back to day"):
  // `onSelectDay` now carries the clicked day's own ISO date, not a no-arg
  // "go back to Day" signal.
  it("clicking today's day cell calls onSelectDay with today's own ISO date", () => {
    const onSelectDay = vi.fn();
    render(<MiniMonth today="2026-09-27" onSelectDay={onSelectDay} />);
    fireEvent.click(screen.getByLabelText("Today, September 27"));
    expect(onSelectDay).toHaveBeenCalledTimes(1);
    expect(onSelectDay).toHaveBeenCalledWith("2026-09-27");
  });

  it("clicking a non-today day cell calls onSelectDay with THAT day's ISO date", () => {
    const onSelectDay = vi.fn();
    render(<MiniMonth today="2026-09-27" onSelectDay={onSelectDay} />);
    fireEvent.click(screen.getByLabelText("September 15"));
    expect(onSelectDay).toHaveBeenCalledTimes(1);
    expect(onSelectDay).toHaveBeenCalledWith("2026-09-15");
  });

  it("clicking a day cell in a navigated (non-current) month calls onSelectDay with that month's own ISO date", () => {
    const onSelectDay = vi.fn();
    render(<MiniMonth today="2026-09-27" onSelectDay={onSelectDay} />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByLabelText("October 15"));
    expect(onSelectDay).toHaveBeenCalledTimes(1);
    expect(onSelectDay).toHaveBeenCalledWith("2026-10-15");
  });

  it("with no onSelectDay given, a day click doesn't throw", () => {
    render(<MiniMonth today="2026-09-27" />);
    expect(() => fireEvent.click(screen.getByLabelText("September 15"))).not.toThrow();
  });

  it("marks only today's button aria-current=date", () => {
    render(<MiniMonth today="2026-09-27" />);
    expect(screen.getByLabelText("Today, September 27")).toHaveAttribute("aria-current", "date");
    expect(screen.getByLabelText("September 15")).not.toHaveAttribute("aria-current");
  });

  it("weekday header cells carry full-name accessible text", () => {
    render(<MiniMonth today="2026-09-27" />);
    for (const name of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("month arrows and day buttons show the shared focus ring and hover state", () => {
    render(<MiniMonth today="2026-09-27" />);
    for (const el of [screen.getByRole("button", { name: "Next month" }), screen.getByLabelText("September 15")]) {
      expect(el.className).toContain("focus-visible:outline-accent-solid");
      expect(el.className).toMatch(/hover:/);
    }
  });
});
