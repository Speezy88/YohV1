/**
 * web/src/lib/missingData.test.ts — real-use fixes plan, Task 2; re-pointed
 * to the sandbox queue by Story 9.4 (chunk B).
 *
 * `useMissingDataCount`'s fetch + refetch-on-hint against
 * `GET /api/sandbox/count`, `missingDataChipLabel`'s "N need data"/hidden
 * rule, and `openMissingData`'s one click handler (run `/sandbox` in the
 * already-open Chat panel via `openChatWithCommand`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { apiClient } from "./apiClient.ts";
import * as chatPanelLib from "./chatPanel.ts";
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
  apiClient: { api: { sandbox: { count: { $get: vi.fn() } } } },
}));

const envelope = (body: unknown) => ({ json: async () => body });
const get = apiClient.api.sandbox.count.$get as unknown as ReturnType<typeof vi.fn>;

describe("useMissingDataCount", () => {
  beforeEach(() => {
    hintListener = undefined;
    get.mockReset();
  });

  it("fetches the sandbox queue count once on mount", async () => {
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

  it("reads 'N need data' regardless of count", () => {
    expect(missingDataChipLabel({ status: "loaded", count: 1 })).toBe("1 need data");
    expect(missingDataChipLabel({ status: "loaded", count: 4 })).toBe("4 need data");
  });
});

describe("openMissingData", () => {
  afterEach(() => vi.restoreAllMocks());

  it("runs /sandbox in the already-open Chat panel", () => {
    const openWithCommand = vi.spyOn(chatPanelLib, "openChatWithCommand").mockImplementation(() => {});

    openMissingData();

    expect(openWithCommand).toHaveBeenCalledWith("/sandbox");
    expect(openWithCommand).toHaveBeenCalledTimes(1);
  });
});
