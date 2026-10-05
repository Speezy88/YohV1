/**
 * src/shell/backup-cli.ts
 *
 * Story 7.4, AD-7 + the Deployment & environments section: a nightly
 * cron-triggered one-shot (like `ritual-cli.ts`'s own subcommands, but its
 * own entry point — it isn't a ritual and touches no Notion/Calendar/LLM
 * adapter). Copies the SQLite file with `better-sqlite3`'s online backup
 * API (via `adapters/sqlite.ts` — AD-10's sole opener of the SQLite file;
 * this file never constructs a `better-sqlite3` database itself) to a
 * second, Spencer-configured location.
 * After a successful backup it keeps the newest `BACKUP_KEEP_COUNT` backup
 * files and the newest `OUTBOX_KEEP_ROWS` outbox rows.
 *
 * Controller ruling (SDD plan Task 4 notes): the backup target is read
 * from `YOH_BACKUP_PATH` and defaults to nothing. An unset target is a
 * loud failure through the same AD-7 alert path, never a silently-skipped
 * backup — Spencer names the real location during manual verification.
 */
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { openSqliteConnection } from "../adapters/sqlite.ts";
import { loadPushoverConfigFromEnv, sendPushoverNotification } from "../adapters/notification-adapter.ts";
import { writeStructuredLog } from "../adapters/logger.ts";
import { createNotification, initNotificationStoreSchema, OUTBOX_KEEP_ROWS, pruneOutbox } from "../adapters/notification-store.ts";

export type BackupResult = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string };

/** How many nightly backups are kept (Spencer, 2026-10-04). */
export const BACKUP_KEEP_COUNT = 14;

/** Only the names `runBackup` itself writes: `yoh-memory-YYYY-MM-DD.db`. */
const BACKUP_FILE_PATTERN = /^yoh-memory-\d{4}-\d{2}-\d{2}\.db$/;

/**
 * Deletes Yoh's own backup files in `targetDir` beyond the newest `keep` (by the date in the name); returns the
 * names removed. `justWritten` (a file name) counts toward `keep` but is never removed, so a clock that is
 * behind cannot make tonight's backup look like the oldest one.
 */
export function pruneBackups(targetDir: string, keep: number, justWritten?: string): string[] {
  const backups = readdirSync(targetDir).filter((name) => BACKUP_FILE_PATTERN.test(name) && name !== justWritten).sort();
  const keepOthers = justWritten === undefined ? keep : keep - 1;
  const stale = backups.slice(0, Math.max(0, backups.length - Math.max(0, keepOthers)));
  for (const name of stale) unlinkSync(`${targetDir}/${name}`);
  return stale;
}

/** Retention after a successful backup. A failure here is logged, never turned into a failed backup. */
function pruneAfterBackup(connection: ReturnType<typeof openSqliteConnection>, targetDir: string, justWritten: string): void {
  try {
    pruneBackups(targetDir, BACKUP_KEEP_COUNT, justWritten);
  } catch (err) {
    writeStructuredLog({ level: "error", event: "backup-cli.prune-backups-failed", detail: { message: err instanceof Error ? err.message : String(err) } });
  }
  try {
    const hasOutbox = connection.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'outbox'").get() !== undefined;
    if (hasOutbox) pruneOutbox(connection, { keep: OUTBOX_KEEP_ROWS });
  } catch (err) {
    writeStructuredLog({ level: "error", event: "backup-cli.prune-outbox-failed", detail: { message: err instanceof Error ? err.message : String(err) } });
  }
}

/**
 * Runs one online backup. `env`/`now` are injectable (tests use real temp
 * files — `better-sqlite3`'s backup API does real file I/O, so there's no
 * useful fake to inject for the copy itself).
 */
export async function runBackup(
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: () => Date = () => new Date(),
): Promise<BackupResult> {
  const sourcePath = env["MEMORY_DB_PATH"] || "./data/yoh-memory.db";
  const targetDir = env["YOH_BACKUP_PATH"];
  if (!targetDir) {
    return { ok: false, message: "backup-cli: missing required environment variable YOH_BACKUP_PATH — no backup target configured" };
  }

  let connection;
  try {
    connection = openSqliteConnection({ databasePath: sourcePath });
  } catch (err) {
    return { ok: false, message: `backup-cli: could not open the source database — ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    mkdirSync(targetDir, { recursive: true });
    const dateStamp = now().toISOString().slice(0, 10);
    const targetPath = `${targetDir}/yoh-memory-${dateStamp}.db`;
    await connection.db.backup(targetPath);
    pruneAfterBackup(connection, targetDir, `yoh-memory-${dateStamp}.db`);
    return { ok: true, path: targetPath };
  } catch (err) {
    return { ok: false, message: `backup-cli: online backup failed — ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    connection.close();
  }
}

/**
 * Sends the AD-7 alert pair for a backup-related failure: a Pushover alert
 * through the same channel `ritual-cli.ts`'s `createFailureAlertSender` uses
 * (a separate process — this file has no `RitualCliDeps` seam to reuse — so
 * it binds the Pushover adapter directly), AND an `operational` in-app
 * notification through `notification-store.ts` (AD-7's Phase 2 revision:
 * every alert condition — including a backup failure — also appends one).
 * The two are independent, each in its own try/catch: a
 * `notification-store.ts` write failure must never suppress the Pushover
 * send (the channel that doesn't depend on the server being up), and a
 * Pushover failure must not skip the in-app notification either. Never
 * throws: a failure to send either is caught and logged rather than
 * escaping to the caller.
 *
 * Shared by `main`'s own ordinary failure path (Task 4) AND `runEntry`'s
 * catch-all below (Controller ruling R12, fix round 1) — the SAME alert
 * pair either way, per AD-9, whether the failure is an expected `Result`
 * failure `main` observed directly or an unexpected thrown error `runEntry`
 * caught from entirely outside `main`'s own try/catches.
 */
async function alertBackupFailure(env: Readonly<Record<string, string | undefined>>, title: string, message: string): Promise<void> {
  try {
    const pushoverConfig = loadPushoverConfigFromEnv(env);
    await sendPushoverNotification(pushoverConfig, { title, message });
  } catch (err) {
    process.stderr.write(`backup-cli: also failed to send the Pushover alert — ${err instanceof Error ? err.message : String(err)}\n`);
  }
  try {
    const connection = openSqliteConnection({ databasePath: env["MEMORY_DB_PATH"] || "./data/yoh-memory.db" });
    try {
      initNotificationStoreSchema(connection.db);
      createNotification(connection, { kind: "operational", title, body: message, deepLink: null, createdAt: new Date().toISOString() });
    } finally {
      connection.close();
    }
  } catch (err) {
    process.stderr.write(`backup-cli: also failed to write the operational in-app notification — ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

/**
 * Real entrypoint: runs the backup, prints the result, and on failure raises
 * both AD-7 alerts via `alertBackupFailure` above. Never throws itself —
 * `runBackup` already catches everything it does — but see `runEntry` below
 * for the outer safety net covering anything unexpected that escapes this
 * function anyway.
 */
export async function main(env: Readonly<Record<string, string | undefined>> = process.env): Promise<number> {
  const result = await runBackup(env);
  if (result.ok) {
    process.stdout.write(`backup-cli: backed up to ${result.path}\n`);
    return 0;
  }

  process.stderr.write(`backup-cli: ${result.message}\n`);
  await alertBackupFailure(env, "Meeseek: nightly backup failed", result.message);
  return 1;
}

/**
 * Controller ruling R12 (fix round 1, AD-7 wins): the top-level entry needs
 * the same "wraps its entire invocation" guarantee `ritual-cli.ts`'s own
 * `main().then().catch()` block has (`src/shell/ritual-cli.ts`'s
 * `import.meta.main` block) — but unlike that block (which only logs and
 * exits non-zero on an unexpected throw), THIS one also raises both AD-7
 * alerts on the way out, since `backup-cli.ts` has no `withFailureAlert`
 * wrapper of its own to fall back on and an unhandled rejection here would
 * otherwise crash silently: no Pushover alert, no operational notification,
 * nobody told.
 *
 * `runMain` is injected (defaults to the real `main`) so this is testable
 * without needing `runBackup` itself to somehow throw past its own
 * exhaustive internal try/catches — a test injects a `runMain` that throws
 * directly, standing in for "any unexpected bug escapes `main` anyway."
 */
export async function runEntry(
  runMain: () => Promise<number> = () => main(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  try {
    return await runMain();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`backup-cli: fatal error: ${message}\n`);
    await alertBackupFailure(env, "Meeseek: nightly backup failed", `backup-cli: unexpected error — ${message}`);
    return 1;
  }
}

if (import.meta.main) {
  runEntry().then((code) => process.exit(code));
}
