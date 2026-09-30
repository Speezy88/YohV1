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
vi.mock("./apiClient.ts", () => ({ apiClient: { api: { memory: { $get: vi.fn() } } } }));

import { apiClient } from "./apiClient.ts";
import {
  __resetMemoryForTests,
  getMemoryState,
  openMemoryItem,
  refetchMemory,
  selectMemory,
  startMemoryStream,
} from "./memory.ts";

const api = apiClient.api as unknown as { memory: { $get: ReturnType<typeof vi.fn> } };
const envelope = (body: unknown) => ({ json: async () => body });

function item(id: string, folder: MemoryItemView["folder"]): MemoryItemView {
  return {
    id, folder, text: `text ${id}`, origin: "stated", status: "current", declined: false, pendingChange: false,
    createdAt: "2026-09-01T10:00:00Z", confirmedAt: "2026-09-01T10:00:00Z", loaded: true, earlierVersions: [],
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

  it("drops an out-of-order response", async () => {
    let releaseFirst: (v: unknown) => void = () => {};
    api.memory.$get.mockReturnValueOnce(new Promise((r) => { releaseFirst = r; }));
    const first = refetchMemory();
    api.memory.$get.mockResolvedValueOnce(envelope({ ok: true, value: VIEW }));
    await refetchMemory();
    releaseFirst(envelope({ ok: true, value: { ...VIEW, folders: [] } }));
    await first;
    const v = getMemoryState().view;
    expect(v.status === "loaded" && v.value.folders.length).toBe(2);
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
