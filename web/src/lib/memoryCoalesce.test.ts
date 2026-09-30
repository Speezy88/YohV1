import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { __resetMemoryForTests, startMemoryStream } from "./memory.ts";

const get = (apiClient.api as unknown as { memory: { $get: ReturnType<typeof vi.fn> } }).memory.$get;
const VIEW = { ok: true, value: { folders: [], needsReview: [], changedSettings: [], pendingPatterns: [] } };

describe("memory refetch coalescing", () => {
  beforeEach(() => {
    __resetMemoryForTests();
    get.mockReset();
  });

  it("5 hints during one in-flight fetch produce 2 fetches total (in-flight + one trailing)", async () => {
    const releases: (() => void)[] = [];
    get.mockImplementation(() => new Promise((resolve) => releases.push(() => resolve({ json: async () => VIEW }))));
    startMemoryStream();
    expect(get).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) hintListener!({ seq: i, topic: "memory", entityId: "x" });
    expect(get).toHaveBeenCalledTimes(1);
    releases[0]!();
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    releases[1]!();
    await new Promise((r) => setTimeout(r, 20));
    expect(get).toHaveBeenCalledTimes(2);
  });
});
