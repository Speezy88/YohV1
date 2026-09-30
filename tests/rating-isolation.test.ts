/** Story 13.11: ratings never reach a model call. No file that makes a model call may import the rating store. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("model-calling modules never import rating-store or rating-schedule", () => {
  for (const file of ["adapters/llm-adapter.ts", "app/general-question.ts", "app/create-item.ts", "app/memory-recall.ts", "app/file-memory.ts"]) {
    let src: string;
    try {
      src = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    } catch {
      continue;
    }
    assert.doesNotMatch(src, /rating-store|rating-schedule|\/rate\.ts/, file);
  }
});
