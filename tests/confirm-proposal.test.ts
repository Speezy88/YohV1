/**
 * Tests for `src/app/confirm-proposal.ts` (Story 8.2).
 *
 * `apply`/`ProposalEntityAccessor`/`timeBudgetEntityAccessor` are
 * module-private (never exported — see that file's own doc comments), so
 * every test here drives them entirely through `confirmProposal`'s own
 * public surface, including the moved Important #1/#2 white-box cases
 * (a genuine `ConflictError`, a plain thrown `Error`), reached by making the
 * STORE itself simulate a genuine concurrent writer racing the read
 * `timeBudgetEntityAccessor`/`putTimeBudget` both rely on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMemoryStore,
  getCurrentTimeBudget,
  getOpenInteractionRequest,
  getTaskFieldOverride,
  getTimeBudgetDeferralStreak,
  putOpenInteractionRequest,
  putTimeBudget,
  putTimeBudgetDeferralStreak,
  type MemoryStore,
} from "../src/adapters/memory-store.ts";
import { openSqliteConnection, type SqliteConnection } from "../src/adapters/sqlite.ts";
import { getMaxOutboxSeq, initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import type { CalendarEditProposal } from "../src/app/calendar-edit.ts";
import { confirmProposal, type ConfirmProposalDeps } from "../src/app/confirm-proposal.ts";
import type { CalendarEditChange, FieldValueSuggestion, NotionPageDraft, Proposal, TimeBudget } from "../src/types/domain.ts";

function tempStore(): MemoryStore {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db); // Task 7 (Epic 8): interaction-request clears now append an outbox row.
  return createMemoryStore(connection);
}

/** Task 8: like `tempStore()`, but also hands back the raw connection — needed for the `plan` hint tests, which assert on `tailOutboxSince` directly (mirrors `tests/update-task.test.ts`'s own `setup()`). */
function tempStoreWithConnection(): { store: MemoryStore; connection: SqliteConnection } {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  return { store: createMemoryStore(connection), connection };
}

const NOW = "2026-08-24T09:00:00.000Z";

function makeTimeBudgetProposal(overrides: Partial<Proposal<Partial<TimeBudget>>> = {}): Proposal<Partial<TimeBudget>> {
  return {
    id: "time-budget-change-2026-08-24",
    kind: "time-budget-change",
    entityId: "current",
    entityVersion: "1",
    suggested: { totalMinutes: 480 },
    reason: "Tasks have been deferred for 3 consecutive days — raising your Time Budget might let more of your day fit.",
    createdAt: NOW,
    ...overrides,
  };
}

// ---- time-budget-change ----------------------------------------------------

test("confirmProposal(time-budget-change): decline applies nothing and reports applied:false", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 });
  const result = await confirmProposal({ store }, { proposal: makeTimeBudgetProposal({ entityVersion: "1" }), accept: false });
  assert.deepEqual(result, { ok: true, value: { applied: false, receipts: [] } });
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 360);
  store.close();
});

test("confirmProposal(time-budget-change): accept with a matching live version applies the change and clears the request when requestId is given", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 }); // version 1
  putOpenInteractionRequest(store, "time-budget-proposal", { requestKind: "proposal", promptText: "x", detail: {}, createdAt: NOW });

  const result = await confirmProposal({ store }, { proposal: makeTimeBudgetProposal({ entityVersion: "1" }), accept: true, requestId: "time-budget-proposal" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { applied: true, receipts: ["Done — I've updated your Time Budget."] });
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 480);
  assert.equal(getOpenInteractionRequest(store, "time-budget-proposal"), undefined);
  store.close();
});

test("confirmProposal(time-budget-change): a MISMATCHED live version rejects as stale-proposal — never applies — and still clears a given requestId", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 }); // version 1
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 200, workMinutes: 70, breakMinutes: 15 }); // version 2 — moved on since the proposal was generated
  putOpenInteractionRequest(store, "time-budget-proposal", { requestKind: "proposal", promptText: "x", detail: {}, createdAt: NOW });

  const result = await confirmProposal({ store }, { proposal: makeTimeBudgetProposal({ entityVersion: "1" }), accept: true, requestId: "time-budget-proposal" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "stale-proposal");
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 200);
  assert.equal(getOpenInteractionRequest(store, "time-budget-proposal"), undefined, "cleared even on a stale rejection — matches chat-cli.ts's prior behavior");
  store.close();
});

test("confirmProposal(time-budget-change): the entity no longer existing at all (currentVersion undefined) also rejects as stale", async () => {
  const store = tempStore(); // no Time Budget ever declared
  const result = await confirmProposal({ store }, { proposal: makeTimeBudgetProposal({ entityVersion: "1" }), accept: true });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "stale-proposal");
  store.close();
});

test("confirmProposal(time-budget-change): a 'yes' OR a 'no' resets the deferral streak (Important #1, preserved)", async () => {
  for (const accept of [true, false]) {
    const store = tempStore();
    putTimeBudget(store, { date: "2026-08-20", totalMinutes: 60, workMinutes: 70, breakMinutes: 15 });
    putTimeBudgetDeferralStreak(store, { consecutiveDeferralDays: 3, lastDeferralDate: "2026-08-22" });

    await confirmProposal({ store }, { proposal: makeTimeBudgetProposal({ entityVersion: "1", suggested: { totalMinutes: 75 } }), accept });

    assert.equal(getTimeBudgetDeferralStreak(store), undefined, `streak must reset on ${accept ? "yes" : "no"}`);
    store.close();
  }
});

/**
 * Wraps a real `MemoryStore` so its FIRST `getRecord("time-budget", ...)`
 * call — the read `timeBudgetEntityAccessor.currentVersion()` and
 * `putTimeBudget`'s own internal capture both go through — returns the
 * store's TRUE current row, but as a side effect ALSO commits a real
 * concurrent write to that same row (via `readModifyWrite`, which never
 * goes through `getRecord`, so it doesn't recurse) and caches the
 * PRE-write snapshot for every later `getRecord` call in this same
 * `confirmProposal` invocation. This simulates a genuine cross-process
 * race (AD-10) landing in the exact window `apply`'s live re-read can't
 * close on its own: everything `confirmProposal` believes about "current"
 * stays self-consistent and matches `proposal.entityVersion`, while
 * `readModifyWrite`'s own internal, unintercepted read sees the row that
 * actually races ahead — forcing a genuine `ConflictError`.
 */
function makeRacyTimeBudgetStore(store: MemoryStore): MemoryStore {
  const originalGetRecord = store.getRecord.bind(store);
  let raced = false;
  let staleSnapshot: ReturnType<typeof store.getRecord> | undefined;
  store.getRecord = ((kind: string, id: string) => {
    if (kind !== "time-budget") return originalGetRecord(kind, id);
    if (!raced) {
      raced = true;
      staleSnapshot = originalGetRecord(kind, id);
      store.readModifyWrite<TimeBudget>("time-budget", "current", staleSnapshot?.version, () => ({
        date: "2026-08-24",
        totalMinutes: 999,
        workMinutes: 70,
        breakMinutes: 15,
      }));
      return staleSnapshot;
    }
    return staleSnapshot;
  }) as typeof store.getRecord;
  return store;
}

test("confirmProposal(time-budget-change): a genuine ConflictError from a real concurrent write is returned as a Result failure, not an unhandled throw (Important #2, preserved)", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 }); // version 1
  const racyStore = makeRacyTimeBudgetStore(store);

  const result = await confirmProposal({ store: racyStore }, { proposal: makeTimeBudgetProposal({ entityVersion: "1" }), accept: true });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "conflict");
  // Restore the real `getRecord` — `racyStore` IS `store` (mutated in
  // place), so without this, this assertion's own read would still see the
  // mock's cached pre-race snapshot instead of the database's true row.
  Reflect.deleteProperty(store, "getRecord");
  assert.equal(getCurrentTimeBudget(store)?.data.totalMinutes, 999, "the concurrent writer's value stands — the stale suggestion never overwrites it");
  store.close();
});

/**
 * `timeBudgetEntityAccessor.applyChange` itself throws a plain `Error`
 * (not a `ConflictError`) only when the live Time Budget vanishes between
 * `apply`'s own version check and this second read — reachable the same
 * way, but by having the racy store return `undefined` on its second
 * `getRecord` call instead of committing a competing write.
 */
function makeVanishingTimeBudgetStore(store: MemoryStore): MemoryStore {
  const originalGetRecord = store.getRecord.bind(store);
  let calls = 0;
  store.getRecord = ((kind: string, id: string) => {
    if (kind !== "time-budget") return originalGetRecord(kind, id);
    calls++;
    return calls === 1 ? originalGetRecord(kind, id) : undefined;
  }) as typeof store.getRecord;
  return store;
}

test("confirmProposal(time-budget-change): the entity vanishing between apply()'s version check and its own read is caught as a Result failure (kind: 'unreachable'), not an unhandled throw (Important #2, preserved)", async () => {
  const store = tempStore();
  putTimeBudget(store, { date: "2026-08-24", totalMinutes: 360, workMinutes: 70, breakMinutes: 15 }); // version 1
  const vanishingStore = makeVanishingTimeBudgetStore(store);

  const result = await confirmProposal({ store: vanishingStore }, { proposal: makeTimeBudgetProposal({ entityVersion: "1" }), accept: true });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
  store.close();
});

// ---- field-value (FR-25) ---------------------------------------------------

function makeFieldValueProposal(overrides: Partial<Proposal<FieldValueSuggestion>> = {}): Proposal<FieldValueSuggestion> {
  return {
    id: "field-value-t1-estimatedDurationMinutes",
    kind: "field-value",
    entityId: "t1",
    entityVersion: "display-time",
    suggested: { taskId: "t1", taskTitle: "Call dentist", field: "estimatedDurationMinutes", value: 30, reason: "Spencer said it'll take about half an hour" },
    reason: "Spencer said it'll take about half an hour",
    createdAt: NOW,
    ...overrides,
  };
}

function makeUpdateTaskFieldFake(ok = true): { calls: Array<{ taskId: string; field: string; value: unknown }>; fn: NonNullable<ConfirmProposalDeps["updateTaskField"]> } {
  const calls: Array<{ taskId: string; field: string; value: unknown }> = [];
  return {
    calls,
    fn: async (taskId, field, value) => {
      calls.push({ taskId, field, value });
      return ok ? { ok: true, value: undefined } : { ok: false, error: { kind: "unreachable", message: "notion down" } };
    },
  };
}

test("confirmProposal(field-value): accept re-validates through parsePlanningFieldValue, writes through updateTaskField, and merges the override", async () => {
  const store = tempStore();
  const updateTaskField = makeUpdateTaskFieldFake();
  const result = await confirmProposal({ store, updateTaskField: updateTaskField.fn }, { proposal: makeFieldValueProposal(), accept: true });
  assert.equal(result.ok, true);
  if (result.ok) {
    // Important fix: the exact wording answer-data-completeness.ts's own
    // typed (FR-24) blind-ask branch uses — the human-readable field label,
    // quoted value, trailing period — not the raw internal field name.
    assert.deepEqual(result.value.receipts, ['Call dentist — Estimated Duration: set to "30".']);
  }
  assert.deepEqual(updateTaskField.calls, [{ taskId: "t1", field: "estimatedDurationMinutes", value: 30 }]);
  assert.equal(getTaskFieldOverride(store, "t1")?.data.estimatedDurationMinutes, 30);
  store.close();
});

test("confirmProposal(field-value): decline writes nothing — updateTaskField is never called", async () => {
  const store = tempStore();
  const updateTaskField = makeUpdateTaskFieldFake();
  const result = await confirmProposal({ store, updateTaskField: updateTaskField.fn }, { proposal: makeFieldValueProposal(), accept: false });
  assert.deepEqual(result, { ok: true, value: { applied: false, receipts: [] } });
  assert.equal(updateTaskField.calls.length, 0);
  assert.equal(getTaskFieldOverride(store, "t1"), undefined);
  store.close();
});

test("confirmProposal(field-value): a tampered/out-of-range echoed value is re-validated and refused — updateTaskField is never called (Review Focus #1)", async () => {
  const store = tempStore();
  const updateTaskField = makeUpdateTaskFieldFake();
  // Simulate a client sending back a doctored Proposal over the wire: the
  // wire payload is untyped JSON, so TypeScript's `NonNullable<Task[...]>`
  // on `FieldValueSuggestion.value` is not actually enforced at runtime.
  const tampered = makeFieldValueProposal({ suggested: { taskId: "t1", taskTitle: "Call dentist", field: "status", value: "banana" as never, reason: "x" } });
  const result = await confirmProposal({ store, updateTaskField: updateTaskField.fn }, { proposal: tampered, accept: true });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  assert.equal(updateTaskField.calls.length, 0, "the write must never be attempted for a value that fails re-validation");
  store.close();
});

test("confirmProposal(field-value): an updateTaskField failure is returned as-is and the override is not merged", async () => {
  const store = tempStore();
  const updateTaskField = makeUpdateTaskFieldFake(false);
  const result = await confirmProposal({ store, updateTaskField: updateTaskField.fn }, { proposal: makeFieldValueProposal(), accept: true });
  assert.equal(result.ok, false);
  assert.equal(getTaskFieldOverride(store, "t1"), undefined);
  store.close();
});

test("confirmProposal(field-value): no updateTaskField dependency configured returns a clear Result failure, never throws (Review Focus #2)", async () => {
  const store = tempStore();
  const result = await confirmProposal({ store }, { proposal: makeFieldValueProposal(), accept: true });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
  store.close();
});

// ---- notion-page-draft (FR-26) ---------------------------------------------

function makeNotionPageDraftProposal(overrides: Partial<Proposal<NotionPageDraft>> = {}): Proposal<NotionPageDraft> {
  return {
    id: "create-Tasks-123",
    kind: "notion-page-draft",
    // Ruling #4: a create-type proposal's entityId is its OWN id, never a
    // shared name like the target database — two independent drafts into
    // the same database must never spuriously conflict under
    // open-proposal.ts's same-(kind,entityId) rule (see Task 2's tests).
    entityId: "create-Tasks-123",
    entityVersion: "new",
    suggested: { database: "Tasks", properties: { title: "Buy hiking boots" } },
    reason: "You asked me to create this in Tasks.",
    createdAt: NOW,
    ...overrides,
  };
}

test("confirmProposal(notion-page-draft): accept calls createPage with the draft's database/properties, unwrapped", async () => {
  const store = tempStore();
  const calls: Array<{ database: string; properties: Record<string, string> }> = [];
  const createPage: ConfirmProposalDeps["createPage"] = async (database, properties) => {
    calls.push({ database, properties: { ...properties } });
    return { ok: true, value: { pageId: "p1" } };
  };
  const result = await confirmProposal({ store, createPage }, { proposal: makeNotionPageDraftProposal(), accept: true });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ database: "Tasks", properties: { title: "Buy hiking boots" } }]);
  store.close();
});

test("confirmProposal(notion-page-draft): decline never calls createPage", async () => {
  const store = tempStore();
  let called = false;
  const createPage: ConfirmProposalDeps["createPage"] = async () => {
    called = true;
    return { ok: true, value: { pageId: "p1" } };
  };
  const result = await confirmProposal({ store, createPage }, { proposal: makeNotionPageDraftProposal(), accept: false });
  assert.deepEqual(result, { ok: true, value: { applied: false, receipts: [] } });
  assert.equal(called, false);
  store.close();
});

// ---- calendar-edit (FR-27) --------------------------------------------------

// Post-review fix (re-review, AD-9): `CalendarEditProposal` (`app/calendar-
// edit.ts`) is an ADDITIVE type (`Proposal<CalendarEditChange> &
// { receiptText }`) — never a widened `Proposal<T>` — so this fixture
// builds THAT type, not `Proposal<CalendarEditChange>` (which no longer
// carries `receiptText` at all).
function makeCalendarEditProposal(overrides: Partial<CalendarEditProposal> = {}): CalendarEditProposal {
  return {
    id: "calendar-edit-1",
    kind: "calendar-edit",
    entityId: "evt-1",
    entityVersion: "etag-1",
    suggested: { kind: "move", eventId: "evt-1", calendarId: "primary", newStart: "2026-09-18T18:00:00.000Z", newEnd: "2026-09-18T18:30:00.000Z" },
    reason: 'Move "Team sync" to Fri, Sep 18, 2026, 6:00 PM–6:30 PM',
    // Post-review fix, Important #2: `app/calendar-edit.ts` always sets its
    // own past-tense `receiptText`, distinct from the future-tense `reason`
    // above — this fixture mirrors that real shape.
    receiptText: 'Moved "Team sync" to Fri, Sep 18, 6:00 PM–6:30 PM.',
    createdAt: NOW,
    ...overrides,
  };
}

test("confirmProposal(calendar-edit): accept calls applyCalendarEdit with the Proposal itself (its own calling convention, unwrapped for no one else)", async () => {
  const store = tempStore();
  const calls: Array<Proposal<CalendarEditChange>> = [];
  const applyCalendarEdit: ConfirmProposalDeps["applyCalendarEdit"] = async (proposal) => {
    calls.push(proposal);
    return { ok: true, value: { eventId: "evt-1", calendarId: "primary" } };
  };
  const proposal = makeCalendarEditProposal();
  const result = await confirmProposal({ store, applyCalendarEdit }, { proposal, accept: true });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [proposal]);
  store.close();
});

test("confirmProposal(calendar-edit): a stale-proposal failure from applyCalendarEdit's own etag check is returned as-is", async () => {
  const store = tempStore();
  const applyCalendarEdit: ConfirmProposalDeps["applyCalendarEdit"] = async () => ({
    ok: false,
    error: { kind: "stale-proposal", message: "event has changed since this proposal was generated" },
  });
  const result = await confirmProposal({ store, applyCalendarEdit }, { proposal: makeCalendarEditProposal(), accept: true });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "stale-proposal");
  store.close();
});

test("confirmProposal(calendar-edit): decline never calls applyCalendarEdit", async () => {
  const store = tempStore();
  let called = false;
  const applyCalendarEdit: ConfirmProposalDeps["applyCalendarEdit"] = async () => {
    called = true;
    return { ok: true, value: { eventId: "evt-1", calendarId: "primary" } };
  };
  const result = await confirmProposal({ store, applyCalendarEdit }, { proposal: makeCalendarEditProposal(), accept: false });
  assert.equal(result.ok, true);
  assert.equal(called, false);
  store.close();
});

// ============================================================================
// Task 8 (Plan hint after a calendar edit): a confirmed "calendar-edit"
// appends one `plan` outbox hint so `web/src/lib/calendarDay.ts`'s per-date
// cache refetches — entityId is the edited event's LOCAL date when it can
// be derived, or an empty string (topic-only, "refetch every cached date")
// when it can't (e.g. a "resize" change, which carries no start at all).
// ============================================================================

test("confirmProposal(calendar-edit): accept appends a 'plan' hint carrying the edited event's local date (move)", async () => {
  const { store, connection } = tempStoreWithConnection();
  const applyCalendarEdit: ConfirmProposalDeps["applyCalendarEdit"] = async () => ({ ok: true, value: { eventId: "evt-1", calendarId: "primary" } });
  const proposal = makeCalendarEditProposal(); // move, newStart "2026-09-18T18:00:00.000Z"
  const start = getMaxOutboxSeq(connection);
  const result = await confirmProposal({ store, applyCalendarEdit, connection, timeZone: "America/New_York" }, { proposal, accept: true });
  assert.equal(result.ok, true);
  assert.deepEqual(
    tailOutboxSince(connection, start).map((h) => [h.topic, h.entityId]),
    [["plan", "2026-09-18"]],
  );
  store.close();
});

test("confirmProposal(calendar-edit): a 'create' change's own local date, converted through the host timezone", async () => {
  const { store, connection } = tempStoreWithConnection();
  const applyCalendarEdit: ConfirmProposalDeps["applyCalendarEdit"] = async () => ({ ok: true, value: { eventId: "calendar-create-1", calendarId: "primary" } });
  const proposal = makeCalendarEditProposal({
    entityId: "calendar-create-1",
    suggested: { kind: "create", calendarId: "primary", title: "Meet with Alex", start: "2026-09-29T02:45:00.000Z", end: "2026-09-29T04:15:00.000Z" },
  });
  const start = getMaxOutboxSeq(connection);
  // 2026-09-29T02:45Z is still Sep 28 in America/Los_Angeles — pins that the
  // conversion is genuinely timezone-aware, not a bare UTC-date slice.
  const result = await confirmProposal({ store, applyCalendarEdit, connection, timeZone: "America/Los_Angeles" }, { proposal, accept: true });
  assert.equal(result.ok, true);
  assert.deepEqual(
    tailOutboxSince(connection, start).map((h) => [h.topic, h.entityId]),
    [["plan", "2026-09-28"]],
  );
  store.close();
});

test("confirmProposal(calendar-edit): a 'resize' change (no start to derive a date from) appends a topic-only 'plan' hint", async () => {
  const { store, connection } = tempStoreWithConnection();
  const applyCalendarEdit: ConfirmProposalDeps["applyCalendarEdit"] = async () => ({ ok: true, value: { eventId: "evt-1", calendarId: "primary" } });
  const proposal = makeCalendarEditProposal({ suggested: { kind: "resize", eventId: "evt-1", calendarId: "primary", newEnd: "2026-09-18T19:00:00.000Z" } });
  const start = getMaxOutboxSeq(connection);
  const result = await confirmProposal({ store, applyCalendarEdit, connection, timeZone: "America/New_York" }, { proposal, accept: true });
  assert.equal(result.ok, true);
  assert.deepEqual(
    tailOutboxSince(connection, start).map((h) => [h.topic, h.entityId]),
    [["plan", ""]],
  );
  store.close();
});

test("confirmProposal(calendar-edit): no timeZone configured also falls back to a topic-only 'plan' hint", async () => {
  const { store, connection } = tempStoreWithConnection();
  const applyCalendarEdit: ConfirmProposalDeps["applyCalendarEdit"] = async () => ({ ok: true, value: { eventId: "evt-1", calendarId: "primary" } });
  const start = getMaxOutboxSeq(connection);
  const result = await confirmProposal({ store, applyCalendarEdit, connection }, { proposal: makeCalendarEditProposal(), accept: true });
  assert.equal(result.ok, true);
  assert.deepEqual(
    tailOutboxSince(connection, start).map((h) => [h.topic, h.entityId]),
    [["plan", ""]],
  );
  store.close();
});

test("confirmProposal(calendar-edit): no connection configured appends no hint at all (tests/callers that don't care)", async () => {
  const store = tempStore();
  const applyCalendarEdit: ConfirmProposalDeps["applyCalendarEdit"] = async () => ({ ok: true, value: { eventId: "evt-1", calendarId: "primary" } });
  const result = await confirmProposal({ store, applyCalendarEdit, timeZone: "America/New_York" }, { proposal: makeCalendarEditProposal(), accept: true });
  assert.equal(result.ok, true);
  store.close();
});

test("confirmProposal(calendar-edit): a decline never appends a 'plan' hint", async () => {
  const { store, connection } = tempStoreWithConnection();
  const applyCalendarEdit: ConfirmProposalDeps["applyCalendarEdit"] = async () => {
    throw new Error("must not be called on decline");
  };
  const start = getMaxOutboxSeq(connection);
  const result = await confirmProposal({ store, applyCalendarEdit, connection, timeZone: "America/New_York" }, { proposal: makeCalendarEditProposal(), accept: false });
  assert.equal(result.ok, true);
  assert.deepEqual(tailOutboxSince(connection, start), []);
  store.close();
});

// ============================================================================
// Post-review fix, Important #2: the receipt Spencer sees after saying yes
// is `proposal.receiptText` (past tense) — NEVER `proposal.reason` (the
// future-tense, "?"-suffixed confirm question he already answered). Pinned
// for both a move/resize-shaped proposal and a create-shaped one.
// ============================================================================

test("confirmProposal(calendar-edit): the receipt is the past-tense receiptText, never the future-tense (still-\"?\"-suffixed) reason — move/resize shape", async () => {
  const store = tempStore();
  const applyCalendarEdit: ConfirmProposalDeps["applyCalendarEdit"] = async () => ({ ok: true, value: { eventId: "evt-1", calendarId: "primary" } });
  const proposal = makeCalendarEditProposal({
    reason: 'Move "Team sync" to Fri, Sep 18, 2026, 6:00 PM–6:30 PM',
    receiptText: 'Moved "Team sync" to Fri, Sep 18, 6:00 PM–6:30 PM.',
  });
  const result = await confirmProposal({ store, applyCalendarEdit }, { proposal, accept: true });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.receipts, ['Moved "Team sync" to Fri, Sep 18, 6:00 PM–6:30 PM.']);
  assert.notEqual(result.value.receipts[0], proposal.reason, "the receipt must never be the future-tense confirm question");
  store.close();
});

test("confirmProposal(calendar-edit): the receipt is the past-tense receiptText, never the future-tense reason — create shape (the exact incident-adjacent wording)", async () => {
  const store = tempStore();
  const applyCalendarEdit: ConfirmProposalDeps["applyCalendarEdit"] = async () => ({ ok: true, value: { eventId: "calendar-create-1", calendarId: "primary" } });
  const proposal = makeCalendarEditProposal({
    entityId: "calendar-create-1",
    suggested: { kind: "create", calendarId: "primary", title: "Meet with Alex", start: "2026-09-28T14:45:00.000Z", end: "2026-09-28T16:15:00.000Z" },
    reason: 'Create "Meet with Alex" on Mon, Sep 28, 10:45 AM–12:15 PM?',
    receiptText: 'Added "Meet with Alex" to Google Calendar — Mon, Sep 28, 10:45 AM–12:15 PM.',
  });
  const result = await confirmProposal({ store, applyCalendarEdit }, { proposal, accept: true });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.receipts, ['Added "Meet with Alex" to Google Calendar — Mon, Sep 28, 10:45 AM–12:15 PM.']);
  assert.notEqual(result.value.receipts[0], proposal.reason, "the receipt must never be the future-tense confirm question");
  assert.doesNotMatch(result.value.receipts[0]!, /\?$/, "a receipt is a statement, never a question");
  store.close();
});

test("confirmProposal(calendar-edit): falls back to reason when receiptText is absent — a proposal persisted before this fix landed (a plain Proposal<CalendarEditChange>, never a CalendarEditProposal)", async () => {
  const store = tempStore();
  const applyCalendarEdit: ConfirmProposalDeps["applyCalendarEdit"] = async () => ({ ok: true, value: { eventId: "evt-1", calendarId: "primary" } });
  // A genuinely OLDER-shaped stored proposal — built as `Proposal<CalendarEditChange>`
  // directly (never `CalendarEditProposal`), so it has no `receiptText` at
  // all, exactly as one persisted before this fix landed would round-trip
  // back out of the store.
  const proposal: Proposal<CalendarEditChange> = {
    id: "calendar-edit-legacy",
    kind: "calendar-edit",
    entityId: "evt-1",
    entityVersion: "etag-1",
    suggested: { kind: "move", eventId: "evt-1", calendarId: "primary", newStart: "2026-09-18T18:00:00.000Z", newEnd: "2026-09-18T18:30:00.000Z" },
    reason: 'Move "Team sync" to Fri, Sep 18, 2026, 6:00 PM–6:30 PM',
    createdAt: NOW,
  };
  const result = await confirmProposal({ store, applyCalendarEdit }, { proposal, accept: true });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.receipts, [proposal.reason]);
  store.close();
});

// ---- unrecognized kind ------------------------------------------------------

test("confirmProposal: an unrecognized proposal kind with accept:true returns a validation failure rather than throwing or silently no-op'ing", async () => {
  const store = tempStore();
  const result = await confirmProposal({ store }, { proposal: { id: "x", kind: "something-new", entityId: "e1", entityVersion: "1", suggested: {}, reason: "x", createdAt: NOW }, accept: true });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  store.close();
});

// ---- rule-change (Story 13.8) ----------------------------------------------
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { readPlanningSettings, writeSetting } from "../src/adapters/settings-store.ts";
import { ruleChangeProposalId, ruleChangeRequestId } from "../src/core/rule-change.ts";
import type { RuleChange } from "../src/types/domain.ts";

function ruleHarness(now = new Date(NOW)) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const store = createMemoryStore(connection);
  const memoryItems = createMemoryItemStore(connection);
  const item = memoryItems.insert({ folder: "planning-preferences", text: "Start work at 2:30 on school days", origin: "stated", scope: "standing", sourceTurnId: "t1", ruleChange: "pending" } as never);
  const change: RuleChange = { key: "schoolDayWorkStart", value: "14:30", previous: "15:15", memoryItemId: item.id };
  const proposal: Proposal<RuleChange> = {
    id: ruleChangeProposalId(item.id),
    kind: "rule-change",
    entityId: "schoolDayWorkStart",
    entityVersion: JSON.stringify("15:15"),
    suggested: change,
    reason: "Change school-day work start from 3:15 PM to 2:30 PM?",
    createdAt: NOW,
  };
  const requestId = ruleChangeRequestId(item.id);
  putOpenInteractionRequest(store, requestId, { requestKind: "proposal", promptText: proposal.reason, detail: { proposal }, createdAt: NOW });
  const deps: ConfirmProposalDeps = { store, connection, memoryItems, now: () => now };
  const workStart = () => store.withDb(readPlanningSettings).workStart.schoolDay;
  return { deps, store, connection, memoryItems, item, proposal, requestId, workStart };
}

test("rule-change: Yes writes the override, confirms the item, clears the request", async () => {
  const h = ruleHarness();
  const r = await confirmProposal(h.deps, { proposal: h.proposal, accept: true, requestId: h.requestId });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.applied, true);
    assert.equal(r.value.message, "Changed school-day work start to 2:30 PM. Revert it on the Memory page.");
  }
  assert.deepEqual(h.workStart(), { hour: 14, minute: 30 });
  assert.equal(h.memoryItems.getItem(h.item.id)?.ruleChange, "confirmed");
  assert.equal(getOpenInteractionRequest(h.store, h.requestId), undefined);
});

test("rule-change: No writes nothing, declines the item", async () => {
  const h = ruleHarness();
  const r = await confirmProposal(h.deps, { proposal: h.proposal, accept: false, requestId: h.requestId });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.applied, false);
    assert.equal(r.value.message, "Kept 3:15 PM. Your preference stays saved, marked declined.");
  }
  assert.deepEqual(h.workStart(), { hour: 15, minute: 15 });
  assert.equal(h.memoryItems.getItem(h.item.id)?.ruleChange, "declined");
  assert.equal(getOpenInteractionRequest(h.store, h.requestId), undefined);
});

test("rule-change: a stale Yes returns stale-proposal, writes nothing, item goes none", async () => {
  const h = ruleHarness();
  await writeSetting(h.connection, "schoolDayWorkStart", "16:00");
  const r = await confirmProposal(h.deps, { proposal: h.proposal, accept: true, requestId: h.requestId });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "stale-proposal");
  assert.deepEqual(h.workStart(), { hour: 16, minute: 0 });
  assert.equal(h.memoryItems.getItem(h.item.id)?.ruleChange, "none");
  assert.equal(getOpenInteractionRequest(h.store, h.requestId), undefined);
});

test("rule-change: an expired Yes (7 days) is withdrawn as declined", async () => {
  const h = ruleHarness(new Date("2026-09-01T09:00:00.000Z"));
  const r = await confirmProposal(h.deps, { proposal: h.proposal, accept: true, requestId: h.requestId });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "stale-proposal");
  assert.deepEqual(h.workStart(), { hour: 15, minute: 15 });
  assert.equal(h.memoryItems.getItem(h.item.id)?.ruleChange, "declined");
  assert.equal(getOpenInteractionRequest(h.store, h.requestId), undefined);
});

test("rule-change: a window that would overlap is a validation failure and writes nothing", async () => {
  const h = ruleHarness();
  const cur = h.store.withDb(readPlanningSettings);
  const community = cur.protectedWindows.find((w) => w.key === "community")!;
  const pad = (n: number) => String(n).padStart(2, "0");
  const previous = { start: "10:55", end: "11:35" };
  const value = { start: `${pad(community.startHour)}:${pad(community.startMinute)}`, end: `${pad(community.endHour)}:${pad(community.endMinute)}` };
  const change: RuleChange = { key: "lunchWindow", value, previous, memoryItemId: h.item.id };
  const proposal = { ...h.proposal, entityId: "lunchWindow", suggested: change };
  // Only meaningful when the built-in lunch window equals `previous`; otherwise use its real value.
  const lunch = cur.protectedWindows.find((w) => w.key === "lunch")!;
  const real = { start: `${pad(lunch.startHour)}:${pad(lunch.startMinute)}`, end: `${pad(lunch.endHour)}:${pad(lunch.endMinute)}` };
  const r = await confirmProposal(h.deps, { proposal: { ...proposal, suggested: { ...change, previous: real } }, accept: true, requestId: h.requestId });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "validation");
  assert.deepEqual(h.store.withDb(readPlanningSettings).protectedWindows, cur.protectedWindows);
  assert.equal(getOpenInteractionRequest(h.store, h.requestId), undefined);
});

test("rule-change: missing connection or memoryItems is a missing dependency", async () => {
  const h = ruleHarness();
  const r = await confirmProposal({ store: h.store }, { proposal: h.proposal, accept: true, requestId: h.requestId });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.kind, "unreachable");
});

test("rule-change: store helpers find and withdraw the open rule proposal; question is Yes/No only", async () => {
  const { findOpenRuleProposals, withdrawRuleProposal } = await import("../src/adapters/memory-store.ts");
  const { buildProposalQuestion } = await import("../src/core/open-item-questions.ts");
  const h = ruleHarness();
  assert.equal(findOpenRuleProposals(h.store).length, 1);
  assert.equal(buildProposalQuestion(h.requestId, "q", h.proposal).allowsFreeText, false);
  assert.equal(withdrawRuleProposal(h.store, h.item.id), true);
  assert.equal(withdrawRuleProposal(h.store, h.item.id), false);
  assert.equal(findOpenRuleProposals(h.store).length, 0);
});

test("settings-store logs a skipped invalid stored row", async () => {
  const { readSettingOverrides, initSettingsStoreSchema } = await import("../src/adapters/settings-store.ts");
  const h = ruleHarness();
  initSettingsStoreSchema(h.connection.db);
  h.connection.db.prepare("INSERT INTO planning_settings (key, area, value, updated_at) VALUES ('schoolDayWorkStart','', '\"07:00\"', 'x')").run();
  const lines: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: unknown }).write = (c: string) => (lines.push(String(c)), true);
  try {
    readSettingOverrides(h.connection.db);
  } finally {
    (process.stderr as { write: unknown }).write = orig;
  }
  assert.ok(lines.some((l) => l.includes("settings-store.invalid-row-skipped")));
});
