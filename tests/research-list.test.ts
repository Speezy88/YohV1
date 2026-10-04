/**
 * Tests for `src/app/research-list.ts` (Task 6C, FR-43): the Research Hub
 * page's one read — most-recent-first, capped at 20, an honest error when
 * the Notion read throws.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResearchDocument, listResearch, RESEARCH_PAGE_SIZE, type ResearchListDeps } from "../src/app/research-list.ts";
import type { ResearchVaultRecord } from "../src/types/domain.ts";

function record(id: string, overrides: Partial<ResearchVaultRecord> = {}): ResearchVaultRecord {
  return { id, title: id, keyFindings: "", sources: [], sourceCount: 0, url: `https://notion.so/${id}`, ...overrides };
}

function deps(overrides: Partial<ResearchListDeps> = {}): ResearchListDeps {
  return {
    readResearchVault: async () => [],
    ...overrides,
  };
}

test("lists items newest Date first", async () => {
  const records = [
    record("older", { title: "Older", date: "2026-09-01" }),
    record("newer", { title: "Newer", date: "2026-09-20" }),
    record("middle", { title: "Middle", date: "2026-09-10" }),
  ];
  const result = await listResearch(deps({ readResearchVault: async () => records }), { pages: 1 });
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.items.map((i) => i.id),
    ["newer", "middle", "older"],
  );
});

test("undated rows sort after every dated row, in title order among themselves", async () => {
  const records = [
    record("z-undated", { title: "Z undated" }),
    record("dated", { title: "Dated", date: "2026-09-01" }),
    record("a-undated", { title: "A undated" }),
  ];
  const result = await listResearch(deps({ readResearchVault: async () => records }), { pages: 1 });
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.items.map((i) => i.id),
    ["dated", "a-undated", "z-undated"],
  );
});

test("caps the list at 20 items, keeping the most recent", async () => {
  const records = Array.from({ length: 25 }, (_, i) => record(`r-${i}`, { title: `r-${i}`, date: `2026-09-${String(i + 1).padStart(2, "0")}` }));
  const result = await listResearch(deps({ readResearchVault: async () => records }), { pages: 1 });
  assert.ok(result.ok);
  assert.equal(result.value.items.length, 20);
  assert.equal(result.value.items[0]!.id, "r-24");
});

function many(n: number): ResearchVaultRecord[] {
  // r-0 is the oldest, r-(n-1) the newest.
  return Array.from({ length: n }, (_, i) => record(`r-${i}`, { title: `r-${i}`, date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10) }));
}

test("RESEARCH_PAGE_SIZE is 20", () => {
  assert.equal(RESEARCH_PAGE_SIZE, 20);
});

for (const [count, pages, expectedLen, expectedMore] of [
  [0, 1, 0, false],
  [20, 1, 20, false],
  [21, 1, 20, true],
  [21, 2, 21, false],
  [45, 1, 20, true],
  [45, 2, 40, true],
  [45, 3, 45, false],
] as const) {
  test(`${count} records at pages=${pages} gives ${expectedLen} items, hasMore ${expectedMore}`, async () => {
    const result = await listResearch(deps({ readResearchVault: async () => many(count) }), { pages });
    assert.ok(result.ok);
    assert.equal(result.value.items.length, expectedLen);
    assert.equal(result.value.hasMore, expectedMore);
    if (expectedLen > 0) assert.equal(result.value.items[0]!.id, `r-${count - 1}`);
    if (expectedLen > 0) assert.equal(result.value.items.at(-1)!.id, `r-${count - expectedLen}`);
  });
}

for (const bad of [undefined, "", "abc", "0", "-3", "1.5", "NaN"]) {
  test(`pages=${JSON.stringify(bad)} means page 1`, async () => {
    const result = await listResearch(deps({ readResearchVault: async () => many(45) }), { pages: bad });
    assert.ok(result.ok);
    assert.equal(result.value.items.length, 20);
    assert.equal(result.value.hasMore, true);
  });
}

test("pages given as a numeric string is honoured", async () => {
  const result = await listResearch(deps({ readResearchVault: async () => many(45) }), { pages: "2" });
  assert.ok(result.ok);
  assert.equal(result.value.items.length, 40);
});

test("maps every field through, omitting date when unset", async () => {
  const result = await listResearch(
    deps({ readResearchVault: async () => [record("r1", { title: "AP Bio registration deadline", sourceCount: 3, url: "https://notion.so/r1" })] }),
    { pages: 1 },
  );
  assert.ok(result.ok);
  assert.deepEqual(result.value.items, [{ id: "r1", title: "AP Bio registration deadline", sourceCount: 3, url: "https://notion.so/r1" }]);
});

test("a Notion read failure is an honest, plain error naming Notion", async () => {
  const result = await listResearch(
    deps({
      readResearchVault: async () => {
        throw new Error("notion-adapter: socket hang up");
      },
    }),
    { pages: 1 },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
  assert.equal(result.error.message, "I couldn't reach Notion right now; nothing was changed.");
});

test("getResearchDocument returns the document with the id given", async () => {
  const records = [
    record("a", { title: "A", date: "2026-09-20", keyFindings: "Body A", sources: ["https://a.example"], sourceCount: 1 }),
    record("b", { title: "B", date: "2026-09-10", keyFindings: "Body B\n\nMore", sources: ["https://b.example", "https://c.example"], sourceCount: 2 }),
  ];
  const result = await getResearchDocument(deps({ readResearchVault: async () => records }), { id: "b" });
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    document: { id: "b", title: "B", date: "2026-09-10", body: "Body B\n\nMore", sources: ["https://b.example", "https://c.example"], url: "https://notion.so/b" },
  });
});

test("getResearchDocument with an unknown id or no id returns the most recent document", async () => {
  const records = [record("old", { date: "2026-09-01" }), record("new", { date: "2026-09-20" })];
  for (const input of [{ id: "nope" }, {}, { id: "" }]) {
    const result = await getResearchDocument(deps({ readResearchVault: async () => records }), input);
    assert.ok(result.ok);
    assert.equal(result.value.document?.id, "new");
  }
});

test("getResearchDocument on an empty vault is a success with no document key", async () => {
  const result = await getResearchDocument(deps(), { id: "x" });
  assert.ok(result.ok);
  assert.deepEqual(result.value, {});
  assert.equal("document" in result.value, false);
});

test("getResearchDocument keeps an empty body and empty sources, omitting date when unset", async () => {
  const result = await getResearchDocument(deps({ readResearchVault: async () => [record("e")] }), { id: "e" });
  assert.ok(result.ok);
  assert.deepEqual(result.value, { document: { id: "e", title: "e", body: "", sources: [], url: "https://notion.so/e" } });
});

test("getResearchDocument maps a Notion failure to an honest unreachable error", async () => {
  const result = await getResearchDocument(
    deps({
      readResearchVault: async () => {
        throw new Error("socket hang up");
      },
    }),
    { id: "x" },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
  assert.equal(result.error.message, "I couldn't reach Notion right now; nothing was changed.");
});
