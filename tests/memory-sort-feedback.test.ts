/** Sorting feedback: the pure example lines the memory filer reads. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MEMORY_SORT_EXAMPLES_MAX, sortingExampleLines } from "../src/core/memory-sort-feedback.ts";
import type { MemorySortFeedback } from "../src/types/domain.ts";

const FB = (o: Partial<MemorySortFeedback> = {}): MemorySortFeedback => ({
  itemId: "i1",
  text: "Prefers deep work before lunch",
  folder: "about-you",
  verdict: "wrong",
  reason: "It's a scheduling rule, not a fact about me.",
  createdAt: "2026-10-03T12:00:00.000Z",
  ...o,
});

test("a wrong verdict names the folder it was filed in, where it belongs, and the reason", () => {
  assert.deepEqual(sortingExampleLines([FB({ belongsIn: "planning-preferences" })]), [
    `- "Prefers deep work before lunch" filed in about-you: wrong, belongs in planning-preferences. Reason: It's a scheduling rule, not a fact about me.`,
  ]);
  assert.deepEqual(sortingExampleLines([FB()]), [
    `- "Prefers deep work before lunch" filed in about-you: wrong. Reason: It's a scheduling rule, not a fact about me.`,
  ]);
});

test("a right verdict reads as right; line breaks in the reason are flattened", () => {
  assert.deepEqual(sortingExampleLines([FB({ verdict: "right", reason: "A fact\nabout   me." })]), [
    `- "Prefers deep work before lunch" filed in about-you: right. Reason: A fact about me.`,
  ]);
});

test("keeps only the first MEMORY_SORT_EXAMPLES_MAX entries, in the order given", () => {
  const many = Array.from({ length: MEMORY_SORT_EXAMPLES_MAX + 3 }, (_, n) => FB({ itemId: `i${n}`, text: `Fact ${n}` }));
  const lines = sortingExampleLines(many);
  assert.equal(lines.length, MEMORY_SORT_EXAMPLES_MAX);
  assert.match(lines[0] as string, /"Fact 0"/);
  assert.deepEqual(sortingExampleLines([]), []);
});
