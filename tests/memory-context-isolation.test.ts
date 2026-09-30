import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

/** The text of one top-level exported function declaration (signature through the next top-level `}`). */
function declaration(source: string, name: string): string {
  const start = source.search(new RegExp(`export (async )?function\\*? ${name}\\b`));
  assert.ok(start >= 0, `${name} not found`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end + 3);
}

const MEMORY = /MemoryContext|memory-context|\bmemory\b/;

test("classifyCapture and classifyChatIntent take no memory", () => {
  const source = read("src/adapters/llm-adapter.ts");
  for (const name of ["classifyCapture", "classifyChatIntent"]) {
    assert.doesNotMatch(declaration(source, name), MEMORY, name);
  }
});

test("search-intent, the scheduler and confirm-proposal never touch memory context", () => {
  for (const path of ["src/core/search-intent.ts", "src/rituals/reshuffle.ts", "src/app/confirm-proposal.ts"]) {
    assert.doesNotMatch(read(path), /MemoryContext|memory-context|memory-recall|memory-item-store/, path);
  }
});
