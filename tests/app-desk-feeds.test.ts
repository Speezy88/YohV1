/**
 * Tests for `getDeskFeeds` (Ruling E12-R21): the result is always ok; a feed's failure is its own status.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getDeskFeeds } from "../src/app/desk-feeds.ts";
import type { CryptoFeedValue, FeedResult, NewsFeedValue, WeatherFeedValue } from "../src/types/api.ts";

const OK: FeedResult<CryptoFeedValue> = { status: "ok", value: { tickers: [{ symbol: "BTC", priceUsd: 1, changePercent: null }] }, fetchedAt: "2026-10-07T12:00:00.000Z" };

const WEATHER: FeedResult<WeatherFeedValue> = { status: "ok", value: { location: "Seattle, WA", temperatureF: 58, conditions: "Cloudy", next: null }, fetchedAt: "2026-10-07T12:00:00.000Z" };
const NEWS: FeedResult<NewsFeedValue> = { status: "ok", value: { items: [] }, fetchedAt: "2026-10-07T12:00:00.000Z" };
const deps = (over: object = {}) => ({ timeZone: "UTC", readCrypto: async () => OK, readWeather: async () => WEATHER, readNews: async () => NEWS, ...over });

test("returns all three feeds, and one feed's failure leaves the others ok", async () => {
  const r = await getDeskFeeds(deps({ readWeather: async () => { throw new Error("boom"); } }), {});
  assert.deepEqual(r, { ok: true, value: { timeZone: "UTC", crypto: OK, weather: { status: "unavailable" }, news: NEWS } });
  const r2 = await getDeskFeeds(deps({ readNews: async () => ({ status: "unavailable" }) }), {});
  assert.ok(r2.ok && r2.value.crypto.status === "ok" && r2.value.weather.status === "ok" && r2.value.news.status === "unavailable");
});

test("returns the time zone and the crypto feed's result", async () => {
  const r = await getDeskFeeds(deps({ timeZone: "America/Los_Angeles" }), {});
  assert.deepEqual(r, { ok: true, value: { timeZone: "America/Los_Angeles", crypto: OK, weather: WEATHER, news: NEWS } });
});

test("a feed's own unavailable status is still an ok result", async () => {
  const r = await getDeskFeeds(deps({ readCrypto: async () => ({ status: "unavailable" }) }), {});
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.crypto.status, "unavailable");
});

test("a read that throws anyway becomes unavailable, not a failure", async () => {
  const r = await getDeskFeeds(deps({ readCrypto: async () => { throw new Error("boom"); } }), {});
  assert.deepEqual(r, { ok: true, value: { timeZone: "UTC", crypto: { status: "unavailable" }, weather: WEATHER, news: NEWS } });
});
