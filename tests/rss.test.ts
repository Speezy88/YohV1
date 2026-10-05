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
