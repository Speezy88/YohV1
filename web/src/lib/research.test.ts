/**
 * web/src/lib/research.test.ts — the Research list hook's stale-but-shown
 * timestamp: `refreshFailed.at` is when the list on screen was loaded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as eventBus from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import { useResearchList } from "./research.ts";

vi.mock("./apiClient.ts", () => ({
  apiClient: { api: { research: { $get: vi.fn() } } },
}));

const $get = apiClient.api.research.$get as unknown as ReturnType<typeof vi.fn>;

describe("useResearchList", () => {
  beforeEach(() => {
    $get.mockReset();
    vi.spyOn(eventBus, "onHint").mockImplementation(() => () => {});
  });
  afterEach(() => vi.useRealTimers());

  it("refreshFailed.at is the last successful load and does not advance on repeated failures", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 25, 8, 0));
    $get.mockResolvedValueOnce({ json: async () => ({ ok: true, value: { items: [] } }) });
    const { result } = renderHook(() => useResearchList());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    $get.mockResolvedValue({ json: async () => ({ ok: false, error: { kind: "unreachable", message: "down" } }) });
    vi.setSystemTime(new Date(2026, 8, 25, 9, 5));
    await act(() => result.current.refetch());
    vi.setSystemTime(new Date(2026, 8, 25, 10, 30));
    await act(() => result.current.refetch());
    const s = result.current.state;
    expect(s.status === "loaded" && s.refreshFailed?.at.getTime()).toBe(new Date(2026, 8, 25, 8, 0).getTime());
  });
});
