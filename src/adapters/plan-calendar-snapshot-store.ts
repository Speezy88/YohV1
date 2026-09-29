/**
 * What Yoh last wrote to the "Yoh Plan" Google calendar, per local date: one
 * row per calendar event with the plan block it was written from. Lets a later
 * read tell Yoh's own events from ones Spencer moved or added.
 */
import type Database from "better-sqlite3";
import type { PlanBlock } from "../types/domain.ts";
import type { SqliteConnection } from "./sqlite.ts";

export type PlanCalendarSnapshotEntry = {
  eventId: string;
  blockId: string;
  kind: PlanBlock["kind"];
  taskId?: string;
  routineId?: string;
  start: string;
  end: string;
};

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

export function createPlanCalendarSnapshotStore(connection: SqliteConnection) {
  return {
    list: (date: string): PlanCalendarSnapshotEntry[] => listPlanCalendarSnapshot(connection.db, date),
    replace: (date: string, entries: readonly PlanCalendarSnapshotEntry[]): void => {
      connection.writeTx((db) => replacePlanCalendarSnapshotInTx(db, date, entries));
    },
  };
}
