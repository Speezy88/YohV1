/**
 * src/adapters/completion-log.ts
 *
 * Story 7.9, AD-10/AD-23: Yoh's own permanent record of everything
 * completed — independent of Notion (this entry survives any later change
 * to, or deletion of, the Task in Notion). A dedicated `completions` table,
 * created idempotently, per AD-10. Exports exactly ONE completion write —
 * `recordCompletion`/`recordCompletionInTx` — proved by a source-scan test
 * (`tests/completion-log.test.ts`) that no other file's SQL inserts into
 * this table.
 *
 * **Controller ruling R7 (supersedes the per-story plan's own
 * "optional fields" draft — see that plan's "Open questions for
 * controller" section for the full history).** `RecordCompletionInput`
 * keeps all seven AD-23 keys REQUIRED. `area`/`dueDate`/`estimatedMinutes`
 * are nullable VALUES (`Area | null`, `IsoDate | null`, `number | null`),
 * never optional keys — every call site must explicitly state what it
 * snapshotted, `null` included, rather than silently omitting a field. The
 * close-out path (`rituals/night-ritual.ts`) supplies `null` for a field a
 * live Task lookup shows missing, or for all three if that lookup fails
 * (never blocking the write). Story 7.10's check-off path supplies the full
 * set from its own already-in-hand `CompleteTask`.
 *
 * `listCompletedTaskIdsOnDate` computes "completed on Spencer's LOCAL
 * calendar day `date`" — needed by `rituals/night-ritual.ts`'s close-out
 * exclusion (FR-41). It scopes the SQL scan to a generous UTC window around
 * `date` (using the indexed `completed_at` column) and then filters
 * precisely by local date in JS via `Intl`, the same small,
 * deliberately-duplicated per-file local-date helper
 * `rituals/ritual-shared.ts`'s own `localIsoDate` already establishes as
 * this codebase's convention (adapters may use `Intl` directly; AD-1 only
 * forbids importing from `core/`/`rituals/`/`app/`, not using built-ins).
 */
import type Database from "better-sqlite3";
import type { SqliteConnection } from "./sqlite.ts";
import type { Area, ExternalId, IsoDate, IsoDateTime } from "../types/domain.ts";

export type CompletionSource = "check-off" | "close-out";

/**
 * R7: all seven keys are required. `area`/`dueDate`/`estimatedMinutes` are
 * nullable values, not optional keys — a call site states `null` when the
 * field genuinely wasn't available (missing on the Task, or an unreadable
 * live lookup), rather than omitting the key entirely.
 */
export interface RecordCompletionInput {
  readonly taskId: ExternalId;
  readonly taskName: string;
  readonly area: Area | null;
  readonly dueDate: IsoDate | null;
  readonly estimatedMinutes: number | null;
  readonly completedAt: IsoDateTime;
  readonly source: CompletionSource;
}

export function initCompletionLogSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      task_name TEXT NOT NULL,
      area TEXT,
      due_date TEXT,
      estimated_minutes INTEGER,
      completed_at TEXT NOT NULL,
      source TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_completions_completed_at ON completions (completed_at);
    CREATE INDEX IF NOT EXISTS idx_completions_task_id ON completions (task_id);
  `);
}

/** Inserts one completion row. Call inside a `writeTx` when it must commit atomically alongside another owner's write (Story 7.10's check-off commit is the first such caller). */
export function recordCompletionInTx(db: Database.Database, input: RecordCompletionInput): void {
  db.prepare(
    `INSERT INTO completions (task_id, task_name, area, due_date, estimated_minutes, completed_at, source)
     VALUES (@taskId, @taskName, @area, @dueDate, @estimatedMinutes, @completedAt, @source)`,
  ).run({
    taskId: input.taskId,
    taskName: input.taskName,
    area: input.area,
    dueDate: input.dueDate,
    estimatedMinutes: input.estimatedMinutes,
    completedAt: input.completedAt,
    source: input.source,
  });
}

/** Convenience wrapper for the common single-write case: opens its own `writeTx`. */
export function recordCompletion(connection: SqliteConnection, input: RecordCompletionInput): void {
  connection.writeTx((db) => recordCompletionInTx(db, input));
}

interface CompletionDateRow {
  readonly task_id: string;
  readonly completed_at: string;
}

/** `rituals/ritual-shared.ts`'s `localIsoDate` logic, duplicated deliberately per this file's own module docstring — adapters don't import from `rituals/`. */
function localIsoDateOf(instant: string, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    new Date(instant),
  );
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Every `taskId` completed on Spencer's LOCAL calendar `date`, in
 * `timeZone` — what `runNightPromptRitual` (Story 7.9) excludes from
 * tonight's close-out questions (FR-41). Scans a generous UTC window around
 * `date`'s UTC midnight (wide enough to cover any real-world UTC offset
 * without needing precise offset math) using the indexed `completed_at`
 * column, then filters precisely by local date.
 */
export function listCompletedTaskIdsOnDate(connection: SqliteConnection, date: IsoDate, timeZone: string): ReadonlySet<ExternalId> {
  const dayStartUtc = new Date(`${date}T00:00:00.000Z`);
  const windowStart = new Date(dayStartUtc.getTime() - 36 * 3_600_000).toISOString();
  const windowEnd = new Date(dayStartUtc.getTime() + 60 * 3_600_000).toISOString();

  const rows = connection.db
    .prepare<{ start: string; end: string }, CompletionDateRow>(
      `SELECT task_id, completed_at FROM completions WHERE completed_at >= @start AND completed_at < @end`,
    )
    .all({ start: windowStart, end: windowEnd });

  const result = new Set<ExternalId>();
  for (const row of rows) {
    if (localIsoDateOf(row.completed_at, timeZone) === date) result.add(row.task_id);
  }
  return result;
}
