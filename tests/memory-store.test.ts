/**
 * Tests for `src/adapters/memory-store.ts`.
 *
 * Per Task 2's Ruling, this must be fully unit-testable without real
 * credentials — every test uses a throwaway SQLite file (or `:memory:`) in
 * the OS temp dir, never a real deployed database.
 *
 * The two-connection tests (schema persistence, conflict detection) open a
 * second `MemoryStore` against the *same on-disk file* to genuinely model
 * AD-10's "ritual-cli.ts and chat-cli.ts are allowed to run concurrently"
 * scenario, rather than asserting against a single in-process store.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  createMemoryStore,
  ConflictError,
  putOpenInteractionRequest,
  getOpenInteractionRequest,
  listOpenInteractionRequests,
  clearInteractionRequest,
  getTaskFieldOverride,
  mergeTaskFieldOverride,
  getCurrentTimeBudget,
  putTimeBudget,
  getSlipHistory,
  recordSlip,
  clearSlip,
  listSlipHistories,
  getUncheckedDay,
  putUncheckedDay,
  listUncheckedDays,
  markUncheckedDayShown,
  clearUncheckedDay,
  putPlan,
  putRitualRun,
  readHotMemory,
  queryColdMemoryPatterns,
  HOT_MEMORY_WINDOW_DAYS,
  COLD_MEMORY_DEFAULT_LOOKBACK_DAYS,
  type InteractionRequest,
  type MemoryStore,
  type Plan,
} from "../src/adapters/memory-store.ts";
import type { TimeBudget } from "../src/types/domain.ts";

/**
 * Wraps `store` in a `Proxy` that counts calls to `listRecordsByKind` — the
 * "scan every record for a kind" primitive every cold/list-shaped read in
 * this file goes through. Used to assert STRUCTURALLY (not just "the numbers
 * came out right") that a hot-memory read path never touches it, per Task
 * 22's TDD requirement 1. Only wraps the one method under test; every other
 * call (including the internal `this.db...` calls each method makes
 * directly, not through `this.listRecordsByKind`) passes through untouched.
 */
function spyOnListRecordsByKind(store: MemoryStore): { store: MemoryStore; callCount: () => number } {
  let count = 0;
  const proxy = new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "listRecordsByKind" && typeof value === "function") {
        count += 1;
        return value.bind(target);
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { store: proxy as MemoryStore, callCount: () => count };
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "yoh-memory-store-test-"));
  return join(dir, "yoh-memory.db");
}

test("creates the database file's parent directory when it doesn't exist yet (fresh checkout, .env.example's ./data/ default)", () => {
  // Deliberately does NOT pre-create the parent directory (unlike
  // tempDbPath()'s mkdtempSync, which always pre-creates one) — this models
  // a fresh checkout using .env.example's documented default
  // (MEMORY_DB_PATH=./data/yoh-memory.db) where ./data/ doesn't exist yet.
  const parentDir = mkdtempSync(join(tmpdir(), "yoh-memory-store-test-"));
  const dbPath = join(parentDir, "nested", "not-yet-created", "yoh-memory.db");

  const store = createMemoryStore({ databasePath: dbPath });
  const created = store.readModifyWrite<{ ok: boolean }>("smoke", "1", undefined, () => ({ ok: true }));
  assert.equal(created.version, 1);
  store.close();
});

test("initializes its SQLite schema on first run", () => {
  const dbPath = tempDbPath();
  const store = createMemoryStore({ databasePath: dbPath });

  // Verify against a completely separate raw connection, not the store's
  // own API, so this is a genuine assertion about what's on disk.
  const raw = new Database(dbPath, { readonly: true });
  const tables = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  raw.close();

  assert.ok(tables.some((t) => t.name === "records"), "expected a 'records' table after first run");
  store.close();
});

test("schema init is idempotent: reopening an existing store does not throw and preserves prior data", () => {
  const dbPath = tempDbPath();
  const first = createMemoryStore({ databasePath: dbPath });
  first.readModifyWrite<{ label: string }>("time-budget", "2026-08-22", undefined, () => ({
    label: "first",
  }));
  first.close();

  assert.doesNotThrow(() => {
    const second = createMemoryStore({ databasePath: dbPath });
    const record = second.getRecord<{ label: string }>("time-budget", "2026-08-22");
    assert.equal(record?.data.label, "first");
    second.close();
  });
});

test("readModifyWrite creates a new record at version 1 when none exists", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });

  const result = store.readModifyWrite<{ totalMinutes: number }>(
    "time-budget",
    "2026-08-22",
    undefined,
    (current) => {
      assert.equal(current, undefined);
      return { totalMinutes: 480 };
    },
  );

  assert.equal(result.version, 1);
  assert.equal(result.data.totalMinutes, 480);
  store.close();
});

test("readModifyWrite updates an existing record and increments version when expectedVersion matches", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });

  const created = store.readModifyWrite<{ totalMinutes: number }>(
    "time-budget",
    "2026-08-22",
    undefined,
    () => ({ totalMinutes: 480 }),
  );
  assert.equal(created.version, 1);

  const updated = store.readModifyWrite<{ totalMinutes: number }>(
    "time-budget",
    "2026-08-22",
    created.version,
    (current) => ({ totalMinutes: (current?.data.totalMinutes ?? 0) - 60 }),
  );

  assert.equal(updated.version, 2);
  assert.equal(updated.data.totalMinutes, 420);
  store.close();
});

test("readModifyWrite surfaces a conflicting write as a ConflictError carrying YohError.kind: 'conflict'", () => {
  const dbPath = tempDbPath();
  // Two independent connections to the same file model two concurrent
  // processes (ritual-cli.ts, chat-cli.ts) per AD-10.
  const writerA = createMemoryStore({ databasePath: dbPath });
  const writerB = createMemoryStore({ databasePath: dbPath });

  const created = writerA.readModifyWrite<{ totalMinutes: number }>(
    "time-budget",
    "2026-08-22",
    undefined,
    () => ({ totalMinutes: 480 }),
  );
  assert.equal(created.version, 1);

  // Writer B "read" the record back when it was still version 1 (simulated
  // by reusing `created.version`), then writer A gets in first:
  writerA.readModifyWrite<{ totalMinutes: number }>("time-budget", "2026-08-22", 1, (current) => ({
    totalMinutes: (current?.data.totalMinutes ?? 0) - 60,
  }));

  // Writer B's write is now stale (it still thinks the version is 1).
  assert.throws(
    () => {
      writerB.readModifyWrite<{ totalMinutes: number }>("time-budget", "2026-08-22", 1, (current) => ({
        totalMinutes: (current?.data.totalMinutes ?? 0) - 15,
      }));
    },
    (err: unknown) => {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.yohError.kind, "conflict");
      return true;
    },
  );

  writerA.close();
  writerB.close();
});

test("readModifyWrite rolls back and leaves the stored record unchanged when the modify callback throws", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });

  store.readModifyWrite<{ totalMinutes: number }>("time-budget", "2026-08-22", undefined, () => ({
    totalMinutes: 480,
  }));

  assert.throws(() => {
    store.readModifyWrite<{ totalMinutes: number }>("time-budget", "2026-08-22", 1, () => {
      throw new Error("boom");
    });
  }, /boom/);

  const record = store.getRecord<{ totalMinutes: number }>("time-budget", "2026-08-22");
  assert.equal(record?.version, 1);
  assert.equal(record?.data.totalMinutes, 480);
  store.close();
});

test("getRecord returns undefined for a record that doesn't exist", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  assert.equal(store.getRecord("time-budget", "does-not-exist"), undefined);
  store.close();
});

test("AD-10: memory-store.ts does not import google-auth-library (token-store.ts is the sole holder of OAuth2Client)", () => {
  const memoryStoreSourcePath = join(import.meta.dirname, "..", "src", "adapters", "memory-store.ts");
  const contents = readFileSync(memoryStoreSourcePath, "utf8");
  assert.ok(!contents.includes("google-auth-library"));
});

// ============================================================================
// listRecordsByKind / deleteRecord — the generic extension Task 5 adds on
// top of Task 2's records table, in support of "open interaction request"
// storage (see below) without forking a new table (AD-10's module
// docstring anticipates exactly this extension point).
// ============================================================================

test("listRecordsByKind returns an empty array for a kind with no records", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  assert.deepEqual(store.listRecordsByKind("interaction-request"), []);
  store.close();
});

test("listRecordsByKind returns every record for a kind, ordered by id, excluding other kinds", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  store.readModifyWrite<{ n: number }>("widget", "b", undefined, () => ({ n: 2 }));
  store.readModifyWrite<{ n: number }>("widget", "a", undefined, () => ({ n: 1 }));
  store.readModifyWrite<{ n: number }>("gadget", "z", undefined, () => ({ n: 99 }));

  const widgets = store.listRecordsByKind<{ n: number }>("widget");
  assert.deepEqual(
    widgets.map((r) => r.id),
    ["a", "b"],
  );
  assert.deepEqual(
    widgets.map((r) => r.data.n),
    [1, 2],
  );
  store.close();
});

test("deleteRecord removes a record when expectedVersion matches", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  const created = store.readModifyWrite<{ n: number }>("widget", "a", undefined, () => ({ n: 1 }));

  store.deleteRecord("widget", "a", created.version);

  assert.equal(store.getRecord("widget", "a"), undefined);
  store.close();
});

test("deleteRecord throws ConflictError (YohError.kind: 'conflict') when expectedVersion is stale", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  store.readModifyWrite<{ n: number }>("widget", "a", undefined, () => ({ n: 1 }));

  assert.throws(
    () => store.deleteRecord("widget", "a", 999),
    (err: unknown) => {
      assert.ok(err instanceof ConflictError);
      assert.equal(err.yohError.kind, "conflict");
      return true;
    },
  );
  // The record survives the rejected delete.
  assert.ok(store.getRecord("widget", "a") !== undefined);
  store.close();
});

test("deleteRecord throws ConflictError when deleting a record that doesn't exist", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  assert.throws(
    () => store.deleteRecord("widget", "does-not-exist", 1),
    (err: unknown) => err instanceof ConflictError,
  );
  store.close();
});

// ============================================================================
// Open interaction requests (AD-3, AD-5) — Task 5's typed surface on top of
// the generic records table. Introduced for the Data-Completeness Gate
// (Story 1.5) but deliberately generic (`InteractionRequest.requestKind` is
// free-form) so later prompt kinds (Night close-out, Self-Check,
// Propose-Don't-Impose) reuse this same persist/surface/clear cycle.
// ============================================================================

function makeRequest(overrides: Partial<InteractionRequest> = {}): InteractionRequest {
  return {
    requestKind: "data-completeness",
    promptText: "I need a bit more before I can plan around this Task.",
    createdAt: "2026-08-22T12:00:00.000Z",
    ...overrides,
  };
}

test("putOpenInteractionRequest persists a new request retrievable via getOpenInteractionRequest", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putOpenInteractionRequest(store, "data-completeness", makeRequest());

  const record = getOpenInteractionRequest(store, "data-completeness");
  assert.equal(record?.data.requestKind, "data-completeness");
  assert.equal(record?.data.promptText, "I need a bit more before I can plan around this Task.");
  assert.equal(record?.version, 1);
  store.close();
});

test("getOpenInteractionRequest returns undefined when none is open for that id", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  assert.equal(getOpenInteractionRequest(store, "data-completeness"), undefined);
  store.close();
});

test("putOpenInteractionRequest called twice for the same id replaces the request's content (upsert, no caller-tracked version needed)", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putOpenInteractionRequest(store, "data-completeness", makeRequest({ promptText: "first" }));
  putOpenInteractionRequest(store, "data-completeness", makeRequest({ promptText: "second, more Tasks now incomplete" }));

  const record = getOpenInteractionRequest(store, "data-completeness");
  assert.equal(record?.data.promptText, "second, more Tasks now incomplete");
  assert.equal(record?.version, 2);
  store.close();
});

test("listOpenInteractionRequests surfaces every open request across different ids/kinds", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putOpenInteractionRequest(store, "data-completeness", makeRequest({ requestKind: "data-completeness" }));
  putOpenInteractionRequest(
    store,
    "night-close-out",
    makeRequest({ requestKind: "night-close-out", promptText: "Did you finish today's Tasks?" }),
  );

  const open = listOpenInteractionRequests(store);
  assert.deepEqual(
    open.map((r) => r.data.requestKind).sort(),
    ["data-completeness", "night-close-out"],
  );
  store.close();
});

test("clearInteractionRequest removes the request; it no longer appears via get or list", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  const stored = putOpenInteractionRequest(store, "data-completeness", makeRequest());

  clearInteractionRequest(store, "data-completeness", stored.version);

  assert.equal(getOpenInteractionRequest(store, "data-completeness"), undefined);
  assert.deepEqual(listOpenInteractionRequests(store), []);
  store.close();
});

test("full persist -> surface -> clear cycle: after clearing, a fresh put starts a new request at version 1 again", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  const first = putOpenInteractionRequest(store, "data-completeness", makeRequest());
  clearInteractionRequest(store, "data-completeness", first.version);

  const second = putOpenInteractionRequest(store, "data-completeness", makeRequest({ promptText: "new round" }));
  assert.equal(second.version, 1);
  assert.equal(getOpenInteractionRequest(store, "data-completeness")?.data.promptText, "new round");
  store.close();
});

// ============================================================================
// Task field overrides (Task 5 fix) — the "Spencer answered a missing
// field" storage half of the persist/surface/clear cycle.
// ============================================================================

test("getTaskFieldOverride returns undefined when nothing has been answered for that Task yet", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  assert.equal(getTaskFieldOverride(store, "task-1"), undefined);
  store.close();
});

test("mergeTaskFieldOverride creates a new override record on first answer", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  mergeTaskFieldOverride(store, "task-1", { area: "Work" });

  const record = getTaskFieldOverride(store, "task-1");
  assert.deepEqual(record?.data, { area: "Work" });
  assert.equal(record?.version, 1);
  store.close();
});

test("mergeTaskFieldOverride called again for the same Task adds a field without clobbering a previously-answered one", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  mergeTaskFieldOverride(store, "task-1", { area: "Work" });
  mergeTaskFieldOverride(store, "task-1", { estimatedDurationMinutes: 30 });

  const record = getTaskFieldOverride(store, "task-1");
  assert.deepEqual(record?.data, { area: "Work", estimatedDurationMinutes: 30 });
  assert.equal(record?.version, 2);
  store.close();
});

test("mergeTaskFieldOverride overwrites a field's previous value when answered again for the same field", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  mergeTaskFieldOverride(store, "task-1", { area: "Work" });
  mergeTaskFieldOverride(store, "task-1", { area: "Health" });

  assert.equal(getTaskFieldOverride(store, "task-1")?.data.area, "Health");
  store.close();
});

test("overrides for different Tasks are stored independently", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  mergeTaskFieldOverride(store, "task-1", { area: "Work" });
  mergeTaskFieldOverride(store, "task-2", { area: "Health" });

  assert.equal(getTaskFieldOverride(store, "task-1")?.data.area, "Work");
  assert.equal(getTaskFieldOverride(store, "task-2")?.data.area, "Health");
  store.close();
});

// ============================================================================
// Time Budget (Task 6 / Story 1.6, FR-5) — "today's Time Budget" read/write.
// Deliberately NOT day-keyed storage: a single singleton row is upserted, so
// a value declared once is still the current value on every later read,
// including across a simulated day boundary or weekend, with no explicit
// expiry mechanism to accidentally trigger.
// ============================================================================

function makeTimeBudget(overrides: Partial<TimeBudget> = {}): TimeBudget {
  return {
    date: "2026-08-21", // a Friday
    totalMinutes: 360,
    workMinutes: 70,
    breakMinutes: 15,
    ...overrides,
  };
}

test("getCurrentTimeBudget returns undefined when Spencer has never declared a Time Budget", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  assert.equal(getCurrentTimeBudget(store), undefined);
  store.close();
});

test("putTimeBudget persists a new Time Budget retrievable via getCurrentTimeBudget, at version 1", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putTimeBudget(store, makeTimeBudget());

  const record = getCurrentTimeBudget(store);
  assert.equal(record?.data.totalMinutes, 360);
  assert.equal(record?.data.date, "2026-08-21");
  assert.equal(record?.version, 1);
  store.close();
});

test("putTimeBudget called again replaces the value in place (upsert), not a new row per day", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putTimeBudget(store, makeTimeBudget({ date: "2026-08-21", totalMinutes: 360 }));
  putTimeBudget(store, makeTimeBudget({ date: "2026-08-25", totalMinutes: 240 }));

  // Still exactly one Time Budget row in storage, regardless of how many
  // times it's been declared — the design this story requires: no per-day
  // copy to silently expire.
  assert.deepEqual(store.listRecordsByKind("time-budget").map((r) => r.id).length, 1);

  const record = getCurrentTimeBudget(store);
  assert.equal(record?.data.totalMinutes, 240);
  assert.equal(record?.data.date, "2026-08-25");
  assert.equal(record?.version, 2);
  store.close();
});

// NOTE on the two tests below: neither one advances or mocks a clock, and
// `getCurrentTimeBudget` takes no date argument at all — nothing at this
// storage layer is capable of distinguishing "read immediately after
// declaring" from "read the next day" or "read the following Monday" from
// "read three weeks later." That's not a gap in test rigor; it's a direct
// consequence of the design documented above (a date-blind singleton row,
// no expiry/date-filtering code path at all). The AC's "persists across a
// day/weekend boundary" guarantee therefore holds *by construction* — there
// is no date-based logic anywhere in `getCurrentTimeBudget`/`putTimeBudget`
// that a boundary-crossing test could exercise or fail. These two tests
// document that fact (readable-by-name evidence that a maintainer reading
// this suite understands why no simulated-clock test exists) and otherwise
// just re-confirm the same read-after-write behavior the test three lines
// above already covers — they intentionally add no additional coverage
// beyond it.
test("documents: a declared Time Budget has no per-day expiry to simulate — reading again returns it unchanged (no date-based logic exists to test)", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putTimeBudget(store, makeTimeBudget({ date: "2026-08-21", totalMinutes: 360 }));

  // Reading again is the entire test: there is no "advance to the next
  // day" step because nothing in this file's storage reads a clock.
  const readAgain = getCurrentTimeBudget(store);
  assert.equal(readAgain?.data.totalMinutes, 360);
  assert.equal(readAgain?.data.date, "2026-08-21"); // unchanged — no silent revert to a different default
  assert.equal(readAgain?.version, 1); // no write happened
  store.close();
});

test("documents: the AC's Friday-declared/Monday-read weekend-boundary guarantee holds by construction, not by a simulated clock (getCurrentTimeBudget takes no date and applies no date filter)", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putTimeBudget(store, makeTimeBudget({ date: "2026-08-21", totalMinutes: 360 })); // Friday

  // No clock is mocked or advanced — this call happens at the same instant
  // as the put above. It stands in for "read on Monday" only in the sense
  // that `getCurrentTimeBudget` has no way to behave differently based on
  // what day it's called on; see the note above the previous test.
  const readAgain = getCurrentTimeBudget(store);
  assert.equal(readAgain?.data.totalMinutes, 360);
  assert.equal(readAgain?.data.date, "2026-08-21");
  assert.equal(readAgain?.version, 1);
  store.close();
});

// ============================================================================
// Slip history (Task 17 / Story 2.5, FR-11) — typed surface on `records`
// ============================================================================

test("recordSlip: a Task's first reported slip creates a SlipHistory row with consecutiveSlipCount 1", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  assert.equal(getSlipHistory(store, "task-1"), undefined, "sanity: no slip history before any slip is recorded");

  const record = recordSlip(store, "task-1", "2026-08-20");
  assert.equal(record.data.consecutiveSlipCount, 1);
  assert.equal(record.data.lastSlipDate, "2026-08-20");
  assert.equal(record.version, 1);

  const read = getSlipHistory(store, "task-1");
  assert.equal(read?.data.consecutiveSlipCount, 1);
  store.close();
});

test("recordSlip: called again for the same Task increments consecutiveSlipCount (consecutive slips accumulate)", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  recordSlip(store, "task-1", "2026-08-20");
  recordSlip(store, "task-1", "2026-08-21");
  const third = recordSlip(store, "task-1", "2026-08-22");

  assert.equal(third.data.consecutiveSlipCount, 3);
  assert.equal(third.data.lastSlipDate, "2026-08-22");
  assert.equal(third.version, 3);
  store.close();
});

test("recordSlip: calling it twice for the SAME slipDate is a no-op — does not double-increment (Task 19 review fix)", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  const first = recordSlip(store, "task-1", "2026-08-20");
  assert.equal(first.data.consecutiveSlipCount, 1);

  const second = recordSlip(store, "task-1", "2026-08-20"); // same date again — e.g. a resumed close-out re-answering the same Task
  assert.equal(second.data.consecutiveSlipCount, 1, "the same date must not be counted twice");
  assert.equal(second.version, first.version, "no new write should occur for a duplicate same-date call");

  // A genuinely NEW date still increments normally.
  const third = recordSlip(store, "task-1", "2026-08-21");
  assert.equal(third.data.consecutiveSlipCount, 2);
  store.close();
});

test("recordSlip: two different Tasks accumulate independent consecutive-slip counts", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  recordSlip(store, "task-a", "2026-08-20");
  recordSlip(store, "task-a", "2026-08-21");
  recordSlip(store, "task-b", "2026-08-21");

  assert.equal(getSlipHistory(store, "task-a")?.data.consecutiveSlipCount, 2);
  assert.equal(getSlipHistory(store, "task-b")?.data.consecutiveSlipCount, 1);
  store.close();
});

test("clearSlip: a Task's Slip-Bump is cleared on completion, not carried indefinitely (AC)", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  recordSlip(store, "task-1", "2026-08-20");
  assert.equal(getSlipHistory(store, "task-1")?.data.consecutiveSlipCount, 1);

  clearSlip(store, "task-1");
  assert.equal(getSlipHistory(store, "task-1"), undefined, "slip history should be gone entirely once cleared");
  store.close();
});

test("clearSlip: a subsequent NEW slip after a clear starts back at 1, not carried forward from before the clear", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  recordSlip(store, "task-1", "2026-08-20");
  recordSlip(store, "task-1", "2026-08-21");
  clearSlip(store, "task-1"); // Task completed.

  const afterClearSlip = recordSlip(store, "task-1", "2026-09-01"); // Task slips again, later.
  assert.equal(afterClearSlip.data.consecutiveSlipCount, 1, "must not resume from the pre-clear count of 2");
  store.close();
});

test("clearSlip: clearing a Task with no slip history at all is a harmless no-op", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  assert.doesNotThrow(() => clearSlip(store, "task-never-slipped"));
  assert.equal(getSlipHistory(store, "task-never-slipped"), undefined);
  store.close();
});

test("listSlipHistories: lists every Task's current slip history, across every taskId", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  recordSlip(store, "task-a", "2026-08-20");
  recordSlip(store, "task-b", "2026-08-20");
  recordSlip(store, "task-b", "2026-08-21");

  const all = listSlipHistories(store);
  assert.equal(all.length, 2);
  const byId = Object.fromEntries(all.map((r) => [r.id, r.data.consecutiveSlipCount]));
  assert.deepEqual(byId, { "task-a": 1, "task-b": 2 });
  store.close();
});

test("listSlipHistories: a cleared Task's history no longer appears in the list", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  recordSlip(store, "task-a", "2026-08-20");
  recordSlip(store, "task-b", "2026-08-20");
  clearSlip(store, "task-a");

  const all = listSlipHistories(store);
  assert.equal(all.length, 1);
  assert.equal(all[0]?.id, "task-b");
  store.close();
});

test("recordSlip: persists across a second connection to the same on-disk file (schema/storage genuinely durable, not just in-process)", () => {
  const dbPath = tempDbPath();
  const store1 = createMemoryStore({ databasePath: dbPath });
  recordSlip(store1, "task-1", "2026-08-20");
  store1.close();

  const store2 = createMemoryStore({ databasePath: dbPath });
  const read = getSlipHistory(store2, "task-1");
  assert.equal(read?.data.consecutiveSlipCount, 1);
  store2.close();
});

// ============================================================================
// UncheckedDay (Task 21 / Story 3.3, FR-14, UX-DR14)
// ============================================================================

test("getUncheckedDay returns undefined for a date that was never left unchecked", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  assert.equal(getUncheckedDay(store, "2026-08-21"), undefined);
  store.close();
});

test("putUncheckedDay persists a record retrievable via getUncheckedDay, at version 1", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  const record = putUncheckedDay(store, {
    date: "2026-08-21",
    rolledForwardTasks: [{ taskId: "t1", taskTitle: "Draft the memo" }],
    recordedAt: "2026-08-22T13:00:00.000Z",
  });
  assert.equal(record.version, 1);

  const read = getUncheckedDay(store, "2026-08-21");
  assert.ok(read);
  assert.equal(read.data.date, "2026-08-21");
  assert.deepEqual(read.data.rolledForwardTasks, [{ taskId: "t1", taskTitle: "Draft the memo" }]);
  store.close();
});

test("an UncheckedDay row's mere presence is what distinguishes an unchecked night from a normally-closed one — a closed night has NO row at all, ever", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  // "2026-08-20" was closed out normally — nothing in this codebase ever
  // calls putUncheckedDay for it.
  putUncheckedDay(store, {
    date: "2026-08-21",
    rolledForwardTasks: [{ taskId: "t1", taskTitle: "Draft the memo" }],
    recordedAt: "2026-08-22T13:00:00.000Z",
  });

  assert.equal(getUncheckedDay(store, "2026-08-20"), undefined, "a normally-closed day must never read back as unchecked");
  assert.ok(getUncheckedDay(store, "2026-08-21"), "the genuinely unchecked day must read back as unchecked");
  store.close();
});

test("putUncheckedDay called again for the same date replaces the record (upsert), not a second row", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putUncheckedDay(store, {
    date: "2026-08-21",
    rolledForwardTasks: [{ taskId: "t1", taskTitle: "Draft the memo" }],
    recordedAt: "2026-08-22T13:00:00.000Z",
  });
  const second = putUncheckedDay(store, {
    date: "2026-08-21",
    rolledForwardTasks: [{ taskId: "t1", taskTitle: "Draft the memo" }, { taskId: "t2", taskTitle: "Book the flights" }],
    recordedAt: "2026-08-22T13:05:00.000Z",
  });
  assert.equal(second.version, 2);

  const read = getUncheckedDay(store, "2026-08-21");
  assert.equal(read?.data.rolledForwardTasks.length, 2);
  assert.equal(listUncheckedDays(store).length, 1, "still exactly one row for this date, not two");
  store.close();
});

test("listUncheckedDays lists every night ever recorded as unchecked, across every date", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putUncheckedDay(store, { date: "2026-08-19", rolledForwardTasks: [], recordedAt: "2026-08-20T13:00:00.000Z" });
  putUncheckedDay(store, { date: "2026-08-21", rolledForwardTasks: [], recordedAt: "2026-08-22T13:00:00.000Z" });

  const all = listUncheckedDays(store);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((r) => r.id).sort(), ["2026-08-19", "2026-08-21"]);
  store.close();
});

test("markUncheckedDayShown stamps shownAt on an existing record without disturbing rolledForwardTasks/recordedAt, and bumps its version", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putUncheckedDay(store, {
    date: "2026-08-21",
    rolledForwardTasks: [{ taskId: "t1", taskTitle: "Draft the memo" }],
    recordedAt: "2026-08-22T01:00:00.000Z",
  });
  assert.equal(getUncheckedDay(store, "2026-08-21")?.data.shownAt, undefined, "sanity: not yet shown");

  const stamped = markUncheckedDayShown(store, "2026-08-21", "2026-08-22T13:00:00.000Z");
  assert.ok(stamped, "expected a real stamped record, not the 'already resolved' undefined case");
  assert.equal(stamped.version, 2, "the version increments — a real readModifyWrite, not a no-op");
  assert.equal(stamped.data.shownAt, "2026-08-22T13:00:00.000Z");
  assert.deepEqual(stamped.data.rolledForwardTasks, [{ taskId: "t1", taskTitle: "Draft the memo" }], "untouched by the stamp");
  assert.equal(stamped.data.recordedAt, "2026-08-22T01:00:00.000Z", "untouched by the stamp");

  const read = getUncheckedDay(store, "2026-08-21");
  assert.equal(read?.data.shownAt, "2026-08-22T13:00:00.000Z");
  store.close();
});

test("markUncheckedDayShown returns undefined (a clean no-op, NOT a throw) when no UncheckedDay record exists for that date — Task 21 Minor post-review fix: a concurrent clearUncheckedDay is a real, reachable case, not a bug", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  assert.doesNotThrow(() => markUncheckedDayShown(store, "2026-08-21", "2026-08-22T13:00:00.000Z"));
  const result = markUncheckedDayShown(store, "2026-08-21", "2026-08-22T13:00:00.000Z");
  assert.equal(result, undefined);
  store.close();
});

test("markUncheckedDayShown resolves cleanly (no throw) even when the row is deleted BETWEEN its own internal read and write — the cross-process race the Minor fix targets", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putUncheckedDay(store, {
    date: "2026-08-21",
    rolledForwardTasks: [{ taskId: "t1", taskTitle: "Draft the memo" }],
    recordedAt: "2026-08-21T23:00:00.000Z",
  });

  // Simulate a genuinely concurrent chat-cli.ts process (same SQLite file,
  // AD-10) answering the close-out and clearing this exact row via
  // clearUncheckedDay — timed to land between morning-ritual.ts's own
  // step-1.5 read (which produced the `date` this call is keyed on) and
  // this call's own write. Reproduced directly by simply clearing the row
  // first and then calling markUncheckedDayShown, which is the observable
  // effect regardless of which of the two internal race windows it lands in
  // (this function's own doc comment covers both).
  clearUncheckedDay(store, "2026-08-21");

  assert.doesNotThrow(() => markUncheckedDayShown(store, "2026-08-21", "2026-08-22T13:00:00.000Z"));
  assert.equal(markUncheckedDayShown(store, "2026-08-21", "2026-08-22T13:00:00.000Z"), undefined);
  assert.equal(getUncheckedDay(store, "2026-08-21"), undefined, "still resolved — no row was resurrected by the attempted stamp");
  store.close();
});

test("clearUncheckedDay removes an existing UncheckedDay record — it reads back exactly as if that night was never unchecked", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putUncheckedDay(store, {
    date: "2026-08-21",
    rolledForwardTasks: [{ taskId: "t1", taskTitle: "Draft the memo" }],
    recordedAt: "2026-08-22T01:00:00.000Z",
  });
  assert.ok(getUncheckedDay(store, "2026-08-21"));

  clearUncheckedDay(store, "2026-08-21");
  assert.equal(getUncheckedDay(store, "2026-08-21"), undefined);
  assert.equal(listUncheckedDays(store).length, 0);
  store.close();
});

test("clearUncheckedDay is a harmless no-op when no record exists for that date", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  assert.doesNotThrow(() => clearUncheckedDay(store, "2026-08-21"));
  assert.equal(getUncheckedDay(store, "2026-08-21"), undefined);
  store.close();
});

test("clearUncheckedDay only removes the record for its OWN date — a different date's row is untouched", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putUncheckedDay(store, { date: "2026-08-19", rolledForwardTasks: [], recordedAt: "2026-08-20T13:00:00.000Z" });
  putUncheckedDay(store, { date: "2026-08-21", rolledForwardTasks: [], recordedAt: "2026-08-22T13:00:00.000Z" });

  clearUncheckedDay(store, "2026-08-21");
  assert.equal(getUncheckedDay(store, "2026-08-21"), undefined);
  assert.ok(getUncheckedDay(store, "2026-08-19"), "the other date's record must survive untouched");
  store.close();
});

// ============================================================================
// Hot/cold memory boundary (Task 22 / Story 4.1, FR-15, AD-10)
//
// "Hot" memory is what a routine daily ritual actually reads: today's Plan,
// the current Time Budget, and a ritual's own last-run marker — all reached
// by `getRecord` on a specific `(kind, id)`, never a full scan. "Cold"
// memory is `queryColdMemoryPatterns`, a genuinely separate, on-demand read
// path over OLDER history distilled into human-readable pattern-statements.
// ============================================================================

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan-2026-08-22",
    date: "2026-08-22",
    blocks: [],
    reasoning: "test plan",
    version: 1,
    createdAt: "2026-08-22T12:00:00.000Z",
    updatedAt: "2026-08-22T12:00:00.000Z",
    ...overrides,
  };
}

test("HOT_MEMORY_WINDOW_DAYS/COLD_MEMORY_DEFAULT_LOOKBACK_DAYS are documented positive-day constants, and cold's default lookback is strictly wider than the hot window", () => {
  assert.equal(typeof HOT_MEMORY_WINDOW_DAYS, "number");
  assert.equal(typeof COLD_MEMORY_DEFAULT_LOOKBACK_DAYS, "number");
  assert.ok(HOT_MEMORY_WINDOW_DAYS > 0);
  assert.ok(COLD_MEMORY_DEFAULT_LOOKBACK_DAYS > HOT_MEMORY_WINDOW_DAYS);
});

test("readHotMemory bundles today's Plan, current Time Budget, and named ritual-run markers", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putPlan(store, makePlan());
  putTimeBudget(store, makeTimeBudget({ date: "2026-08-22", totalMinutes: 300 }));
  putRitualRun(store, "morning", { date: "2026-08-22", ranAt: "2026-08-22T13:00:00.000Z" });

  const hot = readHotMemory(store, "2026-08-22", ["morning", "night-prompt"]);

  assert.equal(hot.plan?.data.id, "plan-2026-08-22");
  assert.equal(hot.timeBudget?.data.totalMinutes, 300);
  assert.equal(hot.ritualRuns.morning?.data.date, "2026-08-22");
  assert.equal(hot.ritualRuns["night-prompt"], undefined, "a ritual that hasn't run yet reads back as undefined, not an error");
  store.close();
});

test("readHotMemory returns undefined fields (not throws) when nothing has been declared/generated/run yet", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  const hot = readHotMemory(store, "2026-08-22", ["morning"]);
  assert.equal(hot.plan, undefined);
  assert.equal(hot.timeBudget, undefined);
  assert.equal(hot.ritualRuns.morning, undefined);
  store.close();
});

test("STRUCTURAL: readHotMemory never calls listRecordsByKind — a hot read is always addressed by (kind, id), never a full-table scan", () => {
  const dbPath = tempDbPath();
  const real = createMemoryStore({ databasePath: dbPath });
  putPlan(real, makePlan());
  putTimeBudget(real, makeTimeBudget({ date: "2026-08-22" }));
  putRitualRun(real, "morning", { date: "2026-08-22", ranAt: "2026-08-22T13:00:00.000Z" });
  real.close();

  const store = createMemoryStore({ databasePath: dbPath });
  const { store: spiedStore, callCount } = spyOnListRecordsByKind(store);

  readHotMemory(spiedStore, "2026-08-22", ["morning", "night-prompt", "night-escalate"]);

  assert.equal(callCount(), 0, "readHotMemory must never touch listRecordsByKind (the cold/list scan primitive)");
  store.close();
});

test("STRUCTURAL: queryColdMemoryPatterns DOES use listRecordsByKind — the cold path is a genuine full scan, unlike the hot path above", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  const { store: spiedStore, callCount } = spyOnListRecordsByKind(store);

  queryColdMemoryPatterns(spiedStore, { asOfDate: "2026-08-22" });

  assert.ok(callCount() > 0, "the cold query path is expected to scan — that's what makes it 'cold', not a bug to avoid");
  store.close();
});

// ----------------------------------------------------------------------------
// queryColdMemoryPatterns — genuine distillation of real stored history into
// pattern-statements, not a generic placeholder.
// ----------------------------------------------------------------------------

test("queryColdMemoryPatterns: a Task that slipped 3 times over 2 weeks produces an accurate slip-streak pattern-statement", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  recordSlip(store, "task-1", "2026-08-09");
  recordSlip(store, "task-1", "2026-08-15");
  recordSlip(store, "task-1", "2026-08-22");

  const patterns = queryColdMemoryPatterns(store, { asOfDate: "2026-08-22" });

  const slipPattern = patterns.find((p) => p.kind === "slip-streak" && p.taskId === "task-1");
  assert.ok(slipPattern, "expected a slip-streak pattern for task-1");
  assert.equal(slipPattern.statement, "Task task-1 has an active slip streak of 3 (most recently slipped on 2026-08-22).");
  store.close();
});

test("queryColdMemoryPatterns POST-REVIEW FIX (Important #1): a lifetime slip streak spread across months is NOT misrepresented as having all happened within the lookback window — only 1 of 5 recorded slips actually falls inside the 30-day window, and the statement must not claim otherwise", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  // Reviewer's exact reproduction scenario: a Task that keeps slipping
  // without ever completing (so clearSlip never resets it — Task 17's
  // design) accumulates a lifetime consecutiveSlipCount across slips spread
  // over months. Only the LAST of these five slips (2026-08-20) actually
  // falls inside a 30-day lookback from asOfDate 2026-08-22; the other four
  // happened 2-3+ months earlier.
  recordSlip(store, "task-1", "2026-05-01");
  recordSlip(store, "task-1", "2026-05-15");
  recordSlip(store, "task-1", "2026-06-01");
  recordSlip(store, "task-1", "2026-06-15");
  recordSlip(store, "task-1", "2026-08-20");

  const patterns = queryColdMemoryPatterns(store, { asOfDate: "2026-08-22", lookbackDays: 30 });
  const slipPattern = patterns.find((p) => p.kind === "slip-streak" && p.taskId === "task-1");

  assert.ok(slipPattern, "the streak is still reported — it's recent (lastSlipDate is in-window), just not entirely IN the window");
  // The count (5) is real and must still be reported (it's an honest
  // lifetime count) — but must NOT be paired with an "in the last 30 days"
  // claim, since only 1 of the 5 slips actually happened in that window.
  assert.ok(
    !slipPattern.statement.includes("in the last 30 days"),
    `statement must not claim the count happened "in the last 30 days" when 4 of 5 slips predate that window: got "${slipPattern.statement}"`,
  );
  assert.ok(slipPattern.statement.includes("5"), "the honest lifetime count (5) must still appear somewhere in the statement");
  // The statement instead states the count as an undated lifetime streak,
  // paired with the one date the data can honestly support: lastSlipDate.
  assert.equal(slipPattern.statement, "Task task-1 has an active slip streak of 5 (most recently slipped on 2026-08-20).");
  store.close();
});

test("queryColdMemoryPatterns: 2 unchecked nights in the last month produce an accurate unchecked-nights pattern-statement", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putUncheckedDay(store, { date: "2026-08-01", rolledForwardTasks: [], recordedAt: "2026-08-02T13:00:00.000Z" });
  putUncheckedDay(store, { date: "2026-08-10", rolledForwardTasks: [], recordedAt: "2026-08-11T13:00:00.000Z" });

  const patterns = queryColdMemoryPatterns(store, { asOfDate: "2026-08-22" });

  const uncheckedPattern = patterns.find((p) => p.kind === "unchecked-nights");
  assert.ok(uncheckedPattern, "expected an unchecked-nights pattern");
  assert.equal(
    uncheckedPattern.statement,
    `2 nights were left unchecked in the last ${COLD_MEMORY_DEFAULT_LOOKBACK_DAYS} days.`,
  );
  store.close();
});

test("queryColdMemoryPatterns: singularizes 'night was' correctly when exactly one unchecked night is in range", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putUncheckedDay(store, { date: "2026-08-10", rolledForwardTasks: [], recordedAt: "2026-08-11T13:00:00.000Z" });

  const patterns = queryColdMemoryPatterns(store, { asOfDate: "2026-08-22" });
  const uncheckedPattern = patterns.find((p) => p.kind === "unchecked-nights");
  assert.equal(
    uncheckedPattern?.statement,
    `1 night was left unchecked in the last ${COLD_MEMORY_DEFAULT_LOOKBACK_DAYS} days.`,
  );
  store.close();
});

test("queryColdMemoryPatterns: a single (non-repeating) slip does not produce a 'pattern' — only genuine repeats (>= 2) are reported", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  recordSlip(store, "task-1", "2026-08-20");

  const patterns = queryColdMemoryPatterns(store, { asOfDate: "2026-08-22" });
  assert.equal(patterns.find((p) => p.taskId === "task-1"), undefined);
  store.close();
});

test("queryColdMemoryPatterns: a record older than the lookback window is excluded from the distillation", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  // 60 days before asOfDate — well outside the default 30-day lookback.
  putUncheckedDay(store, { date: "2026-06-23", rolledForwardTasks: [], recordedAt: "2026-06-24T13:00:00.000Z" });

  const patterns = queryColdMemoryPatterns(store, { asOfDate: "2026-08-22" });
  assert.equal(patterns.find((p) => p.kind === "unchecked-nights"), undefined);
  store.close();
});

test("queryColdMemoryPatterns: respects a caller-supplied lookbackDays narrower than the default", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putUncheckedDay(store, { date: "2026-08-10", rolledForwardTasks: [], recordedAt: "2026-08-11T13:00:00.000Z" }); // 12 days before asOfDate

  const wideWindow = queryColdMemoryPatterns(store, { asOfDate: "2026-08-22", lookbackDays: 30 });
  assert.ok(wideWindow.some((p) => p.kind === "unchecked-nights"), "sanity: visible within a 30-day window");

  const narrowWindow = queryColdMemoryPatterns(store, { asOfDate: "2026-08-22", lookbackDays: 5 });
  assert.equal(
    narrowWindow.find((p) => p.kind === "unchecked-nights"),
    undefined,
    "excluded once the lookback window no longer reaches back that far",
  );
  store.close();
});

test("queryColdMemoryPatterns: returns an empty array when there is no historical data at all", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  assert.deepEqual(queryColdMemoryPatterns(store, { asOfDate: "2026-08-22" }), []);
  store.close();
});

test("queryColdMemoryPatterns: multiple slipping Tasks each get their own accurate statement, ordered by taskId", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  recordSlip(store, "task-b", "2026-08-20");
  recordSlip(store, "task-b", "2026-08-21");
  recordSlip(store, "task-a", "2026-08-18");
  recordSlip(store, "task-a", "2026-08-19");
  recordSlip(store, "task-a", "2026-08-20");

  const patterns = queryColdMemoryPatterns(store, { asOfDate: "2026-08-22" });
  const slipStatements = patterns.filter((p) => p.kind === "slip-streak");
  assert.deepEqual(
    slipStatements.map((p) => p.taskId),
    ["task-a", "task-b"],
  );
  assert.equal(slipStatements[0]?.statement, "Task task-a has an active slip streak of 3 (most recently slipped on 2026-08-20).");
  assert.equal(slipStatements[1]?.statement, "Task task-b has an active slip streak of 2 (most recently slipped on 2026-08-21).");
  store.close();
});

// ----------------------------------------------------------------------------
// Exact lookback-window boundary (Important #3 fix: these were claimed in
// the original report but did not actually exist in the diff — added for
// real here). Uses the same `inWindow` cutoff both slip-streak and
// unchecked-nights patterns share: for asOfDate "2026-08-22" and the default
// 30-day lookback, cutoffDate = addDaysToIsoDate("2026-08-22", -29) =
// "2026-07-24".
// ----------------------------------------------------------------------------

test("queryColdMemoryPatterns: an UncheckedDay record dated EXACTLY at the lookback cutoff is INCLUDED (the window is inclusive of its own start)", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putUncheckedDay(store, { date: "2026-07-24", rolledForwardTasks: [], recordedAt: "2026-07-25T01:00:00.000Z" }); // exactly the cutoff date

  const patterns = queryColdMemoryPatterns(store, { asOfDate: "2026-08-22", lookbackDays: 30 });
  const uncheckedPattern = patterns.find((p) => p.kind === "unchecked-nights");
  assert.ok(uncheckedPattern, "a record dated exactly on the cutoff date must be included, not excluded");
  assert.equal(uncheckedPattern.statement, "1 night was left unchecked in the last 30 days.");
  store.close();
});

test("queryColdMemoryPatterns: an UncheckedDay record dated ONE DAY BEFORE the lookback cutoff is EXCLUDED", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  putUncheckedDay(store, { date: "2026-07-23", rolledForwardTasks: [], recordedAt: "2026-07-24T01:00:00.000Z" }); // one day before the cutoff

  const patterns = queryColdMemoryPatterns(store, { asOfDate: "2026-08-22", lookbackDays: 30 });
  assert.equal(
    patterns.find((p) => p.kind === "unchecked-nights"),
    undefined,
    "a record dated one day before the cutoff must be excluded",
  );
  store.close();
});

test("queryColdMemoryPatterns: a SlipHistory record whose lastSlipDate is EXACTLY at the lookback cutoff is INCLUDED", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  recordSlip(store, "task-1", "2026-07-20");
  recordSlip(store, "task-1", "2026-07-24"); // lastSlipDate exactly the cutoff date, count 2 (qualifies)

  const patterns = queryColdMemoryPatterns(store, { asOfDate: "2026-08-22", lookbackDays: 30 });
  const slipPattern = patterns.find((p) => p.kind === "slip-streak" && p.taskId === "task-1");
  assert.ok(slipPattern, "a lastSlipDate exactly on the cutoff date must be included, not excluded");
  assert.equal(slipPattern.statement, "Task task-1 has an active slip streak of 2 (most recently slipped on 2026-07-24).");
  store.close();
});

test("queryColdMemoryPatterns: a SlipHistory record whose lastSlipDate is ONE DAY BEFORE the lookback cutoff is EXCLUDED even with a qualifying count", () => {
  const store = createMemoryStore({ databasePath: tempDbPath() });
  recordSlip(store, "task-1", "2026-07-22");
  recordSlip(store, "task-1", "2026-07-23"); // lastSlipDate one day before the cutoff, count 2 (would otherwise qualify)

  const patterns = queryColdMemoryPatterns(store, { asOfDate: "2026-08-22", lookbackDays: 30 });
  assert.equal(
    patterns.find((p) => p.kind === "slip-streak" && p.taskId === "task-1"),
    undefined,
    "a lastSlipDate one day before the cutoff must be excluded even though consecutiveSlipCount (2) alone would qualify",
  );
  store.close();
});

// ----------------------------------------------------------------------------
// No ritual's routine daily operation queries cold memory (AC3).
// ----------------------------------------------------------------------------

test("STRUCTURAL (AC3): morning-ritual.ts, night-ritual.ts, and mid-day-reflow.ts never call queryColdMemoryPatterns — cold memory is on-demand only, not part of routine daily operation", () => {
  const ritualFiles = ["morning-ritual.ts", "night-ritual.ts", "mid-day-reflow.ts"];
  for (const file of ritualFiles) {
    const path = join(import.meta.dirname, "..", "src", "rituals", file);
    const contents = readFileSync(path, "utf8");
    assert.ok(
      !contents.includes("queryColdMemoryPatterns"),
      `${file} must not call queryColdMemoryPatterns as part of its routine ritual flow`,
    );
  }
});
