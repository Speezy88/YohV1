import { describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import { render } from "@testing-library/react";
import { isAtVerticalScrollEdge, useWheelPageNavigation } from "./wheelNav.ts";

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

// ---------------------------------------------------------------------
// Polish-2 ("I do not want to be able to scroll pages while my cursor is
// in the tasks section"): `data-wheel-nav="off"` makes useWheelPageNavigation
// ignore a wheel gesture entirely — no navigate, no preventDefault — even
// when the gesture is at a scroll edge (which would otherwise navigate).
// ---------------------------------------------------------------------

function Harness({ onNavigate }: { readonly onNavigate: (direction: 1 | -1) => void }): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  useWheelPageNavigation(rootRef, onNavigate);
  return (
    <div ref={rootRef} data-testid="root">
      <div data-wheel-nav="off" data-testid="opted-out">
        <span data-testid="inside-opt-out" />
      </div>
      <span data-testid="outside-opt-out" />
    </div>
  );
}

function fireWheel(target: Element, deltaY: number): boolean {
  const event = new WheelEvent("wheel", { deltaY, deltaX: 0, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("useWheelPageNavigation — data-wheel-nav=\"off\" opt-out", () => {
  it("a wheel gesture inside a data-wheel-nav=\"off\" subtree, at the scroll edge, calls neither navigate nor preventDefault", () => {
    const onNavigate = vi.fn();
    const { getByTestId } = render(<Harness onNavigate={onNavigate} />);
    const prevented = fireWheel(getByTestId("inside-opt-out"), 100); // no scrollable ancestor => trivially "at the edge"
    expect(onNavigate).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it("outside the opt-out subtree, existing edge-aware navigation behavior is unchanged", () => {
    const onNavigate = vi.fn();
    const { getByTestId } = render(<Harness onNavigate={onNavigate} />);
    const prevented = fireWheel(getByTestId("outside-opt-out"), 100);
    expect(onNavigate).toHaveBeenCalledWith(1);
    expect(prevented).toBe(true);
  });
});
