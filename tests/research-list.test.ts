/**
 * Tests for `src/app/research-list.ts` (Task 6C, FR-43): the Research Hub
 * page's one read — most-recent-first, capped at 20, an honest error when
 * the Notion read throws.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { listResearch, type ResearchListDeps } from "../src/app/research-list.ts";
import type { ResearchVaultRecord } from "../src/types/domain.ts";

function record(id: string, overrides: Partial<ResearchVaultRecord> = {}): ResearchVaultRecord {
  return { id, title: id, sourceCount: 0, url: `https://notion.so/${id}`, ...overrides };
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
  const result = await listResearch(deps({ readResearchVault: async () => records }), {});
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
  const result = await listResearch(deps({ readResearchVault: async () => records }), {});
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.items.map((i) => i.id),
    ["dated", "a-undated", "z-undated"],
  );
});

test("caps the list at 20 items, keeping the most recent", async () => {
  const records = Array.from({ length: 25 }, (_, i) => record(`r-${i}`, { title: `r-${i}`, date: `2026-09-${String(i + 1).padStart(2, "0")}` }));
  const result = await listResearch(deps({ readResearchVault: async () => records }), {});
  assert.ok(result.ok);
  assert.equal(result.value.items.length, 20);
  assert.equal(result.value.items[0]!.id, "r-24");
});

test("maps every field through, omitting date when unset", async () => {
  const result = await listResearch(
    deps({ readResearchVault: async () => [record("r1", { title: "AP Bio registration deadline", sourceCount: 3, url: "https://notion.so/r1" })] }),
    {},
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
    {},
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
  assert.equal(result.error.message, "I couldn't reach Notion right now; nothing was changed.");
});
