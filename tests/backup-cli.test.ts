/**
 * Tests for `src/shell/backup-cli.ts` (Story 7.4, AD-7 + Deployment
 * section). Uses real temp files — `better-sqlite3`'s online backup API
 * does real file I/O, so there's no useful fake to inject here, mirroring
 * how `tests/token-store.test.ts` already uses a real temp file for its
 * own on-disk persistence tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { listUnreadNotifications } from "../src/adapters/notification-store.ts";
import { main, runBackup, runEntry } from "../src/shell/backup-cli.ts";

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
