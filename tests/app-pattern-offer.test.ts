/** Story 13.13 (T14b): `offerPattern` — one pending Pattern proposal per day, lazy TTL withdrawal. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryStore, getOpenInteractionRequest, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { offerPattern } from "../src/app/pattern-offer.ts";
import type { PatternProposal, Proposal } from "../src/types/domain.ts";

const NOW = new Date("2026-09-30T15:00:00.000Z");

function setup(now: () => Date = () => NOW) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  const memoryItems = createMemoryItemStore(connection);
  const deps = { memoryItems, store, now, timeZone: "UTC" };
  const seed = (id: string, area: string, createdAt: string, withRequest = true) => {
    const proposal: Proposal<PatternProposal> = {
      id,
      kind: "pattern",
      entityId: `area-overrun:${area}`,
      entityVersion: "new",
      suggested: { kind: "area-overrun", area, occurrences: 5, paddingMinutes: 30, evidence: "5 times since Sep 3: Sep 3" } as unknown as PatternProposal,
      reason: `Meeseek noticed ${area} Tasks run about 30 min over.\n5 times since Sep 3: Sep 3\nPlan for that?`,
      createdAt,
    };
    if (withRequest) {
      putOpenInteractionRequest(store, `proposal:${id}`, { requestKind: "proposal", promptText: proposal.reason, detail: { proposal, cursor: { questionId: "confirm" } }, createdAt });
    }
    memoryItems.putPatternState({ kind: "area-overrun", area, pendingProposalId: id });
  };
  return { deps, store, memoryItems, seed };
}

test("offers the pending proposal once, then nothing the same day", async () => {
  const { deps, seed, memoryItems } = setup();
  seed("pattern-a", "History", "2026-09-29T12:00:00.000Z");
  const first = await offerPattern(deps, {});
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.value.question?.requestId, "proposal:pattern-a");
  assert.equal(first.value.question?.questionId, "confirm");
  assert.equal(memoryItems.getPatternState("area-overrun", "History")?.lastOfferedOn, "2026-09-30");
  const second = await offerPattern(deps, {});
  assert.ok(second.ok);
  if (second.ok) assert.equal(second.value.question, undefined);
});

test("the oldest pending proposal goes first; the other waits for a later day", async () => {
  let now = NOW;
  const { deps, seed } = setup(() => now);
  seed("pattern-new", "Math", "2026-09-29T12:00:00.000Z");
  seed("pattern-old", "History", "2026-09-27T12:00:00.000Z");
  const first = await offerPattern(deps, {});
  assert.ok(first.ok && first.value.question?.requestId === "proposal:pattern-old");
  now = new Date("2026-10-01T15:00:00.000Z");
  const next = await offerPattern(deps, {});
  assert.ok(next.ok && next.value.question?.requestId === "proposal:pattern-old", "still pending, so it is offered again the next day");
});

test("a proposal older than 7 days is withdrawn (declinedAt set) and never shown", async () => {
  const { deps, seed, store, memoryItems } = setup();
  seed("pattern-stale", "History", "2026-09-20T12:00:00.000Z");
  const r = await offerPattern(deps, {});
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.question, undefined);
  assert.equal(getOpenInteractionRequest(store, "proposal:pattern-stale"), undefined);
  const st = memoryItems.getPatternState("area-overrun", "History");
  assert.equal(st?.pendingProposalId, undefined);
  assert.equal(st?.declinedAt, NOW.toISOString());
});

test("a pending id whose request is gone is cleared without declinedAt", async () => {
  const { deps, seed, memoryItems } = setup();
  seed("pattern-gone", "History", "2026-09-29T12:00:00.000Z", false);
  const r = await offerPattern(deps, {});
  assert.ok(r.ok && r.value.question === undefined);
  const st = memoryItems.getPatternState("area-overrun", "History");
  assert.equal(st?.pendingProposalId, undefined);
  assert.equal(st?.declinedAt, undefined);
});

test("an adapter throw becomes an unreachable Result", async () => {
  const { deps } = setup();
  const broken = { ...deps, memoryItems: { ...deps.memoryItems, listPatternStates: () => { throw new Error("boom"); } } };
  const r = await offerPattern(broken as never, {});
  assert.ok(!r.ok);
  if (!r.ok) assert.equal(r.error.kind, "unreachable");
});
