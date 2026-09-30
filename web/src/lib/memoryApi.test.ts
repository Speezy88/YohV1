import { describe, it, expect, vi, beforeEach } from "vitest";
import { MEMORY_FOLDER_LABELS, hasMemoryPage, undoMemoryReceipt } from "./memoryApi.ts";
import { apiClient } from "./apiClient.ts";

vi.mock("./apiClient.ts", () => ({ apiClient: { api: { memory: { undo: { $post: vi.fn() } } } } }));
const post = apiClient.api.memory.undo.$post as unknown as ReturnType<typeof vi.fn>;
const reply = (body: unknown) => ({ json: async () => body });

describe("memoryApi", () => {
  beforeEach(() => post.mockReset());

  it("pins the eight folder labels", () => {
    expect(Object.values(MEMORY_FOLDER_LABELS)).toEqual([
      "Feedback", "Planning preferences", "Corrections", "About you", "Patterns", "Goals & projects", "Decisions & commitments", "Ideas & notes",
    ]);
  });

  it("has a Memory page now", () => {
    expect(hasMemoryPage()).toBe(true);
  });

  it("returns the server message on success and sends the receipt id", async () => {
    post.mockResolvedValue(reply({ ok: true, value: { receiptId: "r1", message: "Removed from memory." } }));
    expect(await undoMemoryReceipt("r1")).toEqual({ status: "ok", message: "Removed from memory." });
    expect(post).toHaveBeenCalledWith({ json: { receiptId: "r1" } });
  });

  it("maps a conflict to refused", async () => {
    post.mockResolvedValue(reply({ ok: false, error: { kind: "conflict", message: "That can't be undone any more." } }));
    expect(await undoMemoryReceipt("r1")).toEqual({ status: "refused", message: "That can't be undone any more." });
  });

  it("maps other errors and thrown requests to failed", async () => {
    post.mockResolvedValue(reply({ ok: false, error: { kind: "unreachable", message: "x" } }));
    expect(await undoMemoryReceipt("r1")).toEqual({ status: "failed" });
  });

  it("maps a thrown request to failed", async () => {
    post.mockResolvedValue({ json: async () => "not an envelope" });
    const out = await undoMemoryReceipt("r1");
    expect(out).toEqual({ status: "failed" });
  });
});
