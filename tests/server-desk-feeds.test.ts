/**
 * Tests for `GET /api/desk/feeds` (Epic 12): pure transport over `app/desk-feeds.ts`'s `getDeskFeeds`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createApp, startServer, type ServerDeps } from "../src/shell/server.ts";
import { buildDeskFeedsDeps } from "../src/shell/server-wiring.ts";

const deskFeeds: NonNullable<ServerDeps["deskFeeds"]> = {
  timeZone: "UTC",
  readCrypto: async () => ({ status: "ok", value: { tickers: [{ symbol: "BTC", priceUsd: 67123.4, changePercent: 1.2 }] }, fetchedAt: "2026-10-07T12:00:00.000Z" }),
};

function connection() {
  const c = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(c.db);
  return c;
}

test("GET /api/desk/feeds returns the ok envelope with timeZone and crypto", async () => {
  const app = createApp({ connection: connection(), log: () => {}, deskFeeds });
  const res = await app.request("/api/desk/feeds");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; value: { timeZone: string; crypto: { status: string } } };
  assert.equal(body.ok, true);
  assert.equal(body.value.timeZone, "UTC");
  assert.equal(body.value.crypto.status, "ok");
});

test("GET /api/desk/feeds answers the Desk not-configured failure when absent", async () => {
  const app = createApp({ connection: connection(), log: () => {} });
  const res = await app.request("/api/desk/feeds");
  assert.equal(res.status, 503);
  const body = (await res.json()) as { ok: boolean; error: { kind: string } };
  assert.equal(body.ok, false);
  assert.equal(body.error.kind, "unreachable");
});

test("startServer forwards features.deskFeeds", async () => {
  let fetchFn: ((request: Request) => Response | Promise<Response>) | undefined;
  const serveFn = (options: { fetch: (request: Request) => Response | Promise<Response> }) => {
    fetchFn = options.fetch;
    return { close: () => {} };
  };
  startServer(connection(), {}, serveFn, { deskFeeds });
  const res = await fetchFn!(new Request("http://127.0.0.1/api/desk/feeds"));
  assert.equal(res.status, 200);
});

test("buildDeskFeedsDeps is undefined without YOH_TIMEZONE, and built with it", () => {
  assert.equal(buildDeskFeedsDeps({}), undefined);
  const deps = buildDeskFeedsDeps({ YOH_TIMEZONE: "America/Los_Angeles" }, (async () => { throw new Error("no network in tests"); }) as never);
  assert.equal(deps?.timeZone, "America/Los_Angeles");
});
