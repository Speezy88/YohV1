/**
 * src/adapters/notification-store.ts
 *
 * Story 7.3, AD-10/AD-18: the sole owner of the `notifications` and `outbox`
 * tables — dedicated tables created idempotently on startup (never
 * `memory-store.ts`'s generic `(kind, id)` blob table). No other file reads
 * or writes either table; `tests/notification-store.test.ts` source-scans
 * `src/` to keep it that way. The store receives the process's shared
 * `SqliteConnection` (Story 7.1) and never opens its own.
 *
 * Any process — the server, or a cron ritual via `shell/ritual-cli.ts` —
 * creates an in-app notification through this file only (AD-18, FR-49).
 * `kind` is typed as the closed `NotificationKind` union from
 * `types/api.ts`, so a check-in or progress notification can't be
 * constructed.
 *
 * Transaction shape (AD-10's `…InTx(tx, …)` convention):
 *   - `createNotificationInTx(tx, input)` writes the notification row AND
 *     its outbox row, inside the caller's `writeTx`, so they commit (or roll
 *     back) together.
 *   - `appendOutboxInTx(tx, {topic, entityId})` is the one way ANY owner
 *     signals a user-visible change (Story 7.8's Plan, Story 7.10's
 *     check-offs, ...) without touching the `outbox` table itself.
 *   - `createNotification(connection, input)` is the single-owner
 *     convenience that opens its own `writeTx`.
 *
 * Outbox ordering: `seq` is `INTEGER PRIMARY KEY AUTOINCREMENT`, so it is
 * monotonic and never reused. Every write goes through `BEGIN IMMEDIATE`
 * (one writer at a time across processes), so seqs become visible in commit
 * order and a tail reader never sees seq N+1 before seq N.
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { SqliteConnection } from "./sqlite.ts";
import type { EventHint, NotificationKind, NotificationRecord } from "../types/api.ts";

/**
 * How often `GET /api/events` tails the outbox (AD-18, `[ASSUMPTION: ~2s]`).
 * The ONE defining export of this shared tuning constant (Consistency
 * Conventions); `shell/server.ts`'s event stream imports it, nothing
 * redeclares it.
 */
export const OUTBOX_POLL_INTERVAL_MS = 2000;

/** The outbox topic for a notification created or marked read; `entityId` is the notification id. */
export const NOTIFICATION_TOPIC = "notification";

/** Idempotently creates both tables. Called once per process at startup, after `openSqliteConnection`. */
export function initNotificationStoreSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      deep_link TEXT,
      created_at TEXT NOT NULL,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (read_at, created_at);
    CREATE TABLE IF NOT EXISTS outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

/**
 * What a caller supplies to raise a notification. `deepLink` is a required
 * key with a nullable value (Ruling R11): an `operational` notification is
 * message-only and passes `null`.
 */
export interface CreateNotificationInput {
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly deepLink: string | null;
  /** ISO-8601 UTC. */
  readonly createdAt: string;
}

/** One `{topic, entityId}` outbox entry; the store assigns `seq`. */
export interface OutboxEntry {
  readonly topic: string;
  readonly entityId: string;
}

/**
 * Appends one outbox row. Call ONLY from inside a `writeTx`, alongside the
 * owner's own write, so the hint commits atomically with the change it
 * announces (AD-18).
 */
export function appendOutboxInTx(tx: Database.Database, entry: OutboxEntry): void {
  tx.prepare(`INSERT INTO outbox (topic, entity_id, created_at) VALUES (@topic, @entityId, @createdAt)`).run({
    topic: entry.topic,
    entityId: entry.entityId,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Inserts one notification row plus its `notification` outbox row, inside
 * the caller's `writeTx` (AD-18). Returns the generated id.
 */
export function createNotificationInTx(tx: Database.Database, input: CreateNotificationInput): string {
  const id = randomUUID();
  tx.prepare(
    `INSERT INTO notifications (id, kind, title, body, deep_link, created_at)
     VALUES (@id, @kind, @title, @body, @deepLink, @createdAt)`,
  ).run({
    id,
    kind: input.kind,
    title: input.title,
    body: input.body,
    deepLink: input.deepLink,
    createdAt: input.createdAt,
  });
  appendOutboxInTx(tx, { topic: NOTIFICATION_TOPIC, entityId: id });
  return id;
}

/** Single-owner convenience: `createNotificationInTx` in its own `writeTx`. Returns the generated id. */
export function createNotification(connection: SqliteConnection, input: CreateNotificationInput): string {
  return connection.writeTx((tx) => createNotificationInTx(tx, input));
}

interface OutboxDbRow {
  readonly seq: number;
  readonly topic: string;
  readonly entity_id: string;
}

/** Every outbox hint with `seq > sinceSeq`, in `seq` order — what the event stream reads each poll tick. */
export function tailOutboxSince(connection: SqliteConnection, sinceSeq: number): EventHint[] {
  const rows = connection.db
    .prepare<{ sinceSeq: number }, OutboxDbRow>(`SELECT seq, topic, entity_id FROM outbox WHERE seq > @sinceSeq ORDER BY seq`)
    .all({ sinceSeq });
  return rows.map((r) => ({ seq: r.seq, topic: r.topic, entityId: r.entity_id }));
}

/** How many of the newest outbox rows the nightly prune keeps (proposed default; Spencer has not confirmed the number). */
export const OUTBOX_KEEP_ROWS = 10_000;

/**
 * Deletes every outbox row older than the newest `keep`, and returns how many went. The highest `seq`
 * always stays, so `seq` keeps counting up. An event stream resuming from a pruned `seq` simply gets the
 * rows that remain: hints only trigger refetches, so the lost ones cost nothing.
 */
export function pruneOutbox(connection: SqliteConnection, options: { readonly keep: number }): number {
  return connection.writeTx(
    (db) => db.prepare<{ keep: number }>(`DELETE FROM outbox WHERE seq <= (SELECT COALESCE(MAX(seq), 0) FROM outbox) - @keep`).run({ keep: options.keep }).changes,
  );
}

/** The highest outbox `seq`, or 0 when empty — where a fresh (no `Last-Event-ID`) stream starts. */
export function getMaxOutboxSeq(connection: SqliteConnection): number {
  const row = connection.db.prepare<[], { maxSeq: number }>(`SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM outbox`).get();
  return row?.maxSeq ?? 0;
}

interface NotificationDbRow {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly deep_link: string | null;
  readonly created_at: string;
  readonly read_at: string | null;
}

function rowToRecord(row: NotificationDbRow): NotificationRecord {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    deepLink: row.deep_link,
    createdAt: row.created_at,
    ...(row.read_at !== null ? { readAt: row.read_at } : {}),
  };
}

/** Every notification with no `readAt`, oldest first. */
export function listUnreadNotifications(connection: SqliteConnection): NotificationRecord[] {
  return connection.db
    .prepare<[], NotificationDbRow>(
      `SELECT id, kind, title, body, deep_link, created_at, read_at
       FROM notifications WHERE read_at IS NULL ORDER BY created_at, rowid`,
    )
    .all()
    .map(rowToRecord);
}

export type MarkReadOutcome =
  | { readonly status: "marked"; readonly readAt: string }
  | { readonly status: "already-read"; readonly readAt: string }
  | { readonly status: "not-found" };

/**
 * Sets `readAt` on an unread notification and appends a `notification`
 * outbox hint in the same `writeTx` (a read-state change is user-visible:
 * other open tabs drop it from their unread list). Idempotent: an
 * already-read notification keeps its first `readAt` and no hint is added.
 */
export function markNotificationRead(connection: SqliteConnection, id: string, readAt: string): MarkReadOutcome {
  return connection.writeTx((tx): MarkReadOutcome => {
    const row = tx.prepare<{ id: string }, { read_at: string | null }>(`SELECT read_at FROM notifications WHERE id = @id`).get({ id });
    if (row === undefined) return { status: "not-found" };
    if (row.read_at !== null) return { status: "already-read", readAt: row.read_at };
    tx.prepare(`UPDATE notifications SET read_at = @readAt WHERE id = @id`).run({ id, readAt });
    appendOutboxInTx(tx, { topic: NOTIFICATION_TOPIC, entityId: id });
    return { status: "marked", readAt };
  });
}
