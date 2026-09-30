import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, getOpenInteractionRequest, listOpenInteractionRequests, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { initCompletionLogSchema, recordCompletion, recordSlipEventInTx } from "../src/adapters/completion-log.ts";
import { runPatternDetection } from "../src/rituals/pattern-ritual.ts";
import { surfaceOpenItems } from "../src/app/surface-open-items.ts";
import type { Proposal, PatternProposal } from "../src/types/domain.ts";

const NOW = new Date("2026-09-30T13:00:00.000Z");
const TZ = "America/Chicago";

function world() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initCompletionLogSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  const memoryItems = createMemoryItemStore(connection);
  const deps = { store, connection, memoryItems, now: () => NOW, timeZone: TZ };
  return { connection, store, memoryItems, deps };
}

function seedOverruns(connection: ReturnType<typeof world>["connection"], days: string[], overrunMin = 30, area = "History") {
  days.forEach((d, i) => {
    recordCompletion(connection, {
      taskId: `t${area}${i}`, taskName: "Essay", area, dueDate: null, estimatedMinutes: 60,
      completedAt: `${d}T${String(15 + Math.floor(overrunMin / 60)).padStart(2, "0")}:${String(overrunMin % 60).padStart(2, "0")}:00.000Z`,
      source: "check-off", plannedStart: `${d}T14:00:00.000Z`, plannedEnd: `${d}T15:00:00.000Z`,
    });
  });
}
const DAYS = ["2026-09-03", "2026-09-10", "2026-09-17", "2026-09-22", "2026-09-25"];

test("proposes one Pattern proposal with evidence, and records pending state", async () => {
  const { connection, store, memoryItems, deps } = world();
  seedOverruns(connection, DAYS);
  const r = await runPatternDetection(deps);
  assert.deepEqual(r, { ok: true, value: { withdrawn: 0, proposed: 1 } });
  const open = listOpenInteractionRequests(store);
  assert.equal(open.length, 1);
  const proposal = (open[0]?.data.detail as { proposal: Proposal<PatternProposal> }).proposal;
  assert.equal(proposal.kind, "pattern");
  assert.equal(proposal.entityId, "area-overrun::History");
  assert.equal(proposal.suggested.paddingMinutes, 30);
  assert.equal(proposal.suggested.evidence, "5 times since Sep 3: Sep 3, Sep 10, Sep 17, Sep 22, Sep 25");
  assert.equal(proposal.reason.split("\n").length, 3);
  assert.equal(open[0]?.id, `proposal:${proposal.id}`);
  assert.equal(memoryItems.getPatternState("area-overrun", "History")?.pendingProposalId, proposal.id);
  // a second run proposes nothing more (pending)
  assert.deepEqual(await runPatternDetection(deps), { ok: true, value: { withdrawn: 0, proposed: 0 } });
});

test("slip events with an Area propose area-slips; null-Area slips are ignored", async () => {
  const { connection, deps, store } = world();
  connection.writeTx((db) => {
    ["2026-09-03", "2026-09-10", "2026-09-17", "2026-09-22"].forEach((date, i) => {
      recordSlipEventInTx(db, { taskId: `s${i}`, area: "Work", date });
      recordSlipEventInTx(db, { taskId: `n${i}`, area: null, date });
    });
  });
  const r = await runPatternDetection(deps);
  assert.equal(r.ok && r.value.proposed, 1);
  const p = (listOpenInteractionRequests(store)[0]?.data.detail as { proposal: Proposal<PatternProposal> }).proposal;
  assert.equal(p.suggested.kind, "area-slips");
});

test("one day of overruns, next-day completions and close-outs propose nothing", async () => {
  const { connection, deps } = world();
  seedOverruns(connection, ["2026-09-20", "2026-09-20", "2026-09-20", "2026-09-20", "2026-09-20"]);
  recordCompletion(connection, { taskId: "x", taskName: "x", area: "History", dueDate: null, estimatedMinutes: 60, completedAt: "2026-09-05T20:00:00.000Z", source: "check-off", plannedStart: "2026-09-04T14:00:00.000Z", plannedEnd: "2026-09-04T15:00:00.000Z" });
  assert.deepEqual(await runPatternDetection(deps), { ok: true, value: { withdrawn: 0, proposed: 0 } });
});

test("a decline inside the quiet period suppresses; after 30 days it can propose again", async () => {
  const { connection, memoryItems, deps } = world();
  seedOverruns(connection, DAYS);
  memoryItems.putPatternState({ kind: "area-overrun", area: "History", declinedAt: "2026-09-10T12:00:00.000Z" });
  assert.equal((await runPatternDetection(deps) as { value: { proposed: number } }).value.proposed, 0);
  memoryItems.putPatternState({ kind: "area-overrun", area: "History", declinedAt: "2026-08-20T12:00:00.000Z" });
  assert.equal((await runPatternDetection(deps) as { value: { proposed: number } }).value.proposed, 1);
});

test("after a confirmation only newer evidence counts", async () => {
  const { connection, memoryItems, deps } = world();
  seedOverruns(connection, DAYS);
  memoryItems.putPatternState({ kind: "area-overrun", area: "History", confirmedAt: "2026-09-26T12:00:00.000Z" });
  assert.equal((await runPatternDetection(deps) as { value: { proposed: number } }).value.proposed, 0);
});

test("a pattern proposal older than 7 days is withdrawn and treated as declined", async () => {
  const { connection, store, memoryItems, deps } = world();
  const proposal: Proposal<PatternProposal> = {
    id: "pattern-old", kind: "pattern", entityId: "area-overrun::History", entityVersion: "new",
    suggested: { kind: "area-overrun", area: "History", occurrences: 5, firstSeen: "2026-09-01", lastSeen: "2026-09-20", sampleDates: [], paddingMinutes: 30 },
    reason: "x", createdAt: "2026-09-20T12:00:00.000Z",
  };
  putOpenInteractionRequest(store, "proposal:pattern-old", { requestKind: "proposal", promptText: "x", detail: { proposal, cursor: { questionId: "confirm" } }, createdAt: proposal.createdAt } as never);
  memoryItems.putPatternState({ kind: "area-overrun", area: "History", pendingProposalId: "pattern-old" });
  assert.deepEqual(await runPatternDetection(deps), { ok: true, value: { withdrawn: 1, proposed: 0 } });
  assert.equal(getOpenInteractionRequest(store, "proposal:pattern-old"), undefined);
  const st = memoryItems.getPatternState("area-overrun", "History");
  assert.equal(st?.pendingProposalId, undefined);
  assert.equal(st?.declinedAt, NOW.toISOString());
  connection.close();
});

test("surfaceOpenItems hides pattern proposals without deleting them", async () => {
  const { connection, store, deps } = world();
  seedOverruns(connection, DAYS);
  await runPatternDetection(deps);
  const r = await surfaceOpenItems({ store, now: () => NOW } as never, {});
  assert.deepEqual(r.ok && r.value.items, []);
  assert.equal(listOpenInteractionRequests(store).length, 1);
});
