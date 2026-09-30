/** Story 13.13: `GET /api/memory/pattern-offer` works with `chat` deps absent and offers once per day. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryStore, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { createApp } from "../src/shell/server.ts";

test("pattern-offer route returns the pending question once, without chat deps", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const memoryItems = createMemoryItemStore(connection);
  const store = createMemoryStore(connection);
  const createdAt = new Date().toISOString();
  const proposal = { id: "pattern-r", kind: "pattern", entityId: "area-overrun:History", entityVersion: "new", suggested: { kind: "area-overrun", area: "History", occurrences: 5, paddingMinutes: 30 }, reason: "h\ne\nPlan for that?", createdAt };
  putOpenInteractionRequest(store, "proposal:pattern-r", { requestKind: "proposal", promptText: proposal.reason, detail: { proposal, cursor: { questionId: "confirm" } }, createdAt });
  memoryItems.putPatternState({ kind: "area-overrun", area: "History", pendingProposalId: "pattern-r" });
  const app = createApp({ connection, log: () => {}, memoryItems });

  const first = await app.request("/api/memory/pattern-offer");
  assert.equal(first.status, 200);
  const body = (await first.json()) as { ok: boolean; value: { question?: { requestId: string } } };
  assert.equal(body.value.question?.requestId, "proposal:pattern-r");
  const second = (await (await app.request("/api/memory/pattern-offer")).json()) as { value: { question?: unknown } };
  assert.equal(second.value.question, undefined);
  connection.close();
});

test("pattern-offer route is a 503-style not-configured envelope without memoryItems", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const app = createApp({ connection, log: () => {} });
  const res = await app.request("/api/memory/pattern-offer");
  assert.notEqual(res.status, 200);
  connection.close();
});
