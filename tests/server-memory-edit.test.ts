/** Story 13.10 routes: body validation (400) and a happy path for each write. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { writeSetting } from "../src/adapters/settings-store.ts";
import { createApp } from "../src/shell/server.ts";

function setup() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const memoryItems = createMemoryItemStore(connection);
  const app = createApp({ connection, log: () => {}, memoryItems });
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { connection, memoryItems, app, post };
}

test("memory write routes reject malformed bodies with 400", async () => {
  const { post } = setup();
  for (const [path, body] of [
    ["/api/memory/edit", {}],
    ["/api/memory/edit", { itemId: "x" }],
    ["/api/memory/move", { itemId: "x" }],
    ["/api/memory/expiry", { itemId: "x" }],
    ["/api/memory/expiry", { itemId: "x", expiresOn: 5 }],
    ["/api/memory/delete", {}],
    ["/api/memory/sort-feedback", { itemId: "x", verdict: "maybe", reason: "r" }],
    ["/api/memory/sort-feedback", { itemId: "x", verdict: "right" }],
    ["/api/memory/review", { itemId: "x", action: "drop" }],
    ["/api/settings/revert", {}],
  ] as const) {
    const res = await post(path, body);
    assert.equal(res.status, 400, path);
    assert.equal(((await res.json()) as { error: { kind: string } }).error.kind, "validation");
  }
});

test("sort feedback is saved over HTTP and comes back on the item in GET /api/memory", async () => {
  const { memoryItems, post, app } = setup();
  const a = memoryItems.insert({ folder: "about-you", text: "Runs at 6", origin: "stated" });
  const res = await post("/api/memory/sort-feedback", { itemId: a.id, verdict: "wrong", reason: "It's a habit.", belongsIn: "patterns" });
  assert.equal(res.status, 200);
  const view = (await (await app.request("/api/memory")).json()) as { value: { folders: { items: { id: string; sortFeedback?: unknown }[] }[] } };
  const item = view.value.folders.flatMap((f) => f.items).find((i) => i.id === a.id);
  assert.deepEqual(item?.sortFeedback, { verdict: "wrong", reason: "It's a habit.", belongsIn: "patterns" });
});

test("edit, move, expiry, review, delete and revert work over HTTP", async () => {
  const { memoryItems, post, connection } = setup();
  const a = memoryItems.insert({ folder: "about-you", text: "Runs at 6", origin: "inferred" });
  const edited = await post("/api/memory/edit", { itemId: a.id, text: "Runs at 7" });
  assert.equal(edited.status, 200);
  const savedId = ((await edited.json()) as { value: { status: string; itemId: string } }).value.itemId;
  const moved = await post("/api/memory/move", { itemId: savedId, folder: "ideas-notes" });
  assert.equal(moved.status, 200);
  const movedId = ((await moved.json()) as { value: { itemId: string } }).value.itemId;
  assert.equal((await post("/api/memory/expiry", { itemId: movedId, expiresOn: null })).status, 200);
  const stale = await post("/api/memory/expiry", { itemId: a.id, expiresOn: null });
  assert.equal(stale.status, 409);
  const cur = memoryItems.listItems({ status: ["current"] })[0];
  assert.equal((await post("/api/memory/review", { itemId: (cur as { id: string }).id, action: "keep" })).status, 200);
  assert.equal((await post("/api/memory/delete", { itemId: a.id })).status, 200);
  assert.equal((await post("/api/memory/delete", { itemId: a.id })).status, 409);

  writeSetting(connection, "otherDayWorkStart", "10:30");
  const rev = await post("/api/settings/revert", { key: "otherDayWorkStart" });
  assert.equal(rev.status, 200);
  assert.match(((await rev.json()) as { value: { message: string } }).value.message, /^Reverted to /);
  connection.close();
});
