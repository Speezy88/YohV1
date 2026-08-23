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
import { createMemoryStore, ConflictError } from "../src/adapters/memory-store.ts";

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "yoh-memory-store-test-"));
  return join(dir, "yoh-memory.db");
}

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
