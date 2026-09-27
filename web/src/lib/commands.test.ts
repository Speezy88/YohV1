import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiClient } from "./apiClient.ts";
import { __resetCommandsForTests, fetchCommands, filterCommands } from "./commands.ts";

vi.mock("./apiClient.ts", () => ({ apiClient: { api: { commands: { $get: vi.fn() } } } }));

const REGISTRY = [
  { name: "/morning", description: "Opens today's Morning Ritual…", example: "/morning" },
  { name: "/night", description: "Runs the Night Ritual close-out…", example: "/night" },
];

describe("commands store", () => {
  beforeEach(() => {
    __resetCommandsForTests();
    (apiClient.api.commands.$get as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ ok: true, value: { commands: REGISTRY } }) });
  });

  it("fetches once and caches thereafter", async () => {
    await fetchCommands();
    await fetchCommands();
    expect(apiClient.api.commands.$get).toHaveBeenCalledTimes(1);
  });

  it("concurrent callers before the first response share one in-flight request", async () => {
    const [a, b] = await Promise.all([fetchCommands(), fetchCommands()]);
    expect(a).toEqual(b);
    expect(apiClient.api.commands.$get).toHaveBeenCalledTimes(1);
  });

  it("a failed fetch resolves to an empty list rather than throwing", async () => {
    (apiClient.api.commands.$get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));
    expect(await fetchCommands()).toEqual([]);
  });
});

describe("filterCommands", () => {
  it("prefix-matches case-insensitively", () => {
    expect(filterCommands(REGISTRY, "/m")).toEqual([REGISTRY[0]]);
    expect(filterCommands(REGISTRY, "/NIG")).toEqual([REGISTRY[1]]);
  });

  it("a bare '/' matches every command", () => {
    expect(filterCommands(REGISTRY, "/")).toEqual(REGISTRY);
  });

  it("returns nothing for a query matching no command", () => {
    expect(filterCommands(REGISTRY, "/xyz")).toEqual([]);
  });
});
