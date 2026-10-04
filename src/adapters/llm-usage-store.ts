/**
 * src/adapters/llm-usage-store.ts
 *
 * Real-use fixes plan, Task 9 (AD-10): the sole owner of the `llm_usage`
 * table — one row per real Claude API call `llm-adapter.ts` makes (both
 * non-streaming and streaming), so Epic 12's Desk can later show "Claude
 * API spend this month" by summing these rows through `core/llm-cost.ts`'s
 * pure cost function. The table is created idempotently on startup, the
 * same convention `notification-store.ts`/`plan-state-store.ts`/
 * `completion-log.ts` already use (`init*Schema(db)`, called once per
 * process right after `openSqliteConnection`). This store receives the
 * process's shared `SqliteConnection` (Story 7.1) and never opens its own.
 *
 * `llm-adapter.ts` is this file's one real caller — an `adapters/*.ts` file
 * importing a SIBLING `adapters/*.ts` file is permitted by AD-1
 * (`adapters -> types`, plus sibling adapters, as today — mirrors
 * `notification-store.ts` importing `sqlite.ts`, or `notion-adapter.ts`
 * importing `notion-select-match.ts`). `llm-adapter.ts` calls
 * `recordLlmUsage` right after every real Claude call, inside its own
 * try/catch — Task 9's own requirement is that a failed usage-recording
 * write must never break a chat turn, and that error-swallowing decision
 * belongs to the call site that actually knows "a turn is in flight," not
 * to this file. This file's own job is just the schema plus a plain
 * single-row insert/read (AD-10: `writeTx` is for MULTI-step writes; a
 * lone `INSERT` needs no transaction wrapper).
 */
import type Database from "better-sqlite3";
import type { SqliteConnection } from "./sqlite.ts";

/**
 * The one closed set of `purpose` labels `llm-adapter.ts`'s six real
 * Claude-calling functions tag their own usage rows with — one label per
 * function (never reused across two different functions), matching Task
 * 9's own list: `classify`, `capture` and `answer` (the pre-tool-loop chat
 * routing calls, since removed — kept here because stored rows carry them),
 * `draft-notion` (`draftNotionPageFields`), `draft-calendar`
 * (`draftCalendarEditRequest`), `suggest-field` (`suggestFieldValue`),
 * `quick-add-normalize` (Polish 4 Task 1: `normalizeQuickAddLine`),
 * `agent` (`runToolTurn`).
 */
export type LlmUsagePurpose = "classify" | "capture" | "answer" | "draft-notion" | "draft-calendar" | "suggest-field" | "quick-add-normalize" | "extract-memories" | "agent";

/** One recorded Claude API call. Field names are camelCase (this codebase's usual TS convention — mirrors `notification-store.ts`'s `CreateNotificationInput`'s `deepLink` vs. its own `deep_link` SQL column); the SQL table itself uses `snake_case` columns, per Task 9's own column list. */
export interface LlmUsageRecord {
  /** ISO-8601 UTC timestamp of the call. */
  readonly at: string;
  /** The exact model id `llm-adapter.ts` requested (e.g. `"claude-haiku-4-5-20251001"`, `"claude-sonnet-5"`) — `core/llm-cost.ts`'s `normalizeModelId` resolves a dated snapshot id to its price-table row. */
  readonly model: string;
  readonly purpose: LlmUsagePurpose;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
}

/**
 * Idempotently creates the `llm_usage` table. Called once per process at
 * startup, right after `openSqliteConnection` — every SHELL that makes an
 * LLM call must call this before any `recordLlmUsage`. Today that's only
 * `shell/server.ts` (`POST /api/chat`'s `llm-adapter.ts` calls);
 * `shell/ritual-cli.ts` never calls Claude at all (no `rituals/*.ts` file
 * imports `llm-adapter.ts`), so it needs no call to this function.
 */
export function initLlmUsageStoreSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      model TEXT NOT NULL,
      purpose TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_creation_input_tokens INTEGER NOT NULL,
      cache_read_input_tokens INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_usage_at ON llm_usage (at);
  `);
}

/**
 * Appends one row. A single-statement write, not wrapped in `writeTx`
 * (AD-10's transaction primitive is for multi-step writes — a lone
 * `INSERT` needs none). May throw on a genuine SQLite failure;
 * `llm-adapter.ts`'s call sites catch and log rather than let a recording
 * failure break a chat turn (Task 9's own requirement).
 */
export function recordLlmUsage(connection: SqliteConnection, record: LlmUsageRecord): void {
  connection.db
    .prepare(
      `INSERT INTO llm_usage (at, model, purpose, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.at,
      record.model,
      record.purpose,
      record.inputTokens,
      record.outputTokens,
      record.cacheCreationInputTokens,
      record.cacheReadInputTokens,
    );
}

/**
 * Every recorded row, oldest first. Epic 12's Desk ("Claude API spend this
 * month") reads through this (filtering/summing by `at`, via
 * `core/llm-cost.ts`'s pure cost function) — no other file queries
 * `llm_usage` directly, mirroring `notification-store.ts`'s single-owner
 * convention.
 */
export function listLlmUsage(connection: SqliteConnection): readonly LlmUsageRecord[] {
  return readUsage(connection, "ORDER BY id ASC");
}

/** Rows whose `at` is at or after `sinceIso` (an ISO-8601 UTC string), oldest first, read through `idx_llm_usage_at`. */
export function listLlmUsageSince(connection: SqliteConnection, sinceIso: string): readonly LlmUsageRecord[] {
  return readUsage(connection, "WHERE at >= ? ORDER BY at ASC, id ASC", [sinceIso]);
}

function readUsage(connection: SqliteConnection, tail: string, params: readonly string[] = []): readonly LlmUsageRecord[] {
  const rows = connection.db
    .prepare(
      `SELECT at, model, purpose, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
       FROM llm_usage ${tail}`,
    )
    .all(...params) as ReadonlyArray<{
    readonly at: string;
    readonly model: string;
    readonly purpose: LlmUsagePurpose;
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cache_creation_input_tokens: number;
    readonly cache_read_input_tokens: number;
  }>;
  return rows.map((r) => ({
    at: r.at,
    model: r.model,
    purpose: r.purpose,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheCreationInputTokens: r.cache_creation_input_tokens,
    cacheReadInputTokens: r.cache_read_input_tokens,
  }));
}
