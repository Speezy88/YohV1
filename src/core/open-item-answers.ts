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
 * finished`, `didn't do it`), when the WHOLE reply is nothing but a slip
 * word (`missed`, `nope`, `no`, `slipped`, `not yet`), or when a completion
 * word is followed by a PARTIAL-clause connector (`but not`, `except`,
 * `apart from`, `other than`, `besides` — Task 9: "done but not the
 * reading" means the Task is still open, not done). Anything else that
 * merely contains "not"/"missed" alongside a completion word with no such
 * connector (`done, not bad`) falls through to the completed check below.
 */
const NIGHT_CLOSE_OUT_SLIPPED_RE =
  /\b(?:not|didn['’]?t|did not|never)\s+(?:get\s+)?(?:done|finish(?:ed)?|complete(?:d)?|do(?:\s+it)?|get\s+to\s+it)\b|^(?:nope|no|not yet|slipped?|missed(?: it)?)\W*$/;
/** Task 9: a completion word, then later a partial-clause connector — "finished apart from problem 3", "done except the reading". */
const NIGHT_CLOSE_OUT_PARTIAL_RE = /\b(?:completed?|done|finished)\b.*\b(?:but\s+not|except|apart from|other than|besides)\b/;
const NIGHT_CLOSE_OUT_COMPLETED_RE = /\b(completed?|done|finished)\b/;

export function parseNightCloseOutAnswer(raw: string): NightCloseOutStatus | undefined {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "") return undefined;
  if (NIGHT_CLOSE_OUT_SLIPPED_RE.test(normalized)) return "slipped";
  if (NIGHT_CLOSE_OUT_PARTIAL_RE.test(normalized)) return "slipped";
  if (NIGHT_CLOSE_OUT_COMPLETED_RE.test(normalized)) return "completed";
  return undefined;
}

/** Recognizes Spencer's explicit "skip" escape hatch for ONE Task within a close-out answer — see `app/answer-night-close-out.ts`'s own doc comment for why this exists. */
export function isSkipAnswer(raw: string): boolean {
  return /^skip$/i.test(raw.trim());
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
  if (/^(y|yes|yeah|yep|confirm|apply|approve)$/.test(normalized)) return true;
  if (/^(n|no|nope|dismiss|decline|discard)$/.test(normalized)) return false;
  return undefined;
}
