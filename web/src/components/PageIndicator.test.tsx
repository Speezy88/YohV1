import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageIndicator } from "./PageIndicator.tsx";

describe("PageIndicator", () => {
  it("announces the current page via a visually-hidden aria-live region", () => {
    render(<PageIndicator index={1} />);
    expect(screen.getByText("Tasks, page 2 of 5")).toHaveAttribute("aria-live", "polite");
  });

  it("renders no visible dots or buttons — navigation lives in the sidebar now (Task 6A)", () => {
    render(<PageIndicator index={0} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
