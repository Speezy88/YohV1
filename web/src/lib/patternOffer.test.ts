import { describe, it, expect, vi, beforeEach } from "vitest";
import { offerTodaysPattern } from "./patternOffer.ts";
import * as chatStore from "./chatStore.ts";
import { apiClient } from "./apiClient.ts";

vi.mock("./apiClient.ts", () => ({ apiClient: { api: { memory: { "pattern-offer": { $get: vi.fn() } } } } }));
const get = apiClient.api.memory["pattern-offer"].$get as unknown as ReturnType<typeof vi.fn>;
const question = { requestId: "proposal:p1", questionId: "confirm", text: "a\nb\nc", options: [{ label: "Yes", value: "yes" }], allowsFreeText: false };

describe("offerTodaysPattern", () => {
  beforeEach(() => { vi.restoreAllMocks(); get.mockReset(); });

  it("appends the returned question through the deduping proposal append", async () => {
    const append = vi.spyOn(chatStore, "appendProposalQuestion").mockImplementation(() => {});
    get.mockResolvedValue({ json: async () => ({ ok: true, value: { question } }) });
    await offerTodaysPattern();
    expect(append).toHaveBeenCalledWith(question);
  });

  it("appends nothing when there is no question, on an error result, or when the request throws", async () => {
    const append = vi.spyOn(chatStore, "appendProposalQuestion").mockImplementation(() => {});
    get.mockResolvedValueOnce({ json: async () => ({ ok: true, value: {} }) });
    await offerTodaysPattern();
    get.mockResolvedValueOnce({ json: async () => ({ ok: false, error: { kind: "unreachable", message: "x" } }) });
    await offerTodaysPattern();
    get.mockRejectedValueOnce(new Error("down"));
    await expect(offerTodaysPattern()).resolves.toBeUndefined();
    expect(append).not.toHaveBeenCalled();
  });
});
