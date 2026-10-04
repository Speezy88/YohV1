/**
 * What Yoh last wrote to the "Yoh Plan" Google calendar, per local date: one
 * row per calendar event with the plan block it was written from. Lets a later
 * read tell Yoh's own events from ones Spencer moved or added.
 */
import type Database from "better-sqlite3";
import type { PlanBlock, PlanCalendarSnapshotEntry } from "../types/domain.ts";
import type { SqliteConnection } from "./sqlite.ts";

export type { PlanCalendarSnapshotEntry };

/** A write that began less than this long ago is treated as still in flight (a crashed writer's marker goes stale). */
export const PLAN_CALENDAR_WRITE_FRESH_MS = 5 * 60_000;

/** Whether Yoh is writing the Yoh Plan calendar for a date: `writingSince` is set and younger than the freshness window. */
export interface PlanCalendarWriteState {
  readonly writingSince?: string;
  readonly writtenAt?: string;
}

const tablesReady = new WeakSet<Database.Database>();

function ensureSnapshotTable(db: Database.Database): void {
  if (tablesReady.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_calendar_snapshot (
      date TEXT NOT NULL,
      event_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      task_id TEXT,
      routine_id TEXT,
      start TEXT NOT NULL,
      end TEXT NOT NULL,
      PRIMARY KEY (date, event_id)
    );
    CREATE TABLE IF NOT EXISTS plan_calendar_write_state (
      date TEXT PRIMARY KEY,
      writing_since TEXT,
      written_at TEXT
    );
  `);
  tablesReady.add(db);
}

/** The snapshot entries for one date. */
export function listPlanCalendarSnapshot(db: Database.Database, date: string): PlanCalendarSnapshotEntry[] {
  ensureSnapshotTable(db);
  const rows = db
    .prepare("SELECT event_id, block_id, kind, task_id, routine_id, start, end FROM plan_calendar_snapshot WHERE date = ? ORDER BY start, event_id")
    .all(date) as {
    event_id: string;
    block_id: string;
    kind: PlanBlock["kind"];
    task_id: string | null;
    routine_id: string | null;
    start: string;
    end: string;
  }[];
  return rows.map((r) => ({
    eventId: r.event_id,
    blockId: r.block_id,
    kind: r.kind,
    ...(r.task_id !== null ? { taskId: r.task_id } : {}),
    ...(r.routine_id !== null ? { routineId: r.routine_id } : {}),
    start: r.start,
    end: r.end,
  }));
}

/** Replaces one date's snapshot. Runs inside the caller's transaction; other dates are untouched. */
export function replacePlanCalendarSnapshotInTx(
  db: Database.Database,
  date: string,
  entries: readonly PlanCalendarSnapshotEntry[],
): void {
  ensureSnapshotTable(db);
  db.prepare("DELETE FROM plan_calendar_snapshot WHERE date = ?").run(date);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO plan_calendar_snapshot (date, event_id, block_id, kind, task_id, routine_id, start, end) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const e of entries) {
    insert.run(date, e.eventId, e.blockId, e.kind, e.taskId ?? null, e.routineId ?? null, e.start, e.end);
  }
}

/** The write state for one date (empty when nothing was ever written). */
function getPlanCalendarWriteState(db: Database.Database, date: string): PlanCalendarWriteState {
  ensureSnapshotTable(db);
  const row = db.prepare("SELECT writing_since, written_at FROM plan_calendar_write_state WHERE date = ?").get(date) as
    | { writing_since: string | null; written_at: string | null }
    | undefined;
  return {
    ...(row?.writing_since ? { writingSince: row.writing_since } : {}),
    ...(row?.written_at ? { writtenAt: row.written_at } : {}),
  };
}

function beginPlanCalendarWrite(db: Database.Database, date: string, at: string): void {
  ensureSnapshotTable(db);
  db.prepare(
    "INSERT INTO plan_calendar_write_state (date, writing_since) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET writing_since = excluded.writing_since",
  ).run(date, at);
}

function finishPlanCalendarWrite(db: Database.Database, date: string, at: string): void {
  ensureSnapshotTable(db);
  db.prepare(
    "INSERT INTO plan_calendar_write_state (date, writing_since, written_at) VALUES (?, NULL, ?) ON CONFLICT(date) DO UPDATE SET writing_since = NULL, written_at = excluded.written_at",
  ).run(date, at);
}

export function createPlanCalendarSnapshotStore(connection: SqliteConnection) {
  return {
    list: (date: string): PlanCalendarSnapshotEntry[] => listPlanCalendarSnapshot(connection.db, date),
    replace: (date: string, entries: readonly PlanCalendarSnapshotEntry[]): void => {
      connection.writeTx((db) => replacePlanCalendarSnapshotInTx(db, date, entries));
    },
    writeState: (date: string): PlanCalendarWriteState => getPlanCalendarWriteState(connection.db, date),
    beginWrite: (date: string, at: string): void => connection.writeTx((db) => beginPlanCalendarWrite(db, date, at)),
    finishWrite: (date: string, at: string): void => connection.writeTx((db) => finishPlanCalendarWrite(db, date, at)),
  };
}
