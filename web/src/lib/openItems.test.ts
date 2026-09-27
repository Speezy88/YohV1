/**
 * web/src/lib/openItems.test.ts
 *
 * Story 8.6 (Task 7): the `useSyncExternalStore` open-items store — fetches
 * `GET /api/open-items` once on start, then re-fetches only on a
 * `topic: "open-items"` hint from the shared event bus (`eventBus.ts`),
 * ignoring every other topic. `submitOpenItemAnswer` posts an answer and
 * refetches on both success and failure, surfacing a `stale-proposal`/
 * `conflict` rejection's `kind` rather than throwing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as eventBus from "./eventBus.ts";
import { apiClient } from "./apiClient.ts";
import { __resetOpenItemsForTests, refetchOpenItems, startOpenItemsStream, submitOpenItemAnswer, useOpenItems } from "./openItems.ts";

vi.mock("./apiClient.ts", () => ({
  apiClient: { api: { "open-items": { $get: vi.fn(), answer: { $post: vi.fn() } } } },
}));

const ITEM = {
  requestId: "data-completeness",
  requestKind: "data-completeness",
  promptText: "I need a bit more.",
  question: {
    requestId: "data-completeness",
    questionId: "t1:area",
    text: "What area is Draft the memo?",
    options: [{ label: "Work", value: "Work" }],
    allowsFreeText: true,
  },
};

describe("openItems store", () => {
  let hintCb: (hint: eventBus.EventBusHint) => void;

  beforeEach(() => {
    __resetOpenItemsForTests();
    vi.spyOn(eventBus, "onHint").mockImplementation((cb) => {
      hintCb = cb;
      return () => {};
    });
    (apiClient.api["open-items"].$get as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, value: { items: [ITEM] } }),
    });
  });

  it("fetches once on start", async () => {
    startOpenItemsStream();
    await waitFor(() => expect(apiClient.api["open-items"].$get).toHaveBeenCalledTimes(1));
  });

  it("re-fetches on a topic:'open-items' hint, ignores other topics", async () => {
    startOpenItemsStream();
    await waitFor(() => expect(apiClient.api["open-items"].$get).toHaveBeenCalledTimes(1));
    act(() => hintCb({ seq: 1, topic: "plan", entityId: "x" }));
    expect(apiClient.api["open-items"].$get).toHaveBeenCalledTimes(1);
    act(() => hintCb({ seq: 2, topic: "open-items", entityId: "data-completeness" }));
    await waitFor(() => expect(apiClient.api["open-items"].$get).toHaveBeenCalledTimes(2));
  });

  it("useOpenItems exposes loading, then loaded", async () => {
    const { result } = renderHook(() => useOpenItems());
    expect(result.current.status).toBe("loading");
    await act(() => refetchOpenItems());
    expect(result.current.status).toBe("loaded");
    if (result.current.status === "loaded") expect(result.current.items).toEqual([ITEM]);
  });

  it("surfaces an {ok: false} envelope as an error state", async () => {
    (apiClient.api["open-items"].$get as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: false, error: { kind: "unreachable", message: "server: chat dependencies not configured" } }),
    });
    const { result } = renderHook(() => useOpenItems());
    await act(() => refetchOpenItems());
    expect(result.current.status).toBe("error");
  });

  it("submitOpenItemAnswer posts the request, refetches on success, and returns the value", async () => {
    (apiClient.api["open-items"].answer.$post as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, value: { message: "Got it.", receipts: [], next: "done" } }),
    });
    const outcome = await submitOpenItemAnswer({ requestId: "data-completeness", questionId: "t1:area", answer: "Work" });
    expect(outcome).toEqual({ ok: true, value: { message: "Got it.", receipts: [], next: "done" } });
    await waitFor(() => expect(apiClient.api["open-items"].$get).toHaveBeenCalledTimes(1));
  });

  it("submitOpenItemAnswer surfaces {ok:false, kind, message} on a stale-proposal rejection, without throwing", async () => {
    (apiClient.api["open-items"].answer.$post as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: false, error: { kind: "stale-proposal", message: "entity changed" } }),
    });
    const outcome = await submitOpenItemAnswer({ requestId: "data-completeness", questionId: "t1:area", answer: "Work" });
    expect(outcome).toEqual({ ok: false, kind: "stale-proposal", message: "entity changed" });
  });

  it("a rejected fetch request surfaces as an error state, never an unhandled rejection", async () => {
    (apiClient.api["open-items"].$get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useOpenItems());
    await act(() => refetchOpenItems());
    expect(result.current.status).toBe("error");
  });

  it("a rejected answer request surfaces {ok:false, kind:'unreachable'}, never an unhandled rejection", async () => {
    (apiClient.api["open-items"].answer.$post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    const outcome = await submitOpenItemAnswer({ requestId: "data-completeness", questionId: "t1:area", answer: "Work" });
    expect(outcome).toEqual({ ok: false, kind: "unreachable", message: "network down" });
  });
});
