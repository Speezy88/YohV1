/**
 * Story 7.5, AD-17: `Content-Security-Policy: default-src 'self'` on every
 * response `shell/server.ts` sends, not only the HTML document — so the
 * page can't call a third party or load a third-party script or font.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createApp } from "../src/shell/server.ts";

test("every response carries Content-Security-Policy: default-src 'self'", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const app = createApp({ connection });
  const health = await app.request("/api/health");
  assert.equal(health.headers.get("Content-Security-Policy"), "default-src 'self'");
  connection.close();
});

test("the CSP header is present on a 404 (route not found) too", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const app = createApp({ connection });
  const res = await app.request("/api/does-not-exist");
  assert.equal(res.headers.get("Content-Security-Policy"), "default-src 'self'");
  connection.close();
});
