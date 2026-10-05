import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LaunchSplash } from "./LaunchSplash.tsx";
import * as reducedMotionModule from "../hooks/useReducedMotion.ts";

describe("LaunchSplash", () => {
  it("shows the Yoh Meeseek wordmark and no data", () => {
    render(<LaunchSplash />);
    expect(screen.getByText("Yoh Meeseek")).toBeInTheDocument();
  });

  it("the dot field is static under reduced motion", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(true);
    render(<LaunchSplash />);
    const dots = screen.getByTestId("splash-dots");
    expect(dots).toHaveAttribute("data-animated", "false");
  });

  it("the dot field animates when motion is not reduced", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
    render(<LaunchSplash />);
    expect(screen.getByTestId("splash-dots")).toHaveAttribute("data-animated", "true");
  });

  it("is not a dialog (it's the initial paint, not a modal)", () => {
    render(<LaunchSplash />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
