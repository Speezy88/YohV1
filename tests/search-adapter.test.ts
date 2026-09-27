/**
 * Tests for `src/adapters/search-adapter.ts` (Story 6.4 / FR-28).
 *
 * No live Perplexity account is available in this environment, so every
 * test injects a fake `FetchLike` — the same pattern
 * `notification-adapter.ts`'s own tests already establish for Pushover.
 * Response fixtures follow this file's own documented ASSUMPTION about the
 * Agent API's `output[]` shape (see `search-adapter.ts`'s module
 * docstring) — not a confirmed live shape.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PERPLEXITY_PRESET,
  loadSearchAdapterConfigFromEnv,
  PERPLEXITY_RESPONSES_ENDPOINT,
  search,
  type FetchLike,
  type HttpResponseLike,
} from "../src/adapters/search-adapter.ts";

function fakeFetch(
  response: HttpResponseLike | (() => HttpResponseLike),
): { readonly calls: Array<{ readonly url: string; readonly init: unknown }>; readonly fetch: FetchLike } {
  const calls: Array<{ url: string; init: unknown }> = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return typeof response === "function" ? response() : response;
    },
  };
}

function jsonResponse(status: number, body: unknown): HttpResponseLike {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("search returns the answer text and citation URLs parsed from output[]", async () => {
  const { fetch, calls } = fakeFetch(
    jsonResponse(200, {
      output: [
        { type: "message", content: [{ type: "output_text", text: "Water boils at 100°C at sea level." }] },
        { type: "search_results", search_results: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }] },
      ],
    }),
  );

  const result = await search({ apiKey: "test-key", fetch }, "boiling point of water");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.answer, "Water boils at 100°C at sea level.");
  assert.deepEqual(result.value.citations, ["https://example.com/a", "https://example.com/b"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, PERPLEXITY_RESPONSES_ENDPOINT);
});

test("search sends the Bearer auth header and the query as input", async () => {
  const { fetch, calls } = fakeFetch(jsonResponse(200, { output: [] }));
  await search({ apiKey: "test-key", fetch }, "some query");
  const init = calls[0]!.init as { headers: Record<string, string>; body: string };
  assert.equal(init.headers["Authorization"], "Bearer test-key");
  const body = JSON.parse(init.body);
  assert.equal(body.input, "some query");
  assert.equal(body.preset, DEFAULT_PERPLEXITY_PRESET);
  assert.equal(body.model, undefined);
});

test("search sends config.model instead of the preset when one is configured", async () => {
  const { fetch, calls } = fakeFetch(jsonResponse(200, { output: [] }));
  await search({ apiKey: "test-key", fetch, model: "some/model" }, "q");
  const body = JSON.parse((calls[0]!.init as { body: string }).body);
  assert.equal(body.model, "some/model");
  assert.equal(body.preset, undefined);
});

test("search reads citations from the live Agent API shape (search_results item with results[].url)", async () => {
  const { fetch } = fakeFetch(
    jsonResponse(200, {
      output: [
        { type: "search_results", queries: ["q"], results: [{ id: 1, url: "https://example.com/x", title: "X" }, { id: 2, url: "https://example.com/y" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "The answer.", annotations: [] }] },
      ],
    }),
  );
  const result = await search({ apiKey: "test-key", fetch }, "q");
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { answer: "The answer.", citations: ["https://example.com/x", "https://example.com/y"] });
});

test("search returns a successful empty SearchAnswer for a legitimate zero-result response, never a YohError", async () => {
  const { fetch } = fakeFetch(jsonResponse(200, { output: [] }));
  const result = await search({ apiKey: "test-key", fetch }, "an obscure query");
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { answer: "", citations: [] });
});

test("search returns YohError.kind 'rate-limited' on an HTTP 429, distinct from a zero-result answer", async () => {
  const { fetch } = fakeFetch(jsonResponse(429, { error: "rate limited" }));
  const result = await search({ apiKey: "test-key", fetch }, "query");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "rate-limited");
});

test("search returns YohError.kind 'unreachable' on any other non-2xx response", async () => {
  const { fetch } = fakeFetch(jsonResponse(500, { error: "server error" }));
  const result = await search({ apiKey: "test-key", fetch }, "query");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "unreachable");
});

test("search returns YohError.kind 'unreachable' rather than throwing when the fetch call itself rejects", async () => {
  const failingFetch: FetchLike = async () => {
    throw new Error("network down");
  };
  const result = await search({ apiKey: "test-key", fetch: failingFetch }, "query");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "unreachable");
});

test("loadSearchAdapterConfigFromEnv reads PERPLEXITY_API_KEY", () => {
  const config = loadSearchAdapterConfigFromEnv({ PERPLEXITY_API_KEY: "sk-test" });
  assert.equal(config.apiKey, "sk-test");
});

test("loadSearchAdapterConfigFromEnv throws when PERPLEXITY_API_KEY is missing", () => {
  assert.throws(() => loadSearchAdapterConfigFromEnv({}), /PERPLEXITY_API_KEY/);
});
