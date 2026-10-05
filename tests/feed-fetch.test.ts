/**
 * Tests for the shared feed request helper (review I1, M3, M12): body cap,
 * redirect rules and User-Agent, with a fake `fetch`; nothing contacts a provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FEED_MAX_BODY_BYTES, FeedError, fetchFeedText, type FeedResponse } from "../src/adapters/feed-cache.ts";

const signal = new AbortController().signal;
const hdr = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

function streamOf(chunks: Uint8Array[], onCancel: () => void): FeedResponse["body"] {
  let i = 0;
  return { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: chunks[i++]! } : { done: true }), cancel: async () => onCancel() }) };
}

test("I1: a content-length over the cap fails without reading the body", async () => {
  let read = false;
  const res = { ok: true, status: 200, headers: hdr({ "content-length": String(FEED_MAX_BODY_BYTES + 1) }), text: async () => { read = true; return ""; } };
  await assert.rejects(fetchFeedText((async () => res) as never, "https://a.b/x", { signal }), (e: unknown) => e instanceof FeedError && e.reason === "too-large");
  assert.equal(read, false);
});

test("I1: a streamed body is cut off at the cap; the stream is cancelled and later chunks are not read", async () => {
  let cancelled = false;
  const chunk = new Uint8Array(400_000);
  let pulled = 0;
  const body: FeedResponse["body"] = { getReader: () => ({ read: async () => { pulled++; return pulled <= 5 ? { done: false, value: chunk } : { done: true }; }, cancel: async () => { cancelled = true; } }) };
  const res = { ok: true, status: 200, body, text: async () => "" };
  await assert.rejects(fetchFeedText((async () => res) as never, "https://a.b/x", { signal }), (e: unknown) => e instanceof FeedError && e.reason === "too-large");
  assert.equal(cancelled, true);
  assert.equal(pulled, 3);
});

test("I1: a body under the cap is returned; a text-only body over the cap fails", async () => {
  const ok = { ok: true, status: 200, body: streamOf([new TextEncoder().encode("hel"), new TextEncoder().encode("lo")], () => {}), text: async () => "" };
  assert.equal(await fetchFeedText((async () => ok) as never, "https://a.b/x", { signal }), "hello");
  const big = { ok: true, status: 200, text: async () => "x".repeat(FEED_MAX_BODY_BYTES + 1) };
  await assert.rejects(fetchFeedText((async () => big) as never, "https://a.b/x", { signal }), (e: unknown) => e instanceof FeedError && e.reason === "too-large");
});

test("M3: redirect error by default; a 3xx is a failed read", async () => {
  const seen: unknown[] = [];
  const res = { ok: false, status: 301, headers: hdr({ location: "https://a.b/y" }), text: async () => "" };
  await assert.rejects(fetchFeedText((async (_u: string, init: unknown) => { seen.push(init); return res; }) as never, "https://a.b/x", { signal }), (e: unknown) => e instanceof FeedError && e.reason === "http-301");
  assert.equal((seen[0] as { redirect: string }).redirect, "error");
});

test("M3: with followSameHost, https same-host is followed once; http, other host and a second hop fail", async () => {
  const run = async (location: string, second?: { status: number; location?: string }) => {
    const urls: string[] = [];
    const fetchFn = async (u: string, init: { redirect: string }) => {
      urls.push(`${u}|${init.redirect}`);
      if (urls.length === 1) return { ok: false, status: 302, headers: hdr({ location }), text: async () => "" };
      return second && second.status >= 300 ? { ok: false, status: second.status, headers: hdr({ location: second.location ?? "" }), text: async () => "" } : { ok: true, status: 200, text: async () => "body" };
    };
    const out = await fetchFeedText(fetchFn as never, "https://a.b/x", { signal, followSameHost: true }).then((v) => v, (e: unknown) => (e as FeedError).reason);
    return { out, urls };
  };
  assert.deepEqual(await run("/y"), { out: "body", urls: ["https://a.b/x|manual", "https://a.b/y|manual"] });
  assert.equal((await run("http://a.b/y")).out, "redirect");
  assert.equal((await run("https://evil.example/y")).out, "redirect");
  assert.equal((await run("https://a.b:8443/y")).out, "redirect");
  assert.equal((await run("/y", { status: 302, location: "/z" })).out, "redirect");
});

test("M12: the same User-Agent goes out, default or configured", async () => {
  const seen: Record<string, string>[] = [];
  const fetchFn = async (_u: string, init: { headers: Record<string, string> }) => { seen.push(init.headers); return { ok: true, status: 200, text: async () => "" }; };
  await fetchFeedText(fetchFn as never, "https://a.b/x", { signal });
  await fetchFeedText(fetchFn as never, "https://a.b/x", { signal, userAgent: "Yoh/1.0 (me@example.com)" });
  assert.equal(seen[0]!["User-Agent"], "Yoh/1.0 (personal dashboard)");
  assert.equal(seen[1]!["User-Agent"], "Yoh/1.0 (me@example.com)");
});
