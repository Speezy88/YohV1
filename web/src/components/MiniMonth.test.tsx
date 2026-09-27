import { describe, it, expect } from "vitest";
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
});
