/**
 * The cross-origin POST guard and the app-wide error handler in `createApp`
 * (`src/shell/server.ts`). A browser can send a `text/plain` (or body-less)
 * POST to another origin without a preflight; `application/json` cannot be
 * sent that way, and this server answers no preflight.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { LogEntry } from "../src/adapters/logger.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createNotification, initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createApp, JSON_CONTENT_TYPE_REQUIRED_MESSAGE, type ServerDeps } from "../src/shell/server.ts";

const BODYLESS_ROUTES = [
  "/api/notifications/n1/read",
  "/api/plan/sync",
  "/api/check-off/c1/undo",
  "/api/check-off/c1/hold",
  "/api/check-off/c1/release",
  "/api/chat-history/clear",
];

function tempApp(overrides: Partial<ServerDeps> = {}) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const app = createApp({ connection, log: () => {}, clock: () => new Date("2026-09-25T12:00:00.000Z"), ...overrides });
  return { app, connection };
}

type Envelope = { ok: boolean; error?: { kind: string; message: string } };

for (const route of BODYLESS_ROUTES) {
  test(`POST ${route} is refused as a validation failure when sent as text/plain or with no content type`, async () => {
    const { app, connection } = tempApp();
    for (const headers of [{ "Content-Type": "text/plain" }, undefined]) {
      const res = await app.request(route, { method: "POST", ...(headers ? { headers } : {}) });
      assert.equal(res.status, 400);
      const body = (await res.json()) as Envelope;
      assert.equal(body.ok, false);
      assert.equal(body.error?.kind, "validation");
      assert.equal(body.error?.message, JSON_CONTENT_TYPE_REQUIRED_MESSAGE);
    }
    connection.close();
  });

  test(`POST ${route} reaches its handler when sent as application/json`, async () => {
    const { app, connection } = tempApp();
    const res = await app.request(route, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" } });
    const body = (await res.json()) as Envelope;
    assert.notEqual(body.error?.message, JSON_CONTENT_TYPE_REQUIRED_MESSAGE);
    connection.close();
  });
}

test("a refused POST writes nothing: the notification stays unread", async () => {
  const { app, connection } = tempApp();
  const id = createNotification(connection, { kind: "needs-data", title: "Missing fields", body: "x", deepLink: "/tasks", createdAt: "2026-09-25T00:00:00.000Z" });
  const res = await app.request(`/api/notifications/${id}/read`, { method: "POST", headers: { "Content-Type": "text/plain" } });
  assert.equal(res.status, 400);
  const list = (await (await app.request("/api/notifications")).json()) as { value: { notifications: unknown[] } };
  assert.equal(list.value.notifications.length, 1);
  connection.close();
});

test("GET requests need no content type", async () => {
  const { app, connection } = tempApp();
  assert.equal((await app.request("/api/notifications")).status, 200);
  connection.close();
});

test("malformed JSON on a validated route returns the Result envelope, not plain text", async () => {
  const { app, connection } = tempApp();
  const res = await app.request("/api/plan/reshuffle/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as Envelope;
  assert.equal(body.ok, false);
  assert.equal(body.error?.kind, "validation");
  connection.close();
});

test("a handler that throws returns an 'unreachable' envelope without the raw error text, and logs it", async () => {
  const logged: LogEntry[] = [];
  const { app, connection } = tempApp({ log: (entry) => logged.push(entry) });
  app.get("/api/boom", () => { throw new Error("sqlite: database connection lost"); }); // app/ functions catch their own throws, so add a route that doesn't
  const res = await app.request("/api/boom");
  assert.equal(res.status, 500);
  const body = (await res.json()) as Envelope;
  assert.equal(body.ok, false);
  assert.equal(body.error?.kind, "unreachable");
  assert.doesNotMatch(body.error?.message ?? "", /database|sqlite|connection/i);
  assert.ok(logged.some((entry) => entry.event === "server.unhandled-error"));
  connection.close();
});
