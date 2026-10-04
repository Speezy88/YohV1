/**
 * web/src/lib/desk.test.ts — the Desk store: loads `GET /api/desk`, refetches
 * on a `tasks` (or `plan`) hint from the shared bus, keeps data on a failed refetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as eventBus from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import { __resetDeskForTests, refetchDesk, startDeskStream, useDesk } from "./desk.ts";

vi.mock("./apiClient.ts", () => ({ apiClient: { api: { desk: { $get: vi.fn() } } } }));

const get = apiClient.api.desk.$get as unknown as ReturnType<typeof vi.fn>;
const VALUE = { today: "2026-10-04", completedToday: [], minutesToday: 0, hoursWithYoh: 0, onTime: { onTime: 0, counted: 0, percent: null }, streak: { current: 0, longest: 0 }, heatmap: { weeks: [] }, spend: { monthUsd: 0, unpricedCalls: 0 } };

describe("desk store", () => {
  let hintCb: (hint: eventBus.EventBusHint) => void;
  const stops: Array<() => void> = [];
  afterEach(() => stops.splice(0).forEach((s) => s()));
  beforeEach(() => {
    __resetDeskForTests();
    get.mockReset();
    get.mockResolvedValue({ json: async () => ({ ok: true, value: VALUE }) });
    vi.spyOn(eventBus, "onHint").mockImplementation((cb) => {
      hintCb = cb;
      return () => {};
    });
  });

  it("loads once on start and exposes loading then loaded", async () => {
    const { result } = renderHook(() => useDesk());
    expect(result.current.status).toBe("loading");
    stops.push(startDeskStream());
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error when there is no data yet", async () => {
    get.mockResolvedValue({ json: async () => ({ ok: false, error: { message: "Nope." } }) });
    const { result } = renderHook(() => useDesk());
    stops.push(startDeskStream());
    await waitFor(() => expect(result.current).toEqual({ status: "error", message: "Nope." }));
  });

  it("refetches on a tasks hint and a plan hint, not others", async () => {
    stops.push(startDeskStream());
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    act(() => hintCb({ seq: 1, topic: "notification", entityId: "x" }));
    expect(get).toHaveBeenCalledTimes(1);
    act(() => hintCb({ seq: 2, topic: "tasks", entityId: "t" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    act(() => hintCb({ seq: 3, topic: "plan", entityId: "p" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  });

  it("keeps the data when a refetch fails", async () => {
    const { result } = renderHook(() => useDesk());
    stops.push(startDeskStream());
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    get.mockRejectedValue(new Error("boom"));
    await act(async () => {
      await refetchDesk();
    });
    expect(result.current.status).toBe("loaded");
    if (result.current.status === "loaded") expect(result.current.refreshFailed).toBeDefined();
  });

  it("an older response never overwrites a newer one", async () => {
    const older = VALUE;
    const newer = { ...VALUE, minutesToday: 99 };
    let resolveOlder!: (v: unknown) => void;
    get.mockReturnValueOnce(new Promise((r) => (resolveOlder = r)));
    get.mockResolvedValueOnce({ json: async () => ({ ok: true, value: newer }) });
    const { result } = renderHook(() => useDesk());
    const first = refetchDesk();
    await refetchDesk();
    expect(result.current.status === "loaded" && result.current.value.minutesToday).toBe(99);
    resolveOlder({ json: async () => ({ ok: true, value: older }) });
    await first;
    expect(result.current.status === "loaded" && result.current.value.minutesToday).toBe(99);
  });
});
