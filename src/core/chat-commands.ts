/**
 * src/core/chat-commands.ts
 *
 * Story 8.3 (AD-16, C1). The five deterministic, zero-API-call recognizers
 * `app/chat-turn.ts` dispatches on for its Task-4 capabilities — moved
 * verbatim (bodies unchanged) from `shell/chat-cli.ts`: `parseTimeBudgetCommand`,
 * `isPlanViewCommand`, `isMidDayReflowCommand`, `isBlockerReportCommand`,
 * `parseWhyPrioritizedCommand`. Pure pattern matching, no I/O, no module
 * state — `core/*.ts` imports only `types/` and other `core/*.ts` (AD-1);
 * none of these five need any import at all.
 *
 * Task 5 adds this file's other three recognizers
 * (`parseCreateItemCommand`/`isSaveSearchResultCommand`/`isCalendarEditCommand`),
 * still owned by `chat-cli.ts` inline for this task (Controller ruling).
 */

// ============================================================================
// Time Budget declare/change command (originally Task 6 / Story 1.6, FR-5)
// ============================================================================

/**
 * Recognizes a Time Budget declare/change command typed at the `yoh>`
 * prompt. This is deliberately simple, clearly-documented pattern matching —
 * NOT real free-text NLU. `chatTurn` checks it first, unchanged, before ever
 * consulting `llm-adapter.ts`'s real LLM-based routing, so declaring
 * "6 hours" persists a 360-minute budget for today exactly as it always has,
 * with no API call spent recognizing it.
 *
 * Recognized phrasing (case-insensitive, extra whitespace tolerated):
 *   - "time budget <N>[h|hr|hrs|hour|hours]"
 *   - "time budget <N>[m|min|mins|minute|minutes]"
 *   - either optionally prefixed with "set " or "change ", and with "to "
 *     before the number — e.g. "set time budget to 6 hours",
 *     "change time budget to 90 minutes"
 *
 * If `<N>` has no unit at all (e.g. "time budget 5"), it's read as HOURS —
 * documented default, since Spencer declaring a Time Budget in bare minutes
 * ("time budget 5" meaning 5 minutes) would be an implausibly short day,
 * while "5" meaning 5 hours is the natural reading.
 *
 * Returns `undefined` (not an error) for any line that doesn't match this
 * shape at all, so `chatTurn` can fall through to the next recognizer rather
 * than misreporting an unrelated line as an invalid Time Budget command.
 */
const TIME_BUDGET_COMMAND_RE =
  /^(?:set\s+|change\s+)?time\s*budget(?:\s+to)?\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)?\s*$/i;

export function parseTimeBudgetCommand(line: string): { readonly totalMinutes: number } | undefined {
  const match = TIME_BUDGET_COMMAND_RE.exec(line.trim());
  if (!match) return undefined;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;

  const unit = (match[2] ?? "hours").toLowerCase();
  const totalMinutes = unit.startsWith("m") ? amount : amount * 60;
  if (!Number.isInteger(totalMinutes)) return undefined; // e.g. "0.5m" doesn't land on a whole minute.

  return { totalMinutes };
}

// ============================================================================
// On-demand Plan view command (originally Task 11 / Story 1.11)
// ============================================================================

/**
 * Recognizes an on-demand Plan-view request typed at the `yoh>` prompt — the
 * same kind of deliberately simple, clearly-documented pattern matching
 * `parseTimeBudgetCommand` uses above, NOT real free-text NLU.
 *
 * Recognized phrasing (case-insensitive, extra whitespace tolerated):
 *   - a bare "plan"
 *   - "what's my plan" / "what is my plan" / "...today's plan"
 *   - "show plan" / "show my plan" / "show me my plan" / "show me today's
 *     plan"
 *
 * Returns `false` (not an error) for any line that doesn't match this shape
 * at all, so `chatTurn` can fall through to the next recognizer, exactly as
 * it already does for an unrecognized line.
 */
const PLAN_VIEW_COMMAND_RE =
  /^(?:what(?:'s|\s+is)\s+(?:my|today'?s)\s+plan|show(?:\s+me)?(?:\s+(?:my|today'?s))?\s+plan|plan)\??$/i;

export function isPlanViewCommand(line: string): boolean {
  return PLAN_VIEW_COMMAND_RE.test(line.trim());
}

// ============================================================================
// Mid-Day Re-Flow trigger command (originally Task 15 / Story 2.3, FR-9)
// ============================================================================

/**
 * Recognizes a Mid-Day Re-Flow trigger typed at the `yoh>` prompt — the same
 * kind of deliberately simple, clearly-documented pattern matching
 * `parseTimeBudgetCommand`/`isPlanViewCommand` use above, NOT real free-text
 * NLU.
 *
 * Recognized phrasing (case-insensitive, extra whitespace tolerated,
 * optional leading "please"):
 *   - a bare "reflow" / "re-flow" / "refit"
 *   - "reflow my day" / "re-flow my plan" / "refit my day" / "refit plan"
 *   - "redo my plan" / "redo my day" / "redo plan" / "redo day"
 *     (bare "redo" alone is NOT recognized — an ordinary English word too
 *     ambiguous to claim without an explicit "day"/"plan" object, unlike
 *     "reflow"/"refit", which are unambiguously Yoh-specific)
 *
 * Returns `false` (not an error) for any line that doesn't match this shape
 * at all, so `chatTurn` can fall through to the next recognizer exactly as
 * it already does for an unrecognized line.
 */
const MID_DAY_REFLOW_COMMAND_RE =
  /^(?:please\s+)?(?:(?:re-?flow|refit)(?:\s+(?:my\s+)?(?:day|plan))?|redo\s+(?:my\s+)?(?:day|plan))\??$/i;

export function isMidDayReflowCommand(line: string): boolean {
  return MID_DAY_REFLOW_COMMAND_RE.test(line.trim());
}

// ============================================================================
// Logistics-Only Blocker Handling (originally Task 16 / Story 2.4, FR-10, UX-DR12)
// ============================================================================

/**
 * Recognizes Spencer reporting a purely logistical Blocker in plain
 * language — e.g. "meeting ran over", "running late", "something came up",
 * "stuck in traffic", "call went long". Unlike `isMidDayReflowCommand`'s
 * fixed trigger phrasing, a Blocker report is genuinely open-ended free text
 * (FR-10's own example names neither a Task nor a duration), so this is a
 * documented STARTING keyword/phrase heuristic — not real NLU — covering
 * the common shapes a logistics Blocker report tends to take. It is
 * deliberately conservative rather than exhaustive: richer (LLM-based, or a
 * broader phrase library) Blocker detection is a natural future
 * improvement, not required for this task.
 *
 * Post-review tightening (Important finding): a false positive here is NOT
 * like a false positive on `parseTimeBudgetCommand`/`isPlanViewCommand` —
 * per AD-3 this path reschedules and PERSISTS a real change to Spencer's
 * Plan immediately, with no confirmation gate, including zero-crediting
 * whatever Task the current block belongs to. So every pattern below is
 * required to be a multi-word phrase with enough co-occurring signal that
 * it's implausible as an accidental substring match inside an unrelated
 * sentence — no bare single common word is allowed on its own.
 *
 * Because these phrases can still plausibly appear inside an unrelated
 * sentence even after tightening, `chatTurn` checks this only AFTER
 * `parseTimeBudgetCommand`/`isPlanViewCommand`/`isMidDayReflowCommand` have
 * all already failed to match.
 */
const BLOCKER_REPORT_PATTERNS: readonly RegExp[] = [
  /\bran\s+over\b/i,
  /\bran\s+long\b/i,
  /\bwent\s+long\b/i,
  /\bran\s+late\b/i,
  /\brunning\s+late\b/i,
  /\bsomething\s+came\s+up\b/i,
  /\bstuck\s+in\s+traffic\b/i,
  /\bheld\s+up\b/i,
  /\bgot\s+(interrupted|blocked|stuck)\b/i,
];

export function isBlockerReportCommand(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  return BLOCKER_REPORT_PATTERNS.some((re) => re.test(trimmed));
}

// ============================================================================
// Slip-Bump lineage view (originally Task 17 / Story 2.5, UX-DR19)
// ============================================================================

/**
 * Recognizes Spencer asking "why is X prioritized [today]" typed at the
 * `yoh>` prompt — the same kind of deliberately simple, clearly-documented
 * pattern matching `parseTimeBudgetCommand`/`isPlanViewCommand`/
 * `isMidDayReflowCommand` use above, NOT real free-text NLU. Recognized
 * phrasing (case-insensitive, extra whitespace tolerated, optional trailing
 * "today" and/or "?"):
 *
 *   - "why is <Task name> prioritized"
 *   - "why is <Task name> prioritized today"
 *
 * Returns the captured Task name (verbatim, original casing preserved for
 * echoing back in an error message) on a match, or `undefined` for any line
 * that doesn't match this shape at all — so `chatTurn` can fall through to
 * the next recognizer exactly as it already does for an unrecognized line.
 */
const WHY_PRIORITIZED_COMMAND_RE = /^why\s+is\s+(.+?)\s+prioritized(?:\s+today)?\??$/i;

export function parseWhyPrioritizedCommand(line: string): string | undefined {
  const match = WHY_PRIORITIZED_COMMAND_RE.exec(line.trim());
  return match?.[1];
}
