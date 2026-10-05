/**
 * src/adapters/crypto-feed.ts
 *
 * Ruling E12-R18: BTC, SOL and ETH prices from Kraken's public ticker (no key,
 * nothing but the one URL is sent). Caching, timeout, back-off and last-good
 * come from `feed-cache.ts` (Ruling E12-R17); this file builds the request and
 * parses the answer. A non-empty `error` array, or any of the three pairs
 * missing or not a finite number above 0, fails the whole read.
 */
import type { CryptoFeedValue, CryptoTicker, FeedResult } from "../types/api.ts";
import { createCachedFeed, fetchFeedText, type FeedFetch } from "./feed-cache.ts";
import type { LogEntry } from "./logger.ts";

export const CRYPTO_REFRESH_MS = 5 * 60 * 1000;
export const KRAKEN_TICKER_URL = "https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD";

/** The slice of `fetch` the feed needs (the global `fetch` satisfies it). */
export type CryptoFetch = FeedFetch;

export interface CryptoFeedConfig {
  readonly fetch: CryptoFetch;
  readonly now: () => Date;
  readonly log: (entry: LogEntry) => void;
  /** `YOH_FEED_USER_AGENT`; the default is used when empty or absent. */
  readonly userAgent?: string | undefined;
}

/** Display order is BTC, SOL, ETH; `match` is the text in Kraken's result key (`XXBTZUSD`, `SOLUSD`, `XETHZUSD`). */
const COINS = [
  { symbol: "BTC", match: "XBT" },
  { symbol: "SOL", match: "SOL" },
  { symbol: "ETH", match: "ETH" },
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseTicker(body: unknown): CryptoFeedValue {
  if (!isRecord(body)) throw new Error("crypto-feed: unexpected body");
  if (!Array.isArray(body["error"]) || body["error"].length > 0) throw new Error("crypto-feed: provider error");
  const result = body["result"];
  if (!isRecord(result)) throw new Error("crypto-feed: no result");
  const tickers: CryptoTicker[] = COINS.map(({ symbol, match }) => {
    const key = Object.keys(result).find((k) => k.includes(match));
    const entry = key === undefined ? undefined : result[key];
    if (!isRecord(entry) || !Array.isArray(entry["c"])) throw new Error(`crypto-feed: ${symbol} missing`);
    const priceUsd = Number(entry["c"][0]);
    if (typeof entry["c"][0] !== "string" || !Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error(`crypto-feed: ${symbol} price invalid`);
    const open = typeof entry["o"] === "string" ? Number(entry["o"]) : NaN;
    const changePercent = Number.isFinite(open) && open !== 0 ? ((priceUsd - open) / open) * 100 : null;
    return { symbol, priceUsd, changePercent };
  });
  return { tickers };
}

export function createCryptoFeed(config: CryptoFeedConfig): { read(): Promise<FeedResult<CryptoFeedValue>> } {
  return createCachedFeed<CryptoFeedValue>({
    name: "crypto",
    refreshMs: CRYPTO_REFRESH_MS,
    now: config.now,
    log: config.log,
    load: async (signal) => {
      const text = await fetchFeedText(config.fetch, KRAKEN_TICKER_URL, { signal, userAgent: config.userAgent });
      return parseTicker(JSON.parse(text));
    },
  });
}
