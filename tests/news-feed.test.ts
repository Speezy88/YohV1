/**
 * Tests for the RSS news feed (Ruling E12-R20) with a fake `fetch`; no test calls a provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createNewsFeed, NEWS_REFRESH_MS, NEWS_SOURCES } from "../src/adapters/news-feed.ts";

const NPR = NEWS_SOURCES.find((s) => s.source === "NPR")!.url;
const TC = NEWS_SOURCES.find((s) => s.source === "TechCrunch")!.url;

function rss(prefix: string, count: number, startHour: number): string {
  const items = Array.from({ length: count }, (_, i) => {
    const h = String(startHour + i).padStart(2, "0");
    return `<item><title>${prefix}${i}</title><link>https://example.org/${prefix}${i}</link><pubDate>Sun, 04 Oct 2026 ${h}:00:00 GMT</pubDate></item>`;
  }).join("");
  return `<rss version="2.0"><channel><title>F</title>${items}</channel></rss>`;
}

function setup() {
  const now = { t: Date.parse("2026-10-04T23:00:00.000Z") };
  const requests: { url: string; init: unknown }[] = [];
  const routes: Record<string, { status?: number; body: string }> = { [NPR]: { body: rss("n", 6, 1) }, [TC]: { body: rss("t", 6, 2) } };
  const fetch = async (url: string, init: unknown) => {
    requests.push({ url, init });
    const r = routes[url] ?? { status: 500, body: "" };
    const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => JSON.parse(r.body), text: async () => r.body };
  };
  const feed = createNewsFeed({ fetch: fetch as never, now: () => new Date(now.t), log: () => {} });
  return { feed, requests, routes, now };
}

test("only the two fixed URLs are requested, with nothing else", async () => {
  const { feed, requests } = setup();
  await feed.read();
  assert.deepEqual(requests.map((r) => r.url).sort(), [NPR, TC].sort());
  assert.equal(NPR, "https://feeds.npr.org/1006/rss.xml");
  assert.equal(TC, "https://techcrunch.com/category/artificial-intelligence/feed/");
  for (const r of requests) assert.equal((r.init as { headers?: unknown }).headers, undefined);
});

test("the newest 4 of each source, merged newest first", async () => {
  const r = await setup().feed.read();
  assert.equal(r.status, "ok");
  const items = r.value!.items;
  assert.equal(items.length, 8);
  const times = items.map((i) => i.publishedAt);
  assert.deepEqual(times, [...times].sort().reverse());
  assert.equal(items.filter((i) => i.source === "NPR").length, 4);
  assert.deepEqual(items.filter((i) => i.source === "TechCrunch").map((i) => i.title), ["t5", "t4", "t3", "t2"]);
  assert.deepEqual(items[0], { title: "t5", url: "https://example.org/t5", source: "TechCrunch", publishedAt: "2026-10-04T07:00:00.000Z" });
});

test("one source down keeps its last good items and the status is stale", async () => {
  const { feed, routes, now } = setup();
  await feed.read();
  now.t += NEWS_REFRESH_MS + 1;
  routes[NPR] = { status: 503, body: "" };
  routes[TC] = { body: rss("u", 5, 10) };
  const r = await feed.read();
  assert.equal(r.status, "stale");
  const items = r.value!.items;
  assert.equal(items.filter((i) => i.source === "NPR").length, 4);
  assert.ok(items.some((i) => i.title.startsWith("n")));
  assert.ok(items.some((i) => i.title.startsWith("u")));
});

test("one source down from the start shows the other, as stale", async () => {
  const { feed, routes } = setup();
  routes[NPR] = { status: 503, body: "" };
  const r = await feed.read();
  assert.equal(r.status, "stale");
  assert.ok(r.value!.items.every((i) => i.source === "TechCrunch"));
});

test("both down with nothing is unavailable", async () => {
  const { feed, routes } = setup();
  routes[NPR] = { status: 503, body: "" };
  routes[TC] = { body: "<html>nope</html>" };
  const r = await feed.read();
  assert.equal(r.status, "unavailable");
  assert.equal(r.value, undefined);
});

test("a source whose feed has no usable items fails that source", async () => {
  const { feed, routes } = setup();
  routes[NPR] = { body: `<rss><channel></channel></rss>` };
  assert.equal((await feed.read()).status, "stale");
});

test("the refresh interval is 60 minutes, and read takes no argument", () => {
  assert.equal(NEWS_REFRESH_MS, 60 * 60 * 1000);
  assert.equal(setup().feed.read.length, 0);
});
