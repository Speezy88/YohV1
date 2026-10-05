import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LaunchSplash } from "./LaunchSplash.tsx";

describe("LaunchSplash", () => {
  it("shows the Meeseek wordmark and nothing else", () => {
    const { container } = render(<LaunchSplash />);
    expect(screen.getByText("Meeseek")).toBeInTheDocument();
    expect(container.firstElementChild?.childElementCount).toBe(0);
  });

  it("is not a dialog (it's the initial paint, not a modal)", () => {
    render(<LaunchSplash />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
