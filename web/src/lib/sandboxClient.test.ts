/**
 * web/src/lib/sandboxClient.test.ts — Story 9.2: the three `/sandbox` calls,
 * over the typed Hono RPC client. Every call resolves to an outcome and
 * never throws. Mocks `apiClient.ts` directly, mirroring `checkOff.test.ts`'s
 * own established convention — Hono's `hc()` client is a runtime Proxy, so
 * `vi.spyOn` on an accessed property doesn't stick across calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiClient } from "./apiClient.ts";
import { requestSandboxStart, requestSandboxSave, requestSandboxSkip } from "./sandboxClient.ts";

vi.mock("./apiClient.ts", () => {
  const byId = { save: { $post: vi.fn() }, skip: { $post: vi.fn() } };
  return { apiClient: { api: { sandbox: { start: { $post: vi.fn() }, ":taskId": byId } } } };
});

const api = apiClient.api.sandbox as unknown as {
  start: { $post: ReturnType<typeof vi.fn> };
  ":taskId": Record<"save" | "skip", { $post: ReturnType<typeof vi.fn> }>;
};

function respond(body: unknown) {
  return { json: async () => body };
}

describe("sandboxClient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requestSandboxStart resolves ok:true with the server's value", async () => {
    api.start.$post.mockResolvedValue(respond({ ok: true, value: { card: undefined } }));
    const result = await requestSandboxStart();
    expect(result).toEqual({ ok: true, value: { card: undefined } });
    expect(api.start.$post).toHaveBeenCalledWith({ json: {} });
  });

  it("requestSandboxSave resolves ok:false with the server's error message", async () => {
    api[":taskId"].save.$post.mockResolvedValue(respond({ ok: false, error: { kind: "validation", message: "bad area" } }));
    const result = await requestSandboxSave("t1", { dueDate: "2026-09-30", estimatedDurationMinutes: "45", exclude: [] });
    expect(result).toEqual({ ok: false, message: "bad area" });
    expect(api[":taskId"].save.$post).toHaveBeenCalledWith({
      param: { taskId: "t1" },
      json: { dueDate: "2026-09-30", estimatedDurationMinutes: "45", exclude: [] },
    });
  });

  it("requestSandboxSkip resolves ok:false on a thrown network error, never throwing itself", async () => {
    api[":taskId"].skip.$post.mockRejectedValue(new Error("network down"));
    const result = await requestSandboxSkip("t1", { exclude: [] });
    expect(result).toEqual({ ok: false, message: "network down" });
  });
});
