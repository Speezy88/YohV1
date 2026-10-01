/**
 * web/src/lib/homeView.test.ts
 *
 * Story 7.8: the `useSyncExternalStore` Home-view store — fetches
 * `GET /api/home` once on start, then re-fetches only on a `topic: "plan"`
 * hint from the shared event bus (`eventBus.ts`), ignoring every other
 * topic (e.g. `"notification"`, which `notifications.ts` owns).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as eventBus from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import { __resetHomeViewForTests, startHomeViewStream, useHomeView } from "./homeView.ts";

vi.mock("./apiClient.ts", () => ({
  apiClient: { api: { home: { $get: vi.fn() }, plan: { sync: { $post: vi.fn() } } } },
}));

describe("homeView store", () => {
  let hintCb: (hint: eventBus.EventBusHint) => void;
  const stops: Array<() => void> = [];

  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
  });

  beforeEach(() => {
    __resetHomeViewForTests();
    vi.spyOn(eventBus, "onHint").mockImplementation((cb) => {
      hintCb = cb;
      return () => {};
    });
    (apiClient.api.home.$get as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, value: { today: "2026-09-25", plan: undefined, calendar: { blocks: [] } } }),
    });
  });

  it("fetches once on start", async () => {
    stops.push(startHomeViewStream());
    await waitFor(() => expect(apiClient.api.home.$get).toHaveBeenCalledTimes(1));
  });

  it("re-fetches on a topic:'plan' hint, ignores other topics", async () => {
    stops.push(startHomeViewStream());
    await waitFor(() => expect(apiClient.api.home.$get).toHaveBeenCalledTimes(1));
    act(() => hintCb({ seq: 1, topic: "notification", entityId: "x" }));
    expect(apiClient.api.home.$get).toHaveBeenCalledTimes(1);
    act(() => hintCb({ seq: 2, topic: "plan", entityId: "2026-09-25" }));
    await waitFor(() => expect(apiClient.api.home.$get).toHaveBeenCalledTimes(2));
  });

  it("re-fetches on an 'open-items' hint", async () => {
    stops.push(startHomeViewStream());
    await waitFor(() => expect(apiClient.api.home.$get).toHaveBeenCalledTimes(1));
    act(() => hintCb({ seq: 3, topic: "open-items", entityId: "proposal:p1" }));
    await waitFor(() => expect(apiClient.api.home.$get).toHaveBeenCalledTimes(2));
  });

  it("useHomeView exposes loading, then loaded", async () => {
    const { result } = renderHook(() => useHomeView());
    expect(result.current.status).toBe("loading");
    stops.push(startHomeViewStream());
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    if (result.current.status === "loaded") {
      expect(result.current.value.today).toBe("2026-09-25");
    }
  });

  it("surfaces an {ok: false} envelope as an error state", async () => {
    (apiClient.api.home.$get as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: false, error: { kind: "unreachable", message: "server: home-view dependencies not configured" } }),
    });
    const { result } = renderHook(() => useHomeView());
    stops.push(startHomeViewStream());
    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") {
      expect(result.current.message).toMatch(/not configured/);
    }
  });

  it("a rejected fetch request also surfaces as an error state, never an unhandled rejection", async () => {
    (apiClient.api.home.$get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useHomeView());
    stops.push(startHomeViewStream());
    await waitFor(() => expect(result.current.status).toBe("error"));
    // A thrown error's own text is never stored: fixed copy only.
    expect(JSON.stringify(result.current)).not.toContain("network down");
  });

  it("a failed refetch after a successful load keeps the loaded value and sets refreshFailed; the next success clears it", async () => {
    const home = apiClient.api.home.$get as ReturnType<typeof vi.fn>;
    const { result } = renderHook(() => useHomeView());
    stops.push(startHomeViewStream());
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    home.mockRejectedValueOnce(new Error("network down"));
    act(() => hintCb({ seq: 1, topic: "plan", entityId: "x" }));
    await waitFor(() => expect(result.current.status === "loaded" && result.current.refreshFailed !== undefined).toBe(true));
    if (result.current.status === "loaded") {
      expect(result.current.value.today).toBe("2026-09-25");
      expect(result.current.refreshFailed?.at).toBeInstanceOf(Date);
      expect(JSON.stringify(result.current.refreshFailed)).not.toContain("network down");
    }
    act(() => hintCb({ seq: 2, topic: "plan", entityId: "x" }));
    await waitFor(() => expect(result.current.status === "loaded" && result.current.refreshFailed === undefined).toBe(true));
  });

  it("refreshFailed.at is the last successful load and does not advance on repeated failures", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 8, 25, 8, 0));
      const home = apiClient.api.home.$get as ReturnType<typeof vi.fn>;
      const { result } = renderHook(() => useHomeView());
      stops.push(startHomeViewStream());
      await waitFor(() => expect(result.current.status).toBe("loaded"));
      home.mockRejectedValue(new Error("network down"));
      vi.setSystemTime(new Date(2026, 8, 25, 9, 5));
      act(() => hintCb({ seq: 1, topic: "plan", entityId: "x" }));
      await waitFor(() => expect(result.current.status === "loaded" && result.current.refreshFailed !== undefined).toBe(true));
      vi.setSystemTime(new Date(2026, 8, 25, 10, 30));
      act(() => hintCb({ seq: 2, topic: "plan", entityId: "x" }));
      await new Promise((r) => setTimeout(r, 20));
      const s = result.current;
      expect(s.status === "loaded" && s.refreshFailed?.at.getTime()).toBe(new Date(2026, 8, 25, 8, 0).getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-fetches when the tab regains focus, and stops after the stream stops", async () => {
    const stop = startHomeViewStream();
    await waitFor(() => expect(apiClient.api.home.$get).toHaveBeenCalledTimes(1));
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(apiClient.api.home.$get).toHaveBeenCalledTimes(2));
    stop();
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(apiClient.api.home.$get).toHaveBeenCalledTimes(2);
  });
  it("syncs the Yoh Plan calendar before refetching on focus, but not on the initial load", async () => {
    const order: string[] = [];
    const sync = apiClient.api.plan.sync.$post as ReturnType<typeof vi.fn>;
    const home = apiClient.api.home.$get as ReturnType<typeof vi.fn>;
    sync.mockReset().mockImplementation(async () => { order.push("sync"); return { ok: true }; });
    home.mockReset().mockImplementation(async () => { order.push("home"); return { ok: true, json: async () => ({ ok: false, error: { kind: "unreachable", message: "x" } }) }; });
    const stop = startHomeViewStream();
    await waitFor(() => expect(home).toHaveBeenCalledTimes(1));
    expect(sync).not.toHaveBeenCalled();
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(home).toHaveBeenCalledTimes(2));
    expect(order).toEqual(["home", "sync", "home"]);
    stop();
  });

  it("still refetches when the focus sync fails", async () => {
    const sync = apiClient.api.plan.sync.$post as ReturnType<typeof vi.fn>;
    const home = apiClient.api.home.$get as ReturnType<typeof vi.fn>;
    sync.mockReset().mockRejectedValue(new Error("offline"));
    home.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: false, error: { kind: "unreachable", message: "x" } }) });
    const stop = startHomeViewStream();
    await waitFor(() => expect(home).toHaveBeenCalledTimes(1));
    act(() => void window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(home).toHaveBeenCalledTimes(2));
    expect(sync).toHaveBeenCalledTimes(1);
    stop();
  });
});
