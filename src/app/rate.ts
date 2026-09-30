/**
 * `rate` (Story 13.11): stores a rating pick or dismissal. A score-1 note files to Feedback
 * as Stated through `fileMemory` (the explicit path), attached to today's last chat turn so
 * Undo works until Spencer's next message. The score alone never files anything, and ratings
 * never reach a model call. A filing failure leaves the rating stored and returns a receipt
 * with `items: []` (the web says "Couldn't save that to memory.").
 */
import { randomUUID } from "node:crypto";
import type { ChatStore } from "../adapters/chat-store.ts";
import type { RatingStore } from "../adapters/rating-store.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { RatingRequest, RatingResponse, RememberedReceipt } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";
import { fileMemory, type FileMemoryDeps } from "./file-memory.ts";

export const RATING_NOTE_MAX_CHARS = 280;

export interface RateDeps extends Partial<FileMemoryDeps> {
  readonly ratings: RatingStore;
  readonly chatHistory?: ChatStore;
  readonly now: () => Date;
  readonly timeZone: string;
  readonly log?: (entry: { level: "info" | "warn" | "error"; event: string; detail?: string }) => void;
}

const fail = (kind: YohError["kind"], message: string): Result<never, YohError> => ({ ok: false, error: { kind, message } });

export async function rate(deps: RateDeps, input: RatingRequest): Promise<Result<RatingResponse, YohError>> {
  try {
    const hasScore = input.score !== undefined;
    if (hasScore === (input.dismissed === true)) return fail("validation", "rating: send exactly one of score or dismissed");
    if (hasScore && input.score !== 1 && input.score !== 2 && input.score !== 3) return fail("validation", "rating: score must be 1, 2 or 3");
    const note = input.note === undefined ? undefined : input.note.trim();
    if (note !== undefined && (input.score !== 1 || note.length < 1 || note.length > RATING_NOTE_MAX_CHARS)) {
      return fail("validation", `rating: a note needs score 1 and 1-${RATING_NOTE_MAX_CHARS} characters`);
    }
    const at = deps.now();
    const stamp = { today: localIsoDate(at, deps.timeZone), at: at.toISOString() };
    const stored =
      input.score !== undefined
        ? deps.ratings.answer({ promptId: input.promptId, score: input.score, ...(note !== undefined ? { note } : {}), ...stamp })
        : deps.ratings.dismiss({ promptId: input.promptId, ...stamp });
    if (!stored.ok) {
      return fail("conflict", stored.reason === "unknown-prompt" ? "That rating is no longer open." : "That rating was already answered.");
    }
    if (note === undefined) return { ok: true, value: {} };
    return { ok: true, value: { receipt: await fileNote(deps, note, stamp.today) } };
  } catch (error) {
    deps.log?.({ level: "warn", event: "rate.failed", detail: error instanceof Error ? error.message : String(error) });
    return fail("unreachable", "Couldn't save that. Try again.");
  }
}

async function fileNote(deps: RateDeps, note: string, today: string): Promise<RememberedReceipt> {
  const failed: RememberedReceipt = { receiptId: randomUUID(), kind: "remembered", items: [] };
  if (!deps.memoryItems || !deps.llmClient) return failed;
  try {
    const turns = deps.chatHistory?.turnsForDate(today) ?? [];
    const last = turns[turns.length - 1];
    const filed = await fileMemory(deps as FileMemoryDeps, {
      text: note,
      forceStated: true,
      forceFolder: "feedback",
      ...(last ? { userTurn: { conversationId: last.conversationId, id: last.id } } : {}),
    });
    if (!filed.ok) {
      deps.log?.({ level: "warn", event: "rate.note-filing-failed", detail: filed.error.message });
      return failed;
    }
    return filed.value?.receipt ?? failed;
  } catch (error) {
    deps.log?.({ level: "warn", event: "rate.note-filing-failed", detail: error instanceof Error ? error.message : String(error) });
    return failed;
  }
}
