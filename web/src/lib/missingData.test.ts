/**
 * web/src/lib/missingData.test.ts — real-use fixes plan, Task 2.
 *
 * `useMissingDataCount`'s fetch + refetch-on-hint, `missingDataChipLabel`'s
 * singular/plural/hidden rule, and `openMissingData`'s one click handler
 * (close Chat, arm the Tasks "Missing data" filter, navigate to Tasks).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { apiClient } from "./apiClient.ts";
import * as chatPanelLib from "./chatPanel.ts";
import * as missingDataFilterLib from "./missingDataFilter.ts";
import { useMissingDataCount, missingDataChipLabel, openMissingData } from "./missingData.ts";

let hintListener: ((hint: { topic: string }) => void) | undefined;
vi.mock("./eventBus.ts", () => ({
  onHint: (listener: (hint: { topic: string }) => void) => {
    hintListener = listener;
    return () => {
      hintListener = undefined;
    };
  },
}));
vi.mock("./apiClient.ts", () => ({
  apiClient: { api: { tasks: { "missing-count": { $get: vi.fn() } } } },
}));

const envelope = (body: unknown) => ({ json: async () => body });
const get = apiClient.api.tasks["missing-count"].$get as unknown as ReturnType<typeof vi.fn>;

describe("useMissingDataCount", () => {
  beforeEach(() => {
    hintListener = undefined;
    get.mockReset();
  });

  it("fetches the count once on mount", async () => {
    get.mockResolvedValue(envelope({ ok: true, value: { count: 3 } }));
    const { result } = renderHook(() => useMissingDataCount());
    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current).toEqual({ status: "loaded", count: 3 }));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("reports an error state on a failed/unreachable fetch, never a stale/wrong count", async () => {
    get.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useMissingDataCount());
    await waitFor(() => expect(result.current).toEqual({ status: "error" }));
  });

  it("refetches on a 'tasks' or 'plan' hint, not on an unrelated one", async () => {
    get.mockResolvedValue(envelope({ ok: true, value: { count: 1 } }));
    renderHook(() => useMissingDataCount());
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    get.mockResolvedValue(envelope({ ok: true, value: { count: 0 } }));
    hintListener?.({ topic: "notifications" });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1)); // still 1 — unrelated topic

    hintListener?.({ topic: "tasks" });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    hintListener?.({ topic: "plan" });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  });
});

describe("missingDataChipLabel", () => {
  it("is hidden (undefined) while loading, on error, or at 0", () => {
    expect(missingDataChipLabel({ status: "loading" })).toBeUndefined();
    expect(missingDataChipLabel({ status: "error" })).toBeUndefined();
    expect(missingDataChipLabel({ status: "loaded", count: 0 })).toBeUndefined();
  });

  it("is singular for 1", () => {
    expect(missingDataChipLabel({ status: "loaded", count: 1 })).toBe("1 task missing data");
  });

  it("is plural for more than 1", () => {
    expect(missingDataChipLabel({ status: "loaded", count: 4 })).toBe("4 tasks missing data");
  });
});

describe("openMissingData", () => {
  afterEach(() => vi.restoreAllMocks());

  it("closes Chat, arms the Tasks 'Missing data' filter, and navigates to the Tasks page's index", () => {
    const close = vi.spyOn(chatPanelLib, "closeChatPanel").mockImplementation(() => {});
    const setFilter = vi.spyOn(missingDataFilterLib, "setMissingDataFilterActive").mockImplementation(() => {});
    const goTo = vi.fn();

    openMissingData({ goTo });

    expect(close).toHaveBeenCalledTimes(1);
    expect(setFilter).toHaveBeenCalledWith(true);
    expect(goTo).toHaveBeenCalledWith(1); // PAGES: home(0), tasks(1), desk(2), research(3)
  });

  it("is a no-op-safe navigate when nav is undefined (e.g. Chat rendered outside PageShell in a test)", () => {
    vi.spyOn(chatPanelLib, "closeChatPanel").mockImplementation(() => {});
    vi.spyOn(missingDataFilterLib, "setMissingDataFilterActive").mockImplementation(() => {});
    expect(() => openMissingData(undefined)).not.toThrow();
  });
});
