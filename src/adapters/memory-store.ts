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
 * Per AD-8, `adapters/*.ts` files may throw on I/O failure rather than
 * returning `Result` themselves; `rituals/*.ts` is the only layer allowed to
 * catch and convert a throw into a `Result` failure. `ConflictError` below
 * is what `readModifyWrite` throws on a version mismatch — it carries a
 * `YohError`-shaped `.yohError` field (`kind: "conflict"`, per AD-8/AD-10)
 * for that later translation.
 */

import Database from "better-sqlite3";
import type { YohError } from "../types/domain.ts";

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
    this.db = new Database(config.databasePath);
    this.db.pragma("journal_mode = WAL");
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

    return runTransaction();
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
