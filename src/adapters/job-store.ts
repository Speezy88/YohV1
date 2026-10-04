/**
 * Research job store (Story 11.3, E11-R8): one row per queued background research question.
 * `queued` -> `running` (claimed, one at a time) -> `done` | `failed`. Mark functions take the
 * caller's transaction so the runner can write its notification in the same `writeTx`.
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { IsoDateTime } from "../types/domain.ts";
import type { SqliteConnection } from "./sqlite.ts";

export type ResearchJobStatus = "queued" | "running" | "done" | "failed";

export interface ResearchJob {
  readonly id: string;
  readonly question: string;
  readonly status: ResearchJobStatus;
  readonly createdAt: IsoDateTime;
  readonly claimedAt?: IsoDateTime;
  readonly finishedAt?: IsoDateTime;
  readonly pageId?: string;
  readonly error?: string;
}

interface JobRow {
  id: string;
  question: string;
  status: ResearchJobStatus;
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
  page_id: string | null;
  error: string | null;
}

export function initJobStoreSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_jobs (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
      created_at TEXT NOT NULL,
      claimed_at TEXT,
      finished_at TEXT,
      page_id TEXT,
      error TEXT
    );
  `);
}

function fromRow(r: JobRow): ResearchJob {
  return {
    id: r.id,
    question: r.question,
    status: r.status,
    createdAt: r.created_at,
    ...(r.claimed_at ? { claimedAt: r.claimed_at } : {}),
    ...(r.finished_at ? { finishedAt: r.finished_at } : {}),
    ...(r.page_id ? { pageId: r.page_id } : {}),
    ...(r.error ? { error: r.error } : {}),
  };
}

/** Inserts one `queued` job inside the caller's `writeTx`; returns its id. */
export function insertQueuedResearchJobInTx(tx: Database.Database, input: { question: string; createdAt: IsoDateTime }): string {
  const id = randomUUID();
  tx.prepare(`INSERT INTO research_jobs (id, question, status, created_at) VALUES (?, ?, 'queued', ?)`).run(id, input.question, input.createdAt);
  return id;
}

/**
 * Claims the oldest queued job (ties by insertion order), setting it `running`. Atomic; returns
 * nothing when the queue is empty or another job is already `running`.
 */
export function claimNextResearchJob(connection: SqliteConnection, claimedAt: IsoDateTime): ResearchJob | undefined {
  return connection.writeTx((tx) => {
    const running = tx.prepare(`SELECT 1 FROM research_jobs WHERE status = 'running' LIMIT 1`).get();
    if (running) return undefined;
    const next = tx.prepare(`SELECT * FROM research_jobs WHERE status = 'queued' ORDER BY created_at ASC, rowid ASC LIMIT 1`).get() as JobRow | undefined;
    if (!next) return undefined;
    tx.prepare(`UPDATE research_jobs SET status = 'running', claimed_at = ? WHERE id = ?`).run(claimedAt, next.id);
    return fromRow({ ...next, status: "running", claimed_at: claimedAt });
  });
}

export function markResearchJobDoneInTx(tx: Database.Database, id: string, input: { pageId: string; finishedAt: IsoDateTime }): void {
  tx.prepare(`UPDATE research_jobs SET status = 'done', page_id = ?, finished_at = ? WHERE id = ?`).run(input.pageId, input.finishedAt, id);
}

export function markResearchJobFailedInTx(tx: Database.Database, id: string, input: { error: string; finishedAt: IsoDateTime }): void {
  tx.prepare(`UPDATE research_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`).run(input.error, input.finishedAt, id);
}

export function listRunningResearchJobs(connection: SqliteConnection): ResearchJob[] {
  const rows = connection.db.prepare(`SELECT * FROM research_jobs WHERE status = 'running' ORDER BY created_at ASC, rowid ASC`).all() as JobRow[];
  return rows.map(fromRow);
}
