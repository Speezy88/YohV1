import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSetTimeBudget } from "./timeBudget.ts";

afterEach(() => vi.unstubAllGlobals());

describe("requestSetTimeBudget", () => {
  it("does not show the raw error text when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("TypeError: secret-xyz")));
    const outcome = await requestSetTimeBudget(120);
    expect(outcome).toEqual({ ok: false, message: "Couldn't reach Meeseek — try again." });
  });
});
