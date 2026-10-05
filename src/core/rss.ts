/**
 * src/core/rss.ts
 *
 * Ruling E12-R20: a small pure RSS 2.0 parser for the Desk's news feed (no
 * dependency). Each `<item>` yields `title`, `link` and `publishedAt`; CDATA
 * and the XML entities are handled, tags are stripped from titles and titles
 * are cut at 160 characters. An item without an `http(s)` link or a parseable
 * date is dropped. Anything that is not RSS 2.0 (Atom, HTML, empty) yields
 * no items; this never throws.
 */

export const RSS_TITLE_MAX = 160;

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

/** The raw inner text of the first `<tag>` in `block`, or undefined. */
function inner(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return m?.[1];
}

/** CDATA unwrapped, tags stripped, entities decoded once, whitespace collapsed. */
function plainText(raw: string): string {
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeEntities(unwrapped.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

export function parseRssItems(xml: string): RssItem[] {
  try {
    const out: RssItem[] = [];
    for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
      const block = m[1] ?? "";
      const rawTitle = inner(block, "title");
      const rawLink = inner(block, "link");
      const rawDate = inner(block, "pubDate");
      if (rawTitle === undefined || rawLink === undefined || rawDate === undefined) continue;
      const title = Array.from(plainText(rawTitle)).slice(0, RSS_TITLE_MAX).join("");
      const link = plainText(rawLink);
      const time = Date.parse(plainText(rawDate));
      if (title === "" || Number.isNaN(time)) continue;
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        continue;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      out.push({ title, link, publishedAt: new Date(time).toISOString() });
    }
    return out;
  } catch {
    return [];
  }
}
