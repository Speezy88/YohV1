/**
 * src/core/open-item-answers.ts
 *
 * Story 8.1 (AD-16, C1; Controller Ruling 2 moves `parseProposalAnswer`
 * here in THIS task rather than Task 3/Story 8.2). Pure answer-side
 * parsers for an open `InteractionRequest`'s current question. Cursor
 * arithmetic and question ASSEMBLY live in `core/open-item-questions.ts`
 * instead (Controller Ruling 1) — this file is answers only.
 *
 * Moved verbatim from `src/shell/chat-cli.ts` — same behavior, same tests
 * (adapted into `tests/open-item-answers.test.ts`).
 */
import { isValidSelfCheckScore } from "../rituals/self-check.ts";

export type NightCloseOutStatus = "completed" | "slipped";

/**
 * Parses a raw close-out answer into `"completed"` or `"slipped"` — a
 * deliberately-simple, clearly-documented pattern-matching convention (NOT
 * real free-text NLU). Accepts a few natural synonyms case-insensitively;
 * anything else is rejected so the caller can re-prompt rather than guess.
 * Does NOT recognize `"skip"` — that is its own, separately-checked escape
 * hatch (`isSkipAnswer`, below), not a third `NightCloseOutStatus` value.
 */
export function parseNightCloseOutAnswer(raw: string): NightCloseOutStatus | undefined {
  const normalized = raw.trim().toLowerCase();
  if (/^(completed?|done|finished)$/.test(normalized)) return "completed";
  if (/^(slipped?|missed|didn'?t (do it|finish)|not done)$/.test(normalized)) return "slipped";
  return undefined;
}

/** Recognizes Spencer's explicit "skip" escape hatch for ONE Task within a close-out answer — see `app/answer-night-close-out.ts`'s own doc comment for why this exists. */
export function isSkipAnswer(raw: string): boolean {
  return /^skip$/i.test(raw.trim());
}

/**
 * Parses a raw Self-Check answer line into a score/reason pair. Per UX-DR15
 * both are required together — this is enforced structurally by the regex
 * itself: a bare number alone (or a number followed only by whitespace)
 * simply fails to MATCH. A deliberately-simple, clearly-documented
 * pattern-matching convention (NOT real free-text NLU): a leading 1-2 digit
 * whole number, at least one space, then the rest of the line as the reason
 * (trimmed, must be non-blank). `isValidSelfCheckScore` (`rituals/
 * self-check.ts`) is the single source of truth for the valid range (1-10) —
 * duplicated nowhere here.
 */
const SELF_CHECK_ANSWER_RE = /^\s*(\d{1,2})\s+(.+?)\s*$/;

export interface SelfCheckAnswer {
  readonly score: number;
  readonly reason: string;
}

export function parseSelfCheckAnswer(raw: string): SelfCheckAnswer | undefined {
  const match = SELF_CHECK_ANSWER_RE.exec(raw);
  if (!match) return undefined;
  const score = Number(match[1]);
  const reason = match[2]!.trim();
  if (!isValidSelfCheckScore(score) || reason.length === 0) return undefined;
  return { score, reason };
}

/**
 * Recognizes a yes/no answer to an open Proposal (or an FR-25 suggest
 * question), tolerant of a few natural variants — the same
 * deliberately-simple, clearly-documented pattern matching every parser in
 * this file uses (NOT real free-text NLU). Returns `undefined` for anything
 * else, so the caller re-asks rather than guessing — UX-DR16: silence (and
 * anything that isn't a clearly recognized yes/no) is never treated as
 * consent.
 *
 * Moved from `chat-cli.ts` (Ruling 2) — used by `app/answer-open-item.ts`'s
 * `"proposal"` dispatch (Story 8.2: originally `chat-cli.ts`'s own
 * `answerProposalRequest`, superseded outright) AND by `app/answer-data-
 * completeness.ts`'s FR-25 suggest-confirm step.
 */
export function parseProposalAnswer(raw: string): boolean | undefined {
  const normalized = raw.trim().toLowerCase();
  if (/^(y|yes|yeah|yep|confirm|apply)$/.test(normalized)) return true;
  if (/^(n|no|nope|dismiss|decline)$/.test(normalized)) return false;
  return undefined;
}
