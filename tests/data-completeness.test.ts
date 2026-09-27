/**
 * Tests for `src/rituals/data-completeness.ts`'s pure prompt-text-building
 * and gate-wiring/merge helpers (`buildMissingFieldsPromptText`,
 * `syncDataCompletenessInteractionRequest`, `applyTaskFieldOverride`,
 * `mergeStoredOverrides`).
 *
 * Story 8.9: relocated verbatim out of `tests/chat-cli.test.ts` (Task 5's
 * original review-fix note there: "the Data-Completeness merge/gate/sync
 * trio is its own capability and lives in its own file... `chat-cli.ts`
 * imports it rather than owning or re-exporting it"). These 10 tests were
 * never chat-cli.ts's own — they exercise `rituals/data-completeness.ts`
 * directly, imported (not defined) by the now-deleted `chat-cli.ts`. No
 * behavior changed in this move; only the file, and the helpers/imports it
 * needs, moved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryStore,
  getOpenInteractionRequest,
  getTaskFieldOverride,
  mergeTaskFieldOverride,
} from "../src/adapters/memory-store.ts";
import type { MemoryStore } from "../src/adapters/memory-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import {
  buildMissingFieldsPromptText,
  syncDataCompletenessInteractionRequest,
  applyTaskFieldOverride,
  mergeStoredOverrides,
  DATA_COMPLETENESS_REQUEST_ID,
} from "../src/rituals/data-completeness.ts";
import type { MissingFieldReport } from "../src/core/data-completeness-gate.ts";
import type { Task } from "../src/types/domain.ts";

function tempStore(): MemoryStore {
  // Story 7.8, Ruling R4: mid-day-reflow.ts's putPlan call site now always
  // appends a Plan-change outbox hint in the same writeTx, so this store's
  // connection needs the notification-store schema initialized too, or
  // that write throws "no such table: outbox". (Carried over verbatim from
  // tests/chat-cli.test.ts's own tempStore() — unused by these 10 tests'
  // own assertions, but kept for parity with the original fixture.)
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return createMemoryStore(connection);
}

const NOW = "2026-08-22T12:00:00.000Z";

function makeTask(
  id: string,
  title: string,
  overrides: {
    estimatedDurationMinutes?: number | undefined;
    area?: string | undefined;
    dueDate?: string | undefined;
    status?: Task["status"] | undefined;
    energy?: Task["energy"] | undefined;
  } = {},
): Task {
  return {
    id,
    title,
    createdAt: NOW,
    updatedAt: NOW,
    estimatedDurationMinutes: 30,
    area: "Work",
    dueDate: "2026-08-23",
    status: "not-started",
    energy: "medium",
    ...overrides,
  } as Task;
}

// ============================================================================
// buildMissingFieldsPromptText — pure formatting
// ============================================================================

test("buildMissingFieldsPromptText names the missing field(s) and Task title for a single Task", () => {
  const reports: MissingFieldReport[] = [{ taskId: "t1", taskTitle: "Call dentist", missingFields: ["area"] }];
  const text = buildMissingFieldsPromptText(reports);
  assert.match(text, /Call dentist/);
  assert.match(text, /Area/);
});

test("buildMissingFieldsPromptText covers multiple incomplete Tasks in one combined prompt (UX-DR10)", () => {
  const reports: MissingFieldReport[] = [
    { taskId: "t1", taskTitle: "Call dentist", missingFields: ["area"] },
    { taskId: "t2", taskTitle: "Plan trip", missingFields: ["dueDate", "energy"] },
  ];
  const text = buildMissingFieldsPromptText(reports);
  assert.match(text, /Call dentist/);
  assert.match(text, /Plan trip/);
  assert.match(text, /Due Date/);
  assert.match(text, /Energy/);
});

// ============================================================================
// syncDataCompletenessInteractionRequest — thin wiring: gate -> memory-store
// ============================================================================

test("syncDataCompletenessInteractionRequest persists one combined interaction request when a Task is missing a field", () => {
  const store = tempStore();
  const incompleteTask = makeTask("t1", "Call dentist", { area: undefined });

  syncDataCompletenessInteractionRequest(store, [incompleteTask]);

  const record = getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID);
  assert.ok(record, "expected an open data-completeness interaction request");
  assert.equal(record?.data.requestKind, "data-completeness");
  assert.match(record?.data.promptText ?? "", /Call dentist/);
  store.close();
});

test("syncDataCompletenessInteractionRequest covers multiple incomplete Tasks with a single request record, not one per Task", () => {
  const store = tempStore();
  const t1 = makeTask("t1", "Call dentist", { area: undefined });
  const t2 = makeTask("t2", "Plan trip", { dueDate: undefined });

  syncDataCompletenessInteractionRequest(store, [t1, t2]);

  assert.deepEqual(store.listRecordsByKind("interaction-request").map((r) => r.id), [DATA_COMPLETENESS_REQUEST_ID]);
  const record = getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID);
  assert.match(record?.data.promptText ?? "", /Call dentist/);
  assert.match(record?.data.promptText ?? "", /Plan trip/);
  store.close();
});

test("syncDataCompletenessInteractionRequest does not persist a request when every Task is complete", () => {
  const store = tempStore();
  syncDataCompletenessInteractionRequest(store, [makeTask("t1", "Complete task")]);
  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);
  store.close();
});

test("syncDataCompletenessInteractionRequest clears a previously-open request once the gate re-run's input Task set has the field present (unit-level: caller supplies the now-complete Task directly, not exercising the answer-storage path — see the end-to-end test below for that)", () => {
  const store = tempStore();
  const incompleteTask = makeTask("t1", "Call dentist", { area: undefined });
  syncDataCompletenessInteractionRequest(store, [incompleteTask]);
  assert.ok(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID));

  // A hand-constructed already-complete Task, standing in for whatever
  // later re-read of Task data has the field present — this test is only
  // about syncDataCompletenessInteractionRequest's own clearing logic in
  // isolation, not about how the field actually became present.
  const nowCompleteTask = makeTask("t1", "Call dentist");
  syncDataCompletenessInteractionRequest(store, [nowCompleteTask]);

  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);
  store.close();
});

test("syncDataCompletenessInteractionRequest merges a stored TaskFieldOverride onto the raw Task before running the gate", () => {
  const store = tempStore();
  const rawTask = makeTask("t1", "Call dentist", { area: undefined });

  // The raw Task is still missing `area` on every re-read (e.g. from
  // Notion) — but an override for it is already on file from a previous
  // answer.
  mergeTaskFieldOverride(store, "t1", { area: "Health" });

  syncDataCompletenessInteractionRequest(store, [rawTask]);

  assert.equal(getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID), undefined);
  store.close();
});

// ============================================================================
// applyTaskFieldOverride / mergeStoredOverrides — pure merge helpers
// ============================================================================

test("applyTaskFieldOverride merges override fields onto a Task, leaving fields the override doesn't mention untouched", () => {
  const task = makeTask("t1", "Call dentist", { area: undefined, dueDate: undefined });
  const merged = applyTaskFieldOverride(task, { area: "Health" });
  assert.equal(merged.area, "Health");
  assert.equal(merged.dueDate, undefined);
  assert.equal(merged.estimatedDurationMinutes, 30); // untouched, from makeTask's defaults
});

test("applyTaskFieldOverride returns the Task unchanged when there is no override", () => {
  const task = makeTask("t1", "Call dentist");
  assert.deepEqual(applyTaskFieldOverride(task, undefined), task);
});

test("mergeStoredOverrides applies each Task's own stored override (if any) from memory-store", () => {
  const store = tempStore();
  mergeTaskFieldOverride(store, "t1", { area: "Health" });
  const t1 = makeTask("t1", "Call dentist", { area: undefined });
  const t2 = makeTask("t2", "No override for me", { area: undefined });

  const merged = mergeStoredOverrides(store, [t1, t2]);

  assert.equal(merged.find((t) => t.id === "t1")?.area, "Health");
  assert.equal(merged.find((t) => t.id === "t2")?.area, undefined);
  store.close();
});
