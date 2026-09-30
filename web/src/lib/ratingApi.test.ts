import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitRating } from "./ratingApi.ts";
import { apiClient } from "./apiClient.ts";

vi.mock("./apiClient.ts", () => ({ apiClient: { api: { rating: { $post: vi.fn() } } } }));
const post = apiClient.api.rating.$post as unknown as ReturnType<typeof vi.fn>;
const reply = (body: unknown) => ({ json: async () => body });
const RECEIPT = { receiptId: "r1", kind: "remembered", items: [] };

describe("submitRating", () => {
  beforeEach(() => post.mockReset());

  it("sends the request and returns ok with no receipt for a plain pick", async () => {
    post.mockResolvedValue(reply({ ok: true, value: {} }));
    expect(await submitRating({ promptId: "p1", score: 3 })).toEqual({ status: "ok" });
    expect(post).toHaveBeenCalledWith({ json: { promptId: "p1", score: 3 } });
  });

  it("returns the receipt a note produced", async () => {
    post.mockResolvedValue(reply({ ok: true, value: { receipt: RECEIPT } }));
    expect(await submitRating({ promptId: "p1", score: 1, note: "x" })).toEqual({ status: "ok", receipt: RECEIPT });
  });

  it("maps a conflict to closed", async () => {
    post.mockResolvedValue(reply({ ok: false, error: { kind: "conflict", message: "That rating is no longer open." } }));
    expect(await submitRating({ promptId: "p1", dismissed: true })).toEqual({ status: "closed" });
  });

  it("maps other errors and thrown requests to failed, never throwing", async () => {
    post.mockResolvedValue(reply({ ok: false, error: { kind: "unreachable", message: "x" } }));
    expect(await submitRating({ promptId: "p1", score: 2 })).toEqual({ status: "failed" });
    post.mockResolvedValue({ json: async () => "not an envelope" });
    expect(await submitRating({ promptId: "p1", score: 2 })).toEqual({ status: "failed" });
  });
});
