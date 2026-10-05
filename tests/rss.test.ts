/**
 * Tests for the pure RSS 2.0 parser (Ruling E12-R20).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRssItems } from "../src/core/rss.ts";

const wrap = (items: string) => `<rss version="2.0"><channel><title>Feed</title>${items}</channel></rss>`;
const item = (title: string, link = "https://example.org/a", date = "Sun, 04 Oct 2026 21:10:00 +0000") =>
  `<item><title>${title}</title>${link ? `<link>${link}</link>` : ""}${date ? `<pubDate>${date}</pubDate>` : ""}</item>`;

test("the sample parses: CDATA, entities, ISO dates", () => {
  const xml = `<rss version="2.0"><channel><title>Feed</title>
<item><title><![CDATA[Chipmaker&#8217;s sales rise on AI demand]]></title><link>https://example.org/a</link><pubDate>Sun, 04 Oct 2026 21:10:00 +0000</pubDate></item>
<item><title>Rates &amp; markets</title><link>https://example.org/b</link><pubDate>Sun, 04 Oct 2026 18:00:00 GMT</pubDate></item>
</channel></rss>`;
  assert.deepEqual(parseRssItems(xml), [
    { title: "Chipmaker’s sales rise on AI demand", link: "https://example.org/a", publishedAt: "2026-10-04T21:10:00.000Z" },
    { title: "Rates & markets", link: "https://example.org/b", publishedAt: "2026-10-04T18:00:00.000Z" },
  ]);
});

test("numeric entities, decimal and hex", () => {
  const [a] = parseRssItems(wrap(item("It&#8217;s &#x27;fine&#x27; &lt;ok&gt; &quot;q&quot;")));
  assert.equal(a!.title, "It’s 'fine' <ok> \"q\"");
});

test("tags are stripped from titles", () => {
  const [a] = parseRssItems(wrap(item("<![CDATA[<b>Bold</b> move <a href=\"x\">now</a>]]>")));
  assert.equal(a!.title, "Bold move now");
});

test("titles are cut at 160 characters", () => {
  const [a] = parseRssItems(wrap(item("x".repeat(300))));
  assert.equal(a!.title.length, 160);
});

test("items with a javascript: link, no link or an unparseable date are dropped", () => {
  const xml = wrap(
    item("js", "javascript:alert(1)") + item("none", "") + item("baddate", "https://example.org/c", "not a date") + item("nodate", "https://example.org/d", "") + item("good", "https://example.org/e"),
  );
  assert.deepEqual(parseRssItems(xml).map((i) => i.title), ["good"]);
});

test("an empty or non-RSS document gives no items and does not throw", () => {
  for (const doc of ["", "   ", "<html><body>nope</body></html>", "not xml at all", "<rss><channel></channel></rss>"]) assert.deepEqual(parseRssItems(doc), []);
});

test("an Atom-only document gives no items", () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link href="https://example.org/a"/><updated>2026-10-04T18:00:00Z</updated></entry></feed>`;
  assert.deepEqual(parseRssItems(atom), []);
});

test("I1: hostile 500 KB bodies parse in under 200 ms", () => {
  const bodies = [
    "<item>".repeat(80_000),
    "<item ".padEnd(500_000, " "),
    `<item><title>${"<".repeat(500_000)}</title></item>`,
    `<item><title>${"<![CDATA[".repeat(55_000)}</title><link>https://a.b/</link><pubDate>2026-01-01</pubDate></item>`,
    "<item><title>x</title>".repeat(25_000),
    `<rss><item>${"<title>".repeat(70_000)}`,
  ];
  for (const b of bodies) {
    const t = performance.now();
    parseRssItems(b);
    assert.ok(performance.now() - t < 200, `took ${performance.now() - t} ms`);
  }
});

test("I1: at most 50 items are examined", () => {
  const xml = wrap(Array.from({ length: 80 }, (_, i) => item(`t${i}`, `https://a.b/${i}`, "2026-01-01")).join(""));
  assert.equal(parseRssItems(xml).length, 50);
});

test("I1: a field beyond 2,000 characters is cut before parsing", () => {
  const xml = wrap(item("x".repeat(5_000), "https://a.b/", "2026-01-01"));
  assert.equal(parseRssItems(xml)[0]!.title.length, 160);
  const longLink = wrap(item("t", "https://a.b/" + "y".repeat(3_000), "2026-01-01"));
  assert.ok(parseRssItems(longLink)[0]!.link.length <= 2_100);
});

test("M5: the link is the normalised href and a link with credentials is dropped", () => {
  assert.equal(parseRssItems(wrap(item("t", "https://a.b/x y", "2026-01-01")))[0]!.link, "https://a.b/x%20y");
  assert.equal(parseRssItems(wrap(item("t", "HTTPS://A.B/", "2026-01-01")))[0]!.link, "https://a.b/");
  assert.deepEqual(parseRssItems(wrap(item("t", "https://user:pw@a.b/", "2026-01-01"))), []);
  assert.deepEqual(parseRssItems(wrap(item("t", "https://user@a.b/", "2026-01-01"))), []);
});

test("M5: control, bidi and lone-surrogate characters are stripped from titles", () => {
  const t = parseRssItems(wrap(item("a&#8238;b&#x2066;c&#1;d&#xD800;e‮f", "https://a.b/", "2026-01-01")))[0]!.title;
  assert.equal(t, "abcdef");
});

test("M5: a pubDate needs a 4-digit year and a month name, or ISO 8601", () => {
  for (const bad of ["1", "2026", "12/25/2026", "Oct", "garbage 2026"]) assert.deepEqual(parseRssItems(wrap(item("t", "https://a.b/", bad))), [], bad);
  for (const good of ["Sun, 04 Oct 2026 10:00:00 GMT", "2026-10-04", "2026-10-04T10:00:00Z", "2026-10-04T10:00:00+02:00"]) assert.equal(parseRssItems(wrap(item("t", "https://a.b/", good))).length, 1, good);
});
