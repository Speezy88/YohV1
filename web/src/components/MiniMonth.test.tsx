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

  // Polish-2: this task's brief — "Clicking a day in Month switches back to
  // Day"; only today's data exists client-side, so any day click just
  // means "go back to Day," never a fake other-day view.
  it("clicking today's day cell calls onSelectDay", () => {
    const onSelectDay = vi.fn();
    render(<MiniMonth today="2026-09-27" onSelectDay={onSelectDay} />);
    fireEvent.click(screen.getByLabelText("Today, September 27"));
    expect(onSelectDay).toHaveBeenCalledTimes(1);
  });

  it("clicking a non-today day cell ALSO calls onSelectDay — a click never fakes another day's data", () => {
    const onSelectDay = vi.fn();
    render(<MiniMonth today="2026-09-27" onSelectDay={onSelectDay} />);
    fireEvent.click(screen.getByLabelText("September 15"));
    expect(onSelectDay).toHaveBeenCalledTimes(1);
  });

  it("with no onSelectDay given, a day click doesn't throw", () => {
    render(<MiniMonth today="2026-09-27" />);
    expect(() => fireEvent.click(screen.getByLabelText("September 15"))).not.toThrow();
  });
});
