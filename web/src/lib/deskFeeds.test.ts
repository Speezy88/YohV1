/**
 * web/src/lib/deskFeeds.test.ts — the Desk feeds store: loads `GET /api/desk/feeds`, polls every 5 minutes
 * while visible, never when hidden or stopped, keeps data on a failed refetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { apiClient } from "./apiClient.ts";
import { __resetDeskFeedsForTests, startDeskFeedsStream, useDeskFeeds } from "./deskFeeds.ts";

vi.mock("./apiClient.ts", () => ({ apiClient: { api: { desk: { feeds: { $get: vi.fn() } } } } }));

const get = apiClient.api.desk.feeds.$get as unknown as ReturnType<typeof vi.fn>;
const VALUE = { timeZone: "UTC", crypto: { status: "ok", value: { tickers: [] }, fetchedAt: "2026-10-04T15:30:00.000Z" }, weather: { status: "unavailable" }, news: { status: "unavailable" } };
const setVisibility = (v: "visible" | "hidden") => Object.defineProperty(document, "visibilityState", { value: v, configurable: true });

describe("deskFeeds store", () => {
  const stops: Array<() => void> = [];
  afterEach(() => {
    stops.splice(0).forEach((s) => s());
    vi.useRealTimers();
    setVisibility("visible");
  });
  beforeEach(() => {
    __resetDeskFeedsForTests();
    get.mockReset();
    get.mockResolvedValue({ json: async () => ({ ok: true, value: VALUE }) });
    setVisibility("visible");
  });

  it("loads on start: loading then loaded", async () => {
    const { result } = renderHook(() => useDeskFeeds());
    expect(result.current.status).toBe("loading");
    stops.push(startDeskFeedsStream());
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("is an error state when the request fails and nothing was loaded", async () => {
    get.mockRejectedValue(new Error("secret"));
    const { result } = renderHook(() => useDeskFeeds());
    stops.push(startDeskFeedsStream());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(JSON.stringify(result.current)).not.toContain("secret");
  });

  it("keeps the last data when a later refetch fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useDeskFeeds());
    stops.push(startDeskFeedsStream());
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    get.mockRejectedValue(new Error("down"));
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("loaded");
  });

  it("polls every 5 minutes while visible", async () => {
    vi.useFakeTimers();
    stops.push(startDeskFeedsStream());
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("does not poll while the document is hidden", async () => {
    vi.useFakeTimers();
    setVisibility("hidden");
    stops.push(startDeskFeedsStream());
    await vi.advanceTimersByTimeAsync(0);
    const afterStart = get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(get).toHaveBeenCalledTimes(afterStart);
  });

  it("refetches when the document becomes visible again", async () => {
    vi.useFakeTimers();
    stops.push(startDeskFeedsStream());
    await vi.advanceTimersByTimeAsync(0);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(get).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("stops polling once stopped", async () => {
    vi.useFakeTimers();
    const stop = startDeskFeedsStream();
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
