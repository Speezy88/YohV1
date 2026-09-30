/** Story 13.10 (server half): edit, move, expiry, delete, review through app/memory-edit.ts. Real in-memory stores. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { createMemoryStore, getOpenInteractionRequest, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { ruleChangeRequestId } from "../src/core/rule-change.ts";
import { deleteMemoryItem, editMemoryItem, moveMemoryItem, reviewMemoryItem, setMemoryExpiry } from "../src/app/memory-edit.ts";

function world() {
  const c = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(c.db);
  initMemoryItemStoreSchema(c.db);
  const memoryItems = createMemoryItemStore(c);
  const store = createMemoryStore(c);
  return { c, memoryItems, store, deps: { memoryItems, store, now: () => new Date("2026-09-29T16:00:00Z"), timeZone: "America/New_York", log: () => {} } };
}
const NEW = (o: object = {}) => ({ folder: "about-you" as const, text: "Runs at 6", origin: "stated" as const, ...o });

test("edit writes a new Stated version and supersedes the old row; duplicates write nothing", async () => {
  const w = world();
  const inferred = w.memoryItems.insert(NEW({ origin: "inferred", text: "Likes tea", scope: "mornings" }));
  const other = w.memoryItems.insert(NEW({ folder: "ideas-notes", text: "Likes coffee" }));
  const dup = await editMemoryItem(w.deps, { itemId: inferred.id, text: "  likes  COFFEE. " });
  assert.ok(dup.ok && dup.value.status === "duplicate");
  if (dup.ok && dup.value.status === "duplicate") assert.equal(dup.value.other.id, other.id);
  assert.equal(w.memoryItems.getItem(inferred.id)?.status, "current");

  const r = await editMemoryItem(w.deps, { itemId: inferred.id, text: "Likes green tea" });
  assert.ok(r.ok && r.value.status === "saved");
  if (!r.ok) return;
  const next = w.memoryItems.getItem(r.value.itemId);
  assert.equal(next?.origin, "stated");
  assert.equal(next?.scope, "mornings");
  assert.equal(w.memoryItems.getItem(inferred.id)?.status, "superseded");
});

test("edit: merge, allowDuplicate, stale mergeWithId, validation, pending, non-current", async () => {
  const w = world();
  const a = w.memoryItems.insert(NEW({ text: "A one" }));
  const b = w.memoryItems.insert(NEW({ text: "B two" }));
  const stale = await editMemoryItem(w.deps, { itemId: a.id, text: "B two", mergeWithId: a.id });
  assert.ok(!stale.ok && stale.error.kind === "conflict");
  const merged = await editMemoryItem(w.deps, { itemId: a.id, text: "B two", mergeWithId: b.id });
  assert.ok(merged.ok && merged.value.status === "merged");
  assert.equal(w.memoryItems.getItem(a.id)?.status, "superseded");
  assert.equal(w.memoryItems.getItem(b.id)?.status, "superseded");

  const c = w.memoryItems.insert(NEW({ text: "C" }));
  const d = w.memoryItems.insert(NEW({ text: "D" }));
  const sep = await editMemoryItem(w.deps, { itemId: c.id, text: "D", allowDuplicate: true });
  assert.ok(sep.ok && sep.value.status === "saved");
  assert.equal(w.memoryItems.getItem(d.id)?.status, "current");

  const bad = await editMemoryItem(w.deps, { itemId: d.id, text: "   " });
  assert.ok(!bad.ok && bad.error.kind === "validation" && bad.error.message === "Memory text must be 1 to 280 characters.");
  const gone = await editMemoryItem(w.deps, { itemId: a.id, text: "zzz" });
  assert.ok(!gone.ok && gone.error.kind === "conflict" && gone.error.message === "That item has changed. Reload the page.");

  const p = w.memoryItems.insert(NEW({ folder: "planning-preferences", text: "Start at 4", ruleChange: "pending" }));
  const pend = await editMemoryItem(w.deps, { itemId: p.id, text: "Start at 5" });
  assert.ok(!pend.ok && pend.error.kind === "conflict" && pend.error.message === "Answer the pending change first.");
  const mv = await moveMemoryItem(w.deps, { itemId: p.id, folder: "about-you" });
  assert.ok(!mv.ok && mv.error.message === "Answer the pending change first.");
});

test("move: new version keeps origin; same folder and stated-only rules", async () => {
  const w = world();
  const inf = w.memoryItems.insert(NEW({ origin: "inferred" }));
  const refused = await moveMemoryItem(w.deps, { itemId: inf.id, folder: "feedback" });
  assert.ok(!refused.ok && refused.error.kind === "validation" && /^Only things you said can go in /.test(refused.error.message));
  const same = await moveMemoryItem(w.deps, { itemId: inf.id, folder: "about-you" });
  assert.ok(!same.ok && same.error.kind === "validation");
  const nope = await moveMemoryItem(w.deps, { itemId: inf.id, folder: "bogus" as never });
  assert.ok(!nope.ok && nope.error.kind === "validation");
  const ok = await moveMemoryItem(w.deps, { itemId: inf.id, folder: "ideas-notes" });
  assert.ok(ok.ok && ok.value.itemId);
  if (!ok.ok) return;
  const moved = w.memoryItems.getItem(ok.value.itemId as string);
  assert.equal(moved?.folder, "ideas-notes");
  assert.equal(moved?.origin, "inferred");
  assert.equal(w.memoryItems.getItem(inf.id)?.status, "superseded");
});

test("expiry: set, clear, invalid and past dates", async () => {
  const w = world();
  const it = w.memoryItems.insert(NEW({ expiresOn: "2026-12-01" }));
  const past = await setMemoryExpiry(w.deps, { itemId: it.id, expiresOn: "2026-09-28" });
  assert.ok(!past.ok && past.error.kind === "validation" && past.error.message === "Pick a date that hasn't passed.");
  const junk = await setMemoryExpiry(w.deps, { itemId: it.id, expiresOn: "2026-13-45" });
  assert.ok(!junk.ok && junk.error.kind === "validation");
  const set = await setMemoryExpiry(w.deps, { itemId: it.id, expiresOn: "2026-09-29" });
  assert.ok(set.ok && set.value.itemId);
  if (!set.ok) return;
  assert.equal(w.memoryItems.getItem(set.value.itemId as string)?.expiresOn, "2026-09-29");
  const clr = await setMemoryExpiry(w.deps, { itemId: set.value.itemId as string, expiresOn: null });
  assert.ok(clr.ok);
  if (!clr.ok) return;
  assert.equal(w.memoryItems.getItem(clr.value.itemId as string)?.expiresOn, undefined);
});

test("delete purges the chain for good, withdraws a pending rule Proposal, leaves a chat-forgot chain alone", async () => {
  const w = world();
  const forgot = w.memoryItems.insert(NEW({ text: "forgot me" }));
  w.memoryItems.forget(forgot.id);
  const old = w.memoryItems.insert(NEW({ folder: "planning-preferences", text: "Start at 4", ruleChange: "pending" }));
  putOpenInteractionRequest(w.store, ruleChangeRequestId(old.id), { requestKind: "proposal", promptText: "x", createdAt: "2026-09-29T10:00:00.000Z" } as never);
  const r = await deleteMemoryItem(w.deps, { itemId: old.id });
  assert.ok(r.ok);
  assert.equal(w.memoryItems.getItem(old.id), undefined);
  assert.equal(getOpenInteractionRequest(w.store, ruleChangeRequestId(old.id)), undefined);
  assert.equal(w.memoryItems.getItem(forgot.id)?.status, "deleted");
  const again = await deleteMemoryItem(w.deps, { itemId: old.id });
  assert.ok(!again.ok && again.error.kind === "conflict" && again.error.message === "That item is already gone.");
});

test("review: keep marks history; renew needs an expired or unused reason", async () => {
  const w = world();
  const fresh = w.memoryItems.insert(NEW({ text: "fresh" }));
  const none = await reviewMemoryItem(w.deps, { itemId: fresh.id, action: "renew" });
  assert.ok(!none.ok && none.error.kind === "conflict" && none.error.message === "Nothing to renew here.");
  const expired = w.memoryItems.insert(NEW({ folder: "goals-projects", text: "AP Bio 5", expiresOn: "2026-09-01" }));
  const renewed = await reviewMemoryItem(w.deps, { itemId: expired.id, action: "renew", expiresOn: "2026-12-01" });
  assert.ok(renewed.ok && renewed.value.itemId);
  if (!renewed.ok) return;
  assert.equal(w.memoryItems.getItem(renewed.value.itemId as string)?.expiresOn, "2026-12-01");
  assert.equal(w.memoryItems.getItem(expired.id)?.status, "superseded");
  const kept = await reviewMemoryItem(w.deps, { itemId: fresh.id, action: "keep" });
  assert.ok(kept.ok);
  assert.equal(w.memoryItems.getItem(fresh.id)?.status, "history");
});

test("M4: Keep as history on a pending item withdraws its rule card and clears 'pending'", async () => {
  const w = world();
  const item = w.memoryItems.insert(NEW({ folder: "planning-preferences", text: "Start at 4", ruleChange: "pending" }));
  putOpenInteractionRequest(w.store, ruleChangeRequestId(item.id), { requestKind: "proposal", promptText: "x", createdAt: "2026-09-29T10:00:00.000Z" } as never);
  const kept = await reviewMemoryItem(w.deps, { itemId: item.id, action: "keep" });
  assert.ok(kept.ok);
  assert.equal(w.memoryItems.getItem(item.id)?.status, "history");
  assert.equal(w.memoryItems.getItem(item.id)?.ruleChange, "none");
  assert.equal(getOpenInteractionRequest(w.store, ruleChangeRequestId(item.id)), undefined);
});
