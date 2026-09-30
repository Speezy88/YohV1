/**
 * Memory item store (Story 13.3, AD-26): sole owner of `memory_items`, its
 * external-content FTS5 index, `pattern_state`, and `searchRelevant`. Every
 * write runs in `writeTx` and appends one `memory` outbox row. Throws plain,
 * typed errors; `app/` callers catch and degrade.
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { ExternalId, IsoDate, IsoDateTime, MemoryFolder, MemoryItem } from "../types/domain.ts";
import type { SqliteConnection } from "./sqlite.ts";
import { appendOutboxInTx } from "./notification-store.ts";
import { MEMORY_TOPIC } from "./chat-store.ts";
import { MEMORY_ITEM_MAX_CHARS } from "../core/memory-folders.ts";
import { ftsQuery } from "../core/fts-query.ts";

export interface NewMemoryItem {
  folder: MemoryFolder;
  text: string;
  origin: "stated" | "inferred";
  scope?: string;
  expiresOn?: IsoDate;
  entityRef?: ExternalId;
  ruleChange?: MemoryItem["ruleChange"];
  sourceTurnId?: string;
  at?: IsoDateTime;
}

export class MemoryItemValidationError extends Error {
  readonly kind = "validation";
}

export interface PatternState {
  kind: string;
  area: string;
  pendingProposalId?: string;
  declinedAt?: IsoDateTime;
  lastOfferedOn?: IsoDate;
  /** Story 13.13: when a Yes filed this pattern; only observations after it count toward a new proposal. */
  confirmedAt?: IsoDateTime;
}

export interface MemoryReceipt {
  receiptId: string;
  conversationId: string;
  userTurnId: string;
  kind: "remembered" | "forgot";
  itemIds: string[];
  chainIds: string[];
  createdAt: IsoDateTime;
  undoneAt?: IsoDateTime;
}

interface ReceiptRow {
  receipt_id: string;
  conversation_id: string;
  user_turn_id: string;
  kind: MemoryReceipt["kind"];
  item_ids: string;
  chain_ids: string;
  created_at: string;
  undone_at: string | null;
}

function toReceipt(r: ReceiptRow): MemoryReceipt {
  const out: MemoryReceipt = {
    receiptId: r.receipt_id,
    conversationId: r.conversation_id,
    userTurnId: r.user_turn_id,
    kind: r.kind,
    itemIds: JSON.parse(r.item_ids) as string[],
    chainIds: JSON.parse(r.chain_ids) as string[],
    createdAt: r.created_at,
  };
  if (r.undone_at !== null) out.undoneAt = r.undone_at;
  return out;
}

export interface MemoryItemStore {
  putReceipt(receipt: Omit<MemoryReceipt, "undoneAt">): void;
  getReceipt(receiptId: string): MemoryReceipt | undefined;
  /** Newest receipt of `kind` in the conversation that has not been undone. */
  latestReceipt(conversationId: string, kind: MemoryReceipt["kind"]): MemoryReceipt | undefined;
  /** Every receipt for a Conversation, oldest first (undone ones included). */
  receiptsForConversation(conversationId: string): MemoryReceipt[];
  markReceiptUndone(receiptId: string, at?: IsoDateTime): void;
  insert(input: NewMemoryItem): MemoryItem;
  supersede(oldId: string, next: NewMemoryItem): MemoryItem;
  merge(oldIds: readonly [string, string], next: NewMemoryItem): MemoryItem;
  getItem(id: string): MemoryItem | undefined;
  listItems(filter?: { status?: readonly MemoryItem["status"][]; folders?: readonly MemoryFolder[] }): MemoryItem[];
  chainOf(id: string): MemoryItem[];
  forget(id: string): { chainIds: string[] };
  restore(chainIds: readonly string[]): void;
  purgeDeleted(): number;
  /** Removes exactly these rows for good (Memory page Delete); one outbox row. Leaves other deleted chains alone. */
  purgeChain(chainIds: readonly string[]): void;
  undoFiling(newId: string): void;
  keepAsHistory(id: string): void;
  setRuleChange(id: string, ruleChange: MemoryItem["ruleChange"]): void;
  searchRelevant(text: string, folders: readonly MemoryFolder[], limit: number): MemoryItem[];
  touchMatched(ids: readonly string[], at?: IsoDateTime): void;
  getPatternState(kind: string, area: string): PatternState | undefined;
  putPatternState(state: PatternState): void;
  listPatternStates(): PatternState[];
  clearAll(): void;
}

interface ItemRow {
  id: string;
  folder: MemoryFolder;
  text: string;
  origin: MemoryItem["origin"];
  scope: string | null;
  expires_on: string | null;
  entity_ref: string | null;
  rule_change: MemoryItem["ruleChange"];
  status: MemoryItem["status"];
  prior_status: string | null;
  replaces_id: string | null;
  superseded_by: string | null;
  source_turn_id: string | null;
  created_at: string;
  confirmed_at: string;
  last_matched_at: string | null;
}

interface PatternRow {
  kind: string;
  area: string;
  pending_proposal_id: string | null;
  declined_at: string | null;
  last_offered_on: string | null;
  confirmed_at: string | null;
}

export function initMemoryItemStoreSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      folder TEXT NOT NULL,
      text TEXT NOT NULL,
      origin TEXT NOT NULL,
      scope TEXT,
      expires_on TEXT,
      entity_ref TEXT,
      rule_change TEXT NOT NULL DEFAULT 'none',
      status TEXT NOT NULL DEFAULT 'current',
      prior_status TEXT,
      replaces_id TEXT,
      superseded_by TEXT,
      source_turn_id TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT NOT NULL,
      last_matched_at TEXT
    );
    CREATE INDEX IF NOT EXISTS memory_items_status_idx ON memory_items (status, folder);
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(text, content='memory_items', content_rowid='rowid');
    CREATE TRIGGER IF NOT EXISTS memory_items_ai AFTER INSERT ON memory_items BEGIN
      INSERT INTO memory_items_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_items_ad AFTER DELETE ON memory_items BEGIN
      INSERT INTO memory_items_fts(memory_items_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_items_au AFTER UPDATE OF text ON memory_items BEGIN
      INSERT INTO memory_items_fts(memory_items_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      INSERT INTO memory_items_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TABLE IF NOT EXISTS memory_receipts (
      receipt_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_turn_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      item_ids TEXT NOT NULL,
      chain_ids TEXT NOT NULL,
      created_at TEXT NOT NULL,
      undone_at TEXT
    );
    CREATE INDEX IF NOT EXISTS memory_receipts_conv_idx ON memory_receipts (conversation_id, kind, created_at);
    CREATE TABLE IF NOT EXISTS pattern_state (
      kind TEXT NOT NULL,
      area TEXT NOT NULL,
      pending_proposal_id TEXT,
      declined_at TEXT,
      last_offered_on TEXT,
      PRIMARY KEY (kind, area)
    );
  `);
  // Databases created before Story 13.13 lack the column.
  const patternColumns = db.prepare("PRAGMA table_info(pattern_state)").all() as { name: string }[];
  if (!patternColumns.some((c) => c.name === "confirmed_at")) db.exec("ALTER TABLE pattern_state ADD COLUMN confirmed_at TEXT");
}

function toItem(r: ItemRow): MemoryItem {
  const item: MemoryItem = {
    id: r.id,
    folder: r.folder,
    text: r.text,
    origin: r.origin,
    ruleChange: r.rule_change,
    status: r.status,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
  };
  if (r.scope !== null) item.scope = r.scope;
  if (r.expires_on !== null) item.expiresOn = r.expires_on;
  if (r.entity_ref !== null) item.entityRef = r.entity_ref;
  if (r.replaces_id !== null) item.replacesId = r.replaces_id;
  if (r.source_turn_id !== null) item.sourceTurnId = r.source_turn_id;
  if (r.last_matched_at !== null) item.lastMatchedAt = r.last_matched_at;
  return item;
}

function toPattern(r: PatternRow): PatternState {
  const s: PatternState = { kind: r.kind, area: r.area };
  if (r.pending_proposal_id !== null) s.pendingProposalId = r.pending_proposal_id;
  if (r.declined_at !== null) s.declinedAt = r.declined_at;
  if (r.last_offered_on !== null) s.lastOfferedOn = r.last_offered_on;
  if (r.confirmed_at !== null) s.confirmedAt = r.confirmed_at;
  return s;
}

function validate(input: NewMemoryItem): string {
  const text = input.text.trim();
  if (text.length === 0) throw new MemoryItemValidationError("Memory text is empty.");
  if (text.length > MEMORY_ITEM_MAX_CHARS) throw new MemoryItemValidationError(`Memory text is over ${MEMORY_ITEM_MAX_CHARS} characters.`);
  return text;
}

function insertRow(db: Database.Database, input: NewMemoryItem, text: string, ruleChange: MemoryItem["ruleChange"], replacesId: string | null): string {
  const id = randomUUID();
  const at = input.at ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO memory_items (id, folder, text, origin, scope, expires_on, entity_ref, rule_change, status, replaces_id, source_turn_id, created_at, confirmed_at)
     VALUES (@id, @folder, @text, @origin, @scope, @expiresOn, @entityRef, @ruleChange, 'current', @replacesId, @sourceTurnId, @at, @at)`,
  ).run({
    id,
    folder: input.folder,
    text,
    origin: input.origin,
    scope: input.scope ?? null,
    expiresOn: input.expiresOn ?? null,
    entityRef: input.entityRef ?? null,
    ruleChange,
    replacesId,
    sourceTurnId: input.sourceTurnId ?? null,
    at,
  });
  return id;
}

function getRow(db: Database.Database, id: string): ItemRow | undefined {
  return db.prepare<[string], ItemRow>(`SELECT * FROM memory_items WHERE id = ?`).get(id);
}

function requireRow(db: Database.Database, id: string): ItemRow {
  const row = getRow(db, id);
  if (!row) throw new Error(`Memory item not found: ${id}`);
  return row;
}

function chainRows(db: Database.Database, id: string): ItemRow[] {
  const seen = new Map<string, ItemRow>();
  const queue = [id];
  while (queue.length > 0) {
    const cur = queue.pop() as string;
    if (seen.has(cur)) continue;
    const row = getRow(db, cur);
    if (!row) continue;
    seen.set(cur, row);
    if (row.replaces_id) queue.push(row.replaces_id);
    if (row.superseded_by) queue.push(row.superseded_by);
    for (const n of db.prepare<[string, string], { id: string }>(`SELECT id FROM memory_items WHERE replaces_id = ? OR superseded_by = ?`).all(cur, cur)) queue.push(n.id);
  }
  return [...seen.values()];
}

export function createMemoryItemStore(connection: SqliteConnection): MemoryItemStore {
  const { db } = connection;
  initMemoryItemStoreSchema(db);
  const hint = (tx: Database.Database, entityId: string): void => appendOutboxInTx(tx, { topic: MEMORY_TOPIC, entityId });
  const read = (id: string): MemoryItem => toItem(requireRow(db, id));

  return {
    putReceipt(r) {
      connection.writeTx((tx) => {
        tx.prepare(
          `INSERT INTO memory_receipts (receipt_id, conversation_id, user_turn_id, kind, item_ids, chain_ids, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(r.receiptId, r.conversationId, r.userTurnId, r.kind, JSON.stringify(r.itemIds), JSON.stringify(r.chainIds), r.createdAt);
        hint(tx, r.receiptId);
      });
    },
    getReceipt(receiptId) {
      const row = db.prepare<[string], ReceiptRow>(`SELECT * FROM memory_receipts WHERE receipt_id = ?`).get(receiptId);
      return row ? toReceipt(row) : undefined;
    },
    latestReceipt(conversationId, kind) {
      const row = db
        .prepare<[string, string], ReceiptRow>(
          `SELECT * FROM memory_receipts WHERE conversation_id = ? AND kind = ? AND undone_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        )
        .get(conversationId, kind);
      return row ? toReceipt(row) : undefined;
    },
    receiptsForConversation(conversationId) {
      return db
        .prepare<[string], ReceiptRow>(`SELECT * FROM memory_receipts WHERE conversation_id = ? ORDER BY created_at, rowid`)
        .all(conversationId)
        .map(toReceipt);
    },
    markReceiptUndone(receiptId, at) {
      connection.writeTx((tx) => {
        tx.prepare(`UPDATE memory_receipts SET undone_at = ? WHERE receipt_id = ?`).run(at ?? new Date().toISOString(), receiptId);
        hint(tx, receiptId);
      });
    },
    insert(input) {
      const text = validate(input);
      const id = connection.writeTx((tx) => {
        const newId = insertRow(tx, input, text, input.ruleChange ?? "none", null);
        hint(tx, newId);
        return newId;
      });
      return read(id);
    },
    supersede(oldId, next) {
      const text = validate(next);
      const id = connection.writeTx((tx) => {
        const old = requireRow(tx, oldId);
        const newId = insertRow(tx, next, text, next.ruleChange ?? old.rule_change, oldId);
        tx.prepare(`UPDATE memory_items SET status = 'superseded', superseded_by = ? WHERE id = ?`).run(newId, oldId);
        hint(tx, newId);
        return newId;
      });
      return read(id);
    },
    merge(oldIds, next) {
      const text = validate(next);
      const id = connection.writeTx((tx) => {
        const first = requireRow(tx, oldIds[0]);
        requireRow(tx, oldIds[1]);
        const newId = insertRow(tx, next, text, next.ruleChange ?? first.rule_change, oldIds[0]);
        tx.prepare(`UPDATE memory_items SET status = 'superseded', superseded_by = ? WHERE id IN (?, ?)`).run(newId, oldIds[0], oldIds[1]);
        hint(tx, newId);
        return newId;
      });
      return read(id);
    },
    getItem(id) {
      const row = getRow(db, id);
      return row ? toItem(row) : undefined;
    },
    listItems(filter) {
      const statuses = filter?.status ?? ["current"];
      const folders = filter?.folders;
      const params: string[] = [...statuses];
      let sql = `SELECT * FROM memory_items WHERE status IN (${statuses.map(() => "?").join(",")})`;
      if (folders) {
        sql += ` AND folder IN (${folders.map(() => "?").join(",")})`;
        params.push(...folders);
      }
      sql += ` ORDER BY confirmed_at DESC, rowid DESC`;
      if (statuses.length === 0 || (folders && folders.length === 0)) return [];
      return db.prepare<string[], ItemRow>(sql).all(...params).map(toItem);
    },
    chainOf(id) {
      const rank = (r: ItemRow): number => (r.status === "current" ? 0 : 1);
      return chainRows(db, id)
        .sort((a, b) => rank(a) - rank(b) || (a.confirmed_at < b.confirmed_at ? 1 : a.confirmed_at > b.confirmed_at ? -1 : 0))
        .map(toItem);
    },
    forget(id) {
      return connection.writeTx((tx) => {
        requireRow(tx, id);
        const rows = chainRows(tx, id);
        const upd = tx.prepare(`UPDATE memory_items SET prior_status = status, status = 'deleted' WHERE id = ? AND status != 'deleted'`);
        for (const r of rows) upd.run(r.id);
        // A forgotten item's rule-change card is withdrawn by the caller; never leave the item "pending" for Undo to restore.
        const clear = tx.prepare(`UPDATE memory_items SET rule_change = 'none' WHERE id = ? AND rule_change = 'pending'`);
        for (const r of rows) clear.run(r.id);
        hint(tx, id);
        return { chainIds: rows.map((r) => r.id) };
      });
    },
    restore(chainIds) {
      if (chainIds.length === 0) return;
      connection.writeTx((tx) => {
        const upd = tx.prepare(`UPDATE memory_items SET status = COALESCE(prior_status, 'current'), prior_status = NULL WHERE id = ? AND status = 'deleted'`);
        for (const id of chainIds) upd.run(id);
        hint(tx, chainIds[0] as string);
      });
    },
    purgeDeleted() {
      return connection.writeTx((tx) => {
        const n = tx.prepare(`DELETE FROM memory_items WHERE status = 'deleted'`).run().changes;
        if (n > 0) hint(tx, "purge");
        return n;
      });
    },
    purgeChain(chainIds) {
      if (chainIds.length === 0) return;
      connection.writeTx((tx) => {
        const del = tx.prepare(`DELETE FROM memory_items WHERE id = ?`);
        for (const id of chainIds) del.run(id);
        hint(tx, "purge");
      });
    },
    undoFiling(newId) {
      connection.writeTx((tx) => {
        tx.prepare(`UPDATE memory_items SET status = 'current', superseded_by = NULL WHERE superseded_by = ?`).run(newId);
        tx.prepare(`DELETE FROM memory_items WHERE id = ?`).run(newId);
        hint(tx, newId);
      });
    },
    keepAsHistory(id) {
      connection.writeTx((tx) => {
        requireRow(tx, id);
        tx.prepare(`UPDATE memory_items SET status = 'history', rule_change = CASE WHEN rule_change = 'pending' THEN 'none' ELSE rule_change END WHERE id = ?`).run(id);
        hint(tx, id);
      });
    },
    setRuleChange(id, ruleChange) {
      connection.writeTx((tx) => {
        requireRow(tx, id);
        tx.prepare(`UPDATE memory_items SET rule_change = ? WHERE id = ?`).run(ruleChange, id);
        hint(tx, id);
      });
    },
    searchRelevant(text, folders, limit) {
      const match = ftsQuery(text);
      if (!match || folders.length === 0 || limit <= 0) return [];
      return db
        .prepare<unknown[], ItemRow>(
          `SELECT m.* FROM memory_items_fts JOIN memory_items m ON m.rowid = memory_items_fts.rowid
           WHERE memory_items_fts MATCH ? AND m.status = 'current' AND m.folder IN (${folders.map(() => "?").join(",")})
           ORDER BY bm25(memory_items_fts) LIMIT ?`,
        )
        .all(match, ...folders, limit)
        .map(toItem);
    },
    touchMatched(ids, at) {
      if (ids.length === 0) return;
      const when = at ?? new Date().toISOString();
      connection.writeTx((tx) => {
        const upd = tx.prepare(`UPDATE memory_items SET last_matched_at = ? WHERE id = ?`);
        for (const id of ids) upd.run(when, id);
        hint(tx, ids[0] as string);
      });
    },
    getPatternState(kind, area) {
      const r = db.prepare<[string, string], PatternRow>(`SELECT * FROM pattern_state WHERE kind = ? AND area = ?`).get(kind, area);
      return r ? toPattern(r) : undefined;
    },
    putPatternState(state) {
      connection.writeTx((tx) => {
        tx.prepare(
          `INSERT INTO pattern_state (kind, area, pending_proposal_id, declined_at, last_offered_on, confirmed_at)
           VALUES (@kind, @area, @pending, @declined, @offered, @confirmed)
           ON CONFLICT(kind, area) DO UPDATE SET pending_proposal_id = @pending, declined_at = @declined, last_offered_on = @offered, confirmed_at = @confirmed`,
        ).run({ kind: state.kind, area: state.area, pending: state.pendingProposalId ?? null, declined: state.declinedAt ?? null, offered: state.lastOfferedOn ?? null, confirmed: state.confirmedAt ?? null });
        hint(tx, `${state.kind}:${state.area}`);
      });
    },
    listPatternStates() {
      return db.prepare<[], PatternRow>(`SELECT * FROM pattern_state ORDER BY kind, area`).all().map(toPattern);
    },
    clearAll() {
      connection.writeTx((tx) => {
        tx.prepare(`DELETE FROM memory_items`).run();
        tx.prepare(`DELETE FROM pattern_state`).run();
        tx.prepare(`DELETE FROM memory_receipts`).run();
      });
    },
  };
}
