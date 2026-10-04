/** Claude export import through app/import-memory.ts. Real in-memory stores. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { importMemory } from "../src/app/import-memory.ts";
import type { ImportCandidate } from "../src/core/memory-import.ts";

function world() {
  const c = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(c.db);
  initMemoryItemStoreSchema(c.db);
  const memoryItems = createMemoryItemStore(c);
  // 02:00 UTC on the 4th is still the 3rd in New York: the tag must use the host day.
  return { c, memoryItems, deps: { memoryItems, now: () => new Date("2026-10-04T02:00:00Z"), timeZone: "America/New_York" } };
}
const line = (n: number, o: Partial<ImportCandidate> = {}): ImportCandidate => ({ line: n, folder: "about-you", text: `fact ${n}`, ...o });

test("files candidates tagged with the batch, in one outbox row", async () => {
  const w = world();
  const before = tailOutboxSince(w.c, 0).length;
  const r = await importMemory(w.deps, { candidates: [line(3), line(4, { folder: "goals-projects" })], dryRun: false });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.batchTag, "import:claude-2026-10-03");
  assert.deepEqual(r.value.counts, { filed: 2, skippedDuplicate: 0, rejected: 0 });
  assert.deepEqual(r.value.filed.map((l) => l.line), [3, 4]);
  const items = w.memoryItems.listItems();
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.sourceTurnId === "import:claude-2026-10-03" && i.origin === "inferred" && i.ruleChange === "none"));
  assert.equal(tailOutboxSince(w.c, 0).length - before, 1);
});

test("a dry run returns the same report and writes nothing", async () => {
  const w = world();
  const before = tailOutboxSince(w.c, 0).length;
  const r = await importMemory(w.deps, { candidates: [line(1), line(2)], dryRun: true });
  assert.ok(r.ok && r.value.dryRun === true);
  if (r.ok) assert.deepEqual(r.value.counts, { filed: 2, skippedDuplicate: 0, rejected: 0 });
  assert.equal(w.memoryItems.listItems().length, 0);
  assert.equal(tailOutboxSince(w.c, 0).length, before);
});

test("skips lines that match current memory and repeats inside the file; never supersedes", async () => {
  const w = world();
  const mine = w.memoryItems.insert({ folder: "about-you", text: "Likes coffee", origin: "stated" });
  const r = await importMemory(w.deps, {
    candidates: [line(1, { text: "  likes  COFFEE. " }), line(2, { text: "Likes tea" }), line(3, { text: "likes tea!" })],
    dryRun: false,
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.filed.map((l) => l.line), [2]);
  assert.deepEqual(r.value.skippedDuplicate.map((l) => l.line), [1, 3]);
  assert.equal(w.memoryItems.getItem(mine.id)?.status, "current");
  assert.equal(w.memoryItems.listItems().length, 2);
});

test("stated-only folders and sensitive lines are filed as stated; feedback gets the narrowest scope", async () => {
  const w = world();
  const r = await importMemory(w.deps, {
    candidates: [
      line(1, { folder: "feedback", text: "Keep replies short" }),
      line(2, { folder: "planning-preferences", text: "No meetings before 10" }),
      line(3, { text: "Has a peanut allergy", sensitive: "health" }),
    ],
    dryRun: false,
  });
  assert.ok(r.ok);
  const byText = new Map(w.memoryItems.listItems().map((i) => [i.text, i]));
  assert.equal(byText.get("Keep replies short")?.origin, "stated");
  assert.equal(byText.get("Keep replies short")?.scope, "this kind of request");
  assert.equal(byText.get("No meetings before 10")?.origin, "stated");
  assert.equal(byText.get("No meetings before 10")?.ruleChange, "none");
  assert.equal(byText.get("Has a peanut allergy")?.origin, "stated");
});

test("an over-long line is rejected with its reason and the rest is filed", async () => {
  const w = world();
  const r = await importMemory(w.deps, { candidates: [line(1, { text: "x".repeat(281) }), line(2)], dryRun: false });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.rejected.map((l) => [l.line, l.reason]), [[1, "too-long"]]);
  assert.deepEqual(r.value.filed.map((l) => l.line), [2]);
});

test("refuses the whole import when the always-loaded folders would pass the cap", async () => {
  const w = world();
  for (let i = 0; i < 58; i++) w.memoryItems.insert({ folder: "about-you", text: `existing ${i}`, origin: "stated" });
  const candidates = [line(1), line(2), line(3), line(4, { folder: "goals-projects" })];
  for (const dryRun of [true, false]) {
    const r = await importMemory(w.deps, { candidates, dryRun });
    assert.ok(!r.ok);
    if (r.ok) continue;
    assert.equal(r.error.kind, "validation");
    assert.match(r.error.message, /61 items/);
    assert.match(r.error.message, /limit is 60/);
    assert.match(r.error.message, /Cut 1 line /);
  }
  assert.equal(w.memoryItems.listItems().length, 58);
  const fits = await importMemory(w.deps, { candidates: candidates.slice(1), dryRun: false });
  assert.ok(fits.ok);
  assert.equal(w.memoryItems.listItems().length, 61);
});

test("lines outside the always-loaded folders are not blocked by a full cap", async () => {
  const w = world();
  for (let i = 0; i < 60; i++) w.memoryItems.insert({ folder: "about-you", text: `existing ${i}`, origin: "stated" });
  const r = await importMemory(w.deps, { candidates: [line(1, { folder: "ideas-notes" })], dryRun: false });
  assert.ok(r.ok);
});

test("an empty candidate list is a validation error", async () => {
  const w = world();
  const r = await importMemory(w.deps, { candidates: [], dryRun: false });
  assert.ok(!r.ok && r.error.kind === "validation");
});

test("a failing store becomes an unreachable error, not a throw", async () => {
  const w = world();
  w.c.close();
  const r = await importMemory(w.deps, { candidates: [line(1)], dryRun: false });
  assert.ok(!r.ok && r.error.kind === "unreachable");
});
