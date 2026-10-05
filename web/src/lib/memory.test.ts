import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MemoryViewResponse, MemoryItemView } from "../../../src/types/api.ts";

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
vi.mock("./apiClient.ts", () => ({
  apiClient: {
    api: {
      memory: {
        $get: vi.fn(),
        edit: { $post: vi.fn() },
        move: { $post: vi.fn() },
        expiry: { $post: vi.fn() },
        delete: { $post: vi.fn() },
        review: { $post: vi.fn() },
      },
      settings: { revert: { $post: vi.fn() } },
    },
  },
}));

import { apiClient } from "./apiClient.ts";
import {
  __resetMemoryForTests,
  getMemoryState,
  openMemoryItem,
  refetchMemory,
  selectMemory,
  startMemoryStream,
  editItem,
  moveItem,
  setExpiry,
  deleteItem,
  reviewItem,
  revertSetting,
} from "./memory.ts";

const api = apiClient.api as unknown as { memory: { $get: ReturnType<typeof vi.fn> } };
const envelope = (body: unknown) => ({ json: async () => body });

function item(id: string, folder: MemoryItemView["folder"]): MemoryItemView {
  return {
    id, folder, text: `text ${id}`, origin: "stated", status: "current", declined: false, pendingChange: false,
    createdAt: "2026-09-01T10:00:00Z", confirmedAt: "2026-09-01T10:00:00Z", confirmedOn: "2026-09-01", loaded: true, earlierVersions: [],
  };
}
const VIEW: MemoryViewResponse = {
  folders: [
    { folder: "feedback", label: "Feedback", loadClass: "always", count: 0, items: [] },
    { folder: "about-you", label: "About you", loadClass: "always", count: 1, items: [item("m1", "about-you")] },
  ],
  needsReview: [],
  changedSettings: [],
  pendingPatterns: [],
};

describe("memory store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.clear(); } catch { /* ignore */ }
    __resetMemoryForTests();
  });

  it("starts loading, fetches once, then subscribes to the memory topic only", async () => {
    api.memory.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    const stop = startMemoryStream();
    expect(getMemoryState().view.status).toBe("loading");
    await vi.waitFor(() => expect(getMemoryState().view.status).toBe("loaded"));
    hintListener?.({ seq: 1, topic: "plan", entityId: "x" });
    expect(api.memory.$get).toHaveBeenCalledTimes(1);
    hintListener?.({ seq: 2, topic: "memory", entityId: "x" });
    await vi.waitFor(() => expect(api.memory.$get).toHaveBeenCalledTimes(2));
    stop();
    expect(hintListener).toBeUndefined();
  });

  it("reports an error, and keeps a loaded view when a later refetch fails", async () => {
    api.memory.$get.mockResolvedValueOnce(envelope({ ok: false, error: { kind: "unreachable", message: "x" } }));
    await refetchMemory();
    expect(getMemoryState().view.status).toBe("error");
    api.memory.$get.mockResolvedValueOnce(envelope({ ok: true, value: VIEW }));
    await refetchMemory();
    api.memory.$get.mockRejectedValueOnce(new Error("down"));
    await refetchMemory();
    expect(getMemoryState().view.status).toBe("loaded");
  });

  it("serializes an overlapping refetch: the trailing fetch's response is what ends up shown", async () => {
    let releaseFirst: (v: unknown) => void = () => {};
    api.memory.$get.mockReturnValueOnce(new Promise((r) => { releaseFirst = r; }));
    const first = refetchMemory();
    api.memory.$get.mockResolvedValueOnce(envelope({ ok: true, value: VIEW }));
    const second = refetchMemory();
    releaseFirst(envelope({ ok: true, value: { ...VIEW, folders: [] } }));
    await Promise.all([first, second]);
    const v = getMemoryState().view;
    expect(v.status === "loaded" && v.value.folders.length).toBe(2);
    expect(api.memory.$get).toHaveBeenCalledTimes(2);
  });

  it("defaults to the first folder, persists the selection, and restores it after a reset", () => {
    expect(getMemoryState().selection).toEqual({ kind: "folder", folder: "feedback" });
    selectMemory({ kind: "settings" });
    __resetMemoryForTests({ keepStorage: true });
    expect(getMemoryState().selection).toEqual({ kind: "settings" });
  });

  it("ignores a corrupt stored selection", () => {
    localStorage.setItem("yoh.memory.selection", "{nope");
    __resetMemoryForTests({ keepStorage: true });
    expect(getMemoryState().selection).toEqual({ kind: "folder", folder: "feedback" });
  });

  it("openMemoryItem selects the item's folder and sets a pending scroll id", async () => {
    api.memory.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    await refetchMemory();
    openMemoryItem("m1");
    const s = getMemoryState();
    expect(s.selection).toEqual({ kind: "folder", folder: "about-you", itemId: "m1" });
    expect(s.pendingScrollId).toBe("m1");
  });
});


describe("memory write helpers", () => {
  const w = (apiClient.api as unknown as { memory: Record<"edit" | "move" | "expiry" | "delete", { $post: ReturnType<typeof vi.fn> }> }).memory;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetMemoryForTests();
    api.memory.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
  });

  it("editItem maps the envelope to an outcome and refetches once after a success", async () => {
    w.edit.$post.mockResolvedValue(envelope({ ok: true, value: { status: "saved", itemId: "m2" } }));
    const out = await editItem("m1", "new", { mergeWithId: "o1" });
    expect(out).toEqual({ ok: true, value: { status: "saved", itemId: "m2" } });
    expect(w.edit.$post).toHaveBeenCalledWith({ json: { itemId: "m1", text: "new", mergeWithId: "o1" } });
    expect(api.memory.$get).toHaveBeenCalledTimes(1);
  });

  it("passes the server's plain message through on a failure and does not refetch", async () => {
    w.move.$post.mockResolvedValue(envelope({ ok: false, error: { kind: "validation", message: "That's already in this folder." } }));
    expect(await moveItem("m1", "about-you")).toEqual({ ok: false, message: "That's already in this folder." });
    expect(api.memory.$get).not.toHaveBeenCalled();
  });

  it("a network failure gives one fixed sentence and never throws", async () => {
    w.expiry.$post.mockRejectedValue(new Error("boom"));
    const out = await setExpiry("m1", null);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toBe("I couldn't reach Meeseek's server just now.");
    expect(w.expiry.$post).toHaveBeenCalledWith({ json: { itemId: "m1", expiresOn: null } });
  });

  it("deleteItem posts the id", async () => {
    w.delete.$post.mockResolvedValue(envelope({ ok: true, value: {} }));
    expect(await deleteItem("m1")).toEqual({ ok: true, value: {} });
    expect(w.delete.$post).toHaveBeenCalledWith({ json: { itemId: "m1" } });
  });

  it("reviewItem posts renew with an optional expiry, and keep without one", async () => {
    const review = (apiClient.api as unknown as { memory: { review: { $post: ReturnType<typeof vi.fn> } } }).memory.review;
    review.$post.mockResolvedValue(envelope({ ok: true, value: { itemId: "m2" } }));
    await reviewItem("m1", "renew", "2026-12-01");
    expect(review.$post).toHaveBeenLastCalledWith({ json: { itemId: "m1", action: "renew", expiresOn: "2026-12-01" } });
    await reviewItem("m1", "keep");
    expect(review.$post).toHaveBeenLastCalledWith({ json: { itemId: "m1", action: "keep" } });
  });

  it("revertSetting posts the key (and area) and returns the server message", async () => {
    const revert = (apiClient.api as unknown as { settings: { revert: { $post: ReturnType<typeof vi.fn> } } }).settings.revert;
    revert.$post.mockResolvedValue(envelope({ ok: true, value: { message: "Reverted to 3:15 PM." } }));
    expect(await revertSetting("schoolDayWorkStart")).toEqual({ ok: true, value: { message: "Reverted to 3:15 PM." } });
    expect(revert.$post).toHaveBeenCalledWith({ json: { key: "schoolDayWorkStart" } });
    expect(api.memory.$get).toHaveBeenCalledTimes(1);
  });
});
