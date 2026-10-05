import { test } from "node:test";
import assert from "node:assert/strict";
import { importBatchTag, isImportTag, parseMemoryImport, renderMemoryImport } from "../src/core/memory-import.ts";
import { toMemoryItemView } from "../src/core/memory-item-view.ts";
import type { MemoryItem } from "../src/types/domain.ts";

const FILE = [
  "# Memory import candidates",
  "",
  "> Delete lines you do not want.",
  "",
  "## About you",
  "",
  "- Runs most mornings before school. (2025-11-02)",
  "- Has a peanut allergy. (2025-03-10) [sensitive:health]",
  "",
  "## goals-projects",
  "* Is building Meeseek on a Raspberry Pi.",
].join("\n");

test("parses headings, list lines, dates and sensitive markers", () => {
  const r = parseMemoryImport(FILE);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.candidates, [
    { line: 7, folder: "about-you", text: "Runs most mornings before school." },
    { line: 8, folder: "about-you", text: "Has a peanut allergy.", sensitive: "health" },
    { line: 11, folder: "goals-projects", text: "Is building Meeseek on a Raspberry Pi." },
  ]);
});

test("Windows line endings and a byte-order mark parse the same", () => {
  const r = parseMemoryImport(`﻿${FILE.replace(/\n/g, "\r\n")}`);
  assert.deepEqual(r, parseMemoryImport(FILE));
});

test("text that ends in its own parentheses or brackets is kept whole", () => {
  const r = parseMemoryImport("## About you\n- Takes two maths classes (AP Calc)\n- Uses the tag [urgent]\n- Graduates in (2027)");
  assert.deepEqual(r.candidates.map((c) => c.text), ["Takes two maths classes (AP Calc)", "Uses the tag [urgent]", "Graduates in (2027)"]);
});

test("reports unknown headings, stray lines, lines before a heading and empty list lines", () => {
  const r = parseMemoryImport("- orphan\n## Hobbies\n- under an unknown heading\n## About you\nplain sentence\n- \n- fine");
  assert.deepEqual(r.candidates.map((c) => c.text), ["fine"]);
  assert.deepEqual(r.problems, [
    { line: 1, reason: "list line before any folder heading" },
    { line: 2, reason: 'unknown folder heading "Hobbies"' },
    { line: 5, reason: "not a heading or a list line" },
    { line: 6, reason: "empty list line" },
  ]);
});

test("markdown noise is a problem, not a filed line", () => {
  const r = parseMemoryImport("## About you\n---\n**Note**\n- fine");
  assert.deepEqual(r.candidates.map((c) => c.text), ["fine"]);
  assert.deepEqual(r.problems, [
    { line: 2, reason: "not a heading or a list line" },
    { line: 3, reason: "not a heading or a list line" },
  ]);
});

test("an empty file has no candidates and no problems", () => {
  assert.deepEqual(parseMemoryImport(""), { candidates: [], problems: [] });
});

test("render then parse round-trips, in folder order", () => {
  const text = renderMemoryImport(
    [
      { folder: "goals-projects", text: "Is building Meeseek." },
      { folder: "about-you", text: "Has a peanut allergy.", sensitive: "health", sourceDate: "2025-03-10" },
    ],
    ["Delete lines you do not want."],
  );
  assert.match(text, /^# Memory import candidates\n\n> Delete lines you do not want\.\n/);
  assert.ok(text.indexOf("## About you") < text.indexOf("## Goals & projects"));
  assert.match(text, /- Has a peanut allergy\. \(2025-03-10\) \[sensitive:health\]/);
  const r = parseMemoryImport(text);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.candidates.map((c) => [c.folder, c.text, c.sensitive]), [
    ["about-you", "Has a peanut allergy.", "health"],
    ["goals-projects", "Is building Meeseek.", undefined],
  ]);
});

test("batch tag", () => {
  assert.equal(importBatchTag("claude", "2026-10-03"), "import:claude-2026-10-03");
  assert.equal(isImportTag("import:claude-2026-10-03"), true);
  assert.equal(isImportTag("a3f1c2d4-turn"), false);
});

test("an import-tagged item has no source on the Memory page", () => {
  const item: MemoryItem = {
    id: "m1",
    folder: "about-you",
    text: "Runs at 6",
    origin: "inferred",
    ruleChange: "none",
    status: "current",
    createdAt: "2026-10-03T12:00:00.000Z",
    confirmedAt: "2026-10-03T12:00:00.000Z",
    sourceTurnId: "import:claude-2026-10-03",
  };
  const view = toMemoryItemView(item, { chain: [item], timeZone: "America/New_York" });
  assert.equal(view.source, undefined);
  const gone = toMemoryItemView({ ...item, sourceTurnId: "turn-that-was-deleted" }, { chain: [item], timeZone: "America/New_York" });
  assert.equal(gone.source, "deleted");
});
