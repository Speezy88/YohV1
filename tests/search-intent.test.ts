/**
 * Tests for `src/core/search-intent.ts` (real-use fixes plan, Task 5).
 *
 * Table-driven positives/negatives, the same style as
 * `tests/chat-commands.test.ts`'s own recognizer tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSearchIntent } from "../src/core/search-intent.ts";

// ============================================================================
// Search-positive: an explicit search verb, or a current-information cue.
// ============================================================================

const SEARCH_POSITIVE_LINES = [
  "what's the latest AI news",
  "price of bitcoin",
  "search for the best hiking boots",
  "look up the weather in NYC",
  "google the population of France",
  "find out who won the game last night",
  "research the history of Rome",
  "what happened at the debate last night",
  "who won the world series",
  "what's the current price of gold",
  "how's the stock market doing today",
  "what's the score of the game",
  "this week's top news stories",
];

for (const line of SEARCH_POSITIVE_LINES) {
  test(`parseSearchIntent recognizes a search-shaped line: "${line}"`, () => {
    const result = parseSearchIntent(line);
    assert.ok(result, `expected "${line}" to be recognized as a search-trigger`);
    assert.ok(result!.query.length > 0, `expected a non-empty query for "${line}"`);
  });
}

// ============================================================================
// Planning negatives — must NEVER match, even when they happen to contain a
// word that's also a current-information cue ("today's", "this week").
// ============================================================================

const PLANNING_NEGATIVE_LINES = [
  "what's on my plan today",
  "what do I have today",
  "today's plan",
  "my tasks this week",
  "what should I have for lunch",
  "plan my day",
  "show my plan",
  "time budget 6 hours",
  "why is homework prioritized",
  "what's my schedule looking like this week",
  // I1 (final-review): the cue path must not send Spencer's own planning
  // questions to Perplexity — first-person lines, and lines about
  // due/homework/assignments/essays/what he's working on, stay on the
  // deterministic-fallthrough route (the chat tool loop).
  "what's due this week?",
  "any homework due this week?",
  "what should I work on right now?",
  "whats the latest on my lab report",
];

for (const line of PLANNING_NEGATIVE_LINES) {
  test(`parseSearchIntent does NOT match a planning line: "${line}"`, () => {
    assert.equal(parseSearchIntent(line), undefined, `expected "${line}" to stay on its existing deterministic route`);
  });
}

// ============================================================================
// Explicit "search:" prefix (Ruling: what Research Hub's ask box always
// sends) — the query is everything after the prefix, verbatim.
// ============================================================================

test('parseSearchIntent treats a leading "search:" prefix as explicit, query = the rest', () => {
  assert.deepEqual(parseSearchIntent("search: AP Bio registration deadline"), { query: "AP Bio registration deadline" });
});

test('parseSearchIntent\'s "search:" prefix is case-insensitive and tolerates extra whitespace', () => {
  assert.deepEqual(parseSearchIntent("SEARCH:   what's the latest on tuition increases"), { query: "what's the latest on tuition increases" });
});

// ============================================================================
// Query extraction: an explicit verb match strips the verb phrase; a cue
// match keeps the whole line (no verb to strip).
// ============================================================================

test('parseSearchIntent strips a leading search verb from the query ("search for X" -> "X")', () => {
  assert.deepEqual(parseSearchIntent("search for the best hiking boots"), { query: "the best hiking boots" });
});

test("parseSearchIntent strips a mid-sentence search verb, collapsing the resulting whitespace", () => {
  assert.deepEqual(parseSearchIntent("can you look up the weather in NYC"), { query: "the weather in NYC" });
});

test("parseSearchIntent falls back to the whole line when stripping the verb would leave nothing", () => {
  assert.deepEqual(parseSearchIntent("google"), { query: "google" });
});

test("parseSearchIntent keeps the whole line as the query for a cue-only match (no verb to strip)", () => {
  assert.deepEqual(parseSearchIntent("price of bitcoin"), { query: "price of bitcoin" });
});

// ============================================================================
// Misc: never confuses "research" (the search verb) with "research vault"
// (Yoh's own Notion database) — that line is handled by
// `core/chat-commands.ts`'s own recognizers before this function ever runs,
// and shouldn't ALSO look like a search trigger on its own.
// ============================================================================

test('parseSearchIntent does not treat "research vault" as the search verb "research"', () => {
  assert.equal(parseSearchIntent("check my research vault"), undefined);
});

test("parseSearchIntent: search verbs mid-sentence and first-person statements stay tasks/captures (controller fix)", () => {
  for (const line of [
    "I need to research colleges this week",
    "remind me to look up flights tomorrow",
    "add task: research ACT prep books",
    "I'm feeling current on my work",
    "stock up on groceries",
    "today I finished the history poster",
  ]) {
    assert.equal(parseSearchIntent(line), undefined, line);
  }
});

test("parseSearchIntent: a polite lead before the verb is stripped from the query", () => {
  assert.deepEqual(parseSearchIntent("hey Yoh, could you please look up the Seahawks score"), { query: "the Seahawks score" });
});

test("parseSearchIntent returns undefined for an empty or blank line", () => {
  assert.equal(parseSearchIntent(""), undefined);
  assert.equal(parseSearchIntent("   "), undefined);
});
