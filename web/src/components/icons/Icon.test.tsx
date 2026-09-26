import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Icon } from "./Icon.tsx";

describe("Icon", () => {
  it("renders an accessible name from `label`", () => {
    render(<Icon path="M0 0 L10 10" label="Chat" />);
    expect(screen.getByRole("img", { name: "Chat" })).toBeInTheDocument();
  });

  it("uses a 1.8px stroke (UX-DR47)", () => {
    render(<Icon path="M0 0 L10 10" label="Chat" />);
    const svg = screen.getByRole("img", { name: "Chat" });
    expect(svg.querySelector("path")).toHaveAttribute("stroke-width", "1.8");
  });

  it("active uses accent-solid; neutral uses ink-secondary", () => {
    const { rerender } = render(<Icon path="M0 0" label="Chat" />);
    expect(screen.getByRole("img", { name: "Chat" })).toHaveClass("stroke-ink-secondary");
    rerender(<Icon path="M0 0" label="Chat" active />);
    expect(screen.getByRole("img", { name: "Chat" })).toHaveClass("stroke-accent-solid");
  });
});
