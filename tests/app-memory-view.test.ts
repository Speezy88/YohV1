/** Story 13.9 Part 1: viewMemory, searchMemory, and their store helpers. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createChatStore, initChatStoreSchema } from "../src/adapters/chat-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { createMemoryStore, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { listSettingRows, writeSetting } from "../src/adapters/settings-store.ts";
import { viewMemory } from "../src/app/memory-view.ts";
import { searchMemory } from "../src/app/memory-search.ts";
import { MEMORY_FOLDERS_IN_ORDER } from "../src/core/memory-folders.ts";

const NOW = () => new Date("2026-09-29T15:00:00.000Z");

function world() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initChatStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const memoryItems = createMemoryItemStore(connection);
  const chatHistory = createChatStore(connection);
  const store = createMemoryStore(connection);
  const deps = { memoryItems, chatHistory, connection, store, now: NOW, timeZone: "UTC" };
  return { connection, memoryItems, chatHistory, store, deps };
}
const NEW = (o: object = {}) => ({ folder: "about-you" as const, text: "Runs at 6", origin: "stated" as const, ...o });

test("viewMemory returns all eight folders in PRD order with counts and an expired item under Needs review", async () => {
  const w = world();
  w.memoryItems.insert(NEW());
  w.memoryItems.insert(NEW({ folder: "goals-projects", text: "Ship the beta", expiresOn: "2026-09-01" }));
  const r = await viewMemory(w.deps, {});
  assert.ok(r.ok);
  assert.deepEqual(r.value.folders.map((f) => f.folder), [...MEMORY_FOLDERS_IN_ORDER]);
  assert.equal(r.value.folders.find((f) => f.folder === "about-you")!.count, 1);
  assert.equal(r.value.folders.find((f) => f.folder === "about-you")!.loadClass, "always");
  assert.equal(r.value.needsReview.length, 1);
  assert.equal(r.value.needsReview[0]!.reason, "Expired Sep 1");
  assert.equal(r.value.needsReview[0]!.canRenew, true);
  const goal = r.value.folders.find((f) => f.folder === "goals-projects")!.items[0]!;
  assert.equal(goal.loaded, false);
  assert.equal(goal.notLoadedReason, "Expired Sep 1");
});

test("viewMemory: source, earlier versions, history status, pending change", async () => {
  const w = world();
  const t = w.chatHistory.appendTurn({ date: "2026-09-28", role: "user", text: "hi", at: "2026-09-28T10:00:00.000Z" });
  const a = w.memoryItems.insert(NEW({ sourceTurnId: t.id, text: "v1" }));
  const b = w.memoryItems.supersede(a.id, NEW({ text: "v2", sourceTurnId: "gone-turn" }));
  const h = w.memoryItems.insert(NEW({ text: "kept", folder: "ideas-notes" }));
  w.memoryItems.keepAsHistory(h.id);
  const r = await viewMemory(w.deps, {});
  assert.ok(r.ok);
  const item = r.value.folders.find((f) => f.folder === "about-you")!.items[0]!;
  assert.equal(item.id, b.id);
  assert.equal(item.source, "deleted");
  assert.deepEqual(item.earlierVersions.map((v) => v.text), ["v1"]);
  const orig = w.memoryItems.getItem(a.id);
  assert.ok(orig);
  const ideas = r.value.folders.find((f) => f.folder === "ideas-notes")!;
  assert.equal(ideas.count, 0);
  assert.equal(ideas.items[0]!.status, "history");
});

test("viewMemory: a live source turn resolves to its Conversation and date", async () => {
  const w = world();
  const t = w.chatHistory.appendTurn({ date: "2026-09-28", role: "user", text: "hi", at: "2026-09-28T10:00:00.000Z" });
  w.memoryItems.insert(NEW({ sourceTurnId: t.id }));
  const r = await viewMemory(w.deps, {});
  assert.ok(r.ok);
  assert.deepEqual(r.value.folders.find((f) => f.folder === "about-you")!.items[0]!.source, { conversationId: t.conversationId, turnId: t.id, date: "2026-09-28" });
});

test("viewMemory: changed settings and pending patterns", async () => {
  const w = world();
  writeSetting(w.connection, "lunchWindow", { start: "12:00", end: "13:00" });
  const proposal = { id: "p1", kind: "learned-pattern", entityId: "e", entityVersion: "v", suggested: {}, reason: "r", createdAt: "2026-09-29T10:00:00.000Z" };
  putOpenInteractionRequest(w.store, "proposal:p1", { requestKind: "proposal", promptText: "Remember this pattern?", detail: { proposal }, createdAt: "2026-09-29T10:00:00.000Z" });
  w.memoryItems.putPatternState({ kind: "duration", area: "Home", pendingProposalId: "p1" });
  const r = await viewMemory(w.deps, {});
  assert.ok(r.ok);
  assert.equal(r.value.changedSettings.length, 1);
  assert.equal(r.value.changedSettings[0]!.label, "lunch");
  assert.equal(r.value.changedSettings[0]!.value, "12:00 PM-1:00 PM");
  assert.equal(r.value.pendingPatterns.length, 1);
  assert.equal(r.value.pendingPatterns[0]!.requestId, "proposal:p1");
  assert.equal(r.value.pendingPatterns[0]!.text, "Remember this pattern?");
  assert.equal(listSettingRows(w.connection.db).length, 1);
});

test("viewMemory: a failing store returns an unreachable error", async () => {
  const w = world();
  const broken = { ...w.memoryItems, listItems: () => { throw new Error("db down"); } };
  const r = await viewMemory({ ...w.deps, memoryItems: broken }, {});
  assert.ok(!r.ok && r.error.kind === "unreachable");
});

test("searchMemory finds memories and chat turns; rejects empty and long queries", async () => {
  const w = world();
  w.memoryItems.insert(NEW({ text: "Prefers mornings for deep work" }));
  w.chatHistory.appendTurn({ date: "2026-09-27", role: "user", text: "deep work block please", at: "2026-09-27T10:00:00.000Z" });
  const r = await searchMemory(w.deps, { query: "  deep work " });
  assert.ok(r.ok);
  assert.equal(r.value.query, "deep work");
  assert.equal(r.value.items.length, 1);
  assert.equal(r.value.turns.length, 1);
  assert.equal(r.value.turns[0]!.date, "2026-09-27");
  assert.equal(r.value.turns[0]!.role, "user");
  const empty = await searchMemory(w.deps, { query: "   " });
  assert.ok(!empty.ok && empty.error.kind === "validation");
  const long = await searchMemory(w.deps, { query: "x".repeat(201) });
  assert.ok(!long.ok && long.error.kind === "validation");
});

test("GET /api/memory and /api/memory/search work without chat deps", async () => {
  const { createApp } = await import("../src/shell/server.ts");
  const w = world();
  w.memoryItems.insert(NEW({ text: "Prefers mornings for deep work" }));
  const app = createApp({ connection: w.connection, log: () => {}, memoryItems: w.memoryItems, chatHistory: w.chatHistory });
  const view = (await (await app.request("/api/memory")).json()) as { ok: boolean; value: { folders: unknown[] } };
  assert.ok(view.ok);
  assert.equal(view.value.folders.length, 8);
  const found = (await (await app.request("/api/memory/search?q=deep%20work")).json()) as { ok: boolean; value: { items: unknown[] } };
  assert.equal(found.value.items.length, 1);
  const bad = await app.request("/api/memory/search?q=");
  assert.equal(bad.status, 400);
  const bare = createApp({ connection: w.connection, log: () => {} });
  assert.ok((await bare.request("/api/memory")).status >= 500);
});

test("ChatStore.getTurn and searchTurns", () => {
  const w = world();
  const t = w.chatHistory.appendTurn({ date: "2026-09-27", role: "assistant", text: "Consider the garden plan", at: "2026-09-27T10:00:00.000Z" });
  assert.equal(w.chatHistory.getTurn(t.id)?.date, "2026-09-27");
  assert.equal(w.chatHistory.getTurn("nope"), undefined);
  assert.equal(w.chatHistory.searchTurns("garden", 5)[0]?.turnId, t.id);
  assert.deepEqual(w.chatHistory.searchTurns("a", 5), []);
});

test("viewMemory: confirmedOn and changedOn are the day in the host time zone, not the UTC day", async () => {
  const w = world();
  const a = w.memoryItems.insert(NEW({ text: "v1" }));
  const b = w.memoryItems.supersede(a.id, NEW({ text: "v2" }));
  // 2026-09-30 02:30 UTC is still 2026-09-29 (evening) in Los Angeles.
  w.connection.db.prepare("UPDATE memory_items SET confirmed_at = ?").run("2026-09-30T02:30:00.000Z");
  writeSetting(w.connection, "lunchWindow", { start: "12:00", end: "13:00" });
  w.connection.db.prepare("UPDATE planning_settings SET updated_at = ?").run("2026-09-30T02:30:00.000Z");
  const r = await viewMemory({ ...w.deps, timeZone: "America/Los_Angeles" }, {});
  assert.ok(r.ok);
  const item = r.value.folders.find((f) => f.folder === "about-you")!.items.find((i) => i.id === b.id)!;
  assert.equal(item.confirmedOn, "2026-09-29");
  assert.equal(item.earlierVersions[0]!.confirmedOn, "2026-09-29");
  assert.equal(r.value.changedSettings[0]!.changedOn, "2026-09-29");
});
