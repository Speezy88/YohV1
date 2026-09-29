/**
 * web/src/lib/homeView.test.ts
 *
 * Story 7.8: the `useSyncExternalStore` Home-view store — fetches
 * `GET /api/home` once on start, then re-fetches only on a `topic: "plan"`
 * hint from the shared event bus (`eventBus.ts`), ignoring every other
 * topic (e.g. `"notification"`, which `notifications.ts` owns).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as eventBus from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import { __resetHomeViewForTests, startHomeViewStream, useHomeView } from "./homeView.ts";

vi.mock("./apiClient.ts", () => ({
  apiClient: { api: { home: { $get: vi.fn() } } },
}));

describe("homeView store", () => {
  let hintCb: (hint: eventBus.EventBusHint) => void;

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
    startHomeViewStream();
    await waitFor(() => expect(apiClient.api.home.$get).toHaveBeenCalledTimes(1));
  });

  it("re-fetches on a topic:'plan' hint, ignores other topics", async () => {
    startHomeViewStream();
    await waitFor(() => expect(apiClient.api.home.$get).toHaveBeenCalledTimes(1));
    act(() => hintCb({ seq: 1, topic: "notification", entityId: "x" }));
    expect(apiClient.api.home.$get).toHaveBeenCalledTimes(1);
    act(() => hintCb({ seq: 2, topic: "plan", entityId: "2026-09-25" }));
    await waitFor(() => expect(apiClient.api.home.$get).toHaveBeenCalledTimes(2));
  });

  it("re-fetches on an 'open-items' hint", async () => {
    startHomeViewStream();
    await waitFor(() => expect(apiClient.api.home.$get).toHaveBeenCalledTimes(1));
    act(() => hintCb({ seq: 3, topic: "open-items", entityId: "proposal:p1" }));
    await waitFor(() => expect(apiClient.api.home.$get).toHaveBeenCalledTimes(2));
  });

  it("useHomeView exposes loading, then loaded", async () => {
    const { result } = renderHook(() => useHomeView());
    expect(result.current.status).toBe("loading");
    startHomeViewStream();
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
    startHomeViewStream();
    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") {
      expect(result.current.message).toMatch(/not configured/);
    }
  });

  it("a rejected fetch request also surfaces as an error state, never an unhandled rejection", async () => {
    (apiClient.api.home.$get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useHomeView());
    startHomeViewStream();
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});
