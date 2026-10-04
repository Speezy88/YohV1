/**
 * web/src/lib/research.test.ts — the Research list hook's stale-but-shown
 * timestamp: `refreshFailed.at` is when the list on screen was loaded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as eventBus from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import { useResearchList, useResearchDocument, openResearchDocument, useSelectedResearchId, resetResearchSelection } from "./research.ts";

vi.mock("./apiClient.ts", () => ({
  apiClient: { api: { research: { $get: vi.fn(), document: { $get: vi.fn() } } } },
}));

const $get = apiClient.api.research.$get as unknown as ReturnType<typeof vi.fn>;
const $doc = (apiClient.api.research as unknown as { document: { $get: ReturnType<typeof vi.fn> } }).document.$get;
const ok = (value: unknown) => ({ json: async () => ({ ok: true, value }) });
const fail = () => ({ json: async () => ({ ok: false, error: { kind: "unreachable", message: "down" } }) });
const item = (n: number) => ({ id: `r${n}`, title: `T${n}`, sourceCount: 1, url: `u${n}` });
const doc = (id: string) => ({ document: { id, title: id, body: "b", sources: [], url: "u" } });

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

describe("useResearchList paging", () => {
  let hintHandler: ((h: { topic: string }) => void) | undefined;
  beforeEach(() => {
    $get.mockReset();
    hintHandler = undefined;
    vi.spyOn(eventBus, "onHint").mockImplementation(((fn: (h: { topic: string }) => void) => {
      hintHandler = fn;
      return () => {};
    }) as never);
  });

  it("showMore asks for pages + 1 and replaces the list; refetch keeps the current pages", async () => {
    $get.mockResolvedValueOnce(ok({ items: [item(1)], hasMore: true }));
    const { result } = renderHook(() => useResearchList());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    expect($get).toHaveBeenLastCalledWith({ query: { pages: "1" } });
    $get.mockResolvedValueOnce(ok({ items: [item(1), item(2)], hasMore: false }));
    await act(() => result.current.showMore());
    expect($get).toHaveBeenLastCalledWith({ query: { pages: "2" } });
    const s = result.current.state;
    expect(s.status === "loaded" && s.value.items.length).toBe(2);
    $get.mockResolvedValueOnce(ok({ items: [item(1), item(2)], hasMore: false }));
    await act(async () => hintHandler?.({ topic: "research" }));
    await waitFor(() => expect($get).toHaveBeenLastCalledWith({ query: { pages: "2" } }));
  });

  for (const order of ["showMore first", "refetch first"] as const) {
    it(`a refresh landing while Show more loads leaves the button enabled and the larger page (${order})`, async () => {
      $get.mockResolvedValueOnce(ok({ items: [item(1)], hasMore: true }));
      const { result } = renderHook(() => useResearchList());
      await waitFor(() => expect(result.current.state.status).toBe("loaded"));
      let resolveMore!: (v: unknown) => void;
      let resolveRefresh!: (v: unknown) => void;
      $get.mockImplementationOnce(() => new Promise((r) => (resolveMore = r)));
      $get.mockImplementationOnce(() => new Promise((r) => (resolveRefresh = r)));
      let more!: Promise<void>;
      act(() => {
        more = result.current.showMore();
      });
      expect(result.current.loadingMore).toBe(true);
      await act(async () => hintHandler?.({ topic: "research" }));
      expect($get).toHaveBeenLastCalledWith({ query: { pages: "2" } });
      const big = ok({ items: [item(1), item(2)], hasMore: false });
      await act(async () => {
        if (order === "showMore first") {
          resolveMore(big);
          resolveRefresh(big);
        } else {
          resolveRefresh(big);
          resolveMore(big);
        }
        await more;
      });
      expect(result.current.loadingMore).toBe(false);
      const s = result.current.state;
      expect(s.status === "loaded" && s.value.items.length).toBe(2);
    });
  }

  it("a failed Show more that superseded a refresh runs one refetch so the refresh is not lost", async () => {
    $get.mockResolvedValueOnce(ok({ items: [item(1)], hasMore: true }));
    const { result } = renderHook(() => useResearchList());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    let resolveRefresh!: (v: unknown) => void;
    $get.mockImplementationOnce(() => new Promise((r) => (resolveRefresh = r)));
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refetch();
    });
    $get.mockResolvedValueOnce(fail());
    $get.mockResolvedValueOnce(ok({ items: [item(1), item(9)], hasMore: false }));
    await act(async () => {
      await result.current.showMore();
      resolveRefresh(ok({ items: [item(1)], hasMore: true }));
      await refresh;
    });
    await waitFor(() => {
      const s = result.current.state;
      expect(s.status === "loaded" && s.value.items.length).toBe(2);
    });
    expect($get).toHaveBeenCalledTimes(4);
    expect($get).toHaveBeenLastCalledWith({ query: { pages: "1" } });
    expect(result.current.moreFailed).toBe(true);
  });

  it("a failed showMore keeps the rows and sets moreFailed; a later success clears it", async () => {
    $get.mockResolvedValueOnce(ok({ items: [item(1)], hasMore: true }));
    const { result } = renderHook(() => useResearchList());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    $get.mockResolvedValueOnce(fail());
    await act(() => result.current.showMore());
    expect(result.current.moreFailed).toBe(true);
    const s = result.current.state;
    expect(s.status === "loaded" && s.value.items.length).toBe(1);
    $get.mockResolvedValueOnce(ok({ items: [item(1), item(2)], hasMore: false }));
    await act(() => result.current.showMore());
    expect(result.current.moreFailed).toBe(false);
  });
});

describe("useResearchDocument and the selection", () => {
  let hintHandler: ((h: { topic: string }) => void) | undefined;
  beforeEach(() => {
    $doc.mockReset();
    resetResearchSelection();
    hintHandler = undefined;
    vi.spyOn(eventBus, "onHint").mockImplementation(((fn: (h: { topic: string }) => void) => {
      hintHandler = fn;
      return () => {};
    }) as never);
  });

  it("with no selection it asks for the newest (no id)", async () => {
    $doc.mockResolvedValue(ok(doc("rv-new")));
    const { result } = renderHook(() => useResearchDocument());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    expect($doc).toHaveBeenLastCalledWith({ query: {} });
  });

  it("openResearchDocument(id) selects that id and the hook fetches it, also when already mounted", async () => {
    $doc.mockResolvedValue(ok(doc("rv-new")));
    const { result } = renderHook(() => ({ d: useResearchDocument(), sel: useSelectedResearchId() }));
    await waitFor(() => expect(result.current.d.state.status).toBe("loaded"));
    $doc.mockResolvedValue(ok(doc("rv-2")));
    act(() => openResearchDocument("rv-2"));
    await waitFor(() => expect($doc).toHaveBeenLastCalledWith({ query: { id: "rv-2" } }));
    expect(result.current.sel).toBe("rv-2");
    await waitFor(() => {
      const s = result.current.d.state;
      expect(s.status === "loaded" && s.value.document?.id).toBe("rv-2");
    });
  });

  it("a research hint refetches the box only when nothing was picked", async () => {
    $doc.mockResolvedValue(ok(doc("rv-new")));
    const { result } = renderHook(() => useResearchDocument());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    $doc.mockClear();
    await act(async () => hintHandler?.({ topic: "research" }));
    await waitFor(() => expect($doc).toHaveBeenCalledTimes(1));
    act(() => openResearchDocument("rv-2"));
    await waitFor(() => expect($doc).toHaveBeenCalledTimes(2));
    await act(async () => hintHandler?.({ topic: "research" }));
    expect($doc).toHaveBeenCalledTimes(2);
  });
});
