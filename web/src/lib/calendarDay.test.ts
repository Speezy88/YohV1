/**
 * web/src/lib/calendarDay.test.ts — Task 4 ("pick any day in Month to see
 * its calendar"): the per-date `GET /api/calendar/day` cache/hook.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as eventBus from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import { __resetCalendarDayForTests, retryCalendarDay, useCalendarDay } from "./calendarDay.ts";

vi.mock("./apiClient.ts", () => ({
  apiClient: { api: { calendar: { day: { $get: vi.fn() } } } },
}));

function mockGet(): ReturnType<typeof vi.fn> {
  return apiClient.api.calendar.day.$get as unknown as ReturnType<typeof vi.fn>;
}

describe("calendarDay store", () => {
  let hintCb: (hint: eventBus.EventBusHint) => void;

  beforeEach(() => {
    __resetCalendarDayForTests();
    vi.spyOn(eventBus, "onHint").mockImplementation((cb) => {
      hintCb = cb;
      return () => {};
    });
    mockGet().mockResolvedValue({
      json: async () => ({ ok: true, value: { date: "2026-09-29", blocks: [], timeZone: "America/New_York" } }),
    });
  });

  it("date undefined (today) never fetches, stays 'loading'", () => {
    const { result } = renderHook(() => useCalendarDay(undefined));
    expect(result.current.status).toBe("loading");
    expect(mockGet()).not.toHaveBeenCalled();
  });

  it("fetches once for a given date, then reports loaded", async () => {
    const { result } = renderHook(() => useCalendarDay("2026-09-29"));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(mockGet()).toHaveBeenCalledTimes(1);
    expect(mockGet()).toHaveBeenCalledWith({ query: { date: "2026-09-29" } });
  });

  it("caches per date for the session: a second mount of the same date shows the cached value instantly", async () => {
    const { result, unmount } = renderHook(() => useCalendarDay("2026-09-29"));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    unmount();

    const { result: result2 } = renderHook(() => useCalendarDay("2026-09-29"));
    // Task 8 (stale-while-revalidate): the cached value is visible the
    // instant this hook mounts again — never a flash back to "loading" —
    // even though a background refresh is also kicked off (below).
    expect(result2.current.status).toBe("loaded");
  });

  // ==========================================================================
  // Task 8: stale-while-revalidate — a re-selected, already-cached date
  // refreshes in the background rather than staying stuck on its first
  // fetch forever, since a confirmed Calendar edit can change that day's
  // blocks without this exact date ever getting its own "plan" hint (see
  // the "empty entityId" test below).
  // ==========================================================================

  it("re-selecting a cached date refetches in the background, keeping the cached data visible the whole time", async () => {
    const { result, unmount } = renderHook(() => useCalendarDay("2026-09-29"));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    unmount();
    expect(mockGet()).toHaveBeenCalledTimes(1);

    let resolveSecond: (value: unknown) => void = () => {
      throw new Error("resolveSecond called before assigned");
    };
    mockGet().mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)));

    const { result: result2 } = renderHook(() => useCalendarDay("2026-09-29"));
    // The background refetch has started (a second call), but the cached
    // value is still what's shown — never reset to "loading" while it's in
    // flight.
    expect(mockGet()).toHaveBeenCalledTimes(2);
    expect(result2.current.status).toBe("loaded");

    resolveSecond({ json: async () => ({ ok: true, value: { date: "2026-09-29", blocks: [], timeZone: "America/New_York" } }) });
    await waitFor(() => expect(result2.current.status).toBe("loaded"));
  });

  it("a different date fetches independently, each cached on its own", async () => {
    const { result: a } = renderHook(() => useCalendarDay("2026-09-29"));
    await waitFor(() => expect(a.current.status).toBe("loaded"));
    const { result: b } = renderHook(() => useCalendarDay("2026-09-30"));
    await waitFor(() => expect(b.current.status).toBe("loaded"));
    expect(mockGet()).toHaveBeenCalledTimes(2);
  });

  it("surfaces an {ok: false} envelope as an error state", async () => {
    mockGet().mockResolvedValue({ json: async () => ({ ok: false, error: { kind: "validation", message: "calendar/day: missing or invalid date" } }) });
    const { result } = renderHook(() => useCalendarDay("bad-date"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") expect(result.current.message).toMatch(/invalid date/);
  });

  it("a rejected fetch also surfaces as an error state, never an unhandled rejection", async () => {
    mockGet().mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useCalendarDay("2026-09-29"));
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("re-fetches a cached date on a 'plan' hint whose entityId matches that date, ignores others", async () => {
    const { result } = renderHook(() => useCalendarDay("2026-09-29"));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    act(() => hintCb({ seq: 1, topic: "plan", entityId: "2026-09-30" }));
    expect(mockGet()).toHaveBeenCalledTimes(1);
    act(() => hintCb({ seq: 2, topic: "plan", entityId: "2026-09-29" }));
    await waitFor(() => expect(mockGet()).toHaveBeenCalledTimes(2));
  });

  it("a 'plan' hint with no entityId (the edited event's date couldn't be derived) also refetches", async () => {
    const { result } = renderHook(() => useCalendarDay("2026-09-29"));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    act(() => hintCb({ seq: 1, topic: "plan", entityId: "" }));
    await waitFor(() => expect(mockGet()).toHaveBeenCalledTimes(2));
  });

  it("retryCalendarDay re-fetches the given date", async () => {
    mockGet().mockResolvedValue({ json: async () => ({ ok: false, error: { kind: "unreachable", message: "down" } }) });
    const { result } = renderHook(() => useCalendarDay("2026-09-29"));
    await waitFor(() => expect(result.current.status).toBe("error"));

    mockGet().mockResolvedValue({ json: async () => ({ ok: true, value: { date: "2026-09-29", blocks: [], timeZone: "America/New_York" } }) });
    act(() => retryCalendarDay("2026-09-29"));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
  });
});
