/**
 * Rating store (Story 13.11): the singleton rating schedule state plus one row per prompt.
 * Ratings are not user-visible anywhere, so no outbox row is appended. Nothing that makes a
 * model call may import this module (tests/rating-isolation.test.ts).
 */
import type Database from "better-sqlite3";
import {
  pausedUntilAfterDismissals,
  RATING_DISMISSALS_TO_PAUSE,
  type RatingState,
} from "../core/rating-schedule.ts";
import type { IsoDate, IsoDateTime } from "../types/domain.ts";
import type { SqliteConnection } from "./sqlite.ts";

export type RatingScore = 1 | 2 | 3;
type Refusal = { readonly ok: false; readonly reason: "unknown-prompt" | "already-answered" };

export interface RatingStore {
  getState(): RatingState;
  openPrompt(a: { promptId: string; today: IsoDate; at: IsoDateTime }): void;
  answer(a: { promptId: string; score: RatingScore; note?: string; today: IsoDate; at: IsoDateTime }): { ok: true } | Refusal;
  dismiss(a: { promptId: string; today: IsoDate; at: IsoDateTime }): { ok: true } | Refusal;
  /** A new user turn while a prompt is open; true when one was closed. */
  dismissOpen(a: { today: IsoDate; at: IsoDateTime }): boolean;
  clearAll(): void;
}

export function initRatingStoreSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rating_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_prompt_date TEXT,
      prompts_shown_on_last_date INTEGER NOT NULL DEFAULT 0,
      consecutive_dismissals INTEGER NOT NULL DEFAULT 0,
      paused_until TEXT,
      extra_prompt_due INTEGER NOT NULL DEFAULT 0,
      open_prompt_id TEXT
    );
    CREATE TABLE IF NOT EXISTS ratings (
      prompt_id TEXT PRIMARY KEY,
      shown_on TEXT NOT NULL,
      outcome TEXT NOT NULL,
      score INTEGER,
      note TEXT,
      answered_at TEXT
    );
  `);
}

interface StateRow {
  last_prompt_date: string | null;
  prompts_shown_on_last_date: number;
  consecutive_dismissals: number;
  paused_until: string | null;
  extra_prompt_due: number;
  open_prompt_id: string | null;
}

interface RatingRow {
  outcome: string;
  score: number | null;
  note: string | null;
}

function readState(db: Database.Database): RatingState {
  const r = db.prepare("SELECT * FROM rating_state WHERE id = 1").get() as StateRow | undefined;
  if (!r) return { promptsShownOnLastDate: 0, consecutiveDismissals: 0, extraPromptDue: false };
  return {
    ...(r.last_prompt_date ? { lastPromptDate: r.last_prompt_date } : {}),
    promptsShownOnLastDate: r.prompts_shown_on_last_date,
    consecutiveDismissals: r.consecutive_dismissals,
    ...(r.paused_until ? { pausedUntil: r.paused_until } : {}),
    extraPromptDue: r.extra_prompt_due === 1,
    ...(r.open_prompt_id ? { openPromptId: r.open_prompt_id } : {}),
  };
}

function writeState(db: Database.Database, s: RatingState): void {
  db.prepare(
    `INSERT INTO rating_state (id, last_prompt_date, prompts_shown_on_last_date, consecutive_dismissals, paused_until, extra_prompt_due, open_prompt_id)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_prompt_date = excluded.last_prompt_date,
       prompts_shown_on_last_date = excluded.prompts_shown_on_last_date,
       consecutive_dismissals = excluded.consecutive_dismissals, paused_until = excluded.paused_until,
       extra_prompt_due = excluded.extra_prompt_due, open_prompt_id = excluded.open_prompt_id`,
  ).run(
    s.lastPromptDate ?? null,
    s.promptsShownOnLastDate,
    s.consecutiveDismissals,
    s.pausedUntil ?? null,
    s.extraPromptDue ? 1 : 0,
    s.openPromptId ?? null,
  );
}

function dismissInTx(db: Database.Database, promptId: string, today: IsoDate, at: IsoDateTime): void {
  db.prepare("UPDATE ratings SET outcome = 'dismissed', answered_at = ? WHERE prompt_id = ?").run(at, promptId);
  const s = readState(db);
  const count = s.consecutiveDismissals + 1;
  const pause = count >= RATING_DISMISSALS_TO_PAUSE;
  const { openPromptId: _open, pausedUntil: _paused, ...rest } = s;
  writeState(db, {
    ...rest,
    consecutiveDismissals: pause ? 0 : count,
    ...(pause ? { pausedUntil: pausedUntilAfterDismissals(today) } : _paused !== undefined ? { pausedUntil: _paused } : {}),
  });
}

export function createRatingStore(connection: SqliteConnection): RatingStore {
  return {
    getState: () => readState(connection.db),
    openPrompt({ promptId, today, at }) {
      connection.writeTx((db) => {
        const s = readState(db);
        const sameDay = s.lastPromptDate === today;
        const count = sameDay ? s.promptsShownOnLastDate + 1 : 1;
        db.prepare("INSERT INTO ratings (prompt_id, shown_on, outcome, answered_at) VALUES (?, ?, 'open', NULL)").run(promptId, today);
        void at;
        writeState(db, {
          ...s,
          lastPromptDate: today,
          promptsShownOnLastDate: count,
          extraPromptDue: count >= 2 ? false : s.extraPromptDue,
          openPromptId: promptId,
        });
      });
    },
    answer({ promptId, score, note, at }) {
      return connection.writeTx((db): { ok: true } | Refusal => {
        const row = db.prepare("SELECT outcome, score, note FROM ratings WHERE prompt_id = ?").get(promptId) as RatingRow | undefined;
        if (!row) return { ok: false, reason: "unknown-prompt" };
        if (row.outcome === "answered") {
          // The two-step 1-then-Send flow: one note may be added to an answered 1 with no note.
          if (row.score === 1 && score === 1 && note !== undefined && (row.note === null || row.note === "")) {
            db.prepare("UPDATE ratings SET note = ?, answered_at = ? WHERE prompt_id = ?").run(note, at, promptId);
            return { ok: true };
          }
          return { ok: false, reason: "already-answered" };
        }
        if (row.outcome === "dismissed") return { ok: false, reason: "already-answered" };
        db.prepare("UPDATE ratings SET outcome = 'answered', score = ?, note = ?, answered_at = ? WHERE prompt_id = ?").run(score, note ?? null, at, promptId);
        const s = readState(db);
        const { openPromptId: _open, ...rest } = s;
        writeState(db, { ...rest, consecutiveDismissals: 0, extraPromptDue: score === 1 ? true : s.extraPromptDue });
        return { ok: true };
      });
    },
    dismiss({ promptId, today, at }) {
      return connection.writeTx((db): { ok: true } | Refusal => {
        const row = db.prepare("SELECT outcome, score, note FROM ratings WHERE prompt_id = ?").get(promptId) as RatingRow | undefined;
        if (!row) return { ok: false, reason: "unknown-prompt" };
        if (row.outcome !== "open") return { ok: false, reason: "already-answered" };
        dismissInTx(db, promptId, today, at);
        return { ok: true };
      });
    },
    dismissOpen({ today, at }) {
      return connection.writeTx((db) => {
        const id = readState(db).openPromptId;
        if (id === undefined) return false;
        dismissInTx(db, id, today, at);
        return true;
      });
    },
    clearAll() {
      connection.writeTx((db) => {
        db.prepare("DELETE FROM ratings").run();
        db.prepare("DELETE FROM rating_state").run();
      });
    },
  };
}
