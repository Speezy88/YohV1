/**
 * src/core/rss.ts
 *
 * Ruling E12-R20: a small pure RSS 2.0 parser for the Desk's news feed (no
 * dependency). Each `<item>` yields `title`, `link` and `publishedAt`; CDATA
 * and the XML entities are handled, tags are stripped from titles and titles
 * are cut at 160 characters. An item without an `http(s)` link (no username
 * or password; emitted as the normalised `URL.href`) or a plausible date (ISO
 * 8601, or a 4-digit year and a month name) is dropped. Anything that is not
 * RSS 2.0 (Atom, HTML, empty) yields no items; this never throws.
 *
 * Linear on any input (review I1): the document is walked with `indexOf` from
 * item to item, at most RSS_MAX_ITEMS items are examined and at most
 * RSS_FIELD_MAX_CHARS characters of any one field; an unclosed token ends the walk.
 */

export const RSS_TITLE_MAX = 160;
export const RSS_MAX_ITEMS = 50;
export const RSS_FIELD_MAX_CHARS = 2_000;

export interface RssItem {
  readonly title: string;
  readonly link: string;
  /** ISO 8601, from `pubDate`. */
  readonly publishedAt: string;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name !== undefined) return NAMED[name] ?? whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex ?? "", 16);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

const MONTH = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const CONTROL_AND_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

function plausibleDate(text: string): boolean {
  return ISO_8601.test(text) || (/\b\d{4}\b/.test(text) && MONTH.test(text));
}

/** First index at or after `from` of `needle` (either spelling), or -1. */
function find(xml: string, needles: readonly string[], from: number): number {
  let best = -1;
  for (const n of needles) {
    const i = xml.indexOf(n, from);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

const spellings = (tag: string): string[] => (tag === tag.toLowerCase() ? [tag] : [tag, tag.toLowerCase()]);

/** Index just past the `>` of the open tag `<tag ...>` that starts at or after `from`, with its start; undefined when absent. */
function openTag(xml: string, tag: string, from: number, to: number): { start: number; end: number } | undefined {
  const needles = spellings(tag).map((t) => `<${t}`);
  // Each spelling's next match is remembered and searched again only once passed, so a run of
  // near-misses (`<pubDatex<pubDatex…`) costs one pass over the text, not one pass per near-miss.
  const nextAt = needles.map((n) => xml.indexOf(n, from));
  for (;;) {
    let i = -1;
    for (const at of nextAt) if (at >= 0 && (i < 0 || at < i)) i = at;
    if (i < 0 || i >= to) return undefined;
    const next = xml.charAt(i + tag.length + 1);
    if (next === ">" || next === " " || next === "\t" || next === "\n" || next === "\r") {
      const gt = xml.indexOf(">", i);
      if (gt < 0 || gt >= to) return undefined;
      return { start: i, end: gt + 1 };
    }
    for (let k = 0; k < nextAt.length; k++) {
      const at = nextAt[k];
      const needle = needles[k];
      if (at !== undefined && needle !== undefined && at >= 0 && at <= i) nextAt[k] = xml.indexOf(needle, i + 1);
    }
  }
}

/** The raw inner text (capped) of the first `<tag>` inside `xml[from, to)`, or undefined. */
function inner(xml: string, tag: string, from: number, to: number): string | undefined {
  const open = openTag(xml, tag, from, to);
  if (open === undefined) return undefined;
  const close = find(xml, spellings(tag).map((t) => `</${t}>`), open.end);
  if (close < 0 || close >= to) return undefined;
  return xml.slice(open.end, Math.min(close, open.end + RSS_FIELD_MAX_CHARS));
}

/** `<![CDATA[x]]>` unwrapped; an unclosed section stays as written. */
function unwrapCdata(raw: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const open = raw.indexOf("<![CDATA[", pos);
    if (open < 0) break;
    const close = raw.indexOf("]]>", open + 9);
    if (close < 0) break;
    out += raw.slice(pos, open) + raw.slice(open + 9, close);
    pos = close + 3;
  }
  return out + raw.slice(pos);
}

/** Tags removed in one pass; a `<` with no later `>` and everything after it stays as written. */
function stripTags(text: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const lt = text.indexOf("<", pos);
    if (lt < 0) break;
    const gt = text.indexOf(">", lt);
    if (gt < 0) break;
    out += text.slice(pos, lt);
    pos = gt + 1;
  }
  return out + text.slice(pos);
}

/** CDATA unwrapped, tags stripped, entities decoded once, whitespace collapsed. */
function plainText(raw: string): string {
  return decodeEntities(stripTags(unwrapCdata(raw))).replace(/\s+/g, " ").trim();
}

function cleanTitle(text: string): string {
  return plainText(text).replace(CONTROL_AND_BIDI, "").replace(LONE_SURROGATE, "").replace(/\s+/g, " ").trim();
}

export function parseRssItems(xml: string): RssItem[] {
  try {
    const out: RssItem[] = [];
    let pos = 0;
    for (let examined = 0; examined < RSS_MAX_ITEMS; examined++) {
      const open = openTag(xml, "item", pos, xml.length);
      if (open === undefined) break;
      const close = xml.indexOf("</item>", open.end);
      if (close < 0) break; // an unclosed item ends the walk
      pos = close + 7;
      // The fields are searched inside the item's own text, so no search runs past the item.
      const item = xml.slice(open.end, close);
      const rawTitle = inner(item, "title", 0, item.length);
      const rawLink = inner(item, "link", 0, item.length);
      const rawDate = inner(item, "pubDate", 0, item.length);
      if (rawTitle === undefined || rawLink === undefined || rawDate === undefined) continue;
      const title = Array.from(cleanTitle(rawTitle)).slice(0, RSS_TITLE_MAX).join("");
      const dateText = plainText(rawDate);
      const time = plausibleDate(dateText) ? Date.parse(dateText) : NaN;
      if (title === "" || Number.isNaN(time)) continue;
      let url: URL;
      try {
        url = new URL(plainText(rawLink));
      } catch {
        continue;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (url.username !== "" || url.password !== "") continue;
      out.push({ title, link: url.href, publishedAt: new Date(time).toISOString() });
    }
    return out;
  } catch {
    return [];
  }
}
