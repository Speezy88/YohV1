import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("search-intent, the scheduler and confirm-proposal never touch memory context", () => {
  for (const path of ["src/core/search-intent.ts", "src/rituals/reshuffle.ts", "src/app/confirm-proposal.ts"]) {
    assert.doesNotMatch(read(path), /MemoryContext|memory-context|memory-recall|memory-item-store/, path);
  }
});
