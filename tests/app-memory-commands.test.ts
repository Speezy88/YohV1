/** Memory commands through `chatTurn` (Story 13.4 Part 2). Real in-memory item store; fake everything else. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema, type MemoryItemStore } from "../src/adapters/memory-item-store.ts";
import { chatTurn, type ChatTurnDeps } from "../src/app/chat-turn.ts";
import { createMemoryStore, getOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { COMMANDS } from "../src/app/commands.ts";

function memory(): MemoryItemStore {
  const c = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(c.db);
  initMemoryItemStoreSchema(c.db);
  return createMemoryItemStore(c);
}

function deps(memoryItems: MemoryItemStore | undefined, extra: Partial<ChatTurnDeps> = {}): ChatTurnDeps {
  return {
    memoryItems,
    session: { recentMessages: [], lastSearchAnswer: undefined },
    timeZone: "America/New_York",
    now: () => new Date("2026-09-29T16:00:00Z"),
    turn: { conversationId: "conv-1", userTurnId: "turn-1" },
    log: () => {},
    ...extra,
  } as unknown as ChatTurnDeps;
}

const NEW = (o: Partial<Parameters<MemoryItemStore["insert"]>[0]> = {}) => ({ folder: "about-you" as const, text: "Runs at 6", origin: "stated" as const, ...o });

test("remember that ... replies Got it and asks chatExchange to file it", async () => {
  const r = await chatTurn(deps(memory()), { message: "remember that Chem club is a club, not a class" });
  assert.ok(r.ok);
  assert.equal(r.value.reply, "Got it.");
  assert.deepEqual(r.value.memory, { kind: "remember", text: "Chem club is a club, not a class" });
});

test("/remember passes its args (E10)", async () => {
  const r = await chatTurn(deps(memory()), { message: "/remember Chem club is a club" });
  assert.ok(r.ok);
  assert.deepEqual(r.value.memory, { kind: "remember", text: "Chem club is a club" });
});

test("recall lists matches grouped by folder in PRD order with folder labels", async () => {
  const m = memory();
  const idea = m.insert(NEW({ folder: "ideas-notes", text: "AP Bio poster idea" }));
  const goal = m.insert(NEW({ folder: "goals-projects", text: "AP Bio 5 by May" }));
  const r = await chatTurn(deps(m), { message: "what do you remember about AP Bio?" });
  assert.ok(r.ok);
  const reply = r.value.reply;
  assert.ok(reply.indexOf("Goals & projects") >= 0 && reply.indexOf("Goals & projects") < reply.indexOf("Ideas & notes"));
  assert.match(reply, /AP Bio 5 by May/);
  assert.match(reply, /AP Bio poster idea/);
  // each line links to its item on the Memory page (T10b)
  assert.ok(reply.includes(`- [AP Bio 5 by May](#memory-item-${goal.id})`), reply);
  assert.ok(reply.includes(`- [AP Bio poster idea](#memory-item-${idea.id})`), reply);
});

test("recall escapes brackets in an item's text so the link stays intact", async () => {
  const m = memory();
  const item = m.insert(NEW({ folder: "ideas-notes", text: "Read [draft] notes" }));
  const r = await chatTurn(deps(m), { message: "what do you remember about draft?" });
  assert.ok(r.ok);
  assert.ok(r.value.reply.includes(`- [Read \\[draft\\] notes](#memory-item-${item.id})`), r.value.reply);
});

test("forget with one match deletes the chain, persists a receipt, and directs a forgot receipt", async () => {
  const m = memory();
  const item = m.insert(NEW({ text: "Dentist on Friday" }));
  const r = await chatTurn(deps(m), { message: "forget dentist" });
  assert.ok(r.ok);
  assert.equal(r.value.reply, "Done.");
  assert.equal(m.getItem(item.id)?.status, "deleted");
  const memo = r.value.memory;
  assert.equal(memo?.kind, "forgot");
  if (memo?.kind !== "forgot") return;
  assert.equal(memo.receipt.kind, "forgot");
  assert.deepEqual(memo.receipt.items.map((i) => i.text), ["Dentist on Friday"]);
  assert.deepEqual(memo.chainIds, [item.id]);
  const stored = m.getReceipt(memo.receipt.receiptId);
  assert.equal(stored?.conversationId, "conv-1");
  assert.equal(stored?.userTurnId, "turn-1");
});

test("forget with no match says so", async () => {
  const r = await chatTurn(deps(memory()), { message: "forget the zebra thing" });
  assert.ok(r.ok);
  assert.equal(r.value.reply, "Nothing in memory matches 'the zebra thing'.");
  assert.equal(r.value.memory, undefined);
});

test("forget that targets the latest remembered receipt in this Conversation", async () => {
  const m = memory();
  const item = m.insert(NEW({ text: "Chem club is a club" }));
  m.putReceipt({ receiptId: "rc1", conversationId: "conv-1", userTurnId: "t0", kind: "remembered", itemIds: [item.id], chainIds: [item.id], createdAt: "2026-09-29T15:00:00.000Z" });
  const r = await chatTurn(deps(m), { message: "forget that" });
  assert.ok(r.ok);
  assert.equal(r.value.reply, "Done.");
  assert.equal(m.getItem(item.id)?.status, "deleted");
});

test("forget that with nothing filed yet", async () => {
  const r = await chatTurn(deps(memory()), { message: "/forget" });
  assert.ok(r.ok);
  assert.equal(r.value.reply, "Nothing to forget yet.");
});

test("a throwing store is logged and answered, never thrown", async () => {
  const broken = { searchRelevant: () => { throw new Error("disk"); }, latestReceipt: () => { throw new Error("disk"); } } as unknown as MemoryItemStore;
  const logged: string[] = [];
  const r = await chatTurn(deps(broken, { log: (e: { event: string }) => logged.push(e.event) } as never), { message: "forget dentist" });
  assert.ok(r.ok);
  assert.equal(r.value.reply, "Couldn't reach memory right now.");
  assert.equal(logged.length, 1);
  const r2 = await chatTurn(deps(undefined), { message: "what do you remember about x" });
  assert.ok(r2.ok);
  assert.equal(r2.value.reply, "Couldn't reach memory right now.");
});

test("registry lists /remember and /forget with description and example", () => {
  for (const name of ["/remember", "/forget"]) {
    const c = COMMANDS.find((x) => x.name === name);
    assert.ok(c && c.description.length > 0 && c.example.startsWith(name));
  }
});

test("forget with several matches stores a memory-forget request and returns a disambiguation question", async () => {
  const m = memory();
  const conn = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(conn.db);
  const store = createMemoryStore(conn);
  const a = m.insert(NEW({ text: "AP Bio deadline is Friday" }));
  const b = m.insert(NEW({ folder: "ideas-notes", text: "AP Bio poster idea" }));
  const r = await chatTurn(deps(m, { store } as never), { message: "forget AP Bio" });
  assert.ok(r.ok);
  const q = r.value.question;
  assert.ok(q);
  assert.equal(q.allowsFreeText, false);
  assert.deepEqual(q.options.at(-1), { label: "None of these", value: "none" });
  const values = q.options.slice(0, -1).map((o) => o.value).sort();
  assert.deepEqual(values, [a.id, b.id].sort());
  assert.ok(q.options.some((o) => o.label === "AP Bio poster idea · Ideas & notes"));
  assert.equal(m.getItem(a.id)?.status, "current");
  assert.equal(m.getItem(b.id)?.status, "current");
  const rec = getOpenInteractionRequest(store, q.requestId);
  assert.equal(rec?.data.requestKind, "memory-forget");
});
