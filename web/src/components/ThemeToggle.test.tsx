import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { FOCUS_RING } from "../lib/controlStyles.ts";

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("clicking flips data-theme and persists the choice", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /mode/i });
    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toMatch(/light|dark/);
    expect(localStorage.getItem("yoh-theme")).toBe(document.documentElement.dataset.theme);
  });

  it("a second click flips back", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: /mode/i });
    fireEvent.click(button);
    const first = document.documentElement.dataset.theme;
    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).not.toBe(first);
  });

  it("has an accessible name (aria-label) at all times", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveAccessibleName();
  });

  // Fix round (2026-09-27 review): the visible label names the action
  // (what clicking does next), matching the aria-label — not the current
  // state.
  it("while light, the visible label reads 'Dark mode' and the accessible name matches it", () => {
    localStorage.setItem("yoh-theme", "light");
    render(<ThemeToggle />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Dark mode");
    expect(button).toHaveAccessibleName("Dark mode");
  });

  it("while dark, the visible label reads 'Light mode' and the accessible name matches it", () => {
    localStorage.setItem("yoh-theme", "dark");
    render(<ThemeToggle />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Light mode");
    expect(button).toHaveAccessibleName("Light mode");
  });

  it("clicking flips the visible label to name the NEW action", () => {
    localStorage.setItem("yoh-theme", "light");
    render(<ThemeToggle />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(button).toHaveTextContent("Light mode");
    expect(button).toHaveAccessibleName("Light mode");
  });

  it("has the shared focus ring", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button").className).toContain(FOCUS_RING);
  });
});
