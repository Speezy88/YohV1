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
  type InteractionRequest,
} from "../src/adapters/memory-store.ts";

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
