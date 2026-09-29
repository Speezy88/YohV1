/**
 * src/adapters/plan-state-store.ts
 *
 * Story 7.4, AD-7/AD-10: created with a heartbeat table. The heartbeat is
 * a single-row singleton: "is the server alive" has exactly one current
 * answer, never a history.
 *
 * Story 7.10, AD-20: adds the `pending_check_offs` table (one owner,
 * dedicated table, created idempotently) and the ONE defining export of
 * the undo window, `UNDO_WINDOW_MS`. A record's lifecycle is tracked by
 * nullable columns rather than a status enum:
 *
 *   - `committed_at IS NULL` — still inside its undo window (or held):
 *     Undo may delete it; the commit sweep claims it once `commit_at` passes.
 *   - `held_since IS NOT NULL` — the Undo Toast is hovered/focused (WCAG
 *     2.2.1): never due while held; on release `commit_at` shifts forward
 *     by exactly the held duration. A hold older than `CHECK_OFF_MAX_HOLD_MS`
 *     is ignored, so a tab closed mid-hover can never strand a check-off.
 *   - `committed_at IS NOT NULL AND notion_sync_pending = 1` — the
 *     Completion Log entry is written (claimed in the SAME transaction as
 *     `recordCompletionInTx`, so a retry can never re-run it); the Notion
 *     Status write is still owed, retried from `notion_retry_at` on.
 *
 * The row is deleted on Undo, or once Notion is in sync.
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { SqliteConnection } from "./sqlite.ts";
import type { DayPin, ExternalId } from "../types/domain.ts";

/** How often `shell/server.ts` writes a heartbeat (Shared tuning constants convention — the one defining export). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** How old a heartbeat must be before `ritual-cli.ts morning` treats the server as down (AD-7). Comfortably larger than `HEARTBEAT_INTERVAL_MS` so ordinary GC pauses/poll jitter never false-alarm. */
export const HEARTBEAT_STALE_THRESHOLD_MS = 300_000;

const HEARTBEAT_ROW_ID = 1;

/**
 * The undo window (AD-20, `[ASSUMPTION: ~5 s, UX]`) — the ONE defining
 * export of this shared tuning constant. Every check-off response carries
 * the real `commitAt`, so the client never redeclares it.
 */
export const UNDO_WINDOW_MS = 5000;

/**
 * The longest a hover/focus hold pauses a pending check-off. Past this, the
 * hold is treated as abandoned (tab closed, device asleep mid-hover) and the
 * record commits anyway — AD-20: the commit never depends on the browser.
 */
export const CHECK_OFF_MAX_HOLD_MS = 600_000;

export function initPlanStateStoreSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS heartbeat (id INTEGER PRIMARY KEY CHECK (id = ${HEARTBEAT_ROW_ID}), at TEXT NOT NULL)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_check_offs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      commit_at TEXT NOT NULL,
      held_since TEXT,
      committed_at TEXT,
      notion_sync_pending INTEGER NOT NULL DEFAULT 0,
      notion_failure_notified INTEGER NOT NULL DEFAULT 0,
      notion_retry_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pending_check_offs_commit_at ON pending_check_offs (committed_at, commit_at);
  `);
  ensureDayPinTables(db);
}

// ---------------------------------------------------------------------------
// Day pins and drops (Epic 10): per-day placements Spencer fixed by hand.
// ---------------------------------------------------------------------------

const dayPinTablesReady = new WeakSet<Database.Database>();

/** Creates the tables once per database handle, so callers that never ran `initPlanStateStoreSchema` still work without repeating DDL on every read. */
function ensureDayPinTables(db: Database.Database): void {
  if (dayPinTablesReady.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS day_pins (
      date TEXT NOT NULL,
      subject_kind TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      start TEXT NOT NULL,
      PRIMARY KEY (date, subject_kind, subject_id)
    );
    CREATE TABLE IF NOT EXISTS day_drops (
      date TEXT NOT NULL,
      task_id TEXT NOT NULL,
      PRIMARY KEY (date, task_id)
    );
  `);
  dayPinTablesReady.add(db);
}

/** The day's pins; other dates are never returned. */
export function listDayPins(db: Database.Database, date: string): DayPin[] {
  ensureDayPinTables(db);
  const rows = db
    .prepare("SELECT subject_kind, subject_id, start FROM day_pins WHERE date = ? ORDER BY start, subject_id")
    .all(date) as { subject_kind: string; subject_id: string; start: string }[];
  return rows.map((r) => ({
    date,
    subject: r.subject_kind === "routine" ? { kind: "routine" as const, routineId: r.subject_id } : { kind: "task" as const, taskId: r.subject_id },
    start: r.start,
  }));
}

/** The Task ids dropped for the day. */
export function listDayDrops(db: Database.Database, date: string): ExternalId[] {
  ensureDayPinTables(db);
  return (db.prepare("SELECT task_id FROM day_drops WHERE date = ? ORDER BY task_id").all(date) as { task_id: string }[]).map((r) => r.task_id);
}

/** Replaces one date's pins and drops. Runs inside the caller's transaction; other dates are untouched. */
export function replaceDayPinsAndDropsInTx(
  db: Database.Database,
  date: string,
  pins: readonly DayPin[],
  drops: readonly ExternalId[],
): void {
  ensureDayPinTables(db);
  db.prepare("DELETE FROM day_pins WHERE date = ?").run(date);
  db.prepare("DELETE FROM day_drops WHERE date = ?").run(date);
  const insertPin = db.prepare("INSERT INTO day_pins (date, subject_kind, subject_id, start) VALUES (?, ?, ?, ?)");
  for (const pin of pins) {
    insertPin.run(date, pin.subject.kind, pin.subject.kind === "task" ? pin.subject.taskId : pin.subject.routineId, pin.start);
  }
  const insertDrop = db.prepare("INSERT OR IGNORE INTO day_drops (date, task_id) VALUES (?, ?)");
  for (const taskId of drops) insertDrop.run(date, taskId);
}

/** Upserts the singleton heartbeat row — the latest write replaces, never appends. */
export function writeHeartbeat(connection: SqliteConnection, at: string): void {
  connection.db
    .prepare(`INSERT INTO heartbeat (id, at) VALUES (${HEARTBEAT_ROW_ID}, @at) ON CONFLICT(id) DO UPDATE SET at = @at`)
    .run({ at });
}

/** The last-written heartbeat timestamp, or `undefined` if none has ever been written (cold start — treated as stale by `isHeartbeatStale`). */
export function getLastHeartbeatAt(connection: SqliteConnection): string | undefined {
  const row = connection.db.prepare(`SELECT at FROM heartbeat WHERE id = ${HEARTBEAT_ROW_ID}`).get() as { at: string } | undefined;
  return row?.at;
}

/**
 * Pure staleness check (AD-2's spirit, applied here even though this file
 * is `adapters/*`, not `core/*`, since it takes no I/O itself): `undefined`
 * (never written) is always stale — the ordinary, expected state before
 * the server has ever run once, and indistinguishable from "it's been down
 * the whole time" from `ritual-cli.ts`'s point of view, so both alert.
 */
export function isHeartbeatStale(
  lastHeartbeatAt: string | undefined,
  now: Date,
  thresholdMs: number = HEARTBEAT_STALE_THRESHOLD_MS,
): boolean {
  if (lastHeartbeatAt === undefined) return true;
  return now.getTime() - new Date(lastHeartbeatAt).getTime() > thresholdMs;
}

// ============================================================================
// Pending check-offs (Story 7.10, AD-20)
// ============================================================================

export interface PendingCheckOff {
  readonly id: string;
  readonly taskId: string;
  /** The label the check-off was made under (today's Plan row), for the log snapshot's fallback and any failure notice. */
  readonly taskName: string;
  /** ISO-8601 UTC — the click instant (AD-20), never the later commit time. */
  readonly completedAt: string;
  /** ISO-8601 UTC — `completedAt + UNDO_WINDOW_MS`, shifted forward by any released hold. */
  readonly commitAt: string;
  readonly heldSince?: string;
  readonly committedAt?: string;
  readonly notionSyncPending: boolean;
  readonly notionRetryAt?: string;
}

export interface CreatePendingCheckOffInput {
  readonly taskId: string;
  readonly taskName: string;
  readonly completedAt: string;
}

interface PendingCheckOffRow {
  readonly id: string;
  readonly task_id: string;
  readonly task_name: string;
  readonly completed_at: string;
  readonly commit_at: string;
  readonly held_since: string | null;
  readonly committed_at: string | null;
  readonly notion_sync_pending: number;
  readonly notion_failure_notified: number;
  readonly notion_retry_at: string | null;
}

function toPendingCheckOff(row: PendingCheckOffRow): PendingCheckOff {
  return {
    id: row.id,
    taskId: row.task_id,
    taskName: row.task_name,
    completedAt: row.completed_at,
    commitAt: row.commit_at,
    ...(row.held_since !== null ? { heldSince: row.held_since } : {}),
    ...(row.committed_at !== null ? { committedAt: row.committed_at } : {}),
    notionSyncPending: row.notion_sync_pending === 1,
    ...(row.notion_retry_at !== null ? { notionRetryAt: row.notion_retry_at } : {}),
  };
}

function selectById(db: Database.Database, id: string): PendingCheckOffRow | undefined {
  return db.prepare<{ id: string }, PendingCheckOffRow>(`SELECT * FROM pending_check_offs WHERE id = @id`).get({ id });
}

/** The hold-staleness cutoff for `now`: a hold that started at or before this no longer pauses the record. */
function staleHoldCutoff(now: Date): string {
  return new Date(now.getTime() - CHECK_OFF_MAX_HOLD_MS).toISOString();
}

const DUE_CONDITION = `committed_at IS NULL AND commit_at <= @now AND (held_since IS NULL OR held_since <= @staleHold)`;

/** Inserts one pending check-off (call inside a `writeTx`, alongside its outbox hint). Returns the stored record. */
export function createPendingCheckOffInTx(db: Database.Database, input: CreatePendingCheckOffInput): PendingCheckOff {
  const id = randomUUID();
  const commitAt = new Date(Date.parse(input.completedAt) + UNDO_WINDOW_MS).toISOString();
  db.prepare(
    `INSERT INTO pending_check_offs (id, task_id, task_name, completed_at, commit_at)
     VALUES (@id, @taskId, @taskName, @completedAt, @commitAt)`,
  ).run({ id, taskId: input.taskId, taskName: input.taskName, completedAt: input.completedAt, commitAt });
  return toPendingCheckOff(selectById(db, id)!);
}

export function getPendingCheckOff(connection: SqliteConnection, id: string): PendingCheckOff | undefined {
  const row = selectById(connection.db, id);
  return row ? toPendingCheckOff(row) : undefined;
}

/** The Task's still-undoable pending check-off, if any — so a repeated check of the same Task never creates a second completion. */
export function findUncommittedCheckOffForTask(connection: SqliteConnection, taskId: string): PendingCheckOff | undefined {
  const row = connection.db
    .prepare<{ taskId: string }, PendingCheckOffRow>(
      `SELECT * FROM pending_check_offs WHERE task_id = @taskId AND committed_at IS NULL ORDER BY completed_at DESC LIMIT 1`,
    )
    .get({ taskId });
  return row ? toPendingCheckOff(row) : undefined;
}

/**
 * Undo (AD-20): deletes the record only while it is still uncommitted —
 * atomically, so an Undo racing the commit sweep either wins outright or
 * reports `"committed"`, never half of each.
 */
export function deleteUncommittedCheckOffInTx(db: Database.Database, id: string): "deleted" | "committed" | "missing" {
  const changes = db.prepare(`DELETE FROM pending_check_offs WHERE id = @id AND committed_at IS NULL`).run({ id }).changes;
  if (changes === 1) return "deleted";
  return selectById(db, id) ? "committed" : "missing";
}

/** Holds an uncommitted record (hover/focus). A second hold keeps the first one's start. `undefined` if missing or already committed. */
export function holdPendingCheckOff(connection: SqliteConnection, id: string, at: string): PendingCheckOff | undefined {
  return connection.writeTx((db) => {
    db.prepare(`UPDATE pending_check_offs SET held_since = COALESCE(held_since, @at) WHERE id = @id AND committed_at IS NULL`).run({ id, at });
    const row = selectById(db, id);
    return row && row.committed_at === null ? toPendingCheckOff(row) : undefined;
  });
}

/**
 * Releases a hold, shifting `commit_at` forward by exactly the held
 * duration, so the window resumes with the time it had left. A release
 * without a hold is a no-op. `undefined` if missing or already committed.
 */
export function releasePendingCheckOff(connection: SqliteConnection, id: string, at: string): PendingCheckOff | undefined {
  return connection.writeTx((db) => {
    const row = selectById(db, id);
    if (!row || row.committed_at !== null) return undefined;
    if (row.held_since === null) return toPendingCheckOff(row);
    const heldMs = Math.max(0, Date.parse(at) - Date.parse(row.held_since));
    const commitAt = new Date(Date.parse(row.commit_at) + heldMs).toISOString();
    db.prepare(`UPDATE pending_check_offs SET held_since = NULL, commit_at = @commitAt WHERE id = @id`).run({ id, commitAt });
    return toPendingCheckOff(selectById(db, id)!);
  });
}

/** Uncommitted records whose window has elapsed and that aren't (freshly) held, oldest first. */
export function listDueCheckOffs(connection: SqliteConnection, now: Date): PendingCheckOff[] {
  return connection.db
    .prepare<{ now: string; staleHold: string }, PendingCheckOffRow>(`SELECT * FROM pending_check_offs WHERE ${DUE_CONDITION} ORDER BY commit_at`)
    .all({ now: now.toISOString(), staleHold: staleHoldCutoff(now) })
    .map(toPendingCheckOff);
}

/**
 * Claims a record for commit: marks it committed with the Notion sync owed,
 * ONLY if it is still due (not undone, not freshly held, not already
 * claimed). Call inside the same `writeTx` as `recordCompletionInTx`, so the
 * log entry and the claim commit together — `true` means "write the log
 * entry now"; `false` means someone else got there first. `notionLeaseUntil`
 * keeps the retry sweep off this record while the claimer makes its own
 * first Notion attempt.
 */
export function claimDueCheckOffInTx(db: Database.Database, id: string, now: Date, notionLeaseUntil: string): boolean {
  return (
    db
      .prepare(
        `UPDATE pending_check_offs SET committed_at = @now, notion_sync_pending = 1, held_since = NULL, notion_retry_at = @lease
         WHERE id = @id AND ${DUE_CONDITION}`,
      )
      .run({ id, now: now.toISOString(), staleHold: staleHoldCutoff(now), lease: notionLeaseUntil }).changes === 1
  );
}

/**
 * Claims a committed record's Notion retry: pushes its retry time out to
 * `leaseUntil`, ONLY if the retry is due now — so two overlapping sweeps
 * never both write Notion for the same record.
 */
export function leaseNotionRetryInTx(db: Database.Database, id: string, now: Date, leaseUntil: string): boolean {
  return (
    db
      .prepare(
        `UPDATE pending_check_offs SET notion_retry_at = @lease
         WHERE id = @id AND committed_at IS NOT NULL AND notion_sync_pending = 1 AND (notion_retry_at IS NULL OR notion_retry_at <= @now)`,
      )
      .run({ id, now: now.toISOString(), lease: leaseUntil }).changes === 1
  );
}

/** Committed records still owing their Notion Status write, whose retry time (if any) has arrived. */
export function listNotionSyncDueCheckOffs(connection: SqliteConnection, now: Date): PendingCheckOff[] {
  return connection.db
    .prepare<{ now: string }, PendingCheckOffRow>(
      `SELECT * FROM pending_check_offs
       WHERE committed_at IS NOT NULL AND notion_sync_pending = 1 AND (notion_retry_at IS NULL OR notion_retry_at <= @now)
       ORDER BY committed_at`,
    )
    .all({ now: now.toISOString() })
    .map(toPendingCheckOff);
}

/**
 * Records a failed Notion Status write and when to retry it. Returns `true`
 * only the first time for this record — the caller raises its one
 * `operational` notification on `true` and stays quiet on later failures.
 */
export function markNotionSyncFailedInTx(db: Database.Database, id: string, retryAt: string): boolean {
  const before = selectById(db, id);
  if (!before) return false;
  db.prepare(`UPDATE pending_check_offs SET notion_retry_at = @retryAt, notion_failure_notified = 1 WHERE id = @id`).run({ id, retryAt });
  return before.notion_failure_notified === 0;
}

/** Deletes a record once its Notion Status write has succeeded — nothing more is owed. */
export function removePendingCheckOff(connection: SqliteConnection, id: string): void {
  connection.db.prepare(`DELETE FROM pending_check_offs WHERE id = @id`).run({ id });
}
