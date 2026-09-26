import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Screensaver } from "./Screensaver.tsx";
import * as reducedMotionModule from "../hooks/useReducedMotion.ts";

describe("Screensaver", () => {
  it("shows the Yoh Meeseek wordmark and no data", () => {
    render(<Screensaver variant="splash" />);
    expect(screen.getByText("Yoh Meeseek")).toBeInTheDocument();
  });

  it("the dot field is static under reduced motion", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(true);
    render(<Screensaver variant="idle" />);
    const dots = screen.getByTestId("screensaver-dots");
    expect(dots).toHaveAttribute("data-animated", "false");
  });

  it("the dot field animates when motion is not reduced", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(false);
    render(<Screensaver variant="idle" />);
    expect(screen.getByTestId("screensaver-dots")).toHaveAttribute("data-animated", "true");
  });

  it("the idle variant is an accessible dialog overlay; the splash variant is not (it's the initial paint, not a modal)", () => {
    const { unmount } = render(<Screensaver variant="idle" />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    unmount();
    render(<Screensaver variant="splash" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
