/**
 * src/adapters/news-feed.ts
 *
 * Ruling E12-R20: Business and AI headlines from two fixed RSS feeds (NPR
 * Business, TechCrunch AI), each fetched and cached independently with the
 * shared cache helper (Ruling E12-R17), so a source that fails keeps its own
 * last good items. Value: the newest 4 per source, merged newest first.
 * Status: `ok` when both sources are fresh; `stale` when any shown item comes
 * from a last good set or a source has nothing; `unavailable` when there is
 * nothing to show. Nothing but the two fixed URLs goes out.
 */
import { parseRssItems } from "../core/rss.ts";
import type { FeedResult, NewsFeedValue, NewsItem } from "../types/api.ts";
import { createCachedFeed } from "./feed-cache.ts";
import type { LogEntry } from "./logger.ts";

export const NEWS_REFRESH_MS = 60 * 60 * 1000;
export const NEWS_ITEMS_PER_SOURCE = 4;
export const NEWS_SOURCES = [
  { source: "NPR", url: "https://feeds.npr.org/1006/rss.xml" },
  { source: "TechCrunch", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
] as const;

/** The slice of `fetch` the feed needs (the global `fetch` satisfies it). */
export type NewsFetch = (url: string, init: { readonly signal: AbortSignal }) => Promise<{ readonly ok: boolean; text(): Promise<string> }>;

export interface NewsFeedConfig {
  readonly fetch: NewsFetch;
  readonly now: () => Date;
  readonly log: (entry: LogEntry) => void;
}

export function createNewsFeed(config: NewsFeedConfig): { read(): Promise<FeedResult<NewsFeedValue>> } {
  const sources = NEWS_SOURCES.map(({ source, url }) => ({
    feed: createCachedFeed<readonly NewsItem[]>({
      name: `news.${source.toLowerCase()}`,
      refreshMs: NEWS_REFRESH_MS,
      now: config.now,
      log: config.log,
      load: async (signal) => {
        const res = await config.fetch(url, { signal });
        if (!res.ok) throw new Error("news-feed: non-2xx");
        const items = parseRssItems(await res.text())
          .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
          .slice(0, NEWS_ITEMS_PER_SOURCE)
          .map((i): NewsItem => ({ title: i.title, url: i.link, source, publishedAt: i.publishedAt }));
        if (items.length === 0) throw new Error("news-feed: no items");
        return items;
      },
    }),
  }));

  return {
    async read(): Promise<FeedResult<NewsFeedValue>> {
      try {
        const results = await Promise.all(sources.map((s) => s.feed.read()));
        const shown = results.filter((r) => r.value !== undefined && r.status !== "unavailable");
        if (shown.length === 0) {
          const expired = results.map((r) => r.fetchedAt).filter((t): t is string => t !== undefined).sort();
          const newest = expired[expired.length - 1];
          return newest === undefined ? { status: "unavailable" } : { status: "unavailable", fetchedAt: newest };
        }
        const items = shown.flatMap((r) => [...(r.value ?? [])]).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
        const allFresh = shown.length === results.length && shown.every((r) => r.status === "ok");
        const oldest = shown.map((r) => r.fetchedAt).filter((t): t is string => t !== undefined).sort()[0];
        return { status: allFresh ? "ok" : "stale", value: { items }, ...(oldest === undefined ? {} : { fetchedAt: oldest }) };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}
