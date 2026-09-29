/**
 * web/src/lib/visibleRefresh.test.ts — hotfix: Home's calendar missed
 * changes made directly in Google Calendar until a reload. A store refreshes
 * when the tab regains focus or becomes visible, and polls every
 * `VISIBLE_REFRESH_INTERVAL_MS` only while the tab is visible.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VISIBLE_REFRESH_INTERVAL_MS, onVisibleRefresh } from "./visibleRefresh.ts";

let visibility: DocumentVisibilityState = "visible";

function setVisibility(v: DocumentVisibilityState): void {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("onVisibleRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls every five minutes", () => {
    expect(VISIBLE_REFRESH_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it("refreshes on window focus", () => {
    const refresh = vi.fn();
    const stop = onVisibleRefresh(refresh);
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("refreshes when the tab becomes visible, not when it is hidden", () => {
    const refresh = vi.fn();
    const stop = onVisibleRefresh(refresh);
    setVisibility("hidden");
    expect(refresh).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("polls while visible", () => {
    const refresh = vi.fn();
    const stop = onVisibleRefresh(refresh);
    vi.advanceTimersByTime(VISIBLE_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(VISIBLE_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops polling while hidden and resumes when visible again", () => {
    const refresh = vi.fn();
    const stop = onVisibleRefresh(refresh);
    setVisibility("hidden");
    vi.advanceTimersByTime(VISIBLE_REFRESH_INTERVAL_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(VISIBLE_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("does not poll when started in a hidden tab", () => {
    visibility = "hidden";
    const refresh = vi.fn();
    const stop = onVisibleRefresh(refresh);
    vi.advanceTimersByTime(VISIBLE_REFRESH_INTERVAL_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });

  it("removes its listeners and timer on stop", () => {
    const refresh = vi.fn();
    const stop = onVisibleRefresh(refresh);
    stop();
    window.dispatchEvent(new Event("focus"));
    setVisibility("hidden");
    setVisibility("visible");
    vi.advanceTimersByTime(VISIBLE_REFRESH_INTERVAL_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
