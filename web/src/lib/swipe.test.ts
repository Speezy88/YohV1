import { describe, it, expect } from "vitest";
import { isInsideHorizontallyScrollable } from "./swipe.ts";

describe("isInsideHorizontallyScrollable", () => {
  it("is false for a plain element with no scrollable ancestor", () => {
    const root = document.createElement("div");
    const child = document.createElement("span");
    root.appendChild(child);
    expect(isInsideHorizontallyScrollable(child, root)).toBe(false);
  });

  it("is true when an ancestor up to root has overflow-x auto/scroll and real overflow", () => {
    const root = document.createElement("div");
    const scrollable = document.createElement("div");
    scrollable.style.overflowX = "auto";
    Object.defineProperty(scrollable, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(scrollable, "clientWidth", { value: 200, configurable: true });
    const child = document.createElement("span");
    scrollable.appendChild(child);
    root.appendChild(scrollable);
    expect(isInsideHorizontallyScrollable(child, root)).toBe(true);
  });

  it("stops walking at root — a scrollable ancestor OUTSIDE root doesn't count", () => {
    const outer = document.createElement("div");
    outer.style.overflowX = "auto";
    Object.defineProperty(outer, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(outer, "clientWidth", { value: 200, configurable: true });
    const root = document.createElement("div");
    const child = document.createElement("span");
    root.appendChild(child);
    outer.appendChild(root);
    expect(isInsideHorizontallyScrollable(child, root)).toBe(false);
  });

  it("an overflow-x:auto ancestor with no real overflow (scrollWidth === clientWidth) doesn't count", () => {
    const root = document.createElement("div");
    const notActuallyScrollable = document.createElement("div");
    notActuallyScrollable.style.overflowX = "auto";
    Object.defineProperty(notActuallyScrollable, "scrollWidth", { value: 200, configurable: true });
    Object.defineProperty(notActuallyScrollable, "clientWidth", { value: 200, configurable: true });
    const child = document.createElement("span");
    notActuallyScrollable.appendChild(child);
    root.appendChild(notActuallyScrollable);
    expect(isInsideHorizontallyScrollable(child, root)).toBe(false);
  });
});
