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
import type { ExternalId, InteractionRequest, IsoDate, IsoDateTime, Plan, TaskFieldOverride, TimeBudget, YohError } from "../types/domain.ts";

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
 * genuine concurrent writer (AD-10: `ritual-cli.ts` and `chat-cli.ts` running
 * concurrently) still surfaces `ConflictError` rather than silently
 * clobbering a change made between this function's internal read and write.
 */
export function putTimeBudget(store: MemoryStore, budget: TimeBudget): StoredRecord<TimeBudget> {
  const current = store.getRecord<TimeBudget>(TIME_BUDGET_KIND, TIME_BUDGET_ID);
  return store.readModifyWrite<TimeBudget>(TIME_BUDGET_KIND, TIME_BUDGET_ID, current?.version, () => budget);
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
export function putPlan(store: MemoryStore, plan: Plan): StoredRecord<Plan> {
  const current = store.getRecord<Plan>(PLAN_KIND, plan.date);
  return store.readModifyWrite<Plan>(PLAN_KIND, plan.date, current?.version, () => plan);
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
 * old ones. Epic 3's night rituals (Tasks 19/20) and Epic 5's self-check
 * (Task 24) reuse this same shape with their own ritual ids.
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
 * lineage-view display (`shell/chat-cli.ts`'s "why is X prioritized"
 * command, UX-DR19).
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
export function recordSlip(store: MemoryStore, taskId: string, slipDate: IsoDate): StoredRecord<SlipHistory> {
  const current = store.getRecord<SlipHistory>(SLIP_HISTORY_KIND, taskId);
  if (current?.data.lastSlipDate === slipDate) {
    return current; // Already recorded for this exact date — no-op, not a second increment.
  }
  return store.readModifyWrite<SlipHistory>(SLIP_HISTORY_KIND, taskId, current?.version, (existing) => ({
    consecutiveSlipCount: (existing?.data.consecutiveSlipCount ?? 0) + 1,
    lastSlipDate: slipDate,
  }));
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
 * been answered or explicitly skipped — see `chat-cli.ts`'s
 * `answerNightCloseOutRequest`) are exactly what "rolled forward." Snapshot
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
 * surfaces `ConflictError` per AD-10) and patches only `shownAt`, leaving
 * `rolledForwardTasks`/`recordedAt` untouched. Called by
 * `rituals/morning-ritual.ts`, once, right after it has actually delivered
 * a Plan carrying this night's notice (see `UncheckedDay.shownAt`'s own doc
 * comment for why this is a separate step from `putUncheckedDay`).
 *
 * Throws if no row exists for `date` yet — a caller should only ever call
 * this for a date it just read via `getUncheckedDay`/`listUncheckedDays`,
 * so a missing row here means a genuine concurrent delete (nothing in this
 * codebase currently deletes an `UncheckedDay` row) or a caller bug, either
 * of which should surface loudly rather than silently create a
 * `shownAt`-only row with no `rolledForwardTasks` to have ever displayed.
 */
export function markUncheckedDayShown(store: MemoryStore, date: IsoDate, shownAt: IsoDateTime): StoredRecord<UncheckedDay> {
  const current = store.getRecord<UncheckedDay>(UNCHECKED_DAY_KIND, date);
  if (!current) {
    throw new Error(`memory-store: cannot mark ${date} as shown — no UncheckedDay record exists for it`);
  }
  return store.readModifyWrite<UncheckedDay>(UNCHECKED_DAY_KIND, date, current.version, (existing) => ({
    ...(existing?.data as UncheckedDay),
    shownAt,
  }));
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
