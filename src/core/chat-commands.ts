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
 * Story 8.4 adds this file's other three recognizers
 * (`parseCreateItemCommand`/`isSaveSearchResultCommand`/`isCalendarEditCommand`),
 * moved verbatim from `shell/chat-cli.ts` — `app/chat-turn.ts` now dispatches
 * all eight in one chain (F6/Epic 6 retro order: save-search-result before
 * create-item, since create-item's own looser Notion-mention trigger also
 * matches "save"/"file" verbs).
 */
import type { NotionDatabaseTarget } from "../types/domain.ts";

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
// On-demand Plan-DAY (generate) command (real-use fixes plan, Task 1: "Plan
// my day on demand", `/plan`)
// ============================================================================

/**
 * Recognizes an on-demand Plan-GENERATION request typed in Chat — distinct
 * from `isPlanViewCommand` just above, which only shows a Plan that already
 * exists. The same kind of deliberately simple, documented pattern matching
 * every other recognizer in this file uses, NOT real free-text NLU.
 *
 * Recognized phrasing (case-insensitive, extra whitespace tolerated, an
 * optional trailing "?"):
 *   - "plan my day"
 *   - "make my plan"
 *   - "generate today's plan" (apostrophe optional: "generate todays plan")
 *   - "plan today"
 *
 * Deliberately does NOT match a bare "plan" or "what's my plan"/"show my
 * plan" — those are `isPlanViewCommand`'s own territory (a request to VIEW
 * today's already-generated Plan, never to build one); `app/chat-turn.ts`
 * checks both, and the two never overlap on any of the phrasings either
 * pins (see this file's own tests).
 *
 * Returns `false` (not an error) for any line that doesn't match this shape
 * at all, so `chatTurn` can fall through to the next recognizer exactly as
 * it already does for an unrecognized line.
 */
const PLAN_DAY_COMMAND_RE = /^(?:plan\s+(?:my\s+day|today)|make\s+my\s+plan|generate\s+today'?s\s+plan)\??$/i;

export function isPlanDayCommand(line: string): boolean {
  return PLAN_DAY_COMMAND_RE.test(line.trim());
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

// ============================================================================
// parseCreateItemCommand — pure trigger recognition (Story 6.3 / FR-26,
// moved from shell/chat-cli.ts by Story 8.4 / AD-16)
// ============================================================================

/**
 * Recognizes "create/add a [task|project|research vault item] ..." — the
 * same deliberately-simple, documented starting heuristic every other
 * trigger recognizer in this file uses (NOT real NLU). Only ever emits one
 * of the three real `NotionDatabaseTarget` values — Story 6.3's AC2 ("Yoh
 * does not attempt the creation" for any other target) holds by
 * construction: anything that doesn't match one of these three database
 * words simply doesn't match this regex at all, and falls through to the
 * general-qa catch-all untouched.
 */
const CREATE_ITEM_RE = /^(?:create|add|new)\s+(?:a|an)?\s*(task|project|research\s*vault(?:\s+(?:item|entry))?)\b[:\s-]*(.*)$/i;

/**
 * Second, looser trigger (root-cause fix alongside `core/tone.ts`'s
 * `CAPABILITIES_INSTRUCTION` — see that constant's doc comment) for a
 * request that names Notion and a database explicitly but doesn't open with
 * `CREATE_ITEM_RE`'s exact "create/add/new a ___" shape — e.g. "can we input
 * the high priority data to the notion tasks db" or "put this in the notion
 * research vault". Requires BOTH a write-ish verb AND "notion" co-occurring
 * with a database word IN THE SAME CLAUSE (sentence, split on `.`/`?`/`!`) —
 * same deliberately-simple, documented starting heuristic every other
 * trigger recognizer in this file uses (NOT real NLU). Checking per-clause
 * rather than anywhere-in-the-line matters: without it, an unrelated write
 * verb earlier in a multi-sentence message ("add milk to the list. also
 * check notion tasks later") would false-positive on a line that never
 * actually asked to write anything to Notion.
 */
const NOTION_WRITE_VERB_RE = /\b(?:create|add|new|put|input|file|log|enter|record|save|move|sync|export|push|write)\b/i;
const NOTION_DB_MENTION_RE =
  /\bnotion\b[^.?!]*\b(task|project|research\s*vault)s?\b|\b(task|project|research\s*vault)s?\b[^.?!]*\bnotion\b/i;

export function parseCreateItemCommand(line: string): { readonly database: NotionDatabaseTarget; readonly request: string } | undefined {
  const trimmed = line.trim();

  const match = CREATE_ITEM_RE.exec(trimmed);
  if (match) {
    const [, dbWord, rest] = match;
    const database: NotionDatabaseTarget = /task/i.test(dbWord!) ? "Tasks" : /project/i.test(dbWord!) ? "Projects" : "ResearchVault";
    const request = rest!.trim().length > 0 ? rest!.trim() : trimmed;
    return { database, request };
  }

  const clauses = trimmed.split(/[.?!]+/).map((c) => c.trim()).filter((c) => c.length > 0);
  for (const clause of clauses) {
    if (!NOTION_WRITE_VERB_RE.test(clause)) continue;
    const dbMatch = NOTION_DB_MENTION_RE.exec(clause);
    if (!dbMatch) continue;
    const dbWord = dbMatch[1] ?? dbMatch[2];
    const database: NotionDatabaseTarget = /task/i.test(dbWord!) ? "Tasks" : /project/i.test(dbWord!) ? "Projects" : "ResearchVault";
    return { database, request: trimmed };
  }

  return undefined;
}

// ============================================================================
// isSaveSearchResultCommand — pure trigger recognition (Story 6.5 / FR-29,
// moved from shell/chat-cli.ts by Story 8.4 / AD-16)
// ============================================================================

/**
 * Recognizes "save/file that/this [to the/my (notion) (research) vault]" —
 * the same deliberately-simple starting heuristic every other trigger
 * recognizer in this file uses (Story 6.5 / FR-29). Deliberately does NOT
 * match "save my progress" or similar — the trigger word must be
 * immediately followed by "that"/"this" (optionally then a "to the/my
 * ... vault" tail), not an arbitrary object. The tail's "notion" segment
 * (F6, Epic 6 retro) matters because this is checked before
 * `parseCreateItemCommand`'s own looser Notion-mention trigger — without
 * it, "save that to my notion research vault" would match neither trigger
 * exactly and fall through to the wrong one.
 */
const SAVE_SEARCH_RESULT_RE = /^(?:save|file)\s+(?:that|this)(?:\s+to\s+(?:the|my)\s+(?:notion\s+)?(?:research\s+)?vault)?\.?$/i;

export function isSaveSearchResultCommand(line: string): boolean {
  return SAVE_SEARCH_RESULT_RE.test(line.trim());
}

// ============================================================================
// isCalendarEditCommand — pure trigger recognition (Story 6.6 / FR-27,
// moved from shell/chat-cli.ts by Story 8.4 / AD-16). Broad on purpose: the
// actual move/resize/create parsing is draftCalendarEditRequest's job (an
// LLM call, in llm-adapter.ts). There is deliberately no "delete" trigger
// (AD-13).
//
// Real-use fixes plan, Task 2 (the incident: "make a event at 10:45 am
// tommorow to meet with alex..." fell through every trigger below and was
// captured as a Notion Task instead): broadened from the original narrow set
// of verbs into three independent shapes, any one of which is enough —
// - an EXISTING-event verb at the start of the line (move/reschedule/
//   resize/extend/shorten/"block off") — unchanged from the original
//   trigger, since these only make sense against something already on the
//   calendar;
// - a CREATE verb (create/make/add/schedule/"set up"/book/put) at the
//   START of the line, together with an event-ish noun (event/meeting/
//   appointment/call/block) ANYWHERE in the line — deliberately not
//   requiring the noun to sit immediately after the verb ("add DENTIST
//   APPOINTMENT Friday 2pm", "put a STUDY BLOCK at 4 today");
// - "meet with"/"meeting with" together with a time-or-date hint anywhere
//   in the line, even with no create verb at all ("meet with Alex
//   tomorrow at 3").
// Still no "delete" shape at all (AD-13) — a delete request never matches
// any of the three.
// ============================================================================

const CALENDAR_EDIT_EXISTING_EVENT_VERB_RE = /^(move|reschedule|resize|extend|shorten|block\s+off)\b/i;
const CALENDAR_CREATE_VERB_RE = /^(create|make|add|schedule|set\s*up|book|put)\b/i;
const CALENDAR_CREATE_NOUN_RE = /\b(events?|meetings?|appointments?|calls?|blocks?)\b/i;
const MEET_WITH_RE = /\bmeet(?:ing)?\s+with\b/i;
const TIME_OR_DATE_HINT_RE =
  /\b(\d{1,2}(:\d{2})?\s*(am|pm)|at\s+\d{1,2}(:\d{2})?\b|tomorrow|tonight|today|next\s+\w+|mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?)\b/i;

/**
 * Post-review fix (Important #1, AD-13): the "meet with"/"meeting with" +
 * time-or-date shape above is verb-agnostic by design (it has to be, to
 * catch "meet with Alex tomorrow at 3" with no leading create verb at all)
 * — which means, unbroadened, it ALSO matched "delete my meeting with Alex
 * tomorrow at 3", "cancel the meeting with Alex tomorrow", and "remove my
 * meeting with Alex at 3pm", routing a cancel/delete request into the
 * calendar-edit drafter. AD-13 says there is no delete variant AT ALL —
 * `isCalendarEditCommand` below excludes any line this recognizes, and
 * `app/chat-turn.ts` checks this FIRST (before `isCalendarEditCommand`, and
 * before any LLM call) to give Spencer a plain, honest answer instead of
 * silently falling through or — worse — letting `draftCalendarEditRequest`
 * (or `classifyCapture`'s own "event" backstop) attempt to act on it.
 *
 * Recognizes a cancel/delete/remove/clear verb ANYWHERE in the line,
 * together with either an event-ish noun (reusing `CALENDAR_CREATE_NOUN_RE`
 * above) or "meet with"/"meeting with" — the same deliberately-simple,
 * documented starting heuristic every other recognizer in this file uses
 * (NOT real NLU).
 */
const CALENDAR_DELETE_VERB_RE = /\b(cancel|delete|remove|clear)\b/i;

export function isCalendarDeleteRequestCommand(line: string): boolean {
  const trimmed = line.trim();
  if (!CALENDAR_DELETE_VERB_RE.test(trimmed)) return false;
  return CALENDAR_CREATE_NOUN_RE.test(trimmed) || MEET_WITH_RE.test(trimmed);
}

export function isCalendarEditCommand(line: string): boolean {
  const trimmed = line.trim();
  // AD-13 (post-review fix, Important #1): never route a cancel/delete/
  // remove/clear request into the edit/create drafter — checked FIRST, so
  // it overrides every shape below, including "meet with"/"meeting with".
  if (isCalendarDeleteRequestCommand(trimmed)) return false;
  if (CALENDAR_EDIT_EXISTING_EVENT_VERB_RE.test(trimmed)) return true;
  if (CALENDAR_CREATE_VERB_RE.test(trimmed) && CALENDAR_CREATE_NOUN_RE.test(trimmed)) return true;
  if (MEET_WITH_RE.test(trimmed) && TIME_OR_DATE_HINT_RE.test(trimmed)) return true;
  return false;
}

// ============================================================================
// parseDayViewCommand — pure trigger recognition (real-use fixes plan,
// Task 5: "what's happening tomorrow", read any day's Calendar).
// ============================================================================

/**
 * Recognizes a request to see a given day's Calendar (plus that day's own
 * stored Plan, if any) — "what's happening tomorrow", "what do I have on
 * Thursday", "what's on my calendar tomorrow", "what's on for Oct 3" — the
 * same deliberately simple, documented starting heuristic every other
 * trigger recognizer in this file uses (NOT real NLU).
 *
 * Returns the raw TRAILING date phrase verbatim (e.g. "tomorrow",
 * "Thursday", "Oct 3", "2026-10-05") — NOT a resolved date. This file may
 * only import `types/` (AD-1), so it cannot itself call
 * `core/relative-date.ts`'s `resolveRelativeDate`; `app/chat-turn.ts` does
 * that immediately after this match, and treats an unresolvable phrase (e.g.
 * "what's on your mind", where "your mind" resolves to nothing) exactly
 * like a non-match here — falling through to the next recognizer rather
 * than swallowing an unrelated line.
 *
 * Anchored on QUERY verbs ("what's happening" / "what do I have" /
 * "what's on") that never overlap `isCalendarEditCommand`'s own trigger
 * verbs (move/reschedule/create/schedule/etc.) or `isCalendarDeleteRequestCommand`'s
 * cancel/delete/remove/clear verbs — "move my 3pm tomorrow to 4" and "cancel
 * my meeting with Alex tomorrow" both start with a verb this regex never
 * matches at all. Nor does it overlap `isPlanViewCommand`'s bare "plan" /
 * "what's my plan" (that phrase names no Calendar-query verb this regex
 * requires), and `app/chat-turn.ts` checks `isPlanViewCommand` first in any
 * case, so the two never race even where a future phrasing happened to
 * overlap.
 *
 * Returns `undefined` (not an error) for any line that doesn't match this
 * shape at all — including a bare "what's happening"/"what's on" with no
 * trailing phrase — so `chatTurn` can fall through to the next recognizer
 * exactly as it already does for an unrecognized line.
 */
const DAY_VIEW_COMMAND_RE =
  /^(?:what(?:'s|\s+is)\s+happening|what\s+do\s+i\s+have|what(?:'s|\s+is)\s+on(?:\s+my\s+(?:calendar|schedule))?)\s+(?:on\s+|for\s+)?(.+?)\??$/i;

export function parseDayViewCommand(line: string): string | undefined {
  const match = DAY_VIEW_COMMAND_RE.exec(line.trim());
  const phrase = match?.[1]?.trim();
  return phrase && phrase.length > 0 ? phrase : undefined;
}
