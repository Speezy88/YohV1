import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { recallMemoryContext } from "../src/app/memory-recall.ts";
import type { Task } from "../src/types/domain.ts";

function fresh() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  return { connection, store: createMemoryItemStore(connection) };
}
const base = { now: () => new Date("2026-09-29T18:00:00.000Z"), timeZone: "America/Los_Angeles" };

test("absent store -> undefined value, ok", async () => {
  const r = await recallMemoryContext({ ...base }, { requestText: "hello" });
  assert.deepEqual(r, { ok: true, value: undefined });
});

test("throwing store -> undefined value and a warning, never an error", async () => {
  const logs: any[] = [];
  const memoryItems = { listItems: () => { throw new Error("db down"); } } as never;
  const r = await recallMemoryContext({ ...base, memoryItems, log: (e) => logs.push(e) }, { requestText: "hello" });
  assert.deepEqual(r, { ok: true, value: undefined });
  assert.equal(logs[0].level, "warn");
});

test("loads always items, matches relevant items and bumps last_matched_at only for them", async () => {
  const { store } = fresh();
  const a = store.insert({ folder: "feedback", text: "Keep it short", origin: "stated" });
  const g = store.insert({ folder: "goals-projects", text: "Ship the Obliterade launch", origin: "stated" });
  const other = store.insert({ folder: "goals-projects", text: "Learn piano", origin: "stated" });
  const r = await recallMemoryContext({ ...base, memoryItems: store }, { requestText: "how is the Obliterade launch going" });
  assert.ok(r.ok && r.value);
  assert.deepEqual(r.value.context.always.map((m) => m.id), [a.id]);
  assert.deepEqual(r.value.context.relevant.map((m) => m.id), [g.id]);
  assert.ok(store.getItem(g.id)?.lastMatchedAt);
  assert.equal(store.getItem(other.id)?.lastMatchedAt, undefined);
  assert.equal(store.getItem(a.id)?.lastMatchedAt, undefined);
});

test("empty request text touches nothing", async () => {
  const { store } = fresh();
  const g = store.insert({ folder: "goals-projects", text: "Ship the launch", origin: "stated" });
  const r = await recallMemoryContext({ ...base, memoryItems: store }, { requestText: "  " });
  assert.ok(r.ok && r.value);
  assert.deepEqual(r.value.context.relevant, []);
  assert.equal(store.getItem(g.id)?.lastMatchedAt, undefined);
});

test("readTasks is called only when an item has an entityRef; a failure skips entity checks", async () => {
  const { store } = fresh();
  store.insert({ folder: "about-you", text: "plain", origin: "stated" });
  let calls = 0;
  const readTasks = async (): Promise<readonly Task[]> => { calls++; throw new Error("notion down"); };
  await recallMemoryContext({ ...base, memoryItems: store, readTasks }, { requestText: "x" });
  assert.equal(calls, 0);
  const ref = store.insert({ folder: "about-you", text: "tied", origin: "stated", entityRef: "task-1" });
  const logs: any[] = [];
  const r = await recallMemoryContext({ ...base, memoryItems: store, readTasks, log: (e) => logs.push(e) }, { requestText: "x" });
  assert.equal(calls, 1);
  assert.ok(r.ok && r.value);
  assert.equal(r.value.states.find((s) => s.itemId === ref.id)?.loaded, true);
  assert.equal(logs.length, 1);
});

test("a completed Task's item is not loaded", async () => {
  const { store } = fresh();
  const ref = store.insert({ folder: "about-you", text: "tied", origin: "stated", entityRef: "task-1" });
  const readTasks = async () => [{ id: "task-1", title: "t", status: "completed" }] as unknown as Task[];
  const r = await recallMemoryContext({ ...base, memoryItems: store, readTasks }, { requestText: "" });
  assert.ok(r.ok && r.value);
  assert.deepEqual(r.value.context.always, []);
  assert.equal(r.value.states.find((s) => s.itemId === ref.id)?.reason?.kind, "entity-done");
});
