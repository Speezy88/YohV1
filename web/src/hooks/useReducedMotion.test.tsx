import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReducedMotion } from "./useReducedMotion.ts";

function mockMatchMedia(matches: boolean): { listeners: Array<() => void>; mql: MediaQueryList } {
  const listeners: Array<() => void> = [];
  const mql = {
    matches,
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    removeEventListener: () => {},
  } as unknown as MediaQueryList;
  vi.spyOn(window, "matchMedia").mockReturnValue(mql);
  return { listeners, mql };
}

describe("useReducedMotion", () => {
  it("returns false when the OS has no reduced-motion preference", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("returns true when the OS prefers reduced motion", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("updates live if the OS preference changes mid-session", () => {
    const { listeners, mql } = mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    (mql as { matches: boolean }).matches = true;
    act(() => listeners.forEach((cb) => cb()));
    expect(result.current).toBe(true);
  });
});
