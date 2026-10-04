/** Sorting feedback through app/memory-edit.ts, the Memory page view, and the filer's prompt. Real in-memory stores, fake LLM. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { createMemoryStore } from "../src/adapters/memory-store.ts";
import { extractMemories, type AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import { fileMemory } from "../src/app/file-memory.ts";
import { moveMemoryItem, recordSortFeedback } from "../src/app/memory-edit.ts";
import { viewMemory } from "../src/app/memory-view.ts";

function world() {
  const c = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(c.db);
  initMemoryItemStoreSchema(c.db);
  const memoryItems = createMemoryItemStore(c);
  const store = createMemoryStore(c);
  return { c, memoryItems, store, deps: { memoryItems, store, now: () => new Date("2026-09-29T16:00:00Z"), timeZone: "America/New_York", log: () => {} } };
}
const NEW = (o: object = {}) => ({ folder: "about-you" as const, text: "Prefers deep work before lunch", origin: "stated" as const, ...o });

/** A fake Anthropic client that records each request's system prompt and replies with `reply`. */
function fakeLlm(reply = "[]") {
  const systems: string[] = [];
  const client = {
    messages: {
      create: async (req: { system?: unknown }) => {
        systems.push(JSON.stringify(req.system));
        return { content: [{ type: "text", text: reply }], usage: { input_tokens: 1, output_tokens: 1 } };
      },
    },
  } as unknown as AnthropicMessagesClient;
  return { client, systems };
}

test("a verdict is saved with its trimmed reason and leaves the item untouched", async () => {
  const w = world();
  const item = w.memoryItems.insert(NEW());
  const r = await recordSortFeedback(w.deps, { itemId: item.id, verdict: "wrong", reason: "  It's a scheduling rule.  ", belongsIn: "planning-preferences" });
  assert.deepEqual(r, { ok: true, value: { itemId: item.id } });
  assert.deepEqual(w.memoryItems.listSortFeedback(), [
    { itemId: item.id, text: item.text, folder: "about-you", verdict: "wrong", reason: "It's a scheduling rule.", belongsIn: "planning-preferences", createdAt: "2026-09-29T16:00:00.000Z" },
  ]);
  assert.equal(w.memoryItems.getItem(item.id)?.folder, "about-you");

  const right = await recordSortFeedback(w.deps, { itemId: item.id, verdict: "right", reason: "It is about me.", belongsIn: "corrections" });
  assert.ok(right.ok);
  assert.equal(w.memoryItems.listSortFeedback()[0]?.belongsIn, undefined);
});

test("refusals write nothing: missing reason, bad verdict, bad or same or stated-only folder, gone item", async () => {
  const w = world();
  const item = w.memoryItems.insert(NEW({ origin: "inferred" }));
  const cases = [
    { itemId: item.id, verdict: "wrong" as const, reason: "   " },
    { itemId: item.id, verdict: "wrong" as const, reason: "x".repeat(281) },
    { itemId: item.id, verdict: "maybe" as unknown as "right", reason: "r" },
    { itemId: item.id, verdict: "wrong" as const, reason: "r", belongsIn: "nowhere" as unknown as "corrections" },
    { itemId: item.id, verdict: "wrong" as const, reason: "r", belongsIn: "about-you" as const },
    { itemId: item.id, verdict: "wrong" as const, reason: "r", belongsIn: "feedback" as const },
  ];
  for (const input of cases) {
    const r = await recordSortFeedback(w.deps, input);
    assert.ok(!r.ok && r.error.kind === "validation", JSON.stringify(input));
  }
  const gone = await recordSortFeedback(w.deps, { itemId: "nope", verdict: "right", reason: "r" });
  assert.ok(!gone.ok && gone.error.kind === "conflict");
  w.memoryItems.forget(item.id);
  const deleted = await recordSortFeedback(w.deps, { itemId: item.id, verdict: "right", reason: "r" });
  assert.ok(!deleted.ok && deleted.error.kind === "conflict");
  assert.deepEqual(w.memoryItems.listSortFeedback(), []);
});

test("the Memory page shows the verdict on the item until it moves to another folder", async () => {
  const w = world();
  const item = w.memoryItems.insert(NEW());
  await recordSortFeedback(w.deps, { itemId: item.id, verdict: "wrong", reason: "It's a rule.", belongsIn: "corrections" });
  const viewDeps = { ...w.deps, connection: w.c };
  const find = async () => {
    const v = await viewMemory(viewDeps, {});
    assert.ok(v.ok);
    return v.ok ? v.value.folders.flatMap((f) => f.items) : [];
  };
  assert.deepEqual((await find())[0]?.sortFeedback, { verdict: "wrong", reason: "It's a rule.", belongsIn: "corrections" });

  const moved = await moveMemoryItem(w.deps, { itemId: item.id, folder: "corrections" });
  assert.ok(moved.ok);
  const after = await find();
  assert.equal(after.length, 1);
  assert.equal(after[0]?.sortFeedback, undefined);
  assert.equal(w.memoryItems.listSortFeedback().length, 1);
});

test("the filer's prompt carries the verdicts as examples; none means no section", async () => {
  const none = fakeLlm();
  await extractMemories(none.client, "I like tea", [], { forceStated: false });
  assert.doesNotMatch(none.systems[0] as string, /sorting corrections/);

  const some = fakeLlm();
  await extractMemories(some.client, "I like tea", [], { forceStated: false, sortingExamples: ['- "A" filed in about-you: right. Reason: r'] });
  assert.match(some.systems[0] as string, /Spencer's past sorting corrections/);
  assert.match(some.systems[0] as string, /filed in about-you: right\. Reason: r/);
});

test("fileMemory passes the stored verdicts to the filer", async () => {
  const w = world();
  const item = w.memoryItems.insert(NEW());
  await recordSortFeedback(w.deps, { itemId: item.id, verdict: "wrong", reason: "It's a scheduling rule.", belongsIn: "planning-preferences" });
  const llm = fakeLlm();
  const r = await fileMemory({ ...w.deps, connection: w.c, llmClient: llm.client } as unknown as Parameters<typeof fileMemory>[0], { text: "I like tea", forceStated: false });
  assert.ok(r.ok);
  assert.match(llm.systems[0] as string, /Prefers deep work before lunch\\" filed in about-you: wrong, belongs in planning-preferences\. Reason: It's a scheduling rule\./);
});
