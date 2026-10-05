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
 *   never an error message or a response body (the detail is a fixed `reason`).
 *
 * Imports nothing from the Notion, Calendar, LLM, search or store adapters (AD-22).
 */
import type { FeedResult } from "../types/api.ts";
import type { LogEntry } from "./logger.ts";

export const FEED_TIMEOUT_MS = 8_000;
export const FEED_BACKOFF_MS = 60_000;
export const FEED_STALE_LIMIT_MS = 24 * 60 * 60 * 1000;
/** Review I1: no feed body is read past this many bytes; a larger one is a failed read. */
export const FEED_MAX_BODY_BYTES = 1_000_000;
/** Review M12: the User-Agent every feed request sends unless `YOH_FEED_USER_AGENT` says otherwise. */
export const DEFAULT_FEED_USER_AGENT = "Yoh/1.0 (personal dashboard)";

/** Review M7: the fixed set of reasons a feed read can fail; the only cause ever logged. */
export type FeedFailureReason = "timeout" | "network" | "parse" | "too-large" | "redirect" | `http-${number}`;

export class FeedError extends Error {
  readonly reason: FeedFailureReason;
  constructor(reason: FeedFailureReason) {
    super(`feed: ${reason}`);
    this.name = "FeedError";
    this.reason = reason;
  }
}

/** Maps any thrown value to a fixed reason; never uses the error's message. */
export function feedFailureReason(err: unknown): FeedFailureReason {
  if (err instanceof FeedError) return err.reason;
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  if (err instanceof TypeError) return "network";
  return "parse";
}

export interface FeedRequestInit {
  readonly signal: AbortSignal;
  readonly headers: Readonly<Record<string, string>>;
  /** Review M3: `error` for the fixed JSON endpoints; `manual` for RSS (one same-host https hop is followed by `fetchFeedText`). */
  readonly redirect: "error" | "manual";
}
export interface FeedResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers?: { get(name: string): string | null };
  readonly body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null;
  text(): Promise<string>;
}
/** The slice of `fetch` the feeds need (the global `fetch` satisfies it). */
export type FeedFetch = (url: string, init: FeedRequestInit) => Promise<FeedResponse>;

async function readCapped(res: FeedResponse): Promise<string> {
  const declared = Number(res.headers?.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > FEED_MAX_BODY_BYTES) throw new FeedError("too-large");
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > FEED_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new FeedError("too-large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > FEED_MAX_BODY_BYTES) throw new FeedError("too-large");
  return text;
}

/**
 * One feed request with the shared rules: the same User-Agent, redirects
 * refused (`redirect: "error"`) or, for RSS (`followSameHost`), at most one
 * hop to an https URL on the same host; a non-2xx or a body over the cap is a
 * failed read with a fixed reason.
 */
export async function fetchFeedText(
  fetchFn: FeedFetch,
  url: string,
  opts: { readonly signal: AbortSignal; readonly userAgent?: string | undefined; readonly accept?: string; readonly followSameHost?: boolean },
): Promise<string> {
  const headers: Record<string, string> = { "User-Agent": opts.userAgent || DEFAULT_FEED_USER_AGENT };
  if (opts.accept !== undefined) headers["Accept"] = opts.accept;
  const redirect = opts.followSameHost ? "manual" : "error";
  let res = await fetchFn(url, { signal: opts.signal, headers, redirect });
  if (opts.followSameHost && res.status >= 300 && res.status < 400) {
    const location = res.headers?.get("location") ?? "";
    let target: URL;
    let origin: URL;
    try {
      origin = new URL(url);
      target = new URL(location, origin);
    } catch {
      throw new FeedError("redirect");
    }
    if (target.protocol !== "https:" || target.host !== origin.host) throw new FeedError("redirect");
    res = await fetchFn(target.href, { signal: opts.signal, headers, redirect });
    if (res.status >= 300 && res.status < 400) throw new FeedError("redirect");
  }
  if (!res.ok) throw new FeedError(`http-${res.status}`);
  return readCapped(res);
}

export interface CachedFeedConfig<T> {
  readonly name: string;
  readonly refreshMs: number;
  /** One provider request; throws on any failure (network, non-2xx, unparseable). Gets the 8 s timeout signal. */
  readonly load: (signal: AbortSignal) => Promise<T>;
  readonly now: () => Date;
  readonly log: (entry: LogEntry) => void;
  /** Override of `FEED_TIMEOUT_MS` (tests). */
  readonly timeoutMs?: number;
}

export interface CachedFeed<T> {
  read(): Promise<FeedResult<T>>;
}

/** Review M13: a negative age (the clock stepped back) counts as expired. */
function within(ageMs: number, limitMs: number): boolean {
  return ageMs >= 0 && ageMs < limitMs;
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
    // Review M1: a value is stamped with the time its request started, so a poll of the same period always refetches.
    const startedAt = config.now().getTime();
    try {
      const value = await config.load(AbortSignal.timeout(config.timeoutMs ?? FEED_TIMEOUT_MS));
      good = { value, at: startedAt };
      failedAt = undefined;
      if (down) {
        down = false;
        config.log({ level: "info", event: `${config.name}.recovered`, detail: {} });
      }
      return ok(good);
    } catch (err) {
      const nowMs = config.now().getTime();
      failedAt = nowMs;
      if (!down) {
        down = true;
        config.log({ level: "warn", event: `${config.name}.unavailable`, detail: { reason: feedFailureReason(err) } });
      }
      return fallback(nowMs);
    }
  }

  return {
    async read(): Promise<FeedResult<T>> {
      try {
        const nowMs = config.now().getTime();
        if (good !== undefined && within(nowMs - good.at, config.refreshMs)) return ok(good);
        if (inFlight) return await inFlight;
        if (failedAt !== undefined && within(nowMs - failedAt, FEED_BACKOFF_MS)) return fallback(nowMs);
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
