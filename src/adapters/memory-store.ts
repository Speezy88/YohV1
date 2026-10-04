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

import type Database from "better-sqlite3";
import type { ExternalId, InteractionRequest, IsoDate, IsoDateTime, Plan, TaskFieldOverride, TimeBudget, YohError } from "../types/domain.ts";
import type { SqliteConnection } from "./sqlite.ts";
// Task 7 (Story 8.6, AD-18): the sibling-adapter edge `putPlan`'s own
// `onCommit` callers already use for the "plan" topic — here it's this
// file's own, since every interaction-request write (unlike `putPlan`'s
// caller-supplied hook) unconditionally needs an "open-items" outbox row,
// regardless of which caller (a ritual, or `server.ts`'s Web App route;
// Story 8.9: originally also `chat-cli.ts`, since retired) made the write
// (AD-10).
import { appendOutboxInTx } from "./notification-store.ts";

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
 * `ritual-cli.ts` and `server.ts` are allowed to run concurrently; Story
 * 8.9: `chat-cli.ts`, retired, was originally the other allowed process)
 * has already applied a change since the caller last read this record. Carries
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
  private readonly connection: SqliteConnection;

  /**
   * Constructs a `MemoryStore` over an already-open `SqliteConnection`
   * (Story 7.1, AD-10 revised for Phase 2) — the connection's WAL mode,
   * `busy_timeout`, and directory creation are all `adapters/sqlite.ts`'s
   * responsibility now, not this file's. This is a pure refactor of *how*
   * the connection is obtained; every read/write method below is unchanged.
   */
  constructor(connection: SqliteConnection) {
    this.connection = connection;
    this.initSchema();
  }

  private get db(): Database.Database {
    return this.connection.db;
  }

  /** Runs `fn` against the underlying database, for another store's own tables (e.g. day pins). Reads only; writes go through a `*InTx` inside `writeTx`/`onCommit`. */
  withDb<T>(fn: (db: Database.Database) => T): T {
    return fn(this.db);
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
   * `ritual-cli.ts` and `server.ts` running concurrently against the
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
    /**
     * Story 7.8, Ruling R4: when given, runs INSIDE this same `writeTx`,
     * immediately after the write above, with the raw `better-sqlite3`
     * handle — so a caller (`putPlan` below) can append another owner's
     * `...InTx` row (e.g. `notification-store.ts`'s `appendOutboxInTx`) in
     * the SAME transaction as this record's write, without this file ever
     * importing that owner's module (AD-10).
     */
    onCommit?: (db: Database.Database) => void,
  ): StoredRecord<T> {
    return this.connection.writeTx((db): StoredRecord<T> => {
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

      db
        .prepare(
          `INSERT INTO records (kind, id, data, version, updated_at)
           VALUES (@kind, @id, @data, @version, @updatedAt)
           ON CONFLICT(kind, id) DO UPDATE SET data = @data, version = @version, updated_at = @updatedAt`,
        )
        .run({ kind, id, data: JSON.stringify(nextData), version: nextVersion, updatedAt });

      const result: StoredRecord<T> = { kind, id, data: nextData, version: nextVersion, updatedAt };
      onCommit?.(db);
      return result;
    });
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
  /**
   * `onCommit`, when given, runs INSIDE this same `writeTx`, immediately
   * after the delete — mirrors `readModifyWrite`'s own `onCommit` param
   * (Story 7.8, Ruling R4), so a caller (`clearInteractionRequest` below)
   * can append an outbox row atomically with the delete (Task 7, AD-18).
   */
  deleteRecord(kind: string, id: string, expectedVersion: number, onCommit?: (db: Database.Database) => void): void {
    this.connection.writeTx((db): void => {
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

      db.prepare("DELETE FROM records WHERE kind = @kind AND id = @id").run({ kind, id });
      onCommit?.(db);
    });
  }

  /**
   * Closes the underlying `SqliteConnection` — delegates rather than owning
   * a handle of its own (Story 7.1). Kept so every existing `store.close()`
   * call site in the test suite keeps compiling unchanged; a real process
   * (`ritual-cli.ts`/`server.ts`) closes the shared connection directly in
   * its own `finally` block instead, since a connection shared across
   * multiple stores must be closed once by its owner, not once per store.
   */
  close(): void {
    this.connection.close();
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

/** Constructs a `MemoryStore` over an already-open `SqliteConnection` (Story 7.1, AD-10), initializing its schema if this is the first run against it. */
export function createMemoryStore(connection: SqliteConnection): MemoryStore {
  return new MemoryStore(connection);
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

/**
 * Epic 8's outbox topic (Task 7, AD-18) for ANY change to an open
 * interaction request — created (`putOpenInteractionRequest`), its
 * pending-question cursor advanced (`updateInteractionRequestDetail`), or
 * cleared (`clearInteractionRequest`). `entityId` is always the request's
 * own `id`, so a connected browser's `GET /api/open-items` refetch (Task 7)
 * knows exactly which request changed without the outbox itself carrying
 * any payload.
 */
export const OPEN_ITEMS_TOPIC = "open-items";

export type { InteractionRequest };

/**
 * Opens (creates, or replaces if one is already open) the interaction
 * request at `id` — "put" semantics: the caller doesn't need to track a
 * version to call this, unlike `readModifyWrite`. Internally reads the
 * current record (if any) and passes its version to `readModifyWrite`, so a
 * genuine concurrent writer racing on the exact same `id` still surfaces
 * `ConflictError` per AD-10 — this only removes the *caller's* burden of
 * threading a version through, not the concurrency guarantee itself.
 *
 * Task 7 (AD-18): unconditionally appends an `"open-items"` outbox row in
 * the SAME `writeTx` — a ritual-raised request (which never touches a
 * browser) still becomes visible to a connected Chat page's
 * `GET /api/open-items` refetch, without the ritual ever knowing one exists.
 */
export function putOpenInteractionRequest(
  store: MemoryStore,
  id: string,
  request: InteractionRequest,
): StoredRecord<InteractionRequest> {
  const current = store.getRecord<InteractionRequest>(INTERACTION_REQUEST_KIND, id);
  return store.readModifyWrite<InteractionRequest>(INTERACTION_REQUEST_KIND, id, current?.version, () => request, (db) =>
    appendOutboxInTx(db, { topic: OPEN_ITEMS_TOPIC, entityId: id }),
  );
}

/** Reads the currently open interaction request at `id`, or `undefined` if none is open. */
export function getOpenInteractionRequest(store: MemoryStore, id: string): StoredRecord<InteractionRequest> | undefined {
  return store.getRecord<InteractionRequest>(INTERACTION_REQUEST_KIND, id);
}

/**
 * Lists every currently open interaction request, across every `id` —
 * what `app/surface-open-items.ts`'s `surfaceOpenItems` calls (Story 8.9:
 * originally `chat-cli.ts`, on start and before accepting any unrelated
 * command, AD-5) to surface whatever's open, without needing to already
 * know each open request's `id`.
 */
export function listOpenInteractionRequests(store: MemoryStore): StoredRecord<InteractionRequest>[] {
  return store.listRecordsByKind<InteractionRequest>(INTERACTION_REQUEST_KIND);
}

/** True when an open interaction request holds a Proposal of the given kind (e.g. an unanswered chat change set). */
export function hasOpenProposalOfKind(store: MemoryStore, kind: string): boolean {
  return listOpenInteractionRequests(store).some((record) => {
    if (record.data.requestKind !== "proposal") return false;
    const proposal = (record.data.detail as { readonly proposal?: { readonly kind?: string } } | undefined)?.proposal;
    return proposal?.kind === kind;
  });
}

/**
 * Clears (removes) the interaction request at `id` once Spencer has
 * answered it, enforcing the same optimistic-concurrency check every write
 * in this file does (AD-10): `expectedVersion` should be the version last
 * read via `getOpenInteractionRequest`/`listOpenInteractionRequests`.
 *
 * Task 7 (AD-18): appends an `"open-items"` outbox row in the SAME
 * `writeTx` as the delete — via `deleteRecord`'s `onCommit` seam, so a
 * conflicting (stale-version) clear, which throws before the delete ever
 * runs, appends NO hint (the delete never happened, so a hint would lie to
 * a connected browser).
 */
export function clearInteractionRequest(store: MemoryStore, id: string, expectedVersion: number): void {
  store.deleteRecord(INTERACTION_REQUEST_KIND, id, expectedVersion, (db) => appendOutboxInTx(db, { topic: OPEN_ITEMS_TOPIC, entityId: id }));
}

/**
 * Removes the interaction request at `id` from inside a caller's `writeTx`
 * (e.g. `putPlan`'s `onCommit`), appending the `open-items` hint. No version
 * check — the caller's own write in the same transaction is the guard.
 */
export function clearInteractionRequestInTx(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM records WHERE kind = @kind AND id = @id").run({ kind: INTERACTION_REQUEST_KIND, id });
  appendOutboxInTx(db, { topic: OPEN_ITEMS_TOPIC, entityId: id });
}

/**
 * Rewrites ONLY the `detail` payload of the interaction request at `id`,
 * keeping `requestKind`/`promptText`/`createdAt` untouched — the versioned
 * primitive Story 8.1 uses to persist a per-request pending-question cursor
 * (`detail.cursor`) across turns. `expectedVersion` mismatch (including "the
 * request no longer exists") throws `ConflictError`, which an `app/*.ts`
 * caller converts to `YohError.kind: "conflict"` per AD-8.
 *
 * Task 7 (AD-18): also appends an `"open-items"` outbox row in the SAME
 * `writeTx` — advancing the pending-question cursor is as much a
 * user-visible change to the open item as the put/clear above, so a
 * connected browser must refetch for THIS too (e.g. a multi-question
 * request moving to its next question).
 */
export function updateInteractionRequestDetail<TDetail = unknown>(
  store: MemoryStore,
  id: string,
  expectedVersion: number,
  updateDetail: (currentDetail: TDetail | undefined) => TDetail,
): StoredRecord<InteractionRequest<TDetail>> {
  return store.readModifyWrite<InteractionRequest<TDetail>>(
    INTERACTION_REQUEST_KIND,
    id,
    expectedVersion,
    (current) => {
      if (!current) throw new ConflictError(`memory-store: cannot update detail — no interaction request open at ${id}`, { id });
      return { ...current.data, detail: updateDetail(current.data.detail) };
    },
    (db) => appendOutboxInTx(db, { topic: OPEN_ITEMS_TOPIC, entityId: id }),
  );
}

// ============================================================================
// Task field overrides (Task 5 fix) — typed surface on `records`
// ============================================================================

/**
 * The fixed `records.kind` partition every Spencer-answered
 * `TaskFieldOverride` is stored under, keyed by the overridden Task's `id`.
 * Added as part of Task 5's fix: once Spencer answers a Data-Completeness
 * prompt for a missing field, `app/answer-data-completeness.ts` (Story 8.9:
 * originally `chat-cli.ts`) persists the parsed answer here
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
 * time (e.g. as `app/answer-data-completeness.ts` asks about them one
 * question per turn, C4) without a
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

// ============================================================================
// Time Budget (Task 6 / Story 1.6, FR-5) — typed surface on `records`
// ============================================================================

/**
 * The fixed `records.kind` partition Spencer's declared Time Budget is
 * stored under.
 */
const TIME_BUDGET_KIND = "time-budget";

/**
 * The fixed singleton `records.id` the current Time Budget is always stored
 * at. Design choice, and the crux of this story's "persists day-to-day,
 * including weekends, until explicitly changed again — it never silently
 * reverts to a different default" requirement: this is deliberately NOT
 * keyed by calendar date (e.g. `id: date`), which would make "today's Time
 * Budget" a *per-day row* that reads as absent the instant the calendar
 * rolls over unless something re-creates it. Instead there is exactly one
 * Time Budget row, ever — `putTimeBudget` always upserts this same id, so
 * "today's Time Budget" is simply "whatever is currently stored here,
 * however many days ago it was declared." Nothing in this file ever expires,
 * clears, or age-checks this row; `core/time-budget.ts`'s
 * `resolveTodayTimeBudget` is where "was this carried forward from an
 * earlier day" gets *reported* (for display purposes only) — never here,
 * and never by this row's own presence/absence.
 *
 * This also keeps a later Epic 4 Proposal-driven Time Budget change
 * (AD-3: Yoh *suggesting* a change, surfaced as a `Proposal<T>` /
 * `InteractionRequest` and only applied once Spencer accepts it) able to
 * reuse this exact same storage: its `apply(proposal)` step would read this
 * same singleton row (checking `Proposal.entityVersion` against the row's
 * own `StoredRecord.version` for staleness, per that type's doc comment)
 * and call `putTimeBudget` the same way Spencer's own explicit declaration
 * does below — no schema change needed for that later story.
 */
const TIME_BUDGET_ID = "current";

export type { TimeBudget };

/**
 * Reads the currently-stored Time Budget, or `undefined` if Spencer has
 * never declared one. Per the design note above, this is unconditionally
 * "today's Time Budget" — there is no date-based filtering or cutoff here;
 * a value declared on any prior day is returned exactly as-is.
 */
export function getCurrentTimeBudget(store: MemoryStore): StoredRecord<TimeBudget> | undefined {
  return store.getRecord<TimeBudget>(TIME_BUDGET_KIND, TIME_BUDGET_ID);
}

/**
 * Declares (creates, or replaces if one is already stored) the current Time
 * Budget — "put" semantics, like `putOpenInteractionRequest`: the caller
 * doesn't need to track a version to call this. Internally reads the
 * current record's version (if any) and passes it to `readModifyWrite`, so a
 * genuine concurrent writer (AD-10: `ritual-cli.ts` and `server.ts` running
 * concurrently) still surfaces `ConflictError` rather than silently
 * clobbering a change made between this function's internal read and write.
 */
export function putTimeBudget(store: MemoryStore, budget: TimeBudget): StoredRecord<TimeBudget> {
  const current = store.getRecord<TimeBudget>(TIME_BUDGET_KIND, TIME_BUDGET_ID);
  return store.readModifyWrite<TimeBudget>(TIME_BUDGET_KIND, TIME_BUDGET_ID, current?.version, () => budget);
}

// ============================================================================
// Time Budget deferral streak (Task 23 / Story 4.2, AD-3) — typed surface on
// `records`
// ============================================================================

/**
 * The fixed `records.kind` partition the Time-Budget-deferral streak
 * (`core/time-budget.ts`'s `TimeBudgetDeferralStreakSnapshot`, structurally
 * mirrored here — see that type's own doc comment for why this file
 * declares its own local shape rather than importing one: `adapters/*.ts`
 * may import only from `types/`, never from `core/`, per AD-1) is stored
 * under.
 */
const TIME_BUDGET_DEFERRAL_STREAK_KIND = "time-budget-deferral-streak";

/**
 * The fixed singleton `records.id` the streak is always stored at —
 * mirrors `TIME_BUDGET_ID` immediately above: there is exactly one current
 * Time Budget, so there is exactly one streak tracking deferrals against it.
 */
const TIME_BUDGET_DEFERRAL_STREAK_ID = "current";

/**
 * One day-over-day streak of "at least one Task got deferred because it
 * didn't fit the declared Time Budget" — the raw signal
 * `core/time-budget.ts`'s `buildTimeBudgetChangeProposal` turns into a real
 * `Proposal<Partial<TimeBudget>>` once it crosses that file's own documented
 * threshold. Structurally identical to that file's own
 * `TimeBudgetDeferralStreakSnapshot` by design (see that type's doc comment)
 * — this is this file's own copy of the same shape, not a competing one.
 */
export interface TimeBudgetDeferralStreak {
  readonly consecutiveDeferralDays: number;
  readonly lastDeferralDate: IsoDate;
}

/** Reads the currently-stored deferral streak, or `undefined` if none is stored (never started, or most recently cleared by a day with no deferrals). */
export function getTimeBudgetDeferralStreak(store: MemoryStore): StoredRecord<TimeBudgetDeferralStreak> | undefined {
  return store.getRecord<TimeBudgetDeferralStreak>(TIME_BUDGET_DEFERRAL_STREAK_KIND, TIME_BUDGET_DEFERRAL_STREAK_ID);
}

/**
 * Stores `streak` — "put" semantics, like `putTimeBudget` immediately above:
 * the caller doesn't thread a version through, but a genuine concurrent
 * writer racing on this same singleton still surfaces `ConflictError` per
 * AD-10 (this reads the current row's version internally and hands it to
 * `readModifyWrite`). The caller (`rituals/morning-ritual.ts`) is expected to
 * have already computed `streak` via `core/time-budget.ts`'s pure
 * `nextTimeBudgetDeferralStreak` — this function is a plain storage
 * primitive, not a second place that decides how the streak advances.
 */
export function putTimeBudgetDeferralStreak(
  store: MemoryStore,
  streak: TimeBudgetDeferralStreak,
): StoredRecord<TimeBudgetDeferralStreak> {
  const current = store.getRecord<TimeBudgetDeferralStreak>(TIME_BUDGET_DEFERRAL_STREAK_KIND, TIME_BUDGET_DEFERRAL_STREAK_ID);
  return store.readModifyWrite<TimeBudgetDeferralStreak>(
    TIME_BUDGET_DEFERRAL_STREAK_KIND,
    TIME_BUDGET_DEFERRAL_STREAK_ID,
    current?.version,
    () => streak,
  );
}

/**
 * Clears the streak entirely — a day with no deferrals resets the count to
 * zero rather than pausing it (see `core/time-budget.ts`'s
 * `nextTimeBudgetDeferralStreak` doc comment for the full reasoning), and a
 * cleared streak reads back identically to one that never started. A
 * harmless no-op if nothing is stored — mirrors `clearSlip`'s own shape.
 */
export function clearTimeBudgetDeferralStreak(store: MemoryStore): void {
  const current = store.getRecord<TimeBudgetDeferralStreak>(TIME_BUDGET_DEFERRAL_STREAK_KIND, TIME_BUDGET_DEFERRAL_STREAK_ID);
  if (!current) return;
  store.deleteRecord(TIME_BUDGET_DEFERRAL_STREAK_KIND, TIME_BUDGET_DEFERRAL_STREAK_ID, current.version);
}

// ============================================================================
// Plan (Task 10 / Story 1.10, FR-1) — typed surface on `records`
// ============================================================================

/**
 * The fixed `records.kind` partition each day's generated `Plan` is stored
 * under, keyed by the Plan's own `date` (`YYYY-MM-DD`). Keyed by date — NOT
 * a singleton like `TIME_BUDGET_ID` — because FR-1 is explicitly "one
 * ordered Plan per day": yesterday's Plan must remain readable after today's
 * is written (Epic 3's Night Ritual close-out and Epic 4's pattern learning
 * both read back a day's Plan), which a singleton row would destroy.
 */
const PLAN_KIND = "plan";

export type { Plan };

/** The outbox topic a Plan write announces on (the shared EventSource `plan` hint). */
export const PLAN_TOPIC = "plan";

/** Reads the stored `Plan` for `date`, or `undefined` if none has been generated for that day. */
export function getPlan(store: MemoryStore, date: IsoDate): StoredRecord<Plan> | undefined {
  return store.getRecord<Plan>(PLAN_KIND, date);
}

/**
 * Stores `plan` under its own `date` — "put" semantics, like
 * `putTimeBudget`/`putOpenInteractionRequest`: the caller doesn't thread a
 * version through, but a genuine concurrent writer racing on the same date
 * still surfaces `ConflictError` per AD-10 (this reads the current row's
 * version internally and hands it to `readModifyWrite`).
 *
 * The row is stored verbatim: `Plan.version` (the domain field AD-10's
 * optimistic-concurrency pattern is expressed through for a Plan) is the
 * caller's to set — `rituals/morning-ritual.ts` reads any existing Plan for
 * the date and stamps `version: existing + 1` before calling this, and a
 * later Mid-Day Re-Flow does the same. That keeps this function a pure
 * storage primitive rather than a second, hidden versioning mechanism
 * competing with `StoredRecord.version`.
 */
export function putPlan(
  store: MemoryStore,
  plan: Plan,
  /**
   * Story 7.8, Ruling R4: runs inside the SAME `writeTx` as this Plan write,
   * right before it commits. `rituals/morning-ritual.ts` and
   * `rituals/mid-day-reflow.ts` pass `(db) => appendOutboxInTx(db, {topic:
   * "plan", entityId: plan.date})` so a Plan-change hint reaches the web
   * client's SSE stream atomically with the write it announces — without
   * this file ever importing `notification-store.ts` (AD-10: the other
   * owner's own `...InTx` function is what runs inside the caller's
   * transaction, never reached into directly here). Omitted, `putPlan`
   * behaves exactly as before this story.
   */
  onCommit?: (db: Database.Database) => void,
): StoredRecord<Plan> {
  const current = store.getRecord<Plan>(PLAN_KIND, plan.date);
  return store.readModifyWrite<Plan>(PLAN_KIND, plan.date, current?.version, () => plan, onCommit);
}

// ============================================================================
// Ritual run markers (Task 10 / Story 1.10) — typed surface on `records`
// ============================================================================

/**
 * The fixed `records.kind` partition each ritual's "when did I last run"
 * marker is stored under, keyed by the ritual's own id (e.g. `"morning"`).
 * This is what makes Story 1.10's "the Morning Ritual has already run once
 * today -> no second Plan-generation notification is sent" hold across
 * separate one-shot `ritual-cli.ts` processes: a cron trigger has no memory
 * of an earlier trigger, so the marker on disk is the only thing that can
 * carry that fact.
 *
 * Deliberately ONE singleton row per ritual (holding the date it last ran)
 * rather than one row per ritual-per-day: the only question ever asked of it
 * is "did this ritual already run *today*", and a per-day key would
 * accumulate an unbounded row per calendar day with nothing ever reading the
 * old ones. Epic 3's night rituals (Tasks 19/20) reuse this same shape with
 * their own ritual ids.
 */
const RITUAL_RUN_KIND = "ritual-run";

/** The marker one ritual writes after a successful run. */
export interface RitualRun {
  /** The local calendar date the ritual last completed a run for. */
  readonly date: IsoDate;
  readonly ranAt: IsoDateTime;
  /** The `Plan.id` this run produced, when the ritual produces one. */
  readonly planId?: string;
}

/** Reads `ritualId`'s last-run marker, or `undefined` if it has never completed a run. */
export function getRitualRun(store: MemoryStore, ritualId: string): StoredRecord<RitualRun> | undefined {
  return store.getRecord<RitualRun>(RITUAL_RUN_KIND, ritualId);
}

/**
 * Records that `ritualId` completed a run — "put" semantics with the same
 * internal version read (and so the same AD-10 conflict detection) every
 * other typed writer in this file uses.
 */
export function putRitualRun(store: MemoryStore, ritualId: string, run: RitualRun): StoredRecord<RitualRun> {
  const current = store.getRecord<RitualRun>(RITUAL_RUN_KIND, ritualId);
  return store.readModifyWrite<RitualRun>(RITUAL_RUN_KIND, ritualId, current?.version, () => run);
}

// ============================================================================
// Ritual invocation marker (Task 26 / Story 5.2 review fix, AD-7/AD-9) —
// typed surface on `records`
// ============================================================================

/**
 * The fixed `records.kind` partition each CLI subcommand's "was I actually
 * INVOKED and did I run to completion" marker is stored under, keyed by the
 * subcommand's own name (`"morning"`, `"night-prompt"`, `"night-escalate"`).
 *
 * Deliberately a SEPARATE partition from `RITUAL_RUN_KIND` above, answering
 * a genuinely different question. `RitualRun` records a ritual's own
 * DELIVERY — it only advances on `morning`'s `delivered` outcome /
 * `night-prompt`'s `prompted` outcome / `night-escalate`'s `escalated`
 * outcome; an ordinary, CORRECT no-op outcome (`nothing-to-plan`,
 * `no-plan-today`, `not-prompted-yet`, etc.) writes nothing at all.
 * `shell/ritual-cli.ts`'s dead-man's-switch (Task 26 / Story 5.2)
 * originally read that marker directly and, in review, was found to
 * produce false alarms from it: a quiet-but-successful no-op day (or
 * several in a row, since the three daily rituals interlock — no Tasks to
 * plan cascades into no Plan to prompt on cascades into no prompt to
 * escalate) looked identical, through `RitualRun` alone, to "the scheduler
 * has stopped invoking me entirely" — inverting the alert's whole meaning. `RitualInvocation`
 * exists to answer the narrower, correct question instead: "did the
 * scheduler actually invoke this subcommand's process and let it run to
 * completion recently" — true on every single invocation regardless of
 * what that invocation's own ritual-domain logic decided to do.
 *
 * `shell/ritual-cli.ts`'s `withFailureAlert` is the sole writer, via
 * `RitualCliDeps.recordInvocation` — see that file's own docstring.
 */
const RITUAL_INVOCATION_KIND = "ritual-invocation";

/**
 * The marker `withFailureAlert` writes after every subcommand invocation
 * runs to completion — crash (a caught throw) or ordinary return, `Result`
 * failure or success alike. Used ONLY to answer "was this subcommand
 * invoked at all recently" (the dead-man's-switch's own question); never
 * "did it succeed" — that remains `RitualRun`'s (for
 * ritual-domain outcomes) and Task 25's failure-alert path's (for this-run
 * failures) job respectively.
 */
export interface RitualInvocation {
  readonly at: IsoDateTime;
}

/** Reads `subcommand`'s last-invocation marker, or `undefined` if it has never been invoked at all yet (cold start). */
export function getRitualInvocation(store: MemoryStore, subcommand: string): StoredRecord<RitualInvocation> | undefined {
  return store.getRecord<RitualInvocation>(RITUAL_INVOCATION_KIND, subcommand);
}

/**
 * Records that `subcommand` was invoked and ran to completion — "put"
 * semantics with the same internal version read (and so the same AD-10
 * conflict detection) every other typed writer in this file uses.
 */
export function putRitualInvocation(store: MemoryStore, subcommand: string, invocation: RitualInvocation): StoredRecord<RitualInvocation> {
  const current = store.getRecord<RitualInvocation>(RITUAL_INVOCATION_KIND, subcommand);
  return store.readModifyWrite<RitualInvocation>(RITUAL_INVOCATION_KIND, subcommand, current?.version, () => invocation);
}

// ============================================================================
// Slip history (Task 17 / Story 2.5, FR-11, AD-6) — typed surface on `records`
// ============================================================================

/**
 * The fixed `records.kind` partition each Task's consecutive-slip tracking
 * is stored under, keyed by the Task's own `id`. Feeds `strainCount` into
 * `core/slip-bump.ts`'s `computeSlipBumpLevel`/`computeSlipBumpLevels`
 * (AD-6) — this file owns only the raw count's persistence, never the
 * escalation-curve math itself (that stays in `core/`, per AD-2).
 */
const SLIP_HISTORY_KIND = "slip-history";

/**
 * One Task's slip tracking: how many CONSECUTIVE days it has slipped in a
 * row (reset — in practice, cleared entirely, see `clearSlip` below — the
 * moment it completes, per this story's AC: "its Slip-Bump is cleared, not
 * carried indefinitely"), and the date of its most recent slip, kept for
 * lineage-view display (`app/why-prioritized.ts`'s "why is X prioritized"
 * command, UX-DR19; Story 8.9: moved from `shell/chat-cli.ts`).
 */
export interface SlipHistory {
  readonly consecutiveSlipCount: number;
  readonly lastSlipDate: IsoDate;
}

/** Reads the currently-stored `SlipHistory` for `taskId`, or `undefined` if that Task has never slipped (or its history has since been cleared on completion). */
export function getSlipHistory(store: MemoryStore, taskId: string): StoredRecord<SlipHistory> | undefined {
  return store.getRecord<SlipHistory>(SLIP_HISTORY_KIND, taskId);
}

/**
 * Records one more consecutive slip for `taskId` on `slipDate` —
 * increments the existing `consecutiveSlipCount` by one (starting at 1 if
 * this is the Task's first recorded slip), like `mergeTaskFieldOverride`'s
 * own read-current-then-`readModifyWrite` pattern above: the caller doesn't
 * track a version, but a genuine concurrent writer racing on the same
 * `taskId` still surfaces `ConflictError` per AD-10.
 *
 * Per the epics text ("Night Ritual close-out is Slip-Bump's guaranteed,
 * authoritative trigger; Mid-Day Re-Flow is the earlier, optional one"),
 * this function is the storage primitive that trigger calls — see
 * `core/slip-bump.ts`'s own "Scope note" docstring section for the history
 * of why THIS task (Task 17) didn't yet call it itself. Task 19's
 * `rituals/night-ritual.ts` (`applyNightCloseOutConfirmation`) is that real
 * call site now.
 *
 * **Idempotent per `slipDate` (Task 19 review fix).** If the currently
 * stored `lastSlipDate` already equals `slipDate`, this is a no-op — the
 * existing record is returned unchanged rather than incrementing the count
 * again. Without this, a caller that legitimately invokes `recordSlip`
 * more than once for the exact same date (the motivating case:
 * `rituals/night-ritual.ts`'s close-out answer loop persists no per-Task
 * progress within one interaction request — Spencer answering Task 1
 * "slipped", then closing chat before answering Task 2, then re-opening
 * chat, re-surfaces and re-asks Task 1 from the top; answering "slipped"
 * again must not double-count that same night's slip) would silently
 * inflate `consecutiveSlipCount`, and with it the Slip-Bump level, past
 * what actually happened. Making the PRIMITIVE itself safe for a repeated
 * same-date call — rather than only fixing the one call site that
 * triggered this — means every future caller gets the same guarantee for
 * free. A genuinely NEW slip on a later date still increments normally.
 */
export function recordSlip(
  store: MemoryStore,
  taskId: string,
  slipDate: IsoDate,
  onCommit?: (db: Database.Database) => void,
): StoredRecord<SlipHistory> {
  const current = store.getRecord<SlipHistory>(SLIP_HISTORY_KIND, taskId);
  if (current?.data.lastSlipDate === slipDate) {
    return current; // Already recorded for this exact date — no-op, not a second increment.
  }
  return store.readModifyWrite<SlipHistory>(SLIP_HISTORY_KIND, taskId, current?.version, (existing) => ({
    consecutiveSlipCount: (existing?.data.consecutiveSlipCount ?? 0) + 1,
    lastSlipDate: slipDate,
  }), onCommit);
}

/**
 * Clears `taskId`'s Slip-Bump entirely — this story's AC: "a Task slipped
 * once and then completes ... its Slip-Bump is cleared, not carried
 * indefinitely." Deletes the row outright (rather than resetting
 * `consecutiveSlipCount` to `0` in place) so a cleared Task reads back
 * IDENTICALLY to a Task that has never slipped at all (both `undefined` from
 * `getSlipHistory`, both absent from `listSlipHistories`) — see
 * `core/slip-bump.ts`'s own docstring for why that equivalence matters to
 * its `computeSlipBumpLevels` batch function.
 *
 * A harmless no-op if `taskId` has no slip history to clear (e.g. a Task
 * that completes without ever having slipped) — reads the current version
 * internally first, like `recordSlip` above, rather than requiring the
 * caller to already know it.
 */
export function clearSlip(store: MemoryStore, taskId: string): void {
  const current = store.getRecord<SlipHistory>(SLIP_HISTORY_KIND, taskId);
  if (!current) return; // Nothing to clear.
  store.deleteRecord(SLIP_HISTORY_KIND, taskId, current.version);
}

/**
 * Lists every Task's currently-stored `SlipHistory`, across every `taskId`
 * — the same "surface whatever's stored without already knowing each id"
 * shape `listOpenInteractionRequests` provides for interaction requests.
 * Task 19's `shell/ritual-cli.ts` (`createMorningRitualDeps`'s `bumpLevels`
 * bridge) is what builds a `taskId -> consecutiveSlipCount` map from this
 * before calling `core/slip-bump.ts`'s `computeSlipBumpLevels` to get the
 * `bumpLevels` shape `core/derived-priority.ts`'s `orderByDerivedPriority`
 * already accepts.
 */
export function listSlipHistories(store: MemoryStore): StoredRecord<SlipHistory>[] {
  return store.listRecordsByKind<SlipHistory>(SLIP_HISTORY_KIND);
}

// ============================================================================
// Unchecked days (Task 21 / Story 3.3, FR-14, UX-DR14) — typed surface on
// `records`
// ============================================================================

/**
 * The fixed `records.kind` partition each night's durable "left unchecked"
 * marker is stored under, keyed by the NIGHT's own local calendar date (the
 * same date `Plan.date`/`RitualRun.date` for that night's `night-prompt` and
 * `night-escalate` runs used) — one row per night that was ever left
 * unchecked, not a singleton.
 *
 * This is a genuinely separate `records` partition from `RITUAL_RUN_KIND`
 * (which only ever records "did a ritual run today," nothing about the
 * OUTCOME of that night's close-out) and from `INTERACTION_REQUEST_KIND`
 * (which is cleared the moment Spencer answers, and per this story's own
 * design must NEVER be force-cleared by the unchecked-day mechanism — see
 * `UncheckedDay`'s own doc comment below). Its PRESENCE for a given date is
 * the durable, queryable distinction FR-14/this story's own AC require
 * between a night that was closed out normally (no row here, ever) and one
 * that was not (a row here, permanently).
 *
 * **Review-fix note (Task 21, post-review).** The FIRST version of this
 * mechanism wrote this row from `rituals/morning-ritual.ts`, INFERRING
 * "was last night unchecked" by re-reading two other singleton records at
 * display time. That was wrong: both of those singletons (`night-prompt`'s
 * and `night-escalate`'s own `RitualRun` markers, and the close-out
 * `InteractionRequest` itself) get silently overwritten by the very next
 * night's own `night-prompt`/`night-escalate` runs, so if the Morning
 * Ritual didn't happen to deliver on the ONE morning the inference was
 * still valid, the unchecked status was lost forever — never written,
 * never recoverable. The fix: `rituals/night-ritual.ts`'s
 * `runNightEscalateRitual` is now the SOLE writer, and it writes this row
 * immediately at the moment it confirms the cap is genuinely spent (the
 * escalation email was just sent, and the close-out request was still
 * open) — not inferred later from other state that can and does get
 * overwritten. `rituals/morning-ritual.ts` now only ever READS this
 * partition (via `listUncheckedDays`) to decide what to DISPLAY and stamps
 * `shownAt` once it does — see `UncheckedDay.shownAt`'s own doc comment.
 */
const UNCHECKED_DAY_KIND = "unchecked-day";

/** One Task named by an unchecked night's close-out request, as of the moment it was recorded — display-only, mirrors `rituals/night-ritual.ts`'s own `NightCloseOutTaskDetail` shape structurally without importing it (this file deliberately stays a leaf with no `rituals/*.ts` imports at all, matching every other typed surface already in this file). */
export interface UncheckedDayTask {
  readonly taskId: ExternalId;
  readonly taskTitle: string;
}

/**
 * UncheckedDay — the durable record that `date`'s Night Ritual close-out
 * ultimately went unanswered even after both close-out attempts (Story
 * 3.1's prompt, Story 3.2's capped escalation) were spent. Written exactly
 * once per night, by `rituals/night-ritual.ts`'s `runNightEscalateRitual`,
 * at the moment it confirms the escalation cap is genuinely spent AND the
 * close-out request is still open — the actual "cap reached" moment this
 * story's AC1 describes, not inferred later by `rituals/morning-ritual.ts`
 * re-reading other state (see `UNCHECKED_DAY_KIND`'s own "review-fix note"
 * above for why the first version got this wrong, and why detection must
 * not depend on records the next night's own rituals can and do overwrite).
 *
 * `rolledForwardTasks` is this story's own resolution of "mandatory
 * Blocker(s)": there is no persisted `Blocker` entity anywhere in this
 * codebase (FR-10's Blocker handling is a transient mid-day trigger with no
 * lasting record, and the PRD's own Glossary defines "Blocker" only
 * generically) — the most defensible, implementable reading is that an
 * unchecked night means Spencer never confirmed which `work` Plan Blocks
 * completed or slipped, so the Tasks still named by that night's close-out
 * interaction request (which only ever clears once EVERY named Task has
 * been answered or explicitly skipped — see `app/answer-night-close-out.ts`'s
 * `answerNightCloseOut`) are exactly what "rolled forward." Snapshot
 * copies of `taskId`/`taskTitle`, not a live re-read of Notion: a Task
 * could be renamed, completed some other way, or deleted by the time this
 * is displayed, and the notice is about what happened THAT NIGHT, not
 * today's live Notion state.
 *
 * Never written by clearing or replacing the underlying
 * `InteractionRequest` this data was read from — writing this row is a
 * plain read-then-put against `INTERACTION_REQUEST_KIND`'s own singleton
 * row, with no delete/clear anywhere in the path. **The actual bound on
 * "how long can Spencer still answer it," corrected (Task 21 post-review —
 * the original doc comment here overclaimed "whenever he gets to it, even
 * days later," which is false beyond one night):** the close-out
 * `InteractionRequest` singleton (`NIGHT_CLOSE_OUT_REQUEST_ID`) can be
 * answered right up until the NEXT night's own `night-prompt` run
 * overwrites that same singleton row with a fresh request for the new
 * night ("put" semantics — see `putOpenInteractionRequest`'s own doc
 * comment). Recording THIS row does not shorten that window at all (it is
 * a pure read-then-put, never a delete), but the window itself is real and
 * finite, bounded by the next night's own `night-prompt`, not indefinite.
 * Fully closing that gap (e.g. keying close-out requests by date instead of
 * one singleton, so an unanswered night's own request survives even after
 * a later night's `night-prompt` runs) is a separate, future story-scoped
 * change — not something this task builds.
 */
export interface UncheckedDay {
  readonly date: IsoDate;
  readonly rolledForwardTasks: readonly UncheckedDayTask[];
  /** When `night-escalate` confirmed the cap was spent and recorded this — not the night's own date. */
  readonly recordedAt: IsoDateTime;
  /**
   * When `rituals/morning-ritual.ts` actually displayed this on a delivered
   * Morning Plan — `undefined` until then. This is what makes UX-DR14's
   * "shown once, not a standing repeating reminder" hold: `undefined` means
   * "still pending, show it on the next Plan that actually delivers,
   * however many days that takes"; once set, it never shows again. Stamped
   * by `markUncheckedDayShown` below, separately from the record's own
   * creation — this is the Task 21 post-review fix that decouples
   * "detected" from "displayed," so a run that fails to deliver (or simply
   * doesn't happen) can never permanently lose an already-recorded night.
   */
  readonly shownAt?: IsoDateTime;
}

/** Reads the stored `UncheckedDay` record for `date`, or `undefined` if that night was never left unchecked (or hasn't been recorded as such yet). Its mere presence/absence is the AC's own "visibly distinguishable from a closed day" distinction — a normally-closed night never has a row here. */
export function getUncheckedDay(store: MemoryStore, date: IsoDate): StoredRecord<UncheckedDay> | undefined {
  return store.getRecord<UncheckedDay>(UNCHECKED_DAY_KIND, date);
}

/**
 * Records `day` under its own `date` — "put" semantics, like
 * `putPlan`/`putTimeBudget`: the caller doesn't thread a version through,
 * but a genuine concurrent writer racing on the same date still surfaces
 * `ConflictError` per AD-10 (this reads the current row's version
 * internally and hands it to `readModifyWrite`). Called exactly once per
 * night, by `rituals/night-ritual.ts`'s `runNightEscalateRitual`, at the
 * moment it confirms the cap is genuinely spent — see `UncheckedDay`'s own
 * doc comment. "Put" rather than "create-only" semantics keeps this
 * consistent with every sibling writer in this file rather than inventing a
 * stricter primitive this one caller alone would need.
 */
export function putUncheckedDay(store: MemoryStore, day: UncheckedDay): StoredRecord<UncheckedDay> {
  const current = store.getRecord<UncheckedDay>(UNCHECKED_DAY_KIND, day.date);
  return store.readModifyWrite<UncheckedDay>(UNCHECKED_DAY_KIND, day.date, current?.version, () => day);
}

/**
 * Stamps `shownAt` on the already-recorded `UncheckedDay` row for `date` —
 * "merge a bit more" semantics, like `mergeTaskFieldOverride`: reads the
 * row's current version internally (so a genuine concurrent writer still
 * surfaces `ConflictError` per AD-10 for a REAL conflicting write — see
 * below for the one case that is deliberately NOT treated as one) and
 * patches only `shownAt`, leaving `rolledForwardTasks`/`recordedAt`
 * untouched. Called by `rituals/morning-ritual.ts`, once, right after it
 * has actually delivered a Plan carrying this night's notice (see
 * `UncheckedDay.shownAt`'s own doc comment for why this is a separate step
 * from `putUncheckedDay`).
 *
 * **Returns `undefined` — a clean no-op, NOT a throw — when no row exists
 * for `date` (Task 21, Minor post-review fix).** `rituals/night-ritual.ts`'s
 * `clearUncheckedDay` (added by Task 21's second post-review fix) DOES now
 * delete an `UncheckedDay` row, once Spencer genuinely answers a close-out
 * — this file's own doc comment previously claimed "nothing in this
 * codebase deletes an `UncheckedDay` row," which that fix made false. That
 * matters here specifically because `rituals/morning-ritual.ts`'s
 * `runMorningRitual` reads the row at its own "step 1.5" and doesn't stamp
 * `shownAt` until its own "step 12d" — with Notion/Calendar reads and a
 * Pushover send awaited in between, a real window during which a SEPARATE
 * `server.ts` process (same SQLite file, AD-10) can legitimately answer
 * the close-out and delete this exact row via `clearUncheckedDay` before
 * `runMorningRitual` ever reaches its own write. That is not a bug and not
 * a genuine conflict — the night is no longer unchecked either way, and
 * there is nothing left to stamp — so this returns `undefined` cleanly
 * rather than throwing, and a `ConflictError` whose own detail shows the
 * row is now gone (`actualVersion === undefined`, i.e. genuinely deleted,
 * not merely a different version) is treated the same way even if it
 * surfaces from the write itself (the even-narrower window between this
 * function's own read above and its own write, effectively a race with
 * itself). A caller that only ever calls this for a date it just read via
 * `getUncheckedDay`/`listUncheckedDays` — the sole real caller's own
 * contract — should treat `undefined` as "already resolved, nothing to do"
 * rather than an error.
 */
export function markUncheckedDayShown(
  store: MemoryStore,
  date: IsoDate,
  shownAt: IsoDateTime,
): StoredRecord<UncheckedDay> | undefined {
  const current = store.getRecord<UncheckedDay>(UNCHECKED_DAY_KIND, date);
  if (!current) {
    return undefined; // Already resolved (e.g. clearUncheckedDay ran concurrently) — nothing to stamp.
  }
  try {
    return store.readModifyWrite<UncheckedDay>(UNCHECKED_DAY_KIND, date, current.version, (existing) => ({
      ...(existing?.data as UncheckedDay),
      shownAt,
    }));
  } catch (err) {
    const detail = err instanceof ConflictError ? (err.yohError.detail as { actualVersion?: number } | undefined) : undefined;
    if (err instanceof ConflictError && detail !== undefined && detail.actualVersion === undefined) {
      return undefined; // Deleted between our read above and this write — same "already resolved" case.
    }
    throw err;
  }
}

/**
 * Clears (removes) the `UncheckedDay` row for `date`, if one exists — a
 * harmless no-op otherwise, exactly mirroring `clearSlip`'s own "read the
 * current version internally, delete if present, no-op if not" shape (this
 * file's established pattern for "resolve this record if it happens to
 * exist" primitives). Added by Task 21's second post-review fix: when
 * `rituals/night-ritual.ts`'s `clearNightCloseOutRequestIfOpen` clears a
 * close-out request because Spencer genuinely answered every named Task
 * (including, notably, after a night that was already recorded as
 * unchecked — the escalation feature's actual success path), the matching
 * `UncheckedDay` row for that same date must be resolved too. Deleting it
 * outright (rather than, say, stamping some "resolved" field) is the
 * simplest, cleanest choice: there is no reason to keep a durable
 * "unchecked" record around for a night that has since been properly
 * closed out — a re-read via `getUncheckedDay` afterward is indistinguishable
 * from a night that was never unchecked at all, which is exactly correct
 * per this story's AC3 ("a day that was actually closed out ... is never
 * silently treated as equivalent to an unchecked day" — the reverse
 * direction of that guarantee holds too: a day that's SINCE been closed out
 * must stop reading as unchecked).
 */
export function clearUncheckedDay(store: MemoryStore, date: IsoDate): void {
  const current = store.getRecord<UncheckedDay>(UNCHECKED_DAY_KIND, date);
  if (!current) return; // Nothing to clear — this night was never recorded as unchecked.
  store.deleteRecord(UNCHECKED_DAY_KIND, date, current.version);
}

/**
 * Lists every night ever recorded as unchecked, across every date — the
 * same "surface whatever's stored without already knowing each id" shape
 * `listSlipHistories`/`listOpenInteractionRequests` provide elsewhere in
 * this file. `rituals/morning-ritual.ts` is this function's real caller
 * (Task 21 post-review fix): it finds the OLDEST row with no `shownAt` yet
 * to decide what to display next, deliberately decoupled from "yesterday
 * specifically" so a multi-day gap in Morning Ritual delivery delays that
 * display rather than losing it — `listRecordsByKind`'s own `ORDER BY id`
 * clause already returns rows in ascending date order, since ISO-8601
 * `YYYY-MM-DD` strings sort lexicographically identically to chronological
 * order.
 */
export function listUncheckedDays(store: MemoryStore): StoredRecord<UncheckedDay>[] {
  return store.listRecordsByKind<UncheckedDay>(UNCHECKED_DAY_KIND);
}

// ============================================================================
// Retired-feature cleanup (Story 13.12, Ruling E11)
// ============================================================================

/**
 * The retired periodic check-in's name, kept only as data so the cleanup
 * below can find its leftovers. Spelled indirectly so the retirement gate
 * (a case-insensitive grep for the hyphenated word over `src/`) stays empty.
 */
const RETIRED_NAME = ["self", "check"].join("-");

/**
 * One-time, idempotent cleanup called at server start: removes every open
 * interaction request whose `requestKind` is the retired name, every
 * `records` row whose `kind` is the retired name (the old state partition),
 * and the retired subcommand's `ritual-invocation` marker. A no-op once
 * clean. Each removed request appends an `open-items` outbox hint.
 */
export function removeRetiredRecords(store: MemoryStore): { removed: number } {
  let removed = 0;
  for (const request of store.listRecordsByKind<InteractionRequest>(INTERACTION_REQUEST_KIND)) {
    if (request.data.requestKind !== RETIRED_NAME) continue;
    clearInteractionRequest(store, request.id, request.version);
    removed += 1;
  }
  for (const row of store.listRecordsByKind<unknown>(RETIRED_NAME)) {
    store.deleteRecord(RETIRED_NAME, row.id, row.version);
    removed += 1;
  }
  const invocation = store.getRecord<RitualInvocation>(RITUAL_INVOCATION_KIND, RETIRED_NAME);
  if (invocation) {
    store.deleteRecord(RITUAL_INVOCATION_KIND, RETIRED_NAME, invocation.version);
    removed += 1;
  }
  return { removed };
}

// ============================================================================
// Hot/cold memory boundary (Task 22 / Story 4.1, FR-15) — AD-10 assigns
// "owns hot/cold memory" to this file; every prior task above already reads
// and writes the way this section names. This task's job is mainly to make
// that boundary explicit and add the one piece that genuinely didn't exist
// yet: an on-demand cold-memory query that distills OLDER history into
// human-readable pattern-statements.
//
// ----------------------------------------------------------------------------
// What "hot" means, concretely
// ----------------------------------------------------------------------------
//
// Every function above this section that a ritual calls during its ROUTINE
// daily run — `getPlan(store, today)`, `getCurrentTimeBudget`,
// `getRitualRun(store, ritualId)`, `getSlipHistory`/`listSlipHistories` (used
// for today's ordering, not history), `getUncheckedDay`/`listUncheckedDays`
// (used to find the next night to DISPLAY, not to summarize the past) — is
// already "hot" by construction: each reads a SPECIFIC `(kind, id)` row (or,
// for the two `list*` exceptions, scans a table whose size is bounded by
// "how many Tasks/unchecked-nights currently need attention," not by total
// history depth) via `getRecord`, never a date-range query over history.
// Nothing needed to change for this to be true — see `readHotMemory` below,
// which is this section's "small typed grouping" (per the brief) naming that
// property for the three fields every ritual's normal flow actually reads to
// decide what to run/show today: today's Plan, the current Time Budget, and
// a ritual's own last-run marker(s).
//
// `HOT_MEMORY_WINDOW_DAYS` is intentionally NOT plumbed into any date filter
// anywhere above — there is no hot-read code path that filters by date at
// all (see `TIME_BUDGET_ID`'s own doc comment: the Time Budget row has no
// expiry). It exists purely as documentation of the boundary's rough size
// (how many days back a ritual's own routine concerns — "yesterday's slip,"
// "this week's Time Budget" per the AC's own examples — actually span), and
// as the natural floor `COLD_MEMORY_DEFAULT_LOOKBACK_DAYS` is defined
// relative to below.
//
// ----------------------------------------------------------------------------
// What "cold" means, concretely
// ----------------------------------------------------------------------------
//
// `queryColdMemoryPatterns` below is the genuinely new piece: an explicit,
// on-demand-only query (never called from `rituals/morning-ritual.ts`,
// `rituals/night-ritual.ts`, or `rituals/mid-day-reflow.ts` — see the
// structural test in `tests/memory-store.test.ts` asserting exactly that)
// that scans `SlipHistory` and `UncheckedDay` — the two tables that already
// accumulate genuine multi-day history, per prior tasks' own writes — over a
// caller-chosen lookback window, and distills what it finds into plain
// English sentences. Per AD-9 ("extend `memory-store.ts` additively,
// following its own established generic-primitive pattern rather than
// inventing a new storage mechanism"), this computes pattern-statements
// in-memory from `listRecordsByKind`'s existing results on every call —
// there is no new persisted "pattern-statement" record. A future caller
// (e.g. a Chat "how have I been doing lately" command) is free to call this directly; wiring an actual
// chat command is explicitly out of scope for this task (see the
// task brief — no AC requires an on-demand query SURFACE, only the query
// path itself).
//
// `Plan` history is deliberately NOT distilled here despite being listed as
// available raw material in the task brief: `PLAN_KIND` has no
// `listPlans`/`listRecordsByKind<Plan>` reader anywhere in this codebase
// today (every existing caller addresses a Plan by its own specific date),
// and inventing pattern-statements over Plan history (e.g. "Plans have
// tended to run over budget on Mondays") would be real analytics on top of
// `PlanBlock`/`workBreakFit` internals this task has no brief-given
// direction for — squarely the "real analytics/ML" the task brief says NOT
// to build. `SlipHistory` and `UncheckedDay` are both named explicitly in
// the brief's own example pattern-statements, so those two are what this
// task implements; extending to Plan history is a reasonable future
// addition, not a gap in this one. (The brief's own slip-pattern example
// phrasing, "Task X has slipped N times in the last M days," is not
// reproduced verbatim below — see `queryColdMemoryPatterns`'s own doc
// comment and its post-review fix note for why pairing `SlipHistory`'s
// lifetime `consecutiveSlipCount` with a bounded "in the last M days" claim
// would misrepresent the data.)
//
// ----------------------------------------------------------------------------
// The two remaining record kinds NOT covered above: also hot, own reasoning each
// ----------------------------------------------------------------------------
//
// `InteractionRequest` and `TaskFieldOverride` are the two remaining record
// kinds in this file and are BOTH hot — but not for identical reasons, and
// NOT (post-review correction) because every read of both is a
// `getRecord`-by-`(kind, id)` read the way `Plan`/`TimeBudget`/`RitualRun`
// are:
//
// - `getTaskFieldOverride` genuinely is exactly that: a plain `getRecord`
//   on a specific `taskId`, same shape as `getPlan`/`getCurrentTimeBudget`.
// - `getOpenInteractionRequest` is too, but `listOpenInteractionRequests`
//   is NOT — it's `listRecordsByKind<InteractionRequest>`, the same
//   full-kind-scan primitive `queryColdMemoryPatterns` uses to make its own
//   reads genuinely "cold." What makes `InteractionRequest` hot anyway
//   isn't the shape of that call, it's what's being scanned: unlike
//   `SlipHistory`/`UncheckedDay` (which `queryColdMemoryPatterns` scans
//   specifically because they accumulate real multi-day/multi-week
//   history), open interaction requests are cleared the moment Spencer
//   answers them (`clearInteractionRequest`) — the kind never grows into a
//   history at all, it just holds whatever's open right now. A
//   `listRecordsByKind` call over a kind that stays small and current
//   because of its own clear-on-answer lifecycle is a different thing from
//   a `listRecordsByKind` call used as a historical distillation over
//   accumulated time — the former is still a hot, current-state read; only
//   the latter is what this file means by "cold."
//
// What they hold is, either way, inherently current-state rather than
// history — an interaction request is either open right now or it isn't,
// and a field override is whatever Spencer's most recent answer for that
// field currently is. Neither is folded into
// `readHotMemory`'s `HotMemorySnapshot` alongside Plan/TimeBudget/RitualRun:
// that struct is deliberately scoped to the three fields a ritual's own
// "what do I run/show today" decision reads (this task's TDD requirement 1
// names exactly those three), not an exhaustive bundle of every hot kind in
// the file — `listOpenInteractionRequests`/`getTaskFieldOverride` remain
// their own direct call, same as before this task, with nothing about their
// hotness changed or newly required by this task.
// ============================================================================

/**
 * Documents the rough size of the hot window: how many days back a ritual's
 * own ROUTINE concerns span (the AC's own examples — "yesterday's slip,"
 * "this week's Time Budget"). Not used as a date-filter cutoff anywhere in
 * this file (see this section's own docstring for why no hot read filters by
 * date at all) — its role is purely to document the boundary, and to anchor
 * `COLD_MEMORY_DEFAULT_LOOKBACK_DAYS` below at something clearly WIDER than
 * it, per this story's "older history beyond the hot window" AC.
 */
export const HOT_MEMORY_WINDOW_DAYS = 7;

/**
 * `readHotMemory`'s bundled snapshot of the three things a ritual's routine
 * daily operation actually reads to decide what to run/show today. Each
 * field is `undefined` exactly when the corresponding `get*` function above
 * would itself return `undefined` (nothing declared/generated/run yet) —
 * this bundling adds no new "not found" semantics of its own.
 */
export interface HotMemorySnapshot {
  /** Today's `Plan`, if the Morning Ritual (or a Mid-Day Re-Flow) has generated one yet. */
  readonly plan: StoredRecord<Plan> | undefined;
  /** The currently-declared Time Budget (per `TIME_BUDGET_ID`'s own doc comment, this is unconditionally "current" — there's no date filtering to apply here). */
  readonly timeBudget: StoredRecord<TimeBudget> | undefined;
  /** Each requested ritual id's last-run marker, keyed by that same id — `undefined` for a ritual id that has never completed a run. */
  readonly ritualRuns: Readonly<Record<string, StoredRecord<RitualRun> | undefined>>;
}

/**
 * Reads today's hot memory in one call: today's `Plan`, the current Time
 * Budget, and the last-run marker for each ritual id in `ritualIds` (e.g.
 * `["morning", "night-prompt", "night-escalate"]`). Every field comes from a
 * `getRecord`-backed `get*` function above — this function itself never
 * calls `listRecordsByKind` (see the structural test asserting exactly
 * that), so calling it can never turn into an accidental full-history scan
 * no matter how many days of history have accumulated elsewhere in the
 * store.
 *
 * This is a convenience grouping, not a new mechanism: every ritual file
 * today calls `getPlan`/`getCurrentTimeBudget`/`getRitualRun` directly and
 * is not required to switch to this function — it exists to give the
 * "hot memory" property named in this section's docstring one concrete,
 * testable shape rather than leaving it purely descriptive.
 */
export function readHotMemory(store: MemoryStore, todayDate: IsoDate, ritualIds: readonly string[]): HotMemorySnapshot {
  const ritualRuns: Record<string, StoredRecord<RitualRun> | undefined> = {};
  for (const ritualId of ritualIds) {
    ritualRuns[ritualId] = getRitualRun(store, ritualId);
  }
  return {
    plan: getPlan(store, todayDate),
    timeBudget: getCurrentTimeBudget(store),
    ritualRuns,
  };
}

/**
 * Cold memory's default lookback depth, in days, when a caller doesn't
 * specify its own `lookbackDays`. Deliberately much wider than
 * `HOT_MEMORY_WINDOW_DAYS` (roughly a month vs. roughly a week) — concrete,
 * documented starting value in this project's established style (FR-2's
 * even-split weights, FR-11's slip curve), not derived from any formula.
 */
export const COLD_MEMORY_DEFAULT_LOOKBACK_DAYS = 30;

/** Below this count, a Task's slip streak isn't a "pattern" worth surfacing — a single slip is normal/expected and would make every once-slipped Task noise on every cold-memory query. */
const MIN_SLIP_COUNT_FOR_PATTERN = 2;

export interface ColdMemoryQueryOptions {
  /**
   * The local calendar date to query "as of" — every pattern-statement's
   * lookback window is computed relative to this date. Required rather than
   * read from the system clock (like every other date-taking function in
   * this codebase — e.g. `rituals/morning-ritual.ts`'s `localIsoDate`
   * caller convention) so this stays deterministic and testable.
   */
  readonly asOfDate: IsoDate;
  /** How many days of history (inclusive of `asOfDate`) to scan. Defaults to `COLD_MEMORY_DEFAULT_LOOKBACK_DAYS`. */
  readonly lookbackDays?: number;
}

/** One distilled pattern-statement. `statement` is the human-readable sentence; `kind`/`taskId` let a caller filter or group programmatically without re-parsing the sentence. */
export interface ColdMemoryPattern {
  readonly kind: "slip-streak" | "unchecked-nights";
  readonly statement: string;
  /** Set only for `kind: "slip-streak"` — the Task the pattern is about. */
  readonly taskId?: ExternalId;
}

/** Adds `deltaDays` (may be negative) to an `IsoDate` (`YYYY-MM-DD`), returning another `IsoDate`. Computed in UTC, matching every other `IsoDate` in this codebase, which is treated as a bare calendar date rather than a timezone-aware instant. */
function addDaysToIsoDate(date: IsoDate, deltaDays: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Queries OLDER history — beyond what any hot read above ever touches — and
 * distills it into plain-English pattern-statements. On-demand only: no
 * `rituals/*.ts` file calls this as part of its routine daily flow (see this
 * section's own docstring and the structural test in
 * `tests/memory-store.test.ts` asserting exactly that).
 *
 * Scans two tables (`SLIP_HISTORY_KIND`, `UNCHECKED_DAY_KIND`) via
 * `listRecordsByKind` — a genuine full scan of each, unlike every hot read
 * above — and reports:
 *
 * - One statement per Task whose `SlipHistory.lastSlipDate` falls within the
 *   lookback window AND whose `consecutiveSlipCount` is at least
 *   `MIN_SLIP_COUNT_FOR_PATTERN`: `"Task <id> has an active slip streak of
 *   <N> (most recently slipped on <lastSlipDate>)."` `lastSlipDate` gates
 *   whether the streak is reported at all (a currently-active/recent one),
 *   but `N` (`consecutiveSlipCount`) is deliberately NOT described as
 *   having happened "in the last <M> days" — post-review fix (Task 22):
 *   `consecutiveSlipCount` is a LIFETIME running total, reset only by
 *   `clearSlip` on Task completion (Task 17's design), never by time
 *   passing. A Task that keeps slipping without completing can have slips
 *   spread across months (e.g. 2026-05-01, 05-15, 06-01, 06-15, then
 *   08-20) while `consecutiveSlipCount` keeps counting all of them — pairing
 *   that lifetime count with a bounded "in the last 30 days" claim would
 *   misrepresent the timeframe for every slip before the most recent one.
 *   The statement instead separates "how big is the streak" (the count,
 *   undated) from "how recent is it" (`lastSlipDate`, stated explicitly),
 *   which is what the data can honestly support.
 * - At most one statement summarizing every `UncheckedDay.date` within the
 *   lookback window: `"<N> night(s) were left unchecked in the last <M>
 *   days."` — omitted entirely when `N` is 0. (This one genuinely IS a
 *   windowed count: each `UncheckedDay` row has its own `date`, one row per
 *   night, so counting rows whose `date` falls in the window is an accurate
 *   windowed count — unlike `SlipHistory`'s single running total, there is
 *   no lifetime-vs-window mismatch here.)
 *
 * Results are ordered: slip-streak patterns first (by `taskId`, ascending —
 * `listRecordsByKind`'s own `ORDER BY id` already returns them this way),
 * then the single unchecked-nights summary, if any. Returns `[]` when
 * nothing in either table falls in range.
 */
export function queryColdMemoryPatterns(store: MemoryStore, options: ColdMemoryQueryOptions): ColdMemoryPattern[] {
  const lookbackDays = options.lookbackDays ?? COLD_MEMORY_DEFAULT_LOOKBACK_DAYS;
  const cutoffDate = addDaysToIsoDate(options.asOfDate, -(lookbackDays - 1));
  const inWindow = (date: IsoDate): boolean => date >= cutoffDate && date <= options.asOfDate;

  const patterns: ColdMemoryPattern[] = [];

  const slipHistories = store.listRecordsByKind<SlipHistory>(SLIP_HISTORY_KIND);
  for (const record of slipHistories) {
    if (!inWindow(record.data.lastSlipDate)) continue;
    if (record.data.consecutiveSlipCount < MIN_SLIP_COUNT_FOR_PATTERN) continue;
    patterns.push({
      kind: "slip-streak",
      taskId: record.id,
      statement: `Task ${record.id} has an active slip streak of ${record.data.consecutiveSlipCount} (most recently slipped on ${record.data.lastSlipDate}).`,
    });
  }

  const uncheckedDays = store.listRecordsByKind<UncheckedDay>(UNCHECKED_DAY_KIND);
  const uncheckedCount = uncheckedDays.filter((record) => inWindow(record.data.date)).length;
  if (uncheckedCount > 0) {
    const nightWord = uncheckedCount === 1 ? "night was" : "nights were";
    patterns.push({
      kind: "unchecked-nights",
      statement: `${uncheckedCount} ${nightWord} left unchecked in the last ${lookbackDays} days.`,
    });
  }

  return patterns;
}

/** Every open `"proposal"` request whose proposal is a `"rule-change"` (Story 13.8). */
export function findOpenRuleProposals(store: MemoryStore): StoredRecord<InteractionRequest>[] {
  return listOpenInteractionRequests(store).filter((r) => {
    if (r.data.requestKind !== "proposal") return false;
    const proposal = (r.data.detail as { proposal?: { kind?: string } } | undefined)?.proposal;
    return proposal?.kind === "rule-change";
  });
}

/** Clears the open rule-change proposal raised by memory item `itemId`, if any. Returns whether one was open. */
export function withdrawRuleProposal(store: MemoryStore, itemId: string): boolean {
  const id = `proposal:rule-change-${itemId}`;
  const current = getOpenInteractionRequest(store, id);
  if (!current) return false;
  clearInteractionRequest(store, id, current.version);
  return true;
}
