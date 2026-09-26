/**
 * Tests for `src/app/notifications.ts` (Story 7.3, AD-16): the unread list
 * and mark-read use-cases, shaped `(deps, input) => Promise<Result<…>>`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createNotification, initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { listNotifications, markNotificationRead } from "../src/app/notifications.ts";

const NOW = "2026-09-25T12:00:00.000Z";

function tempDeps() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return { connection, now: () => new Date(NOW) };
}

function raise(deps: ReturnType<typeof tempDeps>) {
  return createNotification(deps.connection, {
    kind: "operational",
    title: "t",
    body: "b",
    deepLink: null,
    createdAt: "2026-09-25T00:00:00.000Z",
  });
}

test("listNotifications returns every unread notification as NotificationRecords", async () => {
  const deps = tempDeps();
  const id = raise(deps);
  assert.deepEqual(await listNotifications(deps, {}), {
    ok: true,
    value: {
      notifications: [{ id, kind: "operational", title: "t", body: "b", deepLink: null, createdAt: "2026-09-25T00:00:00.000Z" }],
    },
  });
  deps.connection.close();
});

test("markNotificationRead stamps readAt from the injected clock and the notification leaves the unread list", async () => {
  const deps = tempDeps();
  const id = raise(deps);
  assert.deepEqual(await markNotificationRead(deps, { id }), { ok: true, value: { id, readAt: NOW } });
  assert.deepEqual(await listNotifications(deps, {}), { ok: true, value: { notifications: [] } });
  deps.connection.close();
});

test("markNotificationRead on an already-read notification is ok and returns the original readAt", async () => {
  const deps = tempDeps();
  const id = raise(deps);
  await markNotificationRead(deps, { id });
  const later = { ...deps, now: () => new Date("2026-09-26T00:00:00.000Z") };
  assert.deepEqual(await markNotificationRead(later, { id }), { ok: true, value: { id, readAt: NOW } });
  deps.connection.close();
});

test("markNotificationRead on an unknown id is a validation error, not a silent success", async () => {
  const deps = tempDeps();
  const result = await markNotificationRead(deps, { id: "nope" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.kind, "validation");
    assert.match(result.error.message, /nope/);
  }
  deps.connection.close();
});

test("a store failure becomes an unreachable Result, never a throw", async () => {
  const deps = tempDeps();
  deps.connection.close();
  const list = await listNotifications(deps, {});
  const mark = await markNotificationRead(deps, { id: "x" });
  assert.equal(list.ok, false);
  assert.equal(mark.ok, false);
  if (!list.ok) assert.equal(list.error.kind, "unreachable");
  if (!mark.ok) assert.equal(mark.error.kind, "unreachable");
});
