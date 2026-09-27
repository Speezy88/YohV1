import { describe, it, expect } from "vitest";
import { isAtVerticalScrollEdge } from "./wheelNav.ts";

function scrollable(overrides: { scrollHeight: number; clientHeight: number; scrollTop: number }): HTMLDivElement {
  const el = document.createElement("div");
  el.style.overflowY = "auto";
  Object.defineProperty(el, "scrollHeight", { value: overrides.scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: overrides.clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: overrides.scrollTop, configurable: true });
  return el;
}

describe("isAtVerticalScrollEdge", () => {
  it("is true (trivially) for a plain element with no scrollable ancestor", () => {
    const root = document.createElement("div");
    const child = document.createElement("span");
    root.appendChild(child);
    expect(isAtVerticalScrollEdge(child, root, 1)).toBe(true);
    expect(isAtVerticalScrollEdge(child, root, -1)).toBe(true);
  });

  it("is false scrolling down (direction 1) when a scrollable ancestor has room below", () => {
    const root = document.createElement("div");
    const scroll = scrollable({ scrollHeight: 1000, clientHeight: 300, scrollTop: 200 });
    const child = document.createElement("span");
    scroll.appendChild(child);
    root.appendChild(scroll);
    expect(isAtVerticalScrollEdge(child, root, 1)).toBe(false);
  });

  it("is true scrolling down once the scrollable ancestor has reached its bottom edge", () => {
    const root = document.createElement("div");
    const scroll = scrollable({ scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    const child = document.createElement("span");
    scroll.appendChild(child);
    root.appendChild(scroll);
    expect(isAtVerticalScrollEdge(child, root, 1)).toBe(true);
  });

  it("is false scrolling up (direction -1) when a scrollable ancestor isn't at its top edge", () => {
    const root = document.createElement("div");
    const scroll = scrollable({ scrollHeight: 1000, clientHeight: 300, scrollTop: 50 });
    const child = document.createElement("span");
    scroll.appendChild(child);
    root.appendChild(scroll);
    expect(isAtVerticalScrollEdge(child, root, -1)).toBe(false);
  });

  it("is true scrolling up once the scrollable ancestor is at its top edge", () => {
    const root = document.createElement("div");
    const scroll = scrollable({ scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
    const child = document.createElement("span");
    scroll.appendChild(child);
    root.appendChild(scroll);
    expect(isAtVerticalScrollEdge(child, root, -1)).toBe(true);
  });

  it("stops walking at root — a scrollable ancestor OUTSIDE root doesn't count", () => {
    const outer = scrollable({ scrollHeight: 1000, clientHeight: 300, scrollTop: 200 });
    const root = document.createElement("div");
    const child = document.createElement("span");
    root.appendChild(child);
    outer.appendChild(root);
    expect(isAtVerticalScrollEdge(child, root, 1)).toBe(true);
  });

  it("an overflow-y:auto ancestor with no real overflow (scrollHeight === clientHeight) doesn't count — falls through to 'no scrollable ancestor'", () => {
    const root = document.createElement("div");
    const notActuallyScrollable = scrollable({ scrollHeight: 200, clientHeight: 200, scrollTop: 0 });
    const child = document.createElement("span");
    notActuallyScrollable.appendChild(child);
    root.appendChild(notActuallyScrollable);
    expect(isAtVerticalScrollEdge(child, root, 1)).toBe(true);
  });
});
