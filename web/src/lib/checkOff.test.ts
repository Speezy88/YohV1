/**
 * web/src/lib/checkOff.test.ts — Story 7.10: the check-off API calls go to
 * the right RPC paths and turn every failure (envelope or network) into an
 * outcome the UI can render; the toast's duration is the server's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiClient } from "./apiClient.ts";
import { remainingMs, requestCheckOff, requestHold, requestRelease, requestUndo } from "./checkOff.ts";

vi.mock("./apiClient.ts", () => {
  const byId = { undo: { $post: vi.fn() }, hold: { $post: vi.fn() }, release: { $post: vi.fn() } };
  return { apiClient: { api: { "check-off": { $post: vi.fn(), ":id": byId } } } };
});

const api = apiClient.api["check-off"] as unknown as {
  $post: ReturnType<typeof vi.fn>;
  ":id": Record<"undo" | "hold" | "release", { $post: ReturnType<typeof vi.fn> }>;
};

const pending = { id: "p1", taskId: "t1", commitAt: "2026-09-25T18:00:05.000Z", asOf: "2026-09-25T18:00:00.000Z", held: false };

function respond(body: unknown) {
  return { json: async () => body };
}

describe("checkOff client", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POSTs only the taskId to /api/check-off and returns the pending record", async () => {
    api.$post.mockResolvedValue(respond({ ok: true, value: pending }));
    expect(await requestCheckOff("t1")).toEqual({ ok: true, value: pending });
    expect(api.$post).toHaveBeenCalledWith({ json: { taskId: "t1" } });
  });

  it("undo/hold/release address the pending record by id", async () => {
    for (const verb of ["undo", "hold", "release"] as const) api[":id"][verb].$post.mockResolvedValue(respond({ ok: true, value: pending }));
    await requestUndo("p1");
    await requestHold("p1");
    await requestRelease("p1");
    for (const verb of ["undo", "hold", "release"] as const) expect(api[":id"][verb].$post).toHaveBeenCalledWith({ param: { id: "p1" } });
  });

  it("an {ok: false} envelope surfaces the server's own message; a rejected request surfaces the fixed copy, never err.message", async () => {
    api[":id"].undo.$post.mockResolvedValue(respond({ ok: false, error: { kind: "conflict", message: "too late" } }));
    expect(await requestUndo("p1")).toEqual({ ok: false, message: "too late" });
    api.$post.mockRejectedValue(new Error("offline"));
    expect(await requestCheckOff("t1")).toEqual({ ok: false, message: "Couldn't reach Meeseek — try again." });
  });

  it("remainingMs is the server's commitAt - asOf, never below zero", () => {
    expect(remainingMs(pending)).toBe(5000);
    expect(remainingMs({ commitAt: pending.asOf, asOf: pending.commitAt })).toBe(0);
  });
});
