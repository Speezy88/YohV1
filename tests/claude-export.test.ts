import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  batchConversations,
  batchDistilled,
  estimateExtractCostUsd,
  EXPORT_MESSAGE_MAX_CHARS,
  mergeCandidates,
  parseExtractedCandidates,
  readConversations,
  readProjects,
  readSavedMemory,
  renderDistilled,
  type ExtractedCandidate,
} from "../src/core/claude-export.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/claude-export/${name}`, import.meta.url), "utf8"));

test("readConversations keeps only Spencer's messages and skips what does not fit", () => {
  const r = readConversations(fixture("conversations.json"));
  assert.equal(r.skipped, 3);
  assert.deepEqual(r.conversations, [
    { date: "2025-11-02", humanMessages: ["I run most mornings before school and I want to keep that.", "Also I am allergic to peanuts."] },
    { date: "2026-01-10", humanMessages: ["I am building a planning assistant on a Raspberry Pi."] },
  ]);
  assert.ok(!JSON.stringify(r.conversations).includes("swimming"));
});

test("readConversations caps a long message and tolerates a wrong shape", () => {
  const long = [{ name: "x", updated_at: "2026-01-01T00:00:00Z", chat_messages: [{ sender: "human", text: "a".repeat(EXPORT_MESSAGE_MAX_CHARS + 50) }] }];
  assert.equal(readConversations(long).conversations[0]?.humanMessages[0]?.length, EXPORT_MESSAGE_MAX_CHARS);
  assert.deepEqual(readConversations(undefined), { conversations: [], skipped: 0 });
  assert.deepEqual(readConversations({ nope: true }), { conversations: [], skipped: 0 });
});

test("readProjects and readSavedMemory return the non-empty distilled sources", () => {
  assert.deepEqual(readProjects(fixture("projects.json")), [{ label: "Project instructions: Yoh", text: "Keep answers short. I plan my day the night before." }]);
  assert.deepEqual(readProjects({ name: "Solo", prompt_template: "One file per project." }), [{ label: "Project instructions: Solo", text: "One file per project." }]);
  assert.deepEqual(readSavedMemory(fixture("memories.json")), [
    { label: "Claude's saved memory", text: "Spencer is a student who dives." },
    { label: "Claude's saved project memory", text: "Yoh runs on a Raspberry Pi." },
    { label: "Claude's memory file: preferences.md", text: "Prefers morning study blocks." },
  ]);
  assert.deepEqual(readProjects(undefined), []);
  assert.deepEqual(readSavedMemory(undefined), []);
  assert.equal(renderDistilled([{ label: "A", text: "one" }, { label: "B", text: "two" }]), "### A\none\n\n### B\ntwo");
});

test("batchDistilled packs sources under the limit and splits an oversized one", () => {
  assert.deepEqual(batchDistilled([{ label: "A", text: "one" }, { label: "B", text: "two" }]), ["### A\none\n\n### B\ntwo"]);
  assert.deepEqual(batchDistilled([{ label: "A", text: "a".repeat(30) }, { label: "B", text: "b".repeat(30) }], 50), [`### A\n${"a".repeat(30)}`, `### B\n${"b".repeat(30)}`]);
  assert.deepEqual(batchDistilled([{ label: "Big", text: "x".repeat(25) }], 10), [`### Big\n${"x".repeat(10)}`, `### Big\n${"x".repeat(10)}`, `### Big\n${"x".repeat(5)}`]);
  assert.deepEqual(batchDistilled([]), []);
});

test("batchConversations packs conversations under the limit and splits an oversized one", () => {
  const { conversations } = readConversations(fixture("conversations.json"));
  const one = batchConversations(conversations);
  assert.equal(one.length, 1);
  assert.match(one[0] as string, /^### Conversation \(2025-11-02\)\n- I run most mornings/);
  assert.match(one[0] as string, /### Conversation \(2026-01-10\)\n/);

  assert.ok(![...one, ...batchConversations(conversations, 120)].some((b) => b.includes("Morning routine")), "titles are never sent");

  const small = batchConversations(conversations, 120);
  assert.ok(small.length >= 2);
  assert.ok(small.every((b) => b.startsWith("### Conversation (")));
  assert.equal(small.join("\n").match(/allergic to peanuts/g)?.length, 1);

  const big = [{ date: "2026-03-01", humanMessages: ["m".repeat(80), "n".repeat(80), "o".repeat(80)] }];
  const split = batchConversations(big, 150);
  assert.equal(split.length, 3);
  assert.ok(split.every((b) => b.startsWith("### Conversation (2026-03-01)\n- ")));
  assert.deepEqual(batchConversations([]), []);
});

test("parseExtractedCandidates keeps valid elements and returns undefined for a non-array reply", () => {
  const reply = `Here you go:\n[{"folder":"about-you","text":"Runs most  mornings.","date":"2025-11-02"},{"folder":"about-you","text":"Has a peanut allergy.","sensitive":"health","date":"soon"},{"folder":"hobbies","text":"x"},{"folder":"about-you","text":""},{"folder":"about-you","text":"${"y".repeat(281)}"},7]`;
  assert.deepEqual(parseExtractedCandidates(reply, 2), [
    { folder: "about-you", text: "Runs most mornings.", stage: 2, sourceDate: "2025-11-02" },
    { folder: "about-you", text: "Has a peanut allergy.", stage: 2, sensitive: "health" },
  ]);
  assert.deepEqual(parseExtractedCandidates("[]", 1), []);
  assert.equal(parseExtractedCandidates("I could not find anything.", 2), undefined);
  assert.equal(parseExtractedCandidates('[{"folder": "about-you", "text": "cut off', 2), undefined);
  assert.equal(parseExtractedCandidates('{"folder":"about-you"}', 2), undefined);
});

test("parseExtractedCandidates salvages the complete elements of a cut-off array", () => {
  const cut = '[{"folder":"about-you","text":"One."},{"folder":"about-you","text":"Two."},{"folder":"about-you","te';
  assert.deepEqual(parseExtractedCandidates(cut, 1), [
    { folder: "about-you", text: "One.", stage: 1 },
    { folder: "about-you", text: "Two.", stage: 1 },
  ]);
  assert.equal(parseExtractedCandidates("[ not json at all", 1), undefined);
});

test("parseExtractedCandidates drops the patterns folder, which Yoh fills itself", () => {
  const reply = '[{"folder":"patterns","text":"Plans on Sunday."},{"folder":"about-you","text":"Runs most mornings."}]';
  assert.deepEqual(parseExtractedCandidates(reply, 2), [{ folder: "about-you", text: "Runs most mornings.", stage: 2 }]);
});

test("mergeCandidates collapses near-duplicates: stage 1 wins, then the newest wording", () => {
  const c = (o: Partial<ExtractedCandidate>): ExtractedCandidate => ({ folder: "about-you", text: "Runs most mornings before school", stage: 2, ...o });
  const merged = mergeCandidates([
    c({ text: "Runs most mornings before school", sourceDate: "2024-01-01" }),
    c({ text: "Runs most mornings before school now", sourceDate: "2026-01-01" }),
    c({ text: "runs most mornings before school.", stage: 1 }),
    c({ text: "Has a peanut allergy", sourceDate: "2025-01-01" }),
    c({ text: "Has a peanut allergy", sourceDate: "2025-06-01", sensitive: "health" }),
    c({ text: "Runs most mornings before school", folder: "patterns", sourceDate: "2025-01-01" }),
    c({ text: "Go", sourceDate: "2025-01-01" }),
    c({ text: "go!", sourceDate: "2025-02-01" }),
  ]);
  assert.deepEqual(merged.map((m) => [m.folder, m.text, m.stage]), [
    ["about-you", "runs most mornings before school.", 1],
    ["about-you", "Has a peanut allergy", 2],
    ["about-you", "go!", 2],
    ["patterns", "Runs most mornings before school", 2],
  ]);
  assert.equal(merged[1]?.sensitive, "health");
});

test("estimateExtractCostUsd grows with the text and is zero for no calls", () => {
  const model = "claude-haiku-4-5-20251001";
  assert.equal(estimateExtractCostUsd([], model), 0);
  const small = estimateExtractCostUsd(["a".repeat(4000)], model);
  const large = estimateExtractCostUsd(["a".repeat(4000), "a".repeat(400_000)], model);
  assert.ok(small > 0 && large > small);
  // 1 call: (1000 + 500) input tokens at $1/M plus 400 output tokens at $5/M.
  assert.ok(Math.abs(small - (1500 / 1_000_000 + (400 * 5) / 1_000_000)) < 1e-9);
});
