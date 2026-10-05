/**
 * src/adapters/feed-cache.ts
 *
 * Ruling E12-R17: the cache, timeout, back-off and last-good logic every Desk
 * feed adapter shares (crypto, weather, news). Each adapter instance owns one
 * cache, in memory only. `read` takes no argument and never throws.
 *
 * - A value younger than `refreshMs` is returned as `ok` without a request.
 * - Otherwise one request (8 s timeout); concurrent reads share it.
 * - Failure: `stale` with the last good value when it is under 24 h old,
 *   else `unavailable`; no new request for 60 s after a failure.
 * - One log line per state change (`<name>.unavailable`, `<name>.recovered`);
 *   never an error message or a response body.
 *
 * Imports nothing from the Notion, Calendar, LLM, search or store adapters (AD-22).
 */
import type { FeedResult } from "../types/api.ts";
import type { LogEntry } from "./logger.ts";

export const FEED_TIMEOUT_MS = 8_000;
export const FEED_BACKOFF_MS = 60_000;
export const FEED_STALE_LIMIT_MS = 24 * 60 * 60 * 1000;

export interface CachedFeedConfig<T> {
  readonly name: string;
  readonly refreshMs: number;
  /** One provider request; throws on any failure (network, non-2xx, unparseable). Gets the 8 s timeout signal. */
  readonly load: (signal: AbortSignal) => Promise<T>;
  readonly now: () => Date;
  readonly log: (entry: LogEntry) => void;
}

export interface CachedFeed<T> {
  read(): Promise<FeedResult<T>>;
}

export function createCachedFeed<T>(config: CachedFeedConfig<T>): CachedFeed<T> {
  let good: { readonly value: T; readonly at: number } | undefined;
  let failedAt: number | undefined;
  let inFlight: Promise<FeedResult<T>> | undefined;
  let down = false;

  const iso = (ms: number): string => new Date(ms).toISOString();
  const ok = (g: { value: T; at: number }): FeedResult<T> => ({ status: "ok", value: g.value, fetchedAt: iso(g.at) });

  function fallback(nowMs: number): FeedResult<T> {
    if (good === undefined) return { status: "unavailable" };
    if (nowMs - good.at < FEED_STALE_LIMIT_MS) return { status: "stale", value: good.value, fetchedAt: iso(good.at) };
    return { status: "unavailable", fetchedAt: iso(good.at) };
  }

  async function refresh(): Promise<FeedResult<T>> {
    try {
      const value = await config.load(AbortSignal.timeout(FEED_TIMEOUT_MS));
      good = { value, at: config.now().getTime() };
      failedAt = undefined;
      if (down) {
        down = false;
        config.log({ level: "info", event: `${config.name}.recovered`, detail: {} });
      }
      return ok(good);
    } catch {
      const nowMs = config.now().getTime();
      failedAt = nowMs;
      if (!down) {
        down = true;
        config.log({ level: "warn", event: `${config.name}.unavailable`, detail: {} });
      }
      return fallback(nowMs);
    }
  }

  return {
    async read(): Promise<FeedResult<T>> {
      try {
        const nowMs = config.now().getTime();
        if (good !== undefined && nowMs - good.at < config.refreshMs) return ok(good);
        if (inFlight) return await inFlight;
        if (failedAt !== undefined && nowMs - failedAt < FEED_BACKOFF_MS) return fallback(nowMs);
        inFlight = refresh().finally(() => {
          inFlight = undefined;
        });
        return await inFlight;
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}
