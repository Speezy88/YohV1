import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { SCREENSAVER_IDLE_MS, useIdleScreensaver } from "./idle.ts";

describe("useIdleScreensaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("SCREENSAVER_IDLE_MS is 10 minutes", () => {
    expect(SCREENSAVER_IDLE_MS).toBe(10 * 60 * 1000);
  });

  it("is false initially, true after SCREENSAVER_IDLE_MS with no input", () => {
    const { result } = renderHook(() => useIdleScreensaver());
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(SCREENSAVER_IDLE_MS));
    expect(result.current).toBe(true);
  });

  it("any input (key, pointer move, scroll) before the timeout resets it", () => {
    const { result } = renderHook(() => useIdleScreensaver());
    act(() => vi.advanceTimersByTime(SCREENSAVER_IDLE_MS - 1000));
    act(() => window.dispatchEvent(new Event("pointermove")));
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(false);
  });

  it("any input after going idle dismisses it", () => {
    const { result } = renderHook(() => useIdleScreensaver());
    act(() => vi.advanceTimersByTime(SCREENSAVER_IDLE_MS));
    expect(result.current).toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown")));
    expect(result.current).toBe(false);
  });
});
