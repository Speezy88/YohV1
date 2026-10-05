/**
 * Tests for `src/shell/backup-cli.ts` (Story 7.4, AD-7 + Deployment
 * section). Uses real temp files — `better-sqlite3`'s online backup API
 * does real file I/O, so there's no useful fake to inject here, mirroring
 * how `tests/token-store.test.ts` already uses a real temp file for its
 * own on-disk persistence tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { appendOutboxInTx, initNotificationStoreSchema, listUnreadNotifications, OUTBOX_KEEP_ROWS, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { BACKUP_KEEP_COUNT, main, pruneBackups, runBackup, runEntry } from "../src/shell/backup-cli.ts";

test("runBackup copies the SQLite file to YOH_BACKUP_PATH, named by today's date", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yoh-backup-src-"));
  const backupDir = mkdtempSync(join(tmpdir(), "yoh-backup-dst-"));
  const sourcePath = join(dir, "source.db");
  const conn = openSqliteConnection({ databasePath: sourcePath });
  conn.db.exec("CREATE TABLE t (id INTEGER)");
  conn.close();

  const result = await runBackup({ MEMORY_DB_PATH: sourcePath, YOH_BACKUP_PATH: backupDir }, () => new Date("2026-09-25T03:00:00.000Z"));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.path, join(backupDir, "yoh-memory-2026-09-25.db"));
  assert.ok(existsSync(result.path));

  // A genuine online backup, not a placeholder file: it's a valid SQLite
  // database that already contains the source's schema.
  const backupConn = openSqliteConnection({ databasePath: result.path });
  const tables = backupConn.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t'").all();
  assert.equal(tables.length, 1);
  backupConn.close();
});

test("runBackup fails loudly, with no backup attempted, when YOH_BACKUP_PATH is unset", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yoh-backup-src-"));
  const sourcePath = join(dir, "source.db");
  openSqliteConnection({ databasePath: sourcePath }).close();

  const result = await runBackup({ MEMORY_DB_PATH: sourcePath });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /YOH_BACKUP_PATH/);
});

test("main() on a backup failure also raises an operational in-app notification, even when the Pushover send itself fails (AD-7)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yoh-backup-src-"));
  const sourcePath = join(dir, "source.db");
  openSqliteConnection({ databasePath: sourcePath }).close();

  const originalErr = process.stderr.write;
  const stderrChunks: string[] = [];
  process.stderr.write = ((chunk: string) => {
    stderrChunks.push(chunk);
    return true;
  }) as typeof process.stderr.write;

  let code: number;
  try {
    // No YOH_BACKUP_PATH (the backup fails) and no Pushover credentials
    // (the alert SEND itself also fails) — proves the in-app notification
    // still gets written regardless.
    code = await main({ MEMORY_DB_PATH: sourcePath });
  } finally {
    process.stderr.write = originalErr;
  }

  assert.equal(code, 1);
  assert.ok(stderrChunks.some((l) => /YOH_BACKUP_PATH/.test(l)));
  assert.ok(stderrChunks.some((l) => /failed to send the Pushover alert/.test(l)));

  const connection = openSqliteConnection({ databasePath: sourcePath });
  const unread = listUnreadNotifications(connection);
  assert.equal(unread.length, 1);
  assert.equal(unread[0]!.kind, "operational");
  assert.match(unread[0]!.title, /backup failed/i);
  assert.equal(unread[0]!.deepLink, null);
  connection.close();
});

test("runEntry catches an unexpected throw from main, sends both AD-7 alerts, and returns a non-zero exit code (Controller ruling R12, fix round 1)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yoh-backup-src-"));
  const sourcePath = join(dir, "source.db");
  openSqliteConnection({ databasePath: sourcePath }).close();

  const originalErr = process.stderr.write;
  const stderrChunks: string[] = [];
  process.stderr.write = ((chunk: string) => {
    stderrChunks.push(chunk);
    return true;
  }) as typeof process.stderr.write;

  let code: number;
  try {
    // Stands in for "an unexpected bug escapes main() entirely" — runBackup
    // itself already catches everything it does, so this is the only way to
    // exercise the OUTER safety net without a real crash.
    code = await runEntry(
      () => {
        throw new Error("unexpected: something broke outside runBackup's own try/catches");
      },
      { MEMORY_DB_PATH: sourcePath }, // no PUSHOVER_* creds either — the alert SEND itself also fails
    );
  } finally {
    process.stderr.write = originalErr;
  }

  assert.equal(code, 1, "an unexpected throw must still exit non-zero, never crash the process silently");
  assert.ok(stderrChunks.some((l) => /fatal error/.test(l)));
  assert.ok(stderrChunks.some((l) => /failed to send the Pushover alert/.test(l)), "the Pushover send was attempted (and, with no creds configured, logged as failed) — not skipped");

  const connection = openSqliteConnection({ databasePath: sourcePath });
  const unread = listUnreadNotifications(connection);
  assert.equal(unread.length, 1, "the operational in-app notification must still be written even though the crash happened outside main's own try/catches");
  assert.equal(unread[0]!.kind, "operational");
  assert.match(unread[0]!.body, /unexpected: something broke/);
  connection.close();
});

test("runEntry returns main()'s own exit code unchanged when nothing unexpected happens", async () => {
  const code = await runEntry(async () => 0);
  assert.equal(code, 0);
});

test("runBackup reports failure (never throws) when the backup target directory can't be created", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yoh-backup-src-"));
  const sourcePath = join(dir, "source.db");
  openSqliteConnection({ databasePath: sourcePath }).close();

  // A regular FILE (not a directory) as the "directory" target — mkdirSync
  // recursive over it throws ENOTDIR, which runBackup must turn into a
  // Result failure, not an unhandled rejection.
  const blockerPath = join(dir, "not-a-dir");
  openSqliteConnection({ databasePath: blockerPath }).close();

  const result = await runBackup({ MEMORY_DB_PATH: sourcePath, YOH_BACKUP_PATH: join(blockerPath, "nested") });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /backup-cli/);
});

// ---- retention (audit fix-first, Task 5) -----------------------------------

function backupDirWith(names: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "yoh-backup-prune-"));
  for (const name of names) writeFileSync(join(dir, name), "x");
  return dir;
}

test("pruneBackups keeps the newest N of Meeseek's own backup files and never touches other files", () => {
  const dir = backupDirWith([
    "yoh-memory-2026-09-20.db", "yoh-memory-2026-09-21.db", "yoh-memory-2026-09-22.db", "yoh-memory-2026-09-23.db",
    "notes.txt", "yoh-memory-old.db", "yoh-memory-2026-09-19.db.bak", "other-2026-09-01.db",
  ]);
  assert.deepEqual(pruneBackups(dir, 2), ["yoh-memory-2026-09-20.db", "yoh-memory-2026-09-21.db"]);
  assert.deepEqual(readdirSync(dir).sort(), [
    "notes.txt", "other-2026-09-01.db", "yoh-memory-2026-09-19.db.bak", "yoh-memory-2026-09-22.db", "yoh-memory-2026-09-23.db", "yoh-memory-old.db",
  ]);
});

test("the retention defaults are 14 backups and 10,000 outbox rows", () => {
  assert.equal(BACKUP_KEEP_COUNT, 14);
  assert.equal(OUTBOX_KEEP_ROWS, 10_000);
});

function sourceWithHints(count: number): string {
  const sourcePath = join(mkdtempSync(join(tmpdir(), "yoh-backup-src-")), "source.db");
  const conn = openSqliteConnection({ databasePath: sourcePath });
  initNotificationStoreSchema(conn.db);
  conn.writeTx((db) => {
    for (let i = 0; i < count; i += 1) appendOutboxInTx(db, { topic: "plan", entityId: "" });
  });
  conn.close();
  return sourcePath;
}

test("a successful backup prunes older backups beyond the newest 14 and old outbox rows", async () => {
  const names = Array.from({ length: 16 }, (_, i) => `yoh-memory-2026-09-${String(i + 1).padStart(2, "0")}.db`);
  const backupDir = backupDirWith(names);
  const sourcePath = sourceWithHints(OUTBOX_KEEP_ROWS + 5);
  const result = await runBackup({ MEMORY_DB_PATH: sourcePath, YOH_BACKUP_PATH: backupDir }, () => new Date("2026-09-25T03:00:00.000Z"));
  assert.equal(result.ok, true);
  const left = readdirSync(backupDir).sort();
  assert.equal(left.length, 14);
  assert.equal(left[0], "yoh-memory-2026-09-04.db");
  assert.equal(left[13], "yoh-memory-2026-09-25.db");
  const conn = openSqliteConnection({ databasePath: sourcePath });
  assert.equal(tailOutboxSince(conn, 0).length, OUTBOX_KEEP_ROWS);
  conn.close();
});

test("a failed backup prunes nothing", async () => {
  const names = Array.from({ length: 16 }, (_, i) => `yoh-memory-2026-09-${String(i + 1).padStart(2, "0")}.db`);
  const backupDir = backupDirWith(names);
  const sourcePath = sourceWithHints(OUTBOX_KEEP_ROWS + 5);
  // Today's target path is a directory, so the online backup itself fails.
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(backupDir, "yoh-memory-2026-09-25.db"));
  const result = await runBackup({ MEMORY_DB_PATH: sourcePath, YOH_BACKUP_PATH: backupDir }, () => new Date("2026-09-25T03:00:00.000Z"));
  assert.equal(result.ok, false);
  assert.equal(readdirSync(backupDir).length, 17);
  const conn = openSqliteConnection({ databasePath: sourcePath });
  assert.equal(tailOutboxSince(conn, 0).length, OUTBOX_KEEP_ROWS + 5);
  conn.close();
});

test("a source database with no outbox table still backs up", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yoh-backup-src-"));
  const sourcePath = join(dir, "source.db");
  const conn = openSqliteConnection({ databasePath: sourcePath });
  conn.db.exec("CREATE TABLE t (id INTEGER)");
  conn.close();
  const result = await runBackup({ MEMORY_DB_PATH: sourcePath, YOH_BACKUP_PATH: mkdtempSync(join(tmpdir(), "yoh-backup-dst-")) }, () => new Date("2026-09-25T03:00:00.000Z"));
  assert.equal(result.ok, true);
});

test("the backup just written is never pruned, even when the clock is behind and its date sorts oldest", async () => {
  const names = Array.from({ length: 16 }, (_, i) => `yoh-memory-2026-09-${String(i + 1).padStart(2, "0")}.db`);
  const backupDir = backupDirWith(names);
  const result = await runBackup({ MEMORY_DB_PATH: sourceWithHints(1), YOH_BACKUP_PATH: backupDir }, () => new Date("2026-01-01T03:00:00.000Z"));
  assert.equal(result.ok, true);
  const left = readdirSync(backupDir).sort();
  assert.equal(left.length, 14);
  assert.equal(left[0], "yoh-memory-2026-01-01.db");
  assert.equal(left[1], "yoh-memory-2026-09-04.db");
});
