/**
 * Tests for `src/app/web-search.ts` (Story 8.4).
 *
 * Moved/adapted from `tests/chat-cli.test.ts`'s "Web search via chat"
 * section (`handleSearchCommand`'s own tests, plus the F5/Ruling-R20
 * lastSearchAnswer-clearing regressions).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchWeb, type WebSearchDeps } from "../src/app/web-search.ts";
import type { ChatSession } from "../src/app/chat-session.ts";
import type { ChatStreamEvent } from "../src/types/api.ts";

function tempSession(): ChatSession {
  return { recentMessages: [], lastSearchAnswer: undefined };
}

test("a successful search renders the answer with its citations and sets session.lastSearchAnswer", async () => {
  const session = tempSession();
  const deps: WebSearchDeps = {
    session,
    webSearchAvailable: true,
    searchFn: async () => ({ ok: true, value: { answer: "Salomon and Merrell test well.", citations: ["https://example.com/a"] } }),
  };
  const result = await searchWeb(deps, { query: "best hiking boots under $150" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value.reply, /Salomon and Merrell test well\./);
  assert.match(result.value.reply, /https:\/\/example\.com\/a/);
  assert.deepEqual(session.lastSearchAnswer, { query: "best hiking boots under $150", answer: { answer: "Salomon and Merrell test well.", citations: ["https://example.com/a"] } });
});

test("a legitimate zero-result answer is relayed honestly, not as an error, and clears lastSearchAnswer", async () => {
  const session = tempSession();
  session.lastSearchAnswer = { query: "stale", answer: { answer: "stale answer", citations: [] } };
  const deps: WebSearchDeps = { session, webSearchAvailable: true, searchFn: async () => ({ ok: true, value: { answer: "", citations: [] } }) };
  const result = await searchWeb(deps, { query: "something obscure" });
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.value.reply, /didn't find anything useful/);
  assert.equal(session.lastSearchAnswer, undefined);
});

test("a search failure is reported plainly and clears lastSearchAnswer (F5, Epic 6 retro Ruling R20)", async () => {
  const session = tempSession();
  session.lastSearchAnswer = { query: "stale", answer: { answer: "stale answer", citations: [] } };
  const deps: WebSearchDeps = { session, webSearchAvailable: true, searchFn: async () => ({ ok: false, error: { kind: "unreachable", message: "Perplexity is down" } }) };
  const result = await searchWeb(deps, { query: "anything" });
  assert.equal(result.ok, true);
  // Task 4 (real-use fixes plan): a plain, honest sentence from
  // `core/error-copy.ts` — never the raw adapter message ("Perplexity is
  // down") verbatim.
  if (result.ok) assert.equal(result.value.reply, "I couldn't reach web search right now; nothing was changed.");
  assert.equal(session.lastSearchAnswer, undefined);
});

test("Review Focus #2: emits a 'Searching the web…' status only when deps.emit is present", async () => {
  const session = tempSession();
  const events: ChatStreamEvent[] = [];
  const deps: WebSearchDeps = {
    session,
    webSearchAvailable: true,
    searchFn: async () => ({ ok: true, value: { answer: "x", citations: [] } }),
    emit: (e) => events.push(e),
  };
  await searchWeb(deps, { query: "x" });
  assert.deepEqual(events, [{ type: "status", text: "Searching the web…" }]);
});

test("Review Focus #2 (CLI path): no emit supplied never throws", async () => {
  const session = tempSession();
  const deps: WebSearchDeps = { session, webSearchAvailable: true, searchFn: async () => ({ ok: true, value: { answer: "x", citations: [] } }) };
  const result = await searchWeb(deps, { query: "x" }); // deps.emit is undefined — must not throw
  assert.equal(result.ok, true);
});

// ============================================================================
// Review fix (real-use fixes plan, Task 5 fix): FR-42 — Yoh must never
// attempt (or claim to attempt) a web search when it isn't actually
// configured (no PERPLEXITY_API_KEY). `webSearchAvailable: false` short-
// circuits BEFORE `searchFn` is ever called, with a plain, honest reply.
// ============================================================================

test("searchWeb never calls searchFn when webSearchAvailable is false, and replies with the plain 'not set up' message", async () => {
  const session = tempSession();
  let searchFnCalls = 0;
  const deps: WebSearchDeps = {
    session,
    webSearchAvailable: false,
    searchFn: async () => {
      searchFnCalls++;
      return { ok: true, value: { answer: "should never be reached", citations: [] } };
    },
  };

  const result = await searchWeb(deps, { query: "best hiking boots" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.reply, "Web search isn't set up yet (it needs a Perplexity key).");
  assert.deepEqual(result.value.receipts, []);
  assert.equal(searchFnCalls, 0, "searchFn must never be called when webSearchAvailable is false — no search is attempted at all");
});

test("searchWeb clears any earlier session.lastSearchAnswer when webSearchAvailable is false", async () => {
  const session = tempSession();
  session.lastSearchAnswer = { query: "stale", answer: { answer: "stale answer", citations: [] } };
  const deps: WebSearchDeps = {
    session,
    webSearchAvailable: false,
    searchFn: async () => ({ ok: true, value: { answer: "x", citations: [] } }),
  };

  await searchWeb(deps, { query: "anything" });

  assert.equal(session.lastSearchAnswer, undefined);
});

test("searchWeb emits no 'Searching the web…' status when webSearchAvailable is false", async () => {
  const session = tempSession();
  const events: ChatStreamEvent[] = [];
  const deps: WebSearchDeps = {
    session,
    webSearchAvailable: false,
    searchFn: async () => ({ ok: true, value: { answer: "x", citations: [] } }),
    emit: (e) => events.push(e),
  };

  await searchWeb(deps, { query: "x" });

  assert.deepEqual(events, [], "no status event should be emitted for a search that's never attempted");
});
