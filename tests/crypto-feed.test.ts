/**
 * Tests for the Kraken crypto feed (Ruling E12-R18) with a fake `fetch`; no test calls the provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCryptoFeed, CRYPTO_REFRESH_MS, KRAKEN_TICKER_URL } from "../src/adapters/crypto-feed.ts";

const SAMPLE = {
  error: [],
  result: {
    XXBTZUSD: { c: ["67123.40000", "0.01"], o: "66327.50000" },
    XETHZUSD: { c: ["3456.78000", "0.2"], o: "3484.66000" },
    SOLUSD: { c: ["142.5700000", "1.0"], o: "140.0000000" },
  },
};

function setup(respond: (url: string, init: unknown) => { status?: number; body: string }) {
  const requests: { url: string; init: unknown }[] = [];
  const fetch = async (url: string, init?: unknown) => {
    requests.push({ url, init });
    const r = respond(url, init);
    return { ok: (r.status ?? 200) < 300, status: r.status ?? 200, json: async () => JSON.parse(r.body), text: async () => r.body };
  };
  const feed = createCryptoFeed({ fetch: fetch as never, now: () => new Date("2026-10-07T12:00:00.000Z"), log: () => {} });
  return { feed, requests };
}
const json = (v: unknown) => ({ body: JSON.stringify(v) });

test("the request URL is exactly the ruled one and carries nothing else", async () => {
  const { feed, requests } = setup(() => json(SAMPLE));
  await feed.read();
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, "https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD");
  assert.equal(KRAKEN_TICKER_URL, requests[0]!.url);
  const init = requests[0]!.init as { headers?: unknown; body?: unknown; method?: string; signal?: unknown; redirect?: string } | undefined;
  assert.deepEqual(init?.headers, { "User-Agent": "Yoh/1.0 (personal dashboard)" });
  assert.equal(init?.redirect, "error");
  assert.equal(init?.body, undefined);
  assert.ok(init?.method === undefined || init.method === "GET");
});

test("the sample parses to BTC, SOL, ETH in that order with the right change", async () => {
  const { feed } = setup(() => json(SAMPLE));
  const r = await feed.read();
  assert.equal(r.status, "ok");
  const t = r.value!.tickers;
  assert.deepEqual(t.map((x) => x.symbol), ["BTC", "SOL", "ETH"]);
  assert.deepEqual(t.map((x) => x.priceUsd), [67123.4, 142.57, 3456.78]);
  assert.ok(Math.abs(t[0]!.changePercent! - ((67123.4 - 66327.5) / 66327.5) * 100) < 1e-9);
  assert.ok(Math.abs(t[1]!.changePercent! - ((142.57 - 140) / 140) * 100) < 1e-9);
  assert.ok(t[2]!.changePercent! < 0);
});

test("changePercent is null when the open is missing or 0", async () => {
  const body = { error: [], result: { ...SAMPLE.result, XXBTZUSD: { c: ["100", "1"] }, SOLUSD: { c: ["5", "1"], o: "0" } } };
  const r = await setup(() => json(body)).feed.read();
  assert.equal(r.value!.tickers[0]!.changePercent, null);
  assert.equal(r.value!.tickers[1]!.changePercent, null);
});

const bad: [string, () => { status?: number; body: string }][] = [
  ["a non-empty error array", () => json({ ...SAMPLE, error: ["EGeneral:Too many requests"] })],
  ["a missing pair", () => json({ error: [], result: { XXBTZUSD: SAMPLE.result.XXBTZUSD, SOLUSD: SAMPLE.result.SOLUSD } })],
  ["an empty price string", () => json({ error: [], result: { ...SAMPLE.result, SOLUSD: { c: [""], o: "1" } } })],
  ["a negative price", () => json({ error: [], result: { ...SAMPLE.result, SOLUSD: { c: ["-5"], o: "1" } } })],
  ["a zero price", () => json({ error: [], result: { ...SAMPLE.result, SOLUSD: { c: ["0"], o: "1" } } })],
  ["a non-numeric price", () => json({ error: [], result: { ...SAMPLE.result, SOLUSD: { c: ["abc", "1"], o: "1" } } })],
  ["a non-2xx status", () => ({ status: 503, body: JSON.stringify(SAMPLE) })],
  ["invalid JSON", () => ({ body: "<html>nope" })],
];
for (const [name, respond] of bad) {
  test(`${name} fails the read`, async () => {
    const r = await setup(respond).feed.read();
    assert.equal(r.status, "unavailable");
    assert.equal(r.value, undefined);
  });
}

test("the refresh interval is 5 minutes, and the adapter's read takes no argument", () => {
  assert.equal(CRYPTO_REFRESH_MS, 5 * 60 * 1000);
  assert.equal(setup(() => json(SAMPLE)).feed.read.length, 0);
});
