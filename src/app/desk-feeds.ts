/**
 * src/app/desk-feeds.ts
 *
 * Ruling E12-R21: `GET /api/desk/feeds` — the Desk's public-feed widgets, on a
 * route of their own so a slow provider never delays the metrics. Each feed
 * fails on its own `status`, so the Result is always ok.
 */
import type { CryptoFeedValue, DeskFeedsResponse, FeedResult, NewsFeedValue, WeatherFeedValue } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";

export interface DeskFeedsDeps {
  readonly timeZone: string;
  /** The crypto feed's `read`, bound. Never throws (a throw anyway reads as unavailable). */
  readonly readCrypto: () => Promise<FeedResult<CryptoFeedValue>>;
  /** The weather and news feeds' `read`s, bound; each fails on its own. */
  readonly readWeather: () => Promise<FeedResult<WeatherFeedValue>>;
  readonly readNews: () => Promise<FeedResult<NewsFeedValue>>;
}

const UNAVAILABLE = { status: "unavailable" } as const;

async function safely<T>(read: () => Promise<FeedResult<T>>): Promise<FeedResult<T>> {
  try {
    return await read();
  } catch {
    return UNAVAILABLE;
  }
}

export async function getDeskFeeds(deps: DeskFeedsDeps, _input: Record<string, never>): Promise<Result<DeskFeedsResponse, YohError>> {
  const [crypto, weather, news] = await Promise.all([safely(deps.readCrypto), safely(deps.readWeather), safely(deps.readNews)]);
  return { ok: true, value: { timeZone: deps.timeZone, crypto, weather, news } };
}
