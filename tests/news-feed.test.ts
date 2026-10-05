/**
 * Tests for the RSS news feed (Ruling E12-R20) with a fake `fetch`; no test calls a provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { LogEntry } from "../src/adapters/logger.ts";
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
  for (const r of requests) assert.deepEqual((r.init as { headers?: unknown }).headers, { "User-Agent": "Yoh/1.0 (personal dashboard)" });
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

test("M3: RSS requests use redirect manual; a cross-host redirect fails, a same-host one is followed once", async () => {
  const requests: { url: string; redirect: string | undefined }[] = [];
  const respond = (url: string, redirect: string | undefined) => {
    requests.push({ url, redirect });
    const hdr = (loc: string) => ({ get: (n: string) => (n.toLowerCase() === "location" ? loc : null) });
    if (url === NPR) return { ok: false, status: 301, headers: hdr("https://evil.example/feed"), text: async () => "" };
    if (url === TC) return { ok: false, status: 301, headers: hdr("/moved/feed"), text: async () => "" };
    if (url === "https://techcrunch.com/moved/feed") return { ok: true, status: 200, text: async () => rss("t", 2, 1) };
    return { ok: false, status: 500, text: async () => "" };
  };
  const feed = createNewsFeed({ fetch: (async (url: string, init: { redirect?: string }) => respond(url, init.redirect)) as never, now: () => new Date("2026-10-04T23:00:00.000Z"), log: () => {} });
  const r = await feed.read();
  assert.equal(r.status, "stale");
  assert.ok(r.value!.items.every((i) => i.source === "TechCrunch"));
  assert.ok(requests.every((q) => q.redirect === "manual"));
  assert.equal(requests.filter((q) => q.url.includes("evil")).length, 0);
  assert.equal(requests.filter((q) => q.url === "https://techcrunch.com/moved/feed").length, 1);
});

test("M5: an item dated more than 24 h after now is dropped", async () => {
  const { feed, routes } = setup();
  const item = (t: string, d: string) => `<item><title>${t}</title><link>https://example.org/${t}</link><pubDate>${d}</pubDate></item>`;
  routes[NPR] = { body: `<rss><channel>${item("soon", "Mon, 05 Oct 2026 22:00:00 GMT")}${item("far", "Tue, 06 Oct 2026 00:00:00 GMT")}${item("past", "Sun, 04 Oct 2026 01:00:00 GMT")}</channel></rss>` };
  const titles = (await feed.read()).value!.items.filter((i) => i.source === "NPR").map((i) => i.title);
  assert.deepEqual(titles.sort(), ["past", "soon"]);
});

test("M7: a failure log carries a fixed reason and never the body", async () => {
  const logs: LogEntry[] = [];
  const feed = createNewsFeed({ fetch: (async () => ({ ok: false, status: 503, text: async () => "SECRET-BODY" })) as never, now: () => new Date(), log: (e) => logs.push(e) });
  await feed.read();
  assert.ok(logs.length > 0);
  assert.ok(logs.every((l) => (l.detail as { reason: string }).reason === "http-503"));
  assert.doesNotMatch(JSON.stringify(logs), /SECRET-BODY/);
});
