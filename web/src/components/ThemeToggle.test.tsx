import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle.tsx";

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("clicking flips data-theme and persists the choice", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /theme/i });
    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toMatch(/light|dark/);
    expect(localStorage.getItem("yoh-theme")).toBe(document.documentElement.dataset.theme);
  });

  it("a second click flips back", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /theme/i });
    fireEvent.click(button);
    const first = document.documentElement.dataset.theme;
    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).not.toBe(first);
  });

  it("has an accessible name (aria-label) at all times", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveAccessibleName();
  });
});
