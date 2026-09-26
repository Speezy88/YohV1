/**
 * src/adapters/plan-state-store.ts
 *
 * Story 7.4, AD-7/AD-10: created with only a heartbeat table for now
 * (Pins and pending check-offs, per AD-10's Structural Seed, arrive in
 * Story 7.10 as new tables in this same file — one owner, dedicated
 * tables, created idempotently). The heartbeat is a single-row singleton:
 * "is the server alive" has exactly one current answer, never a history.
 */
import type Database from "better-sqlite3";
import type { SqliteConnection } from "./sqlite.ts";

/** How often `shell/server.ts` writes a heartbeat (Shared tuning constants convention — the one defining export). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** How old a heartbeat must be before `ritual-cli.ts morning` treats the server as down (AD-7). Comfortably larger than `HEARTBEAT_INTERVAL_MS` so ordinary GC pauses/poll jitter never false-alarm. */
export const HEARTBEAT_STALE_THRESHOLD_MS = 300_000;

const HEARTBEAT_ROW_ID = 1;

export function initPlanStateStoreSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS heartbeat (id INTEGER PRIMARY KEY CHECK (id = ${HEARTBEAT_ROW_ID}), at TEXT NOT NULL)`);
}

/** Upserts the singleton heartbeat row — the latest write replaces, never appends. */
export function writeHeartbeat(connection: SqliteConnection, at: string): void {
  connection.db
    .prepare(`INSERT INTO heartbeat (id, at) VALUES (${HEARTBEAT_ROW_ID}, @at) ON CONFLICT(id) DO UPDATE SET at = @at`)
    .run({ at });
}

/** The last-written heartbeat timestamp, or `undefined` if none has ever been written (cold start — treated as stale by `isHeartbeatStale`). */
export function getLastHeartbeatAt(connection: SqliteConnection): string | undefined {
  const row = connection.db.prepare(`SELECT at FROM heartbeat WHERE id = ${HEARTBEAT_ROW_ID}`).get() as { at: string } | undefined;
  return row?.at;
}

/**
 * Pure staleness check (AD-2's spirit, applied here even though this file
 * is `adapters/*`, not `core/*`, since it takes no I/O itself): `undefined`
 * (never written) is always stale — the ordinary, expected state before
 * the server has ever run once, and indistinguishable from "it's been down
 * the whole time" from `ritual-cli.ts`'s point of view, so both alert.
 */
export function isHeartbeatStale(
  lastHeartbeatAt: string | undefined,
  now: Date,
  thresholdMs: number = HEARTBEAT_STALE_THRESHOLD_MS,
): boolean {
  if (lastHeartbeatAt === undefined) return true;
  return now.getTime() - new Date(lastHeartbeatAt).getTime() > thresholdMs;
}
