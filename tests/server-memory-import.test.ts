/** POST /api/memory/import: unparseable body (400), dry run, real run. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { createApp } from "../src/shell/server.ts";
import type { ImportMemoryResponse } from "../src/types/api.ts";

function setup() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const memoryItems = createMemoryItemStore(connection);
  const app = createApp({ connection, log: () => {}, memoryItems });
  const post = (path: string, body: string) => app.request(path, { method: "POST", headers: { "Content-Type": "text/markdown" }, body });
  return { connection, memoryItems, app, post };
}
const FILE = "## About you\n- Runs most mornings. (2025-11-02)\n\n## Goals & projects\n- Is building Yoh.\n";

test("an unparseable file is a 400 that names the line, and writes nothing", async () => {
  const { post, memoryItems } = setup();
  const res = await post("/api/memory/import", "## Hobbies\n- chess\n## About you\n- fine");
  assert.equal(res.status, 400);
  const body = (await res.json()) as { ok: boolean; error: { kind: string; message: string } };
  assert.equal(body.error.kind, "validation");
  assert.match(body.error.message, /Line 1/);
  assert.match(body.error.message, /Hobbies/);
  assert.equal(memoryItems.listItems().length, 0);
});

test("an empty body is a 400", async () => {
  const { post } = setup();
  const res = await post("/api/memory/import", "");
  assert.equal(res.status, 400);
});

test("dry run reports and writes nothing; the real run files", async () => {
  const { post, memoryItems } = setup();
  const dry = await post("/api/memory/import?dryRun=1", FILE);
  assert.equal(dry.status, 200);
  const dryBody = (await dry.json()) as { ok: true; value: ImportMemoryResponse };
  assert.equal(dryBody.value.dryRun, true);
  assert.deepEqual(dryBody.value.counts, { filed: 2, skippedDuplicate: 0, rejected: 0 });
  assert.equal(memoryItems.listItems().length, 0);

  const real = await post("/api/memory/import", FILE);
  assert.equal(real.status, 200);
  const realBody = (await real.json()) as { ok: true; value: ImportMemoryResponse };
  assert.equal(realBody.value.dryRun, false);
  assert.match(realBody.value.batchTag, /^import:claude-\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(memoryItems.listItems().map((i) => i.text).sort(), ["Is building Yoh.", "Runs most mornings."]);

  const again = await post("/api/memory/import", FILE);
  const againBody = (await again.json()) as { ok: true; value: ImportMemoryResponse };
  assert.deepEqual(againBody.value.counts, { filed: 0, skippedDuplicate: 2, rejected: 0 });
  assert.equal(memoryItems.listItems().length, 2);
});

test("without a memory store the route answers not-configured", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  const app = createApp({ connection, log: () => {} });
  const res = await app.request("/api/memory/import", { method: "POST", body: FILE });
  assert.equal(((await res.json()) as { ok: boolean }).ok, false);
  assert.notEqual(res.status, 200);
});
