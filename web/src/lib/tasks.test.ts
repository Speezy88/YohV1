/**
 * web/src/lib/tasks.test.ts — Task 6B: the Tasks list hook (fetch, refetch
 * on a `tasks`/`plan` hint from the ONE shared bus, stale responses
 * dropped, last good list kept on a failed refresh) and the presentation
 * helpers (relative to the server's `today`, never the browser's clock).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as eventBus from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import { formatDue, formatDuration, loadGroupBy, optionLabel, saveGroupBy, useTasksList } from "./tasks.ts";
import type { TasksViewResponse } from "../../../src/types/api.ts";

vi.mock("./apiClient.ts", () => ({
  apiClient: { api: { tasks: { $get: vi.fn() } } },
}));

const $get = apiClient.api.tasks.$get as unknown as ReturnType<typeof vi.fn>;

function view(total: number): TasksViewResponse {
  return { today: "2026-09-27", groupBy: "due", query: "", total, groups: [], options: { area: [], energy: [], status: [] } };
}

describe("useTasksList", () => {
  let hintCb: (hint: eventBus.EventBusHint) => void;

  beforeEach(() => {
    $get.mockReset();
    vi.spyOn(eventBus, "onHint").mockImplementation((cb) => {
      hintCb = cb;
      return () => {};
    });
  });

  it("fetches with the grouping and query, then refetches on tasks/plan hints only", async () => {
    $get.mockResolvedValue({ json: async () => ({ ok: true, value: view(1) }) });
    const { result } = renderHook(() => useTasksList("area", "bio"));
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    expect($get).toHaveBeenCalledWith({ query: { groupBy: "area", query: "bio" } });
    act(() => hintCb({ seq: 1, topic: "notification", entityId: "x" }));
    expect($get).toHaveBeenCalledTimes(1);
    act(() => hintCb({ seq: 2, topic: "tasks", entityId: "t1" }));
    act(() => hintCb({ seq: 3, topic: "plan", entityId: "t1" }));
    await waitFor(() => expect($get).toHaveBeenCalledTimes(3));
  });

  it("drops an out-of-order response: only the newest request may land", async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    $get
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce({ json: async () => ({ ok: true, value: view(2) }) });
    const { result, rerender } = renderHook(({ q }) => useTasksList("due", q), { initialProps: { q: "a" } });
    rerender({ q: "ab" });
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    resolveFirst({ json: async () => ({ ok: true, value: view(1) }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.state.status === "loaded" && result.current.state.value.total).toBe(2);
  });

  it("keeps the last good list visible when a refresh fails", async () => {
    $get.mockResolvedValueOnce({ json: async () => ({ ok: true, value: view(3) }) });
    const { result } = renderHook(() => useTasksList("due", ""));
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    $get.mockResolvedValueOnce({ json: async () => ({ ok: false, error: { kind: "unreachable", message: "I couldn't reach Notion right now; nothing was changed." } }) });
    await act(() => result.current.refetch());
    expect(result.current.state.status).toBe("loaded");
    if (result.current.state.status === "loaded") {
      expect(result.current.state.value.total).toBe(3);
      expect(result.current.state.refreshFailed?.message).toMatch(/Notion/);
    }
  });

  it("refreshFailed.at is the last successful load and does not advance on repeated failures", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 8, 25, 8, 0));
      $get.mockResolvedValueOnce({ json: async () => ({ ok: true, value: view(3) }) });
      const { result } = renderHook(() => useTasksList("due", ""));
      await waitFor(() => expect(result.current.state.status).toBe("loaded"));
      $get.mockResolvedValue({ json: async () => ({ ok: false, error: { kind: "unreachable", message: "down" } }) });
      vi.setSystemTime(new Date(2026, 8, 25, 9, 5));
      await act(() => result.current.refetch());
      vi.setSystemTime(new Date(2026, 8, 25, 10, 30));
      await act(() => result.current.refetch());
      const s = result.current.state;
      expect(s.status === "loaded" && s.refreshFailed?.at.getTime()).toBe(new Date(2026, 8, 25, 8, 0).getTime());
    } finally {
      vi.useRealTimers();
    }
  });

  it("a first load that fails is an error state with the server's plain message", async () => {
    $get.mockResolvedValueOnce({ json: async () => ({ ok: false, error: { kind: "unreachable", message: "Nope." } }) });
    const { result } = renderHook(() => useTasksList("due", ""));
    await waitFor(() => expect(result.current.state).toEqual({ status: "error", message: "Nope." }));
  });
});

describe("presentation helpers", () => {
  it("formatDue is relative to the server's today", () => {
    expect(formatDue("2026-09-27", "2026-09-27")).toBe("Today");
    expect(formatDue("2026-09-28", "2026-09-27")).toBe("Tomorrow");
    expect(formatDue("2026-09-26", "2026-09-27")).toBe("Yesterday");
    expect(formatDue("2026-10-02", "2026-09-27")).toBe("Fri, Oct 2");
  });

  it("formatDuration and optionLabel", () => {
    expect(formatDuration(90)).toBe("90 min");
    expect(optionLabel("medium")).toBe("Medium");
    expect(optionLabel("Deep")).toBe("Deep");
  });

  it("the chosen grouping persists, and storage failures fall back to Due", () => {
    saveGroupBy("status");
    expect(loadGroupBy()).toBe("status");
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadGroupBy()).toBe("due");
    spy.mockRestore();
    saveGroupBy("due");
  });
});
