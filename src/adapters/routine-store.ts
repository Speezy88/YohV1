/**
 * src/adapters/routine-store.ts
 *
 * Epic 10 (10.3, R8): Routines — recurring blocks Spencer declares in chat
 * ("my commute is 3:00–3:30 on weekdays"). Own table, created idempotently by
 * `initRoutineStoreSchema`. `days` is a comma list of `RoutineDay`; `start` is
 * "HH:MM" local time.
 */
import type Database from "better-sqlite3";
import type { SqliteConnection } from "./sqlite.ts";
import { ROUTINE_DAYS, type Routine, type RoutineDay } from "../core/routine-commands.ts";

export function initRoutineStoreSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      days TEXT NOT NULL,
      start TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL
    );
  `);
}

interface RoutineRow {
  id: string;
  label: string;
  days: string;
  start: string;
  duration_minutes: number;
}

function rowToRoutine(row: RoutineRow): Routine {
  const [h, m] = row.start.split(":").map(Number);
  const days = row.days.split(",").filter((d): d is RoutineDay => (ROUTINE_DAYS as readonly string[]).includes(d));
  return { id: row.id, label: row.label, days, startMinutes: (h ?? 0) * 60 + (m ?? 0), durationMinutes: row.duration_minutes };
}

function formatStart(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Inserts or replaces the routine with this id. */
export function upsertRoutine(connection: SqliteConnection, routine: Routine): void {
  connection.writeTx((db) => {
    db.prepare(
      `INSERT INTO routines (id, label, days, start, duration_minutes) VALUES (@id, @label, @days, @start, @durationMinutes)
       ON CONFLICT(id) DO UPDATE SET label = @label, days = @days, start = @start, duration_minutes = @durationMinutes`,
    ).run({ id: routine.id, label: routine.label, days: routine.days.join(","), start: formatStart(routine.startMinutes), durationMinutes: routine.durationMinutes });
  });
}

/** Returns true when a routine was deleted. */
export function removeRoutine(connection: SqliteConnection, id: string): boolean {
  return connection.writeTx((db) => db.prepare(`DELETE FROM routines WHERE id = ?`).run(id).changes > 0);
}

export function getRoutine(connection: SqliteConnection, id: string): Routine | undefined {
  const row = connection.db.prepare(`SELECT id, label, days, start, duration_minutes FROM routines WHERE id = ?`).get(id) as RoutineRow | undefined;
  return row ? rowToRoutine(row) : undefined;
}

/** Every routine, ordered by start time then label. */
export function listRoutines(connection: SqliteConnection): readonly Routine[] {
  const rows = connection.db.prepare(`SELECT id, label, days, start, duration_minutes FROM routines ORDER BY start, label`).all() as RoutineRow[];
  return rows.map(rowToRoutine);
}

/**
 * Every routine, read straight off a `MemoryStore`'s database. A store whose
 * routine table was never created (older tests, fresh fixtures) has none.
 */
export function listRoutinesFromStore(store: { withDb<T>(fn: (db: Database.Database) => T): T }): readonly Routine[] {
  return store.withDb((db) => {
    try {
      const rows = db.prepare(`SELECT id, label, days, start, duration_minutes FROM routines ORDER BY start, label`).all() as RoutineRow[];
      return rows.map(rowToRoutine);
    } catch {
      return [];
    }
  });
}
