/**
 * Tests for `src/adapters/sqlite.ts` (Story 7.1, AD-10).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";

/**
 * A real, file-backed database path in a fresh temp directory. WAL mode is
 * a genuine SQLite limitation on `:memory:` databases — SQLite silently
 * keeps `:memory:` connections on its own `memory` journal mode no matter
 * what `PRAGMA journal_mode` is requested (verified directly against
 * `better-sqlite3`, not merely assumed) — so the WAL assertion below needs
 * an actual file, matching how `openSqliteConnection` is really used in
 * production (`MEMORY_DB_PATH` is always a real file path; `:memory:` is
 * reserved for ephemeral test isolation elsewhere in this suite).
 */
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "yoh-sqlite-test-"));
  return join(dir, "yoh.db");
}

test("openSqliteConnection opens WAL mode, a busy_timeout, and foreign_keys on", () => {
  const conn = openSqliteConnection({ databasePath: tempDbPath() });
  assert.equal(conn.db.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(conn.db.pragma("busy_timeout", { simple: true }), 5000);
  assert.equal(conn.db.pragma("foreign_keys", { simple: true }), 1);
  conn.close();
});

test("writeTx commits fn's writes on success", () => {
  const conn = openSqliteConnection({ databasePath: ":memory:" });
  conn.db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  conn.writeTx((db) => {
    db.prepare("INSERT INTO t (id) VALUES (1)").run();
  });
  assert.equal(conn.db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM t").get()?.n, 1);
  conn.close();
});

test("writeTx rolls back fn's writes if fn throws, and rethrows", () => {
  const conn = openSqliteConnection({ databasePath: ":memory:" });
  conn.db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  assert.throws(() => {
    conn.writeTx((db) => {
      db.prepare("INSERT INTO t (id) VALUES (1)").run();
      throw new Error("boom");
    });
  }, /boom/);
  assert.equal(conn.db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM t").get()?.n, 0);
  conn.close();
});

test("writeTx returns fn's return value", () => {
  const conn = openSqliteConnection({ databasePath: ":memory:" });
  const result = conn.writeTx(() => 42);
  assert.equal(result, 42);
  conn.close();
});

test("AD-10: adapters/sqlite.ts is the only src/ file that constructs a better-sqlite3 database", () => {
  const offenders: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      if (full.endsWith("src/adapters/sqlite.ts")) continue;
      const contents = readFileSync(full, "utf8");
      if (/new\s+Database\s*\(/.test(contents)) offenders.push(full);
    }
  }

  walk(join(import.meta.dirname, "..", "src"));
  assert.deepEqual(offenders, [], "only adapters/sqlite.ts may call `new Database(...)`");
});
