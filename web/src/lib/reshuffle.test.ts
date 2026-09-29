/**
 * web/src/lib/reshuffle.ts: request/approve/discard clients and the module store Home's preview card reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { apiClient } from "./apiClient.ts";
import * as homeView from "./homeView.ts";
import { __resetReshuffleForTests, approveReshuffle, discardReshuffle, requestReshuffle, useReshuffle } from "./reshuffle.ts";
import type { ReshufflePreviewView } from "../../../src/types/api.ts";

vi.mock("./apiClient.ts", () => ({
  apiClient: {
    api: {
      plan: {
        reshuffle: {
          $post: vi.fn(),
          approve: { $post: vi.fn() },
          discard: { $post: vi.fn() },
        },
      },
    },
  },
}));

function preview(id: string, summary: string): ReshufflePreviewView {
  return {
    proposalId: id,
    requestId: `proposal:${id}`,
    date: "2026-09-25",
    summary,
    blocks: [],
    deferredTaskIds: [],
    needsDataTaskIds: [],
    unplacedRoutineLabels: [],
    expiresAt: "2026-09-25T18:10:00.000Z",
  };
}

const post = apiClient.api.plan.reshuffle.$post as ReturnType<typeof vi.fn>;
const approve = apiClient.api.plan.reshuffle.approve.$post as ReturnType<typeof vi.fn>;
const discard = apiClient.api.plan.reshuffle.discard.$post as ReturnType<typeof vi.fn>;
const envelope = (value: unknown) => ({ json: async () => ({ ok: true, value }) });

describe("reshuffle store", () => {
  beforeEach(() => {
    __resetReshuffleForTests();
    vi.clearAllMocks();
    vi.spyOn(homeView, "refetchHomeView").mockResolvedValue();
  });

  it("approve success sends the proposal id, refetches Home and reports no error", async () => {
    approve.mockResolvedValue(envelope({ status: "applied", calendarFailedBlockIds: [] }));
    const { result } = renderHook(() => useReshuffle(preview("p1", "s")));
    await act(async () => {
      await approveReshuffle("p1");
    });
    expect(approve).toHaveBeenCalledWith({ json: { proposalId: "p1" } });
    expect(homeView.refetchHomeView).toHaveBeenCalled();
    expect(result.current.error).toBeUndefined();
  });

  it("approve with calendar failures says it couldn't update the calendar", async () => {
    approve.mockResolvedValue(envelope({ status: "applied", calendarFailedBlockIds: ["b1"] }));
    const { result } = renderHook(() => useReshuffle(undefined));
    await act(async () => {
      await approveReshuffle("p1");
    });
    expect(result.current.error).toBe("Couldn't update your calendar");
  });

  it("a stale approve shows the fresh preview and a notice", async () => {
    approve.mockResolvedValue(envelope({ status: "recomputed", preview: preview("p2", "New summary"), question: {} }));
    const { result } = renderHook(() => useReshuffle(preview("p1", "Old summary")));
    await act(async () => {
      await approveReshuffle("p1");
    });
    expect(result.current.notice).toMatch(/changed/i);
  });

  it("a failed approve is visible", async () => {
    approve.mockResolvedValue({ json: async () => ({ ok: false, error: { kind: "stale-proposal", message: "That preview expired. Ask again or drag the block again." } }) });
    const { result } = renderHook(() => useReshuffle(preview("p1", "s")));
    await act(async () => {
      await approveReshuffle("p1");
    });
    expect(result.current.error).toBe("That preview expired. Ask again or drag the block again.");
  });

  it("discard sends the id and refetches Home", async () => {
    discard.mockResolvedValue(envelope({ discarded: true }));
    await act(async () => {
      await discardReshuffle("p1");
    });
    expect(discard).toHaveBeenCalledWith({ json: { proposalId: "p1" } });
    expect(homeView.refetchHomeView).toHaveBeenCalled();
  });

  it("a request (unpin) posts the request and shows its preview", async () => {
    let release: () => void = () => {};
    vi.spyOn(homeView, "refetchHomeView").mockReturnValue(new Promise<void>((r) => (release = r)));
    post.mockResolvedValue(envelope({ preview: preview("p3", "Unpinned"), question: {} }));
    const { result } = renderHook(() => useReshuffle(undefined));
    let done = Promise.resolve();
    await act(async () => {
      done = requestReshuffle({ kind: "unpin-task", taskId: "t1" });
      await Promise.resolve();
    });
    expect(post).toHaveBeenCalledWith({ json: { kind: "unpin-task", taskId: "t1" } });
    expect(result.current.preview?.proposalId).toBe("p3");
    release();
    await act(async () => done);
    expect(result.current.preview).toBeUndefined();
  });

  it("a rejected request (validation error, no preview) shows its message", async () => {
    vi.spyOn(homeView, "refetchHomeView").mockResolvedValue();
    post.mockResolvedValue({ json: async () => ({ ok: false, error: { kind: "validation", message: "Nothing fits at 4." } }) });
    const { result } = renderHook(() => useReshuffle(undefined));
    await act(async () => requestReshuffle({ kind: "move-block", planBlockId: "b1", newStart: "2026-09-25T20:00:00.000Z" }));
    expect(result.current.error).toBe("Nothing fits at 4.");
    expect(result.current.preview).toBeUndefined();
    expect(result.current.busy).toBe(false);
  });
});
