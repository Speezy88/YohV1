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
 * real free-text NLU). Recognizes a keyword ANYWHERE in the reply (not just
 * as the whole line), so ordinary free text ("I finished it", "done!",
 * "yes done", "didn't get to it", "nope") resolves the same as a bare
 * keyword (Task 6 addendum). A negation cue (`didn't`/`did not`/`not`/
 * `nope`/`missed`/`slipped`) is checked BEFORE the completed keywords so
 * "not done" reads as slipped, not completed. Does NOT recognize `"skip"` —
 * that is its own, separately-checked escape hatch (`isSkipAnswer`, below),
 * not a third `NightCloseOutStatus` value.
 */
const NIGHT_CLOSE_OUT_SLIPPED_RE = /\b(slipped?|missed?|nope|didn['’]?t|did not|not)\b/;
const NIGHT_CLOSE_OUT_COMPLETED_RE = /\b(completed?|done|finished)\b/;

export function parseNightCloseOutAnswer(raw: string): NightCloseOutStatus | undefined {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "") return undefined;
  if (NIGHT_CLOSE_OUT_SLIPPED_RE.test(normalized)) return "slipped";
  if (NIGHT_CLOSE_OUT_COMPLETED_RE.test(normalized)) return "completed";
  return undefined;
}

/** Recognizes Spencer's explicit "skip" escape hatch for ONE Task within a close-out answer — see `app/answer-night-close-out.ts`'s own doc comment for why this exists. */
export function isSkipAnswer(raw: string): boolean {
  return /^skip$/i.test(raw.trim());
}

/**
 * Task 6 (Spencer: "the waiting on you questions do not go away when they
 * are answered" — traced to the old strict "number<space>reason" shape,
 * which sent a natural reply like "7, feeling good" down the "try again"
 * path forever). Finds the FIRST 1-10 score anywhere in the reply — a bare
 * digit run ("7"), a spelled-out word ("seven"), or either immediately
 * followed by its own "/10" or "out of 10" denominator (consumed as part of
 * the score expression, never treated as reason text) — then takes
 * whatever follows that match, trimmed of leading punctuation/whitespace,
 * as the reason. The reason is optional: a bare score, or a score with
 * nothing but trailing punctuation after it, parses to `reason: ""`. A
 * deliberately-simple, clearly-documented pattern-matching convention (NOT
 * real free-text NLU) — text BEFORE the number (e.g. "i'd say a") is
 * discarded, not folded into the reason. `isValidSelfCheckScore` (`rituals/
 * self-check.ts`) is the single source of truth for the valid range (1-10)
 * — duplicated nowhere here; a first number outside that range (e.g. "11",
 * "0") is rejected outright, with no further search for a second number.
 */
const SELF_CHECK_NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const SELF_CHECK_SCORE_RE = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b(?:\s*\/\s*10\b|\s+out\s+of\s+10\b)?/i;
/** Leading characters trimmed off the reason once the score expression is removed — whitespace and the punctuation Spencer's own examples use to separate score from reason (",", "-", ".", "!", ":", ";"). */
const SELF_CHECK_REASON_LEADING_PUNCTUATION_RE = /^[\s,.\-:;!]+/;

export interface SelfCheckAnswer {
  readonly score: number;
  readonly reason: string;
}

export function parseSelfCheckAnswer(raw: string): SelfCheckAnswer | undefined {
  const match = SELF_CHECK_SCORE_RE.exec(raw);
  if (!match) return undefined;
  const token = match[1]!.toLowerCase();
  const score = /^\d+$/.test(token) ? Number(token) : SELF_CHECK_NUMBER_WORDS[token];
  if (score === undefined || !isValidSelfCheckScore(score)) return undefined;
  const rest = raw.slice(match.index + match[0].length);
  const reason = rest.replace(SELF_CHECK_REASON_LEADING_PUNCTUATION_RE, "").trim();
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
