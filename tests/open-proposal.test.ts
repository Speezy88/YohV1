/**
 * Tests for `src/app/open-proposal.ts` (Story 8.2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, getOpenInteractionRequest } from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { openProposal } from "../src/app/open-proposal.ts";
import type { Proposal } from "../src/types/domain.ts";

function tempStore() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db); // Task 7 (Epic 8): interaction-request writes now append an outbox row.
  return createMemoryStore(connection);
}

function makeCalendarEditProposal(entityId: string, overrides: Partial<Proposal<unknown>> = {}): Proposal<unknown> {
  return {
    id: `calendar-edit-${entityId}`,
    kind: "calendar-edit",
    entityId,
    entityVersion: "etag-1",
    suggested: {},
    reason: `Move "Team sync" to 6pm`,
    createdAt: "2026-09-26T09:00:00.000Z",
    ...overrides,
  };
}

test("openProposal persists a proposal as an open 'proposal' interaction request and returns its confirm question", async () => {
  const store = tempStore();
  const proposal = makeCalendarEditProposal("evt-1");
  const result = await openProposal({ store }, { proposal });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.requestId, `proposal:${proposal.id}`);
  assert.equal(result.value.questionId, "confirm");
  assert.equal(result.value.text, proposal.reason);
  assert.equal(result.value.allowsFreeText, true);
  assert.deepEqual(result.value.proposal, proposal);
  assert.ok(getOpenInteractionRequest(store, `proposal:${proposal.id}`), "persisted as an open interaction request");
  store.close();
});

test("openProposal rejects with conflict when an open proposal already targets the SAME (kind, entityId) — Review Focus #4", async () => {
  const store = tempStore();
  const first = makeCalendarEditProposal("evt-1");
  await openProposal({ store }, { proposal: first });

  const second = makeCalendarEditProposal("evt-1", { id: "calendar-edit-evt-1-again" });
  const result = await openProposal({ store }, { proposal: second });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "conflict");
  assert.equal(getOpenInteractionRequest(store, `proposal:${second.id}`), undefined, "the second proposal must not be persisted");
  store.close();
});

test("openProposal for a DIFFERENT entityId succeeds while another proposal is open — unrelated proposals are never blocked (Review Focus #4)", async () => {
  const store = tempStore();
  await openProposal({ store }, { proposal: makeCalendarEditProposal("evt-1") });

  const result = await openProposal({ store }, { proposal: makeCalendarEditProposal("evt-2") });
  assert.equal(result.ok, true);
  store.close();
});

test("openProposal for a DIFFERENT kind targeting the SAME entityId also succeeds — the conflict check is scoped to (kind, entityId) together, not entityId alone", async () => {
  const store = tempStore();
  await openProposal({ store }, { proposal: makeCalendarEditProposal("t1") });

  const fieldValueProposal: Proposal<unknown> = {
    id: "field-value-t1-area",
    kind: "field-value",
    entityId: "t1",
    entityVersion: "display-time",
    suggested: {},
    reason: "x",
    createdAt: "2026-09-26T09:00:00.000Z",
  };
  const result = await openProposal({ store }, { proposal: fieldValueProposal });
  assert.equal(result.ok, true);
  store.close();
});

test("two create-type proposals never conflict with each other, even into the same database — a create-type proposal's entityId is its own id, never a shared name (Ruling #4, Review Focus #4)", async () => {
  const store = tempStore();
  const firstDraftId = "create-Tasks-1";
  const first: Proposal<unknown> = {
    id: firstDraftId,
    kind: "notion-page-draft",
    entityId: firstDraftId, // NOT "Tasks" — a create-type proposal's entityId is its own id, so two independent drafts into the same database can never collide.
    entityVersion: "new",
    suggested: {},
    reason: "x",
    createdAt: "2026-09-26T09:00:00.000Z",
  };
  await openProposal({ store }, { proposal: first });

  const secondDraftId = "create-Tasks-2";
  const second: Proposal<unknown> = { ...first, id: secondDraftId, entityId: secondDraftId };
  const result = await openProposal({ store }, { proposal: second });
  assert.equal(result.ok, true, "two independent create-item drafts into the same database must never spuriously conflict");
  store.close();
});
