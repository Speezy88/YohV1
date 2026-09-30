/**
 * Chat store (Story 13.1, AD-25): the sole owner of Conversations (one per
 * calendar day in YOH_TIMEZONE), their turns, and the turns FTS5 index.
 * Writes run in `writeTx` and append one `memory` outbox row.
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { IsoDate, IsoDateTime } from "../types/domain.ts";
import type { SqliteConnection } from "./sqlite.ts";
import { appendOutboxInTx } from "./notification-store.ts";
import { ftsQuery } from "../core/fts-query.ts";

export const MEMORY_TOPIC = "memory";

export interface StoredChatTurn {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  truncated: boolean;
  createdAt: IsoDateTime;
}

export interface ChatStore {
  appendTurn(input: {
    date: IsoDate;
    role: "user" | "assistant";
    text: string;
    truncated?: boolean;
    at: IsoDateTime;
  }): StoredChatTurn;
  turnsForDate(date: IsoDate, limit?: number): StoredChatTurn[];
  /** True when a user turn was stored after `turnId` in that Conversation (insertion order). */
  hasUserTurnAfter(conversationId: string, turnId: string): boolean;
  /** Removes every Conversation and turn; appends one `memory` outbox row when it removed anything. */
  clearAll(): void;
  /** Conversations newest date first; `firstLine` is the first user turn, trimmed to 80 characters. */
  listConversations(): { id: string; date: IsoDate; turnCount: number; firstLine: string }[];
  /** A Conversation's turns oldest first, or undefined when it does not exist. */
  conversationTurns(conversationId: string): StoredChatTurn[] | undefined;
  /** Deletes a Conversation, its turns and (via triggers) their index rows; false when it was unknown. */
  deleteConversation(conversationId: string): boolean;
  /** One turn with its Conversation's date, or undefined when it no longer exists. */
  getTurn(turnId: string): (StoredChatTurn & { date: IsoDate }) | undefined;
  /** Keyword search over every stored turn (bm25); `snippet` is a short excerpt around the match. */
  searchTurns(query: string, limit: number): { turnId: string; conversationId: string; date: IsoDate; role: "user" | "assistant"; snippet: string }[];
}

export function initChatStoreSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      date TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_turns (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      truncated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_turns_conversation ON chat_turns (conversation_id, created_at);
    CREATE VIRTUAL TABLE IF NOT EXISTS chat_turns_fts USING fts5(text, content='chat_turns', content_rowid='rowid');
    CREATE TRIGGER IF NOT EXISTS chat_turns_ai AFTER INSERT ON chat_turns BEGIN
      INSERT INTO chat_turns_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chat_turns_ad AFTER DELETE ON chat_turns BEGIN
      INSERT INTO chat_turns_fts(chat_turns_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chat_turns_au AFTER UPDATE ON chat_turns BEGIN
      INSERT INTO chat_turns_fts(chat_turns_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      INSERT INTO chat_turns_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
  `);
}

interface TurnRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  text: string;
  truncated: number;
  created_at: string;
}

function toTurn(r: TurnRow): StoredChatTurn {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    text: r.text,
    truncated: r.truncated === 1,
    createdAt: r.created_at,
  };
}

export function createChatStore(connection: SqliteConnection): ChatStore {
  return {
    appendTurn(input) {
      return connection.writeTx((db) => {
        let conv = db.prepare("SELECT id FROM chat_conversations WHERE date = ?").get(input.date) as { id: string } | undefined;
        if (!conv) {
          conv = { id: randomUUID() };
          db.prepare("INSERT INTO chat_conversations (id, date, created_at) VALUES (?, ?, ?)").run(conv.id, input.date, input.at);
        }
        const turn: StoredChatTurn = {
          id: randomUUID(),
          conversationId: conv.id,
          role: input.role,
          text: input.text,
          truncated: input.truncated === true,
          createdAt: input.at,
        };
        db.prepare(
          "INSERT INTO chat_turns (id, conversation_id, role, text, truncated, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(turn.id, turn.conversationId, turn.role, turn.text, turn.truncated ? 1 : 0, turn.createdAt);
        appendOutboxInTx(db, { topic: MEMORY_TOPIC, entityId: conv.id });
        return turn;
      });
    },
    turnsForDate(date, limit) {
      const conv = connection.db.prepare("SELECT id FROM chat_conversations WHERE date = ?").get(date) as { id: string } | undefined;
      if (!conv) return [];
      const rows = connection.db
        .prepare("SELECT id, conversation_id, role, text, truncated, created_at FROM chat_turns WHERE conversation_id = ? ORDER BY rowid DESC LIMIT ?")
        .all(conv.id, limit ?? -1) as TurnRow[];
      return rows.reverse().map(toTurn);
    },
    hasUserTurnAfter(conversationId, turnId) {
      const row = connection.db
        .prepare(
          "SELECT 1 AS hit FROM chat_turns WHERE conversation_id = ? AND role = 'user' AND rowid > (SELECT rowid FROM chat_turns WHERE id = ? AND conversation_id = ?) LIMIT 1",
        )
        .get(conversationId, turnId, conversationId);
      return row !== undefined;
    },
    getTurn(turnId) {
      const row = connection.db
        .prepare(
          "SELECT t.id, t.conversation_id, t.role, t.text, t.truncated, t.created_at, c.date FROM chat_turns t JOIN chat_conversations c ON c.id = t.conversation_id WHERE t.id = ?",
        )
        .get(turnId) as (TurnRow & { date: string }) | undefined;
      return row ? { ...toTurn(row), date: row.date } : undefined;
    },
    searchTurns(query, limit) {
      const match = ftsQuery(query);
      if (!match || limit <= 0) return [];
      const rows = connection.db
        .prepare(
          `SELECT t.id, t.conversation_id, t.role, c.date, snippet(chat_turns_fts, 0, '', '', '...', 12) AS snippet
           FROM chat_turns_fts JOIN chat_turns t ON t.rowid = chat_turns_fts.rowid JOIN chat_conversations c ON c.id = t.conversation_id
           WHERE chat_turns_fts MATCH ? ORDER BY bm25(chat_turns_fts) LIMIT ?`,
        )
        .all(match, limit) as { id: string; conversation_id: string; role: "user" | "assistant"; date: string; snippet: string }[];
      return rows.map((r) => ({ turnId: r.id, conversationId: r.conversation_id, date: r.date, role: r.role, snippet: r.snippet }));
    },
    clearAll() {
      connection.writeTx((db) => {
        const removed = db.prepare("DELETE FROM chat_turns").run().changes + db.prepare("DELETE FROM chat_conversations").run().changes;
        if (removed > 0) appendOutboxInTx(db, { topic: MEMORY_TOPIC, entityId: "all" });
      });
    },
    listConversations() {
      const rows = connection.db
        .prepare(
          `SELECT c.id, c.date,
             (SELECT count(*) FROM chat_turns t WHERE t.conversation_id = c.id) AS turn_count,
             (SELECT t.text FROM chat_turns t WHERE t.conversation_id = c.id AND t.role = 'user' ORDER BY t.rowid LIMIT 1) AS first_line
           FROM chat_conversations c ORDER BY c.date DESC`,
        )
        .all() as { id: string; date: string; turn_count: number; first_line: string | null }[];
      return rows.map((r) => ({ id: r.id, date: r.date, turnCount: r.turn_count, firstLine: (r.first_line ?? "").trim().slice(0, 80) }));
    },
    conversationTurns(conversationId) {
      const conv = connection.db.prepare("SELECT id FROM chat_conversations WHERE id = ?").get(conversationId);
      if (!conv) return undefined;
      const rows = connection.db
        .prepare("SELECT id, conversation_id, role, text, truncated, created_at FROM chat_turns WHERE conversation_id = ? ORDER BY rowid")
        .all(conversationId) as TurnRow[];
      return rows.map(toTurn);
    },
    deleteConversation(conversationId) {
      return connection.writeTx((db) => {
        const gone = db.prepare("DELETE FROM chat_conversations WHERE id = ?").run(conversationId).changes > 0;
        if (!gone) return false;
        db.prepare("DELETE FROM chat_turns WHERE conversation_id = ?").run(conversationId);
        appendOutboxInTx(db, { topic: MEMORY_TOPIC, entityId: conversationId });
        return true;
      });
    },
  };
}
