/**
 * src/adapters/memory-store.ts
 *
 * Owns Yoh's hot/cold memory storage (FR-15) and all open interaction
 * requests / open `Proposal`s (AD-3, AD-5), per AD-10 of the Architecture
 * Spine. This task (Task 2) builds only the bootstrap: schema init on first
 * run, plus the transactional read-modify-write helper with optimistic
 * concurrency that AD-10 requires. Later tasks add typed, entity-specific
 * read/write functions (e.g. a `getPlan`/`savePlan` pair) on top of this —
 * they should call `readModifyWrite` rather than hand-rolling their own
 * transaction, so every write in the system gets the same conflict
 * detection for free.
 *
 * Design choice (documented per the brief's "make a reasonable documented
 * choice" guidance): rather than one bespoke SQL table per entity kind (most
 * of which don't have a settled shape yet — no `TimeBudget`/`Plan` table
 * design has been decided by any task before this one), the schema is one
 * generic `records` table keyed by `(kind, id)`, storing each entity as a
 * JSON blob alongside its `version`/`updated_at` columns. This satisfies
 * AD-10's "version/updated_at column checked on write" requirement exactly,
 * without precluding a later task from adding its own dedicated tables to
 * `initSchema` (or from storing an "open interaction request" / open
 * `Proposal` as a `records` row with `kind: "interaction-request"`) — the
 * generic table and the transaction helper stay useful either way.
 *
 * Task 5 (Story 1.5, the Data-Completeness Gate) is that later task: it adds
 * `listRecordsByKind`/`deleteRecord` to `MemoryStore` (generic — list every
 * record for a kind without knowing each id ahead of time; delete one under
 * the same optimistic-concurrency rule `readModifyWrite` already enforces),
 * plus a small typed surface below (`InteractionRequest`,
 * `putOpenInteractionRequest`, `getOpenInteractionRequest`,
 * `listOpenInteractionRequests`, `clearInteractionRequest`) built entirely on
 * top of those — every open interaction request/`Proposal` lives as one
 * `records` row with `kind: INTERACTION_REQUEST_KIND` ("interaction-request")
 * and `id` chosen by the requester (e.g. the fixed singleton id
 * `"data-completeness"`, so multiple incomplete Tasks collapse into the one
 * open request UX-DR10 requires rather than one row per Task). No new SQL or
 * table was added for this — see `types/domain.ts`'s `InteractionRequest`
 * doc comment for the full design rationale.
 *
 * Per AD-8, `adapters/*.ts` files may throw on I/O failure rather than
 * returning `Result` themselves; `rituals/*.ts` is the only layer allowed to
 * catch and convert a throw into a `Result` failure. `ConflictError` below
 * is what `readModifyWrite` throws on a version mismatch — it carries a
 * `YohError`-shaped `.yohError` field (`kind: "conflict"`, per AD-8/AD-10)
 * for that later translation.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { InteractionRequest, TaskFieldOverride, YohError } from "../types/domain.ts";

// ============================================================================
// Config
// ============================================================================

export interface MemoryStoreConfig {
  /** Path to the SQLite file, or `:memory:` for an ephemeral in-process store (tests). */
  readonly databasePath: string;
}

// ============================================================================
// Stored record shape
// ============================================================================

export interface StoredRecord<T> {
  readonly kind: string;
  readonly id: string;
  readonly data: T;
  readonly version: number;
  /** ISO-8601 UTC timestamp of the last write, per the Consistency Conventions. */
  readonly updatedAt: string;
}

interface RecordRow {
  readonly kind: string;
  readonly id: string;
  readonly data: string;
  readonly version: number;
  readonly updated_at: string;
}

// ============================================================================
// ConflictError — AD-10's optimistic-concurrency failure, AD-8-shaped
// ============================================================================

/**
 * Thrown by `readModifyWrite` when the caller's `expectedVersion` no longer
 * matches the row's current version — i.e. a concurrent writer (AD-10:
 * `ritual-cli.ts` and `chat-cli.ts` are allowed to run concurrently) has
 * already applied a change since the caller last read this record. Carries
 * `.yohError` (`kind: "conflict"`) so a `rituals/*.ts` catch site can
 * surface it as `Result<T, YohError>` per AD-8 without this adapter
 * returning `Result` itself.
 */
export class ConflictError extends Error {
  readonly yohError: YohError;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = "ConflictError";
    this.yohError = { kind: "conflict", message, detail };
  }
}

// ============================================================================
// MemoryStore
// ============================================================================

export class MemoryStore {
  private readonly db: Database.Database;

  constructor(config: MemoryStoreConfig) {
    // `better-sqlite3` (like raw SQLite) refuses to create a database file
    // inside a directory that doesn't exist yet — it throws
    // "unable to open database file" rather than creating one. On a fresh
    // checkout using .env.example's documented default
    // (MEMORY_DB_PATH=./data/yoh-memory.db), `./data/` doesn't exist, so
    // this step is required for "initializes its SQLite schema on first
    // run" to actually hold. Mirrors the same pattern `token-store.ts`
    // already uses before writing its own token file.
    if (config.databasePath !== ":memory:") {
      const dir = dirname(config.databasePath);
      if (dir && dir !== "." && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(config.databasePath);
    this.db.pragma("journal_mode = WAL");
    // A conflicting writer's SELECT-then-write can otherwise surface SQLite's
    // own SQLITE_BUSY/SQLITE_BUSY_SNAPSHOT error under real cross-process
    // contention instead of letting the application-level version check in
    // `readModifyWrite` run and throw `ConflictError` — see that method's
    // `.immediate()` usage below for the other half of this fix. A short
    // busy_timeout gives a genuinely transient lock (as opposed to a real
    // stale-version conflict) a chance to clear before either error path is
    // reached.
    this.db.pragma("busy_timeout = 5000");
    this.initSchema();
  }

  /**
   * Initializes the SQLite schema on first run. `CREATE TABLE IF NOT
   * EXISTS` makes this idempotent — safe to run every time a `MemoryStore`
   * is constructed, including against a file a previous run already
   * initialized.
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      );
    `);
  }

  /** Reads the current stored value for `(kind, id)`, or `undefined` if none exists yet. */
  getRecord<T>(kind: string, id: string): StoredRecord<T> | undefined {
    const row = this.selectRow(kind, id);
    return row ? this.rowToRecord<T>(row) : undefined;
  }

  /**
   * Runs `modify` inside a single SQLite transaction against the current
   * row for `(kind, id)`, enforcing optimistic concurrency (AD-10):
   *
   * - `expectedVersion: undefined` means "I believe no record exists yet."
   *   If a record already exists, this throws `ConflictError` rather than
   *   silently overwriting it.
   * - `expectedVersion: n` means "the last version I read was `n`." If the
   *   row's current version isn't `n` (including "no row at all"), this
   *   throws `ConflictError` instead of applying a stale write.
   *
   * `modify` receives the current record (or `undefined`) and returns the
   * new data to store. If `modify` throws, the whole transaction rolls
   * back and the stored record is left unchanged (better-sqlite3's
   * `db.transaction()` wraps this in BEGIN/COMMIT/ROLLBACK).
   *
   * Runs as an `.immediate()` transaction (`BEGIN IMMEDIATE`, not a plain
   * deferred `BEGIN`): this acquires SQLite's write lock up front, before
   * the SELECT that reads `expectedVersion` against, rather than only at
   * the first write. Under real cross-process concurrency (AD-10:
   * `ritual-cli.ts` and `chat-cli.ts` running concurrently against the
   * same file), a deferred transaction can have its SELECT establish a
   * snapshot that a second connection's commit then invalidates, causing
   * SQLite itself to throw `SQLITE_BUSY`/`SQLITE_BUSY_SNAPSHOT` at the
   * write step — bypassing the `expectedVersion !== actualVersion` check
   * below entirely and surfacing a raw `SqliteError` instead of
   * `ConflictError`/`YohError.kind: 'conflict'`. `.immediate()` plus the
   * `busy_timeout` pragma set in the constructor makes a second writer
   * either wait briefly for the lock or fail with `SQLITE_BUSY` up front
   * (before this function's own read), rather than mid-transaction after
   * already having read and evaluated a version.
   */
  readModifyWrite<T>(
    kind: string,
    id: string,
    expectedVersion: number | undefined,
    modify: (current: StoredRecord<T> | undefined) => T,
  ): StoredRecord<T> {
    const runTransaction = this.db.transaction((): StoredRecord<T> => {
      const row = this.selectRow(kind, id);
      const actualVersion = row?.version;

      if (expectedVersion !== actualVersion) {
        throw new ConflictError(
          `memory-store: conflicting write to ${kind}/${id} — expected version ${
            expectedVersion ?? "none"
          }, found ${actualVersion ?? "none"}`,
          { kind, id, expectedVersion, actualVersion },
        );
      }

      const current = row ? this.rowToRecord<T>(row) : undefined;
      const nextData = modify(current);
      const nextVersion = (row?.version ?? 0) + 1;
      const updatedAt = new Date().toISOString();

      this.db
        .prepare(
          `INSERT INTO records (kind, id, data, version, updated_at)
           VALUES (@kind, @id, @data, @version, @updatedAt)
           ON CONFLICT(kind, id) DO UPDATE SET data = @data, version = @version, updated_at = @updatedAt`,
        )
        .run({ kind, id, data: JSON.stringify(nextData), version: nextVersion, updatedAt });

      return { kind, id, data: nextData, version: nextVersion, updatedAt };
    });

    return runTransaction.immediate();
  }

  /**
   * Lists every currently-stored record for `kind`, ordered by `id`. Added
   * (Task 5) so a caller can surface "every open interaction request"
   * without knowing each request's `id` ahead of time — `readModifyWrite`
   * and `getRecord` alone require already knowing the `id` to address a
   * single row, which doesn't fit "surface whatever's open" (AD-5).
   */
  listRecordsByKind<T>(kind: string): StoredRecord<T>[] {
    const rows = this.db
      .prepare<{ kind: string }, RecordRow>(
        "SELECT kind, id, data, version, updated_at FROM records WHERE kind = @kind ORDER BY id",
      )
      .all({ kind });
    return rows.map((row) => this.rowToRecord<T>(row));
  }

  /**
   * Deletes the record at `(kind, id)`, enforcing the same
   * optimistic-concurrency check `readModifyWrite` does (AD-10): if the
   * row's current version doesn't match `expectedVersion` (including "no
   * row at all" when a caller expects one to exist), this throws
   * `ConflictError` instead of silently deleting a row a concurrent writer
   * has since changed, or silently no-op'ing on a row that's already gone.
   * Added (Task 5) as the "clear" half of the open-interaction-request
   * persist/surface/clear cycle (AD-5) — `readModifyWrite` alone can only
   * create/replace a row, never remove one.
   */
  deleteRecord(kind: string, id: string, expectedVersion: number): void {
    const runTransaction = this.db.transaction((): void => {
      const row = this.selectRow(kind, id);
      const actualVersion = row?.version;

      if (expectedVersion !== actualVersion) {
        throw new ConflictError(
          `memory-store: conflicting delete of ${kind}/${id} — expected version ${expectedVersion}, found ${
            actualVersion ?? "none"
          }`,
          { kind, id, expectedVersion, actualVersion },
        );
      }

      this.db.prepare("DELETE FROM records WHERE kind = @kind AND id = @id").run({ kind, id });
    });

    runTransaction.immediate();
  }

  close(): void {
    this.db.close();
  }

  private selectRow(kind: string, id: string): RecordRow | undefined {
    return this.db
      .prepare<{ kind: string; id: string }, RecordRow>(
        "SELECT kind, id, data, version, updated_at FROM records WHERE kind = @kind AND id = @id",
      )
      .get({ kind, id });
  }

  private rowToRecord<T>(row: RecordRow): StoredRecord<T> {
    return {
      kind: row.kind,
      id: row.id,
      data: JSON.parse(row.data) as T,
      version: row.version,
      updatedAt: row.updated_at,
    };
  }
}

/** Constructs a `MemoryStore`, initializing its schema if this is the first run against `databasePath`. */
export function createMemoryStore(config: MemoryStoreConfig): MemoryStore {
  return new MemoryStore(config);
}

// ============================================================================
// Open interaction requests (AD-3, AD-5) — typed surface on `records`
// ============================================================================

/**
 * The fixed `records.kind` partition every open interaction request /
 * `Proposal` (AD-3, AD-5) is stored under, regardless of its own
 * `InteractionRequest.requestKind` (e.g. `"data-completeness"`,
 * `"night-close-out"`) — that field distinguishes *what the request is
 * about*; this constant is only the storage-table partition key.
 */
const INTERACTION_REQUEST_KIND = "interaction-request";

export type { InteractionRequest };

/**
 * Opens (creates, or replaces if one is already open) the interaction
 * request at `id` — "put" semantics: the caller doesn't need to track a
 * version to call this, unlike `readModifyWrite`. Internally reads the
 * current record (if any) and passes its version to `readModifyWrite`, so a
 * genuine concurrent writer racing on the exact same `id` still surfaces
 * `ConflictError` per AD-10 — this only removes the *caller's* burden of
 * threading a version through, not the concurrency guarantee itself.
 */
export function putOpenInteractionRequest(
  store: MemoryStore,
  id: string,
  request: InteractionRequest,
): StoredRecord<InteractionRequest> {
  const current = store.getRecord<InteractionRequest>(INTERACTION_REQUEST_KIND, id);
  return store.readModifyWrite<InteractionRequest>(INTERACTION_REQUEST_KIND, id, current?.version, () => request);
}

/** Reads the currently open interaction request at `id`, or `undefined` if none is open. */
export function getOpenInteractionRequest(store: MemoryStore, id: string): StoredRecord<InteractionRequest> | undefined {
  return store.getRecord<InteractionRequest>(INTERACTION_REQUEST_KIND, id);
}

/**
 * Lists every currently open interaction request, across every `id` —
 * what `chat-cli.ts` calls on start and before accepting any unrelated
 * command (AD-5) to surface whatever's open, without needing to already
 * know each open request's `id`.
 */
export function listOpenInteractionRequests(store: MemoryStore): StoredRecord<InteractionRequest>[] {
  return store.listRecordsByKind<InteractionRequest>(INTERACTION_REQUEST_KIND);
}

/**
 * Clears (removes) the interaction request at `id` once Spencer has
 * answered it, enforcing the same optimistic-concurrency check every write
 * in this file does (AD-10): `expectedVersion` should be the version last
 * read via `getOpenInteractionRequest`/`listOpenInteractionRequests`.
 */
export function clearInteractionRequest(store: MemoryStore, id: string, expectedVersion: number): void {
  store.deleteRecord(INTERACTION_REQUEST_KIND, id, expectedVersion);
}

// ============================================================================
// Task field overrides (Task 5 fix) — typed surface on `records`
// ============================================================================

/**
 * The fixed `records.kind` partition every Spencer-answered
 * `TaskFieldOverride` is stored under, keyed by the overridden Task's `id`.
 * Added as part of Task 5's fix: once Spencer answers a Data-Completeness
 * prompt for a missing field, `chat-cli.ts` persists the parsed answer here
 * (via `mergeTaskFieldOverride`) rather than discarding it — a raw `Task`
 * re-read later (e.g. from `notion-adapter.ts`, which still won't have the
 * field, since Notion write-back is Status-only per AD-12) is merged against
 * this before being handed to the Data-Completeness Gate again.
 */
const TASK_FIELD_OVERRIDE_KIND = "task-field-override";

export type { TaskFieldOverride };

/**
 * Reads the currently-stored `TaskFieldOverride` for `taskId`, or
 * `undefined` if Spencer hasn't answered anything for that Task yet.
 */
export function getTaskFieldOverride(store: MemoryStore, taskId: string): StoredRecord<TaskFieldOverride> | undefined {
  return store.getRecord<TaskFieldOverride>(TASK_FIELD_OVERRIDE_KIND, taskId);
}

/**
 * Merges `patch` onto the `TaskFieldOverride` already stored for `taskId`
 * (creating one at `{}` if none exists yet), and persists the merged
 * result — "put a bit more" semantics, so a Task whose prompt named
 * multiple missing fields can have each field's answer merged in one at a
 * time (e.g. as `chat-cli.ts` asks about them one at a time) without a
 * caller needing to track a version or re-supply fields already answered.
 * Like `putOpenInteractionRequest`, this reads the current version
 * internally before calling `readModifyWrite`, so a genuine concurrent
 * writer racing on the same `taskId` still surfaces `ConflictError` per
 * AD-10.
 */
export function mergeTaskFieldOverride(
  store: MemoryStore,
  taskId: string,
  patch: TaskFieldOverride,
): StoredRecord<TaskFieldOverride> {
  const current = store.getRecord<TaskFieldOverride>(TASK_FIELD_OVERRIDE_KIND, taskId);
  return store.readModifyWrite<TaskFieldOverride>(TASK_FIELD_OVERRIDE_KIND, taskId, current?.version, (existing) => ({
    ...existing?.data,
    ...patch,
  }));
}
