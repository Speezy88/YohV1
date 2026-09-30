/** Story 13.8 wiring: a rule-change Yes/No through POST /api/open-items/answer reaches confirmProposal with memoryItems, connection and now. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { createMemoryStore, getOpenInteractionRequest, putOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { readPlanningSettings } from "../src/adapters/settings-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { ruleChangeProposalId, ruleChangeRequestId } from "../src/core/rule-change.ts";
import { createApp, type ServerDeps } from "../src/shell/server.ts";
import type { AnswerOpenItemResponse } from "../src/types/api.ts";
import type { Proposal, RuleChange } from "../src/types/domain.ts";

const NOW = "2026-08-22T18:00:00.000Z";

function setup() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  const memoryItems = createMemoryItemStore(connection);
  const item = memoryItems.insert({ folder: "planning-preferences", text: "Start work at 2:30 on school days", origin: "stated", ruleChange: "pending" });
  const change: RuleChange = { key: "schoolDayWorkStart", value: "14:30", previous: "15:15", memoryItemId: item.id };
  const proposal: Proposal<RuleChange> = {
    id: ruleChangeProposalId(item.id), kind: "rule-change", entityId: "schoolDayWorkStart", entityVersion: JSON.stringify("15:15"),
    suggested: change, reason: "Change school-day work start from 3:15 PM to 2:30 PM?", createdAt: NOW,
  };
  const requestId = ruleChangeRequestId(item.id);
  putOpenInteractionRequest(store, requestId, { requestKind: "proposal", promptText: proposal.reason, detail: { proposal, cursor: { questionId: "confirm" } }, createdAt: NOW });
  // Only what the answer route reads: store, connection, now (as buildChatDeps supplies them).
  const chat = { store, connection, now: () => new Date(NOW), timeZone: "UTC" } as unknown as NonNullable<ServerDeps["chat"]>;
  const app = createApp({ connection, log: () => {}, chat, memoryItems });
  const answer = async (a: string) => {
    const res = await app.request("/api/open-items/answer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, questionId: "confirm", answer: a }),
    });
    return (await res.json()) as { ok: true; value: AnswerOpenItemResponse };
  };
  return { answer, store, memoryItems, item, requestId, connection };
}

test("open-items answer Yes writes the override and confirms the item", async () => {
  const h = setup();
  const body = await h.answer("yes");
  assert.equal(body.value.message, "Changed school-day work start to 2:30 PM. Revert it on the Memory page.");
  assert.deepEqual(h.store.withDb(readPlanningSettings).workStart.schoolDay, { hour: 14, minute: 30 });
  assert.equal(h.memoryItems.getItem(h.item.id)?.ruleChange, "confirmed");
  assert.equal(getOpenInteractionRequest(h.store, h.requestId), undefined);
});

test("open-items answer No declines the item and changes nothing", async () => {
  const h = setup();
  const body = await h.answer("no");
  assert.equal(body.value.message, "Kept 3:15 PM. Your preference stays saved, marked declined.");
  assert.deepEqual(h.store.withDb(readPlanningSettings).workStart.schoolDay, { hour: 15, minute: 15 });
  assert.equal(h.memoryItems.getItem(h.item.id)?.ruleChange, "declined");
});
