import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageIndicator } from "./PageIndicator.tsx";

describe("PageIndicator", () => {
  it("renders four dots, each with an accessible name, the active one marked aria-current", () => {
    const goTo = vi.fn();
    render(<PageIndicator index={1} goTo={goTo} />);
    const dots = screen.getAllByRole("button");
    expect(dots).toHaveLength(4);
    expect(dots[1]).toHaveAttribute("aria-current", "page");
    expect(dots[0]).not.toHaveAttribute("aria-current");
    expect(dots[1]).toHaveAccessibleName(/chat/i);
  });

  it("clicking a dot calls goTo with that page's index", () => {
    const goTo = vi.fn();
    render(<PageIndicator index={0} goTo={goTo} />);
    screen.getAllByRole("button")[2]!.click();
    expect(goTo).toHaveBeenCalledWith(2);
  });

  it("announces the current page via an aria-live region", () => {
    render(<PageIndicator index={1} goTo={() => {}} />);
    expect(screen.getByText("Chat, page 2 of 4")).toHaveAttribute("aria-live", "polite");
  });
});
