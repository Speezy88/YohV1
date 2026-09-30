/** Tests for `src/app/rate.ts` and `POST /api/rating` (Story 13.11). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatStore, initChatStoreSchema } from "../src/adapters/chat-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { createMemoryStore } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createRatingStore, initRatingStoreSchema } from "../src/adapters/rating-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { rate } from "../src/app/rate.ts";
import { createApp } from "../src/shell/server.ts";

const NOW = new Date("2026-09-30T14:00:00.000Z");

function setup(filer: string | Error = '[{"folder":"feedback","text":"The plan was too wordy","origin":"stated"}]') {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initChatStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  initRatingStoreSchema(connection.db);
  const calls: unknown[] = [];
  const llmClient = {
    messages: {
      create: async (p: unknown) => {
        calls.push(p);
        if (filer instanceof Error) throw filer;
        return { content: [{ type: "text", text: filer }], usage: { input_tokens: 1, output_tokens: 1 } };
      },
    },
  };
  const chatHistory = createChatStore(connection);
  const memoryItems = createMemoryItemStore(connection);
  const ratings = createRatingStore(connection);
  const userTurn = chatHistory.appendTurn({ date: "2026-09-30", role: "user", text: "/morning", at: NOW.toISOString() });
  ratings.openPrompt({ promptId: "p1", today: "2026-09-30", at: NOW.toISOString() });
  const deps = {
    ratings, chatHistory, memoryItems, llmClient, connection, store: createMemoryStore(connection),
    now: () => NOW, timeZone: "America/New_York", log: () => {},
  } as unknown as Parameters<typeof rate>[0];
  return { deps, ratings, memoryItems, chatHistory, userTurn, calls, connection, llmClient };
}

test("a plain score stores, files nothing and calls no model", async () => {
  const h = setup();
  const r = await rate(h.deps, { promptId: "p1", score: 3 });
  assert.deepEqual(r, { ok: true, value: {} });
  assert.equal(h.calls.length, 0);
  assert.equal(h.memoryItems.listItems().length, 0);
  assert.equal(h.ratings.getState().openPromptId, undefined);
});

test("a dismissal is recorded", async () => {
  const h = setup();
  assert.equal((await rate(h.deps, { promptId: "p1", dismissed: true })).ok, true);
  assert.equal(h.ratings.getState().consecutiveDismissals, 1);
});

test("validation and conflicts", async () => {
  const h = setup();
  const kind = async (i: Parameters<typeof rate>[1]) => {
    const r = await rate(h.deps, i);
    return r.ok ? "ok" : r.error.kind;
  };
  assert.equal(await kind({ promptId: "p1" }), "validation");
  assert.equal(await kind({ promptId: "p1", score: 2, dismissed: true }), "validation");
  assert.equal(await kind({ promptId: "p1", score: 2, note: "x" }), "validation");
  assert.equal(await kind({ promptId: "p1", score: 1, note: "   " }), "validation");
  assert.equal(await kind({ promptId: "p1", score: 1, note: "x".repeat(281) }), "validation");
  assert.equal(await kind({ promptId: "zzz", score: 2 }), "conflict");
  assert.equal(await kind({ promptId: "p1", score: 2 }), "ok");
  assert.equal(await kind({ promptId: "p1", score: 3 }), "conflict");
});

test("a 1 then a note files to Feedback as Stated with an undoable receipt on the last turn", async () => {
  const h = setup();
  assert.equal((await rate(h.deps, { promptId: "p1", score: 1 })).ok, true);
  const r = await rate(h.deps, { promptId: "p1", score: 1, note: "  The plan was too wordy " });
  assert.ok(r.ok && r.value.receipt && r.value.receipt.items.length === 1);
  const item = h.memoryItems.getItem(r.value.receipt.items[0]!.id);
  assert.deepEqual([item?.folder, item?.origin], ["feedback", "stated"]);
  const stored = h.memoryItems.getReceipt(r.value.receipt.receiptId);
  assert.equal(stored?.userTurnId, h.userTurn.id);
});

test("note filing failure keeps the rating and returns an empty receipt; without memory deps too", async () => {
  const h = setup(new Error("net"));
  await rate(h.deps, { promptId: "p1", score: 1 });
  const r = await rate(h.deps, { promptId: "p1", score: 1, note: "too wordy" });
  assert.ok(r.ok && r.value.receipt?.items.length === 0);
  assert.equal(h.ratings.getState().openPromptId, undefined);
  const h2 = setup();
  const bare = { ...(h2.deps as object), memoryItems: undefined, llmClient: undefined } as unknown as Parameters<typeof rate>[0];
  await rate(bare, { promptId: "p1", score: 1 });
  const r2 = await rate(bare, { promptId: "p1", score: 1, note: "too wordy" });
  assert.ok(r2.ok && r2.value.receipt?.items.length === 0);
  assert.equal(h2.calls.length, 0);
});

test("POST /api/rating validates, stores, and reports conflicts", async () => {
  const h = setup();
  const app = createApp({ connection: h.connection, log: () => {}, ratings: h.ratings });
  const post = (body: unknown) => app.request("/api/rating", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ promptId: "p1", score: 7 })).status, 400);
  assert.equal((await post({ promptId: "p1", dismissed: false })).status, 400);
  const good = await post({ promptId: "p1", score: 2 });
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), { ok: true, value: {} });
  const again = await post({ promptId: "p1", score: 2 });
  assert.equal(again.status, 409);
  const bare = createApp({ connection: h.connection, log: () => {} });
  assert.notEqual((await bare.request("/api/rating", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptId: "p1", score: 2 }) })).status, 200);
});
