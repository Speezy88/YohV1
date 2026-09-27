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
 * keyword (Task 6 addendum).
 *
 * I3 (final-review): a bare `not`/`missed` ANYWHERE in the reply used to
 * read as slipped — "done, not bad" and "completed, missed the bonus
 * question though" wrote Status = Slipped to real Notion even though
 * Spencer said he'd done it. Negation now only counts as slipped when it
 * ATTACHES to a completion word (`not done`, `didn't finish`, `not
 * finished`, `didn't do it`) or when the WHOLE reply is nothing but a slip
 * word (`missed`, `nope`, `no`, `slipped`, `not yet`). Anything else that
 * merely contains "not"/"missed" alongside a completion word (`done, not
 * bad`) falls through to the completed check below.
 */
const NIGHT_CLOSE_OUT_SLIPPED_RE =
  /\b(?:not|didn['’]?t|did not|never)\s+(?:get\s+)?(?:done|finish(?:ed)?|complete(?:d)?|do(?:\s+it)?|get\s+to\s+it)\b|^(?:nope|no|not yet|slipped?|missed(?: it)?)\W*$/;
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
 * path forever). Finds a 1-10 score anywhere in the reply — a bare digit
 * run ("7"), a spelled-out word ("seven"), or either immediately followed
 * by its own "/10" or "out of 10" denominator (consumed as part of the
 * score expression, never treated as reason text) — then takes whatever
 * follows that match, trimmed of leading punctuation/whitespace, as the
 * reason. The reason is optional: a bare score, or a score with nothing but
 * trailing punctuation after it, parses to `reason: ""`. A
 * deliberately-simple, clearly-documented pattern-matching convention (NOT
 * real free-text NLU) — text BEFORE the chosen number (e.g. "i'd say a") is
 * discarded, not folded into the reason. `isValidSelfCheckScore` (`rituals/
 * self-check.ts`) is the single source of truth for the valid range (1-10)
 * — duplicated nowhere here; a number outside that range (e.g. "11", "0")
 * is never itself a valid candidate.
 *
 * M2 (final-review): a natural reply often mentions an unrelated count
 * before the actual score ("had one rough class, but 7", "two tests today,
 * feeling like a 6") — the old "first match wins" rule misread these as 1
 * and 2. Every 1-10 candidate in the reply is now considered: a DIGIT
 * candidate ("7") is always preferred over a spelled-out WORD candidate
 * ("one"), and when several digit candidates are present the LAST one wins
 * ("3 hours of sleep, 5" -> 5, not 3) — Spencer's own score is what he says
 * last, not an incidental number earlier in the sentence. Only when no
 * digit candidate exists at all does a spelled-out word match (the first
 * one) get used.
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
const SELF_CHECK_SCORE_TOKEN_RE = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b(?:\s*\/\s*10\b|\s+out\s+of\s+10\b)?/gi;
/** Leading characters trimmed off the reason once the score expression is removed — whitespace and the punctuation Spencer's own examples use to separate score from reason (",", "-", ".", "!", ":", ";"). */
const SELF_CHECK_REASON_LEADING_PUNCTUATION_RE = /^[\s,.\-:;!]+/;

export interface SelfCheckAnswer {
  readonly score: number;
  readonly reason: string;
}

interface SelfCheckScoreCandidate {
  readonly match: RegExpExecArray;
  readonly score: number;
  readonly isDigit: boolean;
}

export function parseSelfCheckAnswer(raw: string): SelfCheckAnswer | undefined {
  const candidates: SelfCheckScoreCandidate[] = [];
  SELF_CHECK_SCORE_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SELF_CHECK_SCORE_TOKEN_RE.exec(raw)) !== null) {
    const token = match[1]!.toLowerCase();
    const isDigit = /^\d+$/.test(token);
    const score = isDigit ? Number(token) : SELF_CHECK_NUMBER_WORDS[token];
    if (score !== undefined && isValidSelfCheckScore(score)) candidates.push({ match, score, isDigit });
  }
  if (candidates.length === 0) return undefined;

  const digitCandidates = candidates.filter((c) => c.isDigit);
  const chosen = digitCandidates.length > 0 ? digitCandidates[digitCandidates.length - 1]! : candidates[0]!;

  const rest = raw.slice(chosen.match.index + chosen.match[0].length);
  const reason = rest.replace(SELF_CHECK_REASON_LEADING_PUNCTUATION_RE, "").trim();
  return { score: chosen.score, reason };
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
