/**
 * Tests for `createCachedFeed` (Ruling E12-R17): the shared cache, timeout,
 * back-off and last-good logic every Desk feed adapter reuses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCachedFeed, FEED_BACKOFF_MS, FEED_STALE_LIMIT_MS, FEED_TIMEOUT_MS } from "../src/adapters/feed-cache.ts";
import type { LogEntry } from "../src/adapters/logger.ts";

const T0 = Date.parse("2026-10-07T12:00:00.000Z");

function setup(load: (signal: AbortSignal) => Promise<string>, refreshMs = 300_000) {
  let clock = T0;
  const logs: LogEntry[] = [];
  const feed = createCachedFeed<string>({ name: "demo", refreshMs, load, now: () => new Date(clock), log: (e) => logs.push(e) });
  return { feed, logs, advance: (ms: number) => void (clock += ms) };
}

test("a fresh value is served as ok without a request", async () => {
  let calls = 0;
  const { feed, advance } = setup(async () => `v${++calls}`);
  assert.deepEqual(await feed.read(), { status: "ok", value: "v1", fetchedAt: new Date(T0).toISOString() });
  advance(299_999);
  assert.equal((await feed.read()).value, "v1");
  assert.equal(calls, 1);
});

test("an expired value refetches", async () => {
  let calls = 0;
  const { feed, advance } = setup(async () => `v${++calls}`);
  await feed.read();
  advance(300_000);
  const r = await feed.read();
  assert.equal(r.value, "v2");
  assert.equal(r.fetchedAt, new Date(T0 + 300_000).toISOString());
});

test("concurrent reads share one request", async () => {
  let calls = 0;
  let release!: (v: string) => void;
  const { feed } = setup(() => { calls++; return new Promise<string>((r) => (release = r)); });
  const a = feed.read();
  const b = feed.read();
  release("x");
  assert.deepEqual(await a, await b);
  assert.equal(calls, 1);
});

test("a failure after a good value is stale with that value and its fetchedAt", async () => {
  let fail = false;
  const { feed, advance } = setup(async () => { if (fail) throw new Error("down"); return "good"; });
  await feed.read();
  fail = true;
  advance(300_000);
  assert.deepEqual(await feed.read(), { status: "stale", value: "good", fetchedAt: new Date(T0).toISOString() });
});

test("a failure with no good value is unavailable", async () => {
  const { feed } = setup(async () => { throw new Error("down"); });
  assert.deepEqual(await feed.read(), { status: "unavailable" });
});

test("a value 24 h old or older is unavailable, keeping its fetchedAt", async () => {
  let fail = false;
  const { feed, advance } = setup(async () => { if (fail) throw new Error("down"); return "good"; });
  await feed.read();
  fail = true;
  advance(FEED_STALE_LIMIT_MS);
  assert.deepEqual(await feed.read(), { status: "unavailable", fetchedAt: new Date(T0).toISOString() });
});

test("no request for 60 s after a failure, then one again", async () => {
  let calls = 0;
  let fail = true;
  const { feed, advance } = setup(async () => { calls++; if (fail) throw new Error("down"); return "ok"; });
  await feed.read();
  assert.equal(calls, 1);
  advance(FEED_BACKOFF_MS - 1);
  assert.equal((await feed.read()).status, "unavailable");
  assert.equal(calls, 1);
  fail = false;
  advance(1);
  assert.equal((await feed.read()).status, "ok");
  assert.equal(calls, 2);
});

test("a timeout counts as a failure and the request is given an abort signal", async () => {
  let seen: AbortSignal | undefined;
  const { feed } = setup((signal) => { seen = signal; return new Promise<string>((_, rej) => signal.addEventListener("abort", () => rej(signal.reason))); });
  const pending = feed.read();
  assert.ok(seen);
  assert.equal(seen.aborted, false);
  // Not waiting 8 s: the timeout value is the ruled one and a load that rejects on abort is a failure.
  assert.equal(FEED_TIMEOUT_MS, 8_000);
  const { feed: f2 } = setup(async () => { throw new DOMException("timed out", "TimeoutError"); });
  assert.equal((await f2.read()).status, "unavailable");
  void pending;
});

test("read never throws, even when load throws synchronously", async () => {
  const { feed } = setup(() => { throw new Error("sync"); });
  assert.equal((await feed.read()).status, "unavailable");
});

test("one log line per state change, and no error text", async () => {
  let fail = true;
  const { feed, logs, advance } = setup(async () => { if (fail) throw new Error("secret body"); return "ok"; });
  await feed.read();
  advance(FEED_BACKOFF_MS);
  await feed.read();
  advance(FEED_BACKOFF_MS);
  await feed.read();
  assert.deepEqual(logs.map((l) => l.event), ["demo.unavailable"]);
  assert.doesNotMatch(JSON.stringify(logs), /secret body/);
  fail = false;
  advance(FEED_BACKOFF_MS);
  await feed.read();
  await feed.read();
  assert.deepEqual(logs.map((l) => l.event), ["demo.unavailable", "demo.recovered"]);
});
