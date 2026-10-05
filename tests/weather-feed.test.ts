/**
 * Tests for the National Weather Service feed (Ruling E12-R19) with a fake `fetch`; no test calls the provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWeatherFeed, WEATHER_REFRESH_MS, WEATHER_LOCATION, WEATHER_POINTS_URL } from "../src/adapters/weather-feed.ts";

const HOURLY = "https://api.weather.gov/gridpoints/SEW/125,68/forecast/hourly";
const DAILY = "https://api.weather.gov/gridpoints/SEW/125,68/forecast";
const POINTS = { properties: { forecast: DAILY, forecastHourly: HOURLY } };
const HOURLY_BODY = { properties: { periods: [{ name: "", startTime: "2026-10-04T17:00:00-07:00", temperature: 58, temperatureUnit: "F", shortForecast: "Partly Cloudy" }] } };
const DAILY_BODY = {
  properties: {
    periods: [
      { name: "Tonight", temperature: 49, temperatureUnit: "F", shortForecast: "Mostly Clear" },
      { name: "Monday", temperature: 63, temperatureUnit: "F", shortForecast: "Sunny" },
    ],
  },
};

type Responder = (url: string) => { status?: number; body: unknown };
function setup(respond?: Responder, now = { t: Date.parse("2026-10-04T12:00:00.000Z") }) {
  const requests: { url: string; init: { headers?: Record<string, string> } }[] = [];
  const routes: Record<string, { status?: number; body: unknown }> = { [WEATHER_POINTS_URL]: { body: POINTS }, [HOURLY]: { body: HOURLY_BODY }, [DAILY]: { body: DAILY_BODY } };
  const fetch = async (url: string, init: { headers?: Record<string, string> }) => {
    requests.push({ url, init });
    const r = respond ? respond(url) : (routes[url] ?? { status: 500, body: {} });
    const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  };
  const feed = createWeatherFeed({ fetch: fetch as never, now: () => new Date(now.t), log: () => {} });
  return { feed, requests, routes, now };
}

test("a read requests the points URL, then the hourly and daily forecast, and nothing else", async () => {
  const { feed, requests } = setup();
  const r = await feed.read();
  assert.equal(r.status, "ok");
  assert.deepEqual(requests.map((q) => q.url).sort(), [DAILY, HOURLY, WEATHER_POINTS_URL].sort());
  assert.equal(WEATHER_POINTS_URL, "https://api.weather.gov/points/47.6062,-122.3321");
  assert.equal(requests[0]!.url, WEATHER_POINTS_URL);
});

test("every request sends User-Agent and Accept", async () => {
  const { feed, requests } = setup();
  await feed.read();
  for (const q of requests) {
    assert.equal(q.init.headers?.["User-Agent"], "Yoh/1.0 (personal dashboard)");
    assert.equal(q.init.headers?.["Accept"], "application/geo+json");
  }
});

test("the value comes from the first hourly period and the first non-now daily period", async () => {
  const r = await setup().feed.read();
  assert.deepEqual(r.value, { location: "Seattle, WA", temperatureF: 58, conditions: "Partly Cloudy", next: { name: "Tonight", temperatureF: 49, summary: "Mostly Clear" } });
  assert.deepEqual(WEATHER_LOCATION, { name: "Seattle, WA", latitude: 47.6062, longitude: -122.3321 });
});

test("next skips a period named Now and is null when there is none", async () => {
  const a = setup();
  a.routes[DAILY] = { body: { properties: { periods: [{ name: "Now", temperature: 1, temperatureUnit: "F", shortForecast: "x" }, ...DAILY_BODY.properties.periods] } } };
  assert.equal((await a.feed.read()).value!.next!.name, "Tonight");
  const b = setup();
  b.routes[DAILY] = { body: { properties: { periods: [] } } };
  assert.equal((await b.feed.read()).value!.next, null);
});

test("Celsius periods are converted to Fahrenheit", async () => {
  const { feed, routes } = setup();
  routes[HOURLY] = { body: { properties: { periods: [{ name: "", temperature: 20, temperatureUnit: "C", shortForecast: "Clear" }] } } };
  routes[DAILY] = { body: { properties: { periods: [{ name: "Tonight", temperature: 10, temperatureUnit: "C", shortForecast: "Cool" }] } } };
  const r = await feed.read();
  assert.equal(r.value!.temperatureF, 68);
  assert.equal(r.value!.next!.temperatureF, 50);
});

test("the grid URLs are cached across reads", async () => {
  const { feed, requests, now } = setup();
  await feed.read();
  now.t += WEATHER_REFRESH_MS + 1;
  await feed.read();
  assert.equal(requests.filter((q) => q.url === WEATHER_POINTS_URL).length, 1);
  assert.equal(requests.filter((q) => q.url === HOURLY).length, 2);
});

test("a 404 from a forecast URL fails the read and the points URL is looked up again", async () => {
  const { feed, requests, routes, now } = setup();
  await feed.read();
  now.t += WEATHER_REFRESH_MS + 1;
  routes[HOURLY] = { status: 404, body: {} };
  assert.equal((await feed.read()).status, "stale");
  routes[HOURLY] = { body: HOURLY_BODY };
  now.t += 61_000;
  assert.equal((await feed.read()).status, "ok");
  assert.equal(requests.filter((q) => q.url === WEATHER_POINTS_URL).length, 2);
});

test("a failing step fails the read", async () => {
  for (const bad of [WEATHER_POINTS_URL, HOURLY, DAILY]) {
    const { feed, routes } = setup();
    routes[bad] = { status: 503, body: {} };
    const r = await feed.read();
    assert.equal(r.status, "unavailable");
    assert.equal(r.value, undefined);
  }
  const { feed, routes } = setup();
  routes[HOURLY] = { body: { properties: { periods: [] } } };
  assert.equal((await feed.read()).status, "unavailable");
});

test("the refresh interval is 30 minutes, and read takes no argument", () => {
  assert.equal(WEATHER_REFRESH_MS, 30 * 60 * 1000);
  assert.equal(setup().feed.read.length, 0);
});
