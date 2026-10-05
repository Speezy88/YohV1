/**
 * Tests for `getDeskFeeds` (Ruling E12-R21): the result is always ok; a feed's failure is its own status.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getDeskFeeds } from "../src/app/desk-feeds.ts";
import type { CryptoFeedValue, FeedResult } from "../src/types/api.ts";

const OK: FeedResult<CryptoFeedValue> = { status: "ok", value: { tickers: [{ symbol: "BTC", priceUsd: 1, changePercent: null }] }, fetchedAt: "2026-10-07T12:00:00.000Z" };

test("returns the time zone and the crypto feed's result", async () => {
  const r = await getDeskFeeds({ timeZone: "America/Los_Angeles", readCrypto: async () => OK }, {});
  assert.deepEqual(r, { ok: true, value: { timeZone: "America/Los_Angeles", crypto: OK } });
});

test("a feed's own unavailable status is still an ok result", async () => {
  const r = await getDeskFeeds({ timeZone: "UTC", readCrypto: async () => ({ status: "unavailable" }) }, {});
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.crypto.status, "unavailable");
});

test("a read that throws anyway becomes unavailable, not a failure", async () => {
  const r = await getDeskFeeds({ timeZone: "UTC", readCrypto: async () => { throw new Error("boom"); } }, {});
  assert.deepEqual(r, { ok: true, value: { timeZone: "UTC", crypto: { status: "unavailable" } } });
});
