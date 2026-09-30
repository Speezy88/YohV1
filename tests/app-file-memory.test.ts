/** Story 13.8 Part 2: planning preferences raise a rule-change Proposal in the filing transaction. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatStore, initChatStoreSchema } from "../src/adapters/chat-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { createMemoryStore, findOpenRuleProposals, getOpenInteractionRequest, listOpenInteractionRequests, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { readPlanningSettings } from "../src/adapters/settings-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { chatExchange, type ChatExchangeDeps } from "../src/app/chat-exchange.ts";
import { fileMemory } from "../src/app/file-memory.ts";
import { surfaceOpenItems } from "../src/app/surface-open-items.ts";
import { undoMemoryReceipt } from "../src/app/memory-undo.ts";
import { ruleChangeRequestId } from "../src/core/rule-change.ts";
import type { ChatStreamEvent } from "../src/types/api.ts";
import type { Task } from "../src/types/domain.ts";

const NOW = new Date("2026-08-22T18:00:00.000Z");
const SCHOOL = '[{"folder":"planning-preferences","text":"Start work at 2:30 on school days","origin":"stated","ruleChange":{"key":"schoolDayWorkStart","value":"14:30"}}]';

function filer(text: string) {
  return { messages: { create: async () => ({ content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } }) } } as unknown as ChatExchangeDeps["llmClient"];
}

function harness(json: string, extra: Record<string, unknown> = {}) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initChatStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  const memoryItems = createMemoryItemStore(connection);
  const chatHistory = createChatStore(connection);
  const events: ChatStreamEvent[] = [];
  const deps = {
    chatHistory, memoryItems, store, connection,
    memoryLlmClient: filer(json),
    readTasks: async () => [{ area: "Work" }] as unknown as Task[],
    timeZone: "America/New_York",
    now: () => NOW,
    emit: (e: ChatStreamEvent) => events.push(e),
    log: () => {},
    runChatTurn: async () => ({ ok: true as const, value: { reply: "Ok.", receipts: [] } }),
    ...extra,
  } as unknown as ChatExchangeDeps;
  const schoolStart = () => store.withDb(readPlanningSettings).workStart.schoolDay;
  return { deps, events, store, memoryItems, connection, chatHistory, schoolStart };
}

const MSG = "Please start my work at 2:30 on school days from now on";

test("auto-filed school-day work start emits remembered then proposal; item pending; no override yet", async () => {
  const h = harness(SCHOOL);
  await chatExchange(h.deps, { message: MSG });
  assert.deepEqual(h.events.map((e) => e.type), ["done", "remembered", "proposal"]);
  const ev = h.events[2];
  assert.ok(ev?.type === "proposal");
  if (ev?.type === "proposal") {
    assert.equal(ev.question.text, "Change school-day work start from 3:15 PM to 2:30 PM?");
    assert.equal(ev.question.allowsFreeText, false);
  }
  const [item] = h.memoryItems.listItems();
  assert.equal(item?.ruleChange, "pending");
  assert.ok(getOpenInteractionRequest(h.store, ruleChangeRequestId(item!.id)));
  assert.deepEqual(h.schoolStart(), { hour: 15, minute: 15 });
});

test("explicit remember also raises the proposal", async () => {
  const h = harness(SCHOOL, { runChatTurn: async () => ({ ok: true, value: { reply: "Got it.", receipts: [], memory: { kind: "remember", text: "start work at 2:30 on school days" } } }) });
  await chatExchange(h.deps, { message: "remember start work at 2:30 on school days" });
  assert.deepEqual(h.events.map((e) => e.type), ["done", "remembered", "proposal"]);
});

test("atomic: a failure after the request put persists neither the item nor the request", async () => {
  const h = harness(SCHOOL);
  const real = h.store.readModifyWrite.bind(h.store);
  (h.store as { readModifyWrite: unknown }).readModifyWrite = (...a: Parameters<typeof real>) => {
    real(...a);
    throw new Error("boom");
  };
  const r = await fileMemory(h.deps as never, { text: MSG, forceStated: false });
  assert.equal(r.ok, false);
  assert.equal(h.memoryItems.listItems().length, 0);
  assert.equal(listOpenInteractionRequests(h.store).length, 0);
});

test("G1: work start earlier than 09:00 files soft with no proposal", async () => {
  const h = harness('[{"folder":"planning-preferences","text":"Start work at 8:00 on school days","origin":"stated","ruleChange":{"key":"schoolDayWorkStart","value":"08:00"}}]');
  await chatExchange(h.deps, { message: "start work at 8:00 on school days" });
  assert.deepEqual(h.events.map((e) => e.type), ["done", "remembered"]);
  assert.equal(h.memoryItems.listItems()[0]?.ruleChange, "none");
  assert.equal(listOpenInteractionRequests(h.store).length, 0);
});

test("soft cases: unchanged value, unknown key, unknown Area, no connection", async () => {
  const same = harness(SCHOOL.replace("14:30", "15:15"));
  await chatExchange(same.deps, { message: MSG });
  assert.equal(same.memoryItems.listItems()[0]?.ruleChange, "none");

  const key = harness(SCHOOL.replace("schoolDayWorkStart", "blockLength"));
  await chatExchange(key.deps, { message: MSG });
  assert.equal(key.memoryItems.listItems()[0]?.ruleChange, "none");

  const pad = (area: string) => `[{"folder":"planning-preferences","text":"Pad Work","origin":"stated","ruleChange":{"key":"areaDurationPadding","value":{"area":"${area}","minutes":10}}}]`;
  const unknown = harness(pad("Fitness"));
  await chatExchange(unknown.deps, { message: "Please plan ten extra minutes for Fitness tasks from now on" });
  assert.equal(unknown.memoryItems.listItems()[0]?.ruleChange, "none");
  assert.equal(listOpenInteractionRequests(unknown.store).length, 0);

  const known = harness(pad("work"));
  await chatExchange(known.deps, { message: "Please plan ten extra minutes for Work tasks from now on" });
  const q = known.events.find((e) => e.type === "proposal");
  assert.ok(q?.type === "proposal" && q.question.text === "Plan 10 extra minutes for Work Tasks (now 0)?");

  const noConn = harness(SCHOOL, { connection: undefined });
  await chatExchange(noConn.deps, { message: MSG });
  assert.equal(noConn.memoryItems.listItems()[0]?.ruleChange, "none");
});

test("a restate of a declined preference is not re-proposed; a newer restate withdraws the older open proposal", async () => {
  const h = harness(SCHOOL);
  const old = h.memoryItems.insert({ folder: "planning-preferences", text: "Start work at 2:30 on school days", origin: "stated", ruleChange: "declined" });
  (h.deps as { memoryLlmClient: unknown }).memoryLlmClient = filer(SCHOOL.replace("}]", `,"restatesId":"${old.id}"}]`).replace('"ruleChange":{"key":"schoolDayWorkStart","value":"14:30"},"restatesId', '"ruleChange":{"key":"schoolDayWorkStart","value":"14:30"},"restatesId'));
  await chatExchange(h.deps, { message: MSG });
  assert.equal(h.events.some((e) => e.type === "proposal"), false);
  assert.equal(listOpenInteractionRequests(h.store).length, 0);

  const g = harness(SCHOOL);
  await chatExchange(g.deps, { message: MSG });
  const first = g.memoryItems.listItems()[0]!;
  (g.deps as { memoryLlmClient: unknown }).memoryLlmClient = filer(SCHOOL.replace("14:30", "14:45").replace("2:30", "2:45"));
  await chatExchange(g.deps, { message: "Actually please start my work at 2:45 on school days from now on" });
  const open = findOpenRuleProposals(g.store);
  assert.equal(open.length, 1);
  assert.notEqual(open[0]!.id, ruleChangeRequestId(first.id));
  assert.equal(g.memoryItems.getItem(first.id)?.ruleChange, "none");
});

test("undo while the proposal is pending withdraws it with the item", async () => {
  const h = harness(SCHOOL);
  await chatExchange(h.deps, { message: MSG });
  const rem = h.events.find((e) => e.type === "remembered");
  assert.ok(rem?.type === "remembered");
  const r = await undoMemoryReceipt({ memoryItems: h.memoryItems, chatHistory: h.chatHistory, store: h.store }, { receiptId: (rem as { receipt: { receiptId: string } }).receipt.receiptId });
  assert.ok(r.ok);
  assert.equal(listOpenInteractionRequests(h.store).length, 0);
});

test("surfaceOpenItems withdraws a rule-change proposal older than 7 days as declined and never shows it", async () => {
  const h = harness(SCHOOL);
  await chatExchange(h.deps, { message: MSG });
  const item = h.memoryItems.listItems()[0]!;
  const later = new Date(NOW.getTime() + 8 * 86_400_000);
  const r = await surfaceOpenItems({ store: h.store, session: {} as never, memoryItems: h.memoryItems, now: () => later }, {});
  assert.ok(r.ok && r.value.items.length === 0);
  assert.equal(listOpenInteractionRequests(h.store).length, 0);
  assert.equal(h.memoryItems.getItem(item.id)?.ruleChange, "declined");
  // a fresh one is shown
  await chatExchange(h.deps, { message: MSG });
  const fresh = await surfaceOpenItems({ store: h.store, session: {} as never, memoryItems: h.memoryItems, now: () => NOW }, {});
  assert.ok(fresh.ok && fresh.value.items.length === 1);
  void putOpenInteractionRequest;
});
