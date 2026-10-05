/**
 * src/adapters/weather-feed.ts
 *
 * Ruling E12-R19: Seattle's weather from the US National Weather Service.
 * `GET /points/{lat,lon}` yields the forecast URLs (cached for the life of the
 * process, looked up again after a 404 from either); the first hourly period
 * gives the current temperature and conditions, the first daily period that is
 * not "now" gives `next`. Forecast-period values are used, never station
 * observations. Caching, timeout, back-off and last-good come from
 * `feed-cache.ts` (Ruling E12-R17).
 */
import type { FeedResult, WeatherFeedValue } from "../types/api.ts";
import { createCachedFeed, DEFAULT_FEED_USER_AGENT, FeedError, fetchFeedText, type FeedFetch } from "./feed-cache.ts";
import type { LogEntry } from "./logger.ts";

export const WEATHER_REFRESH_MS = 30 * 60 * 1000;
/** The one location (Ruling E12-R19). */
export const WEATHER_LOCATION = { name: "Seattle, WA", latitude: 47.6062, longitude: -122.3321 } as const;
export const WEATHER_POINTS_URL = `https://api.weather.gov/points/${WEATHER_LOCATION.latitude},${WEATHER_LOCATION.longitude}`;

/** The slice of `fetch` the feed needs (the global `fetch` satisfies it). */
export type WeatherFetch = FeedFetch;

export interface WeatherFeedConfig {
  readonly fetch: WeatherFetch;
  readonly now: () => Date;
  readonly log: (entry: LogEntry) => void;
  /** `YOH_FEED_USER_AGENT`; the default is used when empty or absent. */
  readonly userAgent?: string | undefined;
}

interface Period {
  readonly name: string;
  readonly temperatureF: number;
  readonly summary: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function periodsOf(body: unknown): readonly unknown[] {
  const props = isRecord(body) ? body["properties"] : undefined;
  const periods = isRecord(props) ? props["periods"] : undefined;
  if (!Array.isArray(periods)) throw new Error("weather-feed: no periods");
  return periods;
}

function toPeriod(raw: unknown): Period {
  if (!isRecord(raw)) throw new Error("weather-feed: bad period");
  const t = raw["temperature"];
  if (typeof t !== "number" || !Number.isFinite(t)) throw new Error("weather-feed: bad temperature");
  const unit = raw["temperatureUnit"];
  if (unit !== "F" && unit !== "C") throw new Error("weather-feed: bad unit");
  const summary = raw["shortForecast"];
  if (typeof summary !== "string") throw new Error("weather-feed: bad forecast");
  const name = typeof raw["name"] === "string" ? raw["name"] : "";
  return { name, temperatureF: Math.round(unit === "C" ? (t * 9) / 5 + 32 : t), summary };
}

function urlOf(props: unknown, key: string): string {
  const v = isRecord(props) ? props[key] : undefined;
  if (typeof v !== "string" || !v.startsWith("https://api.weather.gov/")) throw new Error(`weather-feed: bad ${key}`);
  return v;
}

export function createWeatherFeed(config: WeatherFeedConfig): { read(): Promise<FeedResult<WeatherFeedValue>> } {
  const userAgent = config.userAgent || DEFAULT_FEED_USER_AGENT;
  let grid: { readonly hourly: string; readonly daily: string } | undefined;

  async function get(url: string, signal: AbortSignal): Promise<unknown> {
    try {
      return JSON.parse(await fetchFeedText(config.fetch, url, { signal, userAgent, accept: "application/geo+json" }));
    } catch (err) {
      if (err instanceof FeedError && err.reason === "http-404") grid = undefined; // the grid may have moved: look it up again next time
      throw err;
    }
  }

  return createCachedFeed<WeatherFeedValue>({
    name: "weather",
    refreshMs: WEATHER_REFRESH_MS,
    now: config.now,
    log: config.log,
    load: async (signal) => {
      if (grid === undefined) {
        const body = await get(WEATHER_POINTS_URL, signal);
        const props = isRecord(body) ? body["properties"] : undefined;
        grid = { hourly: urlOf(props, "forecastHourly"), daily: urlOf(props, "forecast") };
      }
      const { hourly, daily } = grid;
      const [hourlyBody, dailyBody] = await Promise.all([get(hourly, signal), get(daily, signal)]);
      const first = periodsOf(hourlyBody)[0];
      if (first === undefined) throw new Error("weather-feed: no hourly period");
      const now = toPeriod(first);
      const nextRaw = periodsOf(dailyBody).find((p) => {
        const name = isRecord(p) && typeof p["name"] === "string" ? p["name"].trim() : "";
        return name !== "" && name.toLowerCase() !== "now";
      });
      const next = nextRaw === undefined ? null : toPeriod(nextRaw);
      return {
        location: WEATHER_LOCATION.name,
        temperatureF: now.temperatureF,
        conditions: now.summary,
        next: next === null ? null : { name: next.name, temperatureF: next.temperatureF, summary: next.summary },
      };
    },
  });
}
