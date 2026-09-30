/**
 * Tests for `src/app/morning-view.ts` (Story 8.7).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, putOpenInteractionRequest, putPlan } from "../src/adapters/memory-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { morningView, type MorningViewDeps } from "../src/app/morning-view.ts";
import type { Plan } from "../src/types/domain.ts";

const TODAY = "2026-09-26";

function tempDeps(overrides: Partial<MorningViewDeps> = {}): MorningViewDeps {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return {
    store: createMemoryStore(connection),
    now: () => new Date(`${TODAY}T13:00:00.000Z`),
    timeZone: "UTC",
    session: { recentMessages: [], lastSearchAnswer: undefined },
    ...overrides,
  };
}

test("no Plan yet today: plan is undefined, today is still reported, openItems still returned", async () => {
  const result = await morningView(tempDeps(), {});
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.plan, undefined);
  assert.equal(result.value.today, TODAY);
  assert.deepEqual(result.value.openItems, []);
});

test("a stored Plan: text and reasoning are split fields, text carries the block list but never a duplicated reasoning line or ANSI", async () => {
  const deps = tempDeps();
  const plan: Plan = {
    id: `plan-${TODAY}`,
    date: TODAY,
    blocks: [{ id: "work-0", kind: "work", start: `${TODAY}T13:00:00.000Z`, end: `${TODAY}T14:00:00.000Z`, label: "Draft the memo", taskId: "t1" }],
    reasoning: '"Draft the memo" leads today.',
    version: 1,
    createdAt: `${TODAY}T12:00:00.000Z`,
    updatedAt: `${TODAY}T12:00:00.000Z`,
  };
  putPlan(deps.store, plan);

  const result = await morningView(deps, {});
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.ok(result.value.plan);
  assert.ok(result.value.plan!.text.includes("Draft the memo"));
  assert.equal(result.value.plan!.text.includes(plan.reasoning), false, "reasoning is not duplicated inside `text`");
  assert.equal(result.value.plan!.reasoning, plan.reasoning);
  assert.equal(/\x1b\[/.test(result.value.plan!.text), false, "app/ never returns ANSI (Task 4's rule)");
});

test("MorningViewDeps names no Notion/Calendar/Pushover/plan-generation dependency — /morning cannot call them even by accident (FR-1, FR-42)", () => {
  const keys = Object.keys(tempDeps());
  for (const forbidden of ["notionClient", "calendarClient", "sendNotification", "sendPushoverNotification", "generatePlan", "runMorningRitual"]) {
    assert.equal(keys.includes(forbidden), false, `MorningViewDeps must not carry ${forbidden}`);
  }
});

test("Story 13.13: a pending Pattern proposal comes back as patternQuestion once per day; absent memoryItems means no card", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const memoryItems = createMemoryItemStore(connection);
  const store = createMemoryStore(connection);
  const createdAt = "2026-09-25T12:00:00.000Z";
  const proposal = { id: "pattern-x", kind: "pattern", entityId: "area-overrun:History", entityVersion: "new", suggested: { kind: "area-overrun", area: "History", occurrences: 5, paddingMinutes: 30 }, reason: "h\ne\nPlan for that?", createdAt };
  putOpenInteractionRequest(store, "proposal:pattern-x", { requestKind: "proposal", promptText: proposal.reason, detail: { proposal, cursor: { questionId: "confirm" } }, createdAt });
  memoryItems.putPatternState({ kind: "area-overrun", area: "History", pendingProposalId: "pattern-x" });
  const deps = tempDeps({ store, memoryItems });

  const without = await morningView(tempDeps({ store }), {});
  assert.ok(without.ok && without.value.patternQuestion === undefined);
  const first = await morningView(deps, {});
  assert.ok(first.ok && first.value.patternQuestion?.requestId === "proposal:pattern-x");
  assert.deepEqual(first.ok && first.value.openItems, [], "the pattern proposal is not an open item");
  const second = await morningView(deps, {});
  assert.ok(second.ok && second.value.patternQuestion === undefined, "one per day");
  connection.close();
});
