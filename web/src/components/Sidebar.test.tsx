/**
 * web/src/components/Sidebar.test.tsx — Task 6A, DESIGN.md `nav-sidebar`.
 * The wordmark, a link per PAGES with the active one in the gradient pill,
 * the up/down arrow buttons (disabling at either end), and the Theme
 * Toggle. Real navigation (index tracking) is covered end-to-end by
 * `PageShell.test.tsx`; this file covers the sidebar's own rendering
 * contract in isolation.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar.tsx";
import { FOCUS_RING } from "../lib/controlStyles.ts";
import { PageNavigationContext } from "../lib/navigationContext.tsx";
import type { PageNavigation } from "../lib/pages.ts";

function renderWithNav(nav: PageNavigation) {
  return render(
    <PageNavigationContext.Provider value={nav}>
      <Sidebar />
    </PageNavigationContext.Provider>,
  );
}

describe("Sidebar", () => {
  it("shows the Yoh wordmark", () => {
    renderWithNav({ index: 0, goTo: vi.fn(), next: vi.fn(), prev: vi.fn() });
    expect(screen.getByText("Yoh")).toBeInTheDocument();
  });

  it("the active item sets one weight (bold) and the inactive items set one (medium); never both", () => {
    renderWithNav({ index: 1, goTo: vi.fn(), next: vi.fn(), prev: vi.fn() });
    const active = screen.getByRole("button", { name: /^tasks$/i });
    const inactive = screen.getByRole("button", { name: /^home$/i });
    expect(active).toHaveClass("font-bold");
    expect(active).not.toHaveClass("font-medium");
    expect(inactive).toHaveClass("font-medium");
    expect(inactive).not.toHaveClass("font-bold");
  });

  it("renders a link for every page, the active one marked aria-current", () => {
    renderWithNav({ index: 1, goTo: vi.fn(), next: vi.fn(), prev: vi.fn() });
    expect(screen.getByRole("button", { name: /^tasks$/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /^home$/i })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: /^desk$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /research hub/i })).toBeInTheDocument();
  });

  it("clicking a link calls goTo with that page's index", () => {
    const goTo = vi.fn();
    renderWithNav({ index: 0, goTo, next: vi.fn(), prev: vi.fn() });
    screen.getByRole("button", { name: /research hub/i }).click();
    expect(goTo).toHaveBeenCalledWith(3);
  });

  it("the up arrow is disabled on the first page; the down arrow calls next()", () => {
    const next = vi.fn();
    renderWithNav({ index: 0, goTo: vi.fn(), next, prev: vi.fn() });
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    screen.getByRole("button", { name: "Next page" }).click();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("the down arrow is disabled on the last page; the up arrow calls prev()", () => {
    const prev = vi.fn();
    renderWithNav({ index: 4, goTo: vi.fn(), next: vi.fn(), prev });
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    screen.getByRole("button", { name: "Previous page" }).click();
    expect(prev).toHaveBeenCalledTimes(1);
  });

  it("renders the Theme Toggle", () => {
    renderWithNav({ index: 0, goTo: vi.fn(), next: vi.fn(), prev: vi.fn() });
    expect(screen.getByRole("button", { name: /(dark|light) mode/i })).toBeInTheDocument();
  });

  it("announces the current page via the visually-hidden live region", () => {
    renderWithNav({ index: 2, goTo: vi.fn(), next: vi.fn(), prev: vi.fn() });
    expect(screen.getByText("Desk, page 3 of 5")).toBeInTheDocument();
  });

  it("nav items and arrow buttons carry the focus ring; inactive items hover to bg-surface-sunken", () => {
    renderWithNav({ index: 0, goTo: vi.fn(), next: vi.fn(), prev: vi.fn() });
    const inactive = screen.getByRole("button", { name: "Tasks" });
    expect(inactive.className).toContain(FOCUS_RING);
    expect(inactive.className).toContain("hover:bg-surface-sunken");
    expect(screen.getByRole("button", { name: "Previous page" }).className).toContain(FOCUS_RING);
    expect(screen.getByRole("button", { name: "Next page" }).className).toContain(FOCUS_RING);
  });
});
