import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

type Hint = { seq: number; topic: string; entityId: string };
let hintListener: ((h: Hint) => void) | undefined;
vi.mock("./eventBus.ts", () => ({
  onHint: (l: (h: Hint) => void) => {
    hintListener = l;
    return () => {
      hintListener = undefined;
    };
  },
}));
const searchGet = vi.fn();
const listGet = vi.fn();
const oneGet = vi.fn();
const delPost = vi.fn();
const clearPost = vi.fn();
vi.mock("./apiClient.ts", () => ({
  apiClient: {
    api: {
      memory: { $get: vi.fn(), search: { $get: (...a: unknown[]) => searchGet(...a) } },
      "chat-history": {
        $get: (...a: unknown[]) => listGet(...a),
        ":conversationId": { $get: (...a: unknown[]) => oneGet(...a) },
        delete: { $post: (...a: unknown[]) => delPost(...a) },
        clear: { $post: (...a: unknown[]) => clearPost(...a) },
      },
    },
  },
}));

import {
  clearHistory,
  deleteConversation,
  MEMORY_UNDO_WINDOW_MS,
  useChatConversation,
  useChatHistoryList,
  useMemorySearch,
} from "./memory.ts";

const envelope = (body: unknown) => ({ json: async () => body });
const RESULT = (q: string) => ({ query: q, items: [], turns: [] });

describe("memory search and chat history hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces search (~250 ms) and searches once for the latest text", async () => {
    vi.useFakeTimers();
    searchGet.mockImplementation(async ({ query }: { query: { q: string } }) => envelope({ ok: true, value: RESULT(query.q) }));
    const { result } = renderHook(() => useMemorySearch());
    act(() => result.current.setText("che"));
    act(() => result.current.setText("chem"));
    expect(searchGet).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });
    expect(searchGet).toHaveBeenCalledTimes(1);
    expect(searchGet.mock.calls[0]![0]).toEqual({ query: { q: "chem" } });
    expect(result.current.status).toBe("loaded");
  });

  it("drops a stale response that lands after a newer one", async () => {
    vi.useFakeTimers();
    let releaseFirst: (v: unknown) => void = () => {};
    searchGet
      .mockImplementationOnce(() => new Promise((r) => { releaseFirst = r; }))
      .mockImplementationOnce(async () => envelope({ ok: true, value: RESULT("second") }));
    const { result } = renderHook(() => useMemorySearch());
    act(() => result.current.setText("first"));
    await act(async () => { await vi.advanceTimersByTimeAsync(260); });
    act(() => result.current.setText("second"));
    await act(async () => { await vi.advanceTimersByTimeAsync(260); });
    expect(result.current.results?.query).toBe("second");
    await act(async () => { releaseFirst(envelope({ ok: true, value: RESULT("first") })); });
    expect(result.current.results?.query).toBe("second");
  });

  it("clear returns to idle without a request", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMemorySearch());
    act(() => result.current.setText("abc"));
    act(() => result.current.clear());
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(searchGet).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expect(result.current.text).toBe("");
  });

  it("a failed search reports error, never throws", async () => {
    vi.useFakeTimers();
    searchGet.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useMemorySearch());
    act(() => result.current.setText("abc"));
    await act(async () => { await vi.advanceTimersByTimeAsync(260); });
    expect(result.current.status).toBe("error");
  });

  it("chat history list loads and refetches on the memory hint only", async () => {
    listGet.mockResolvedValue(envelope({ ok: true, value: { conversations: [] } }));
    const { result } = renderHook(() => useChatHistoryList());
    await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    hintListener?.({ seq: 1, topic: "plan", entityId: "x" });
    expect(listGet).toHaveBeenCalledTimes(1);
    hintListener?.({ seq: 2, topic: "memory", entityId: "x" });
    await waitFor(() => expect(listGet).toHaveBeenCalledTimes(2));
  });

  it("a conversation load error is shown as error; a good one loads", async () => {
    oneGet.mockResolvedValueOnce(envelope({ ok: false, error: { kind: "conflict", message: "gone" } }));
    const a = renderHook(() => useChatConversation("c1"));
    await waitFor(() => expect(a.result.current.state.status).toBe("error"));
    expect(oneGet.mock.calls[0]![0]).toEqual({ param: { conversationId: "c1" } });
    oneGet.mockResolvedValueOnce(envelope({ ok: true, value: { id: "c2", date: "2026-09-28", turns: [] } }));
    const b = renderHook(() => useChatConversation("c2"));
    await waitFor(() => expect(b.result.current.state.status).toBe("loaded"));
  });

  it("delete and clear return outcomes and never throw", async () => {
    delPost.mockResolvedValueOnce(envelope({ ok: true, value: {} }));
    expect(await deleteConversation("c1")).toEqual({ ok: true, value: {} });
    expect(delPost).toHaveBeenCalledWith({ json: { conversationId: "c1" } });
    clearPost.mockRejectedValueOnce(new Error("down"));
    const out = await clearHistory();
    expect(out.ok).toBe(false);
  });

  it("defines the undo window once", () => {
    expect(MEMORY_UNDO_WINDOW_MS).toBe(6000);
  });
});
