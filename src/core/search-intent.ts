/**
 * src/core/search-intent.ts
 *
 * Task 5 (real-use fixes plan, "the web search is not working"): a
 * deterministic, zero-API-call pre-check for a search-shaped chat line — the
 * same kind of pure pattern matching every recognizer in `core/chat-commands.ts`
 * uses (NOT real free-text NLU). `app/chat-turn.ts` checks this AFTER its
 * existing deterministic planning recognizers (Plan-view, Plan-day,
 * Mid-Day-Reflow, Blocker, why-prioritized, day-view, save-search-result,
 * create-item, calendar-edit/-delete) and BEFORE its paid `classifyCapture`/
 * `classifyChatIntent` LLM calls — the incident this fixes: Haiku's own
 * classifier (`classifyChatIntent`) was returning GENERAL for plainly
 * search-shaped questions ("what's the latest AI news", "price of bitcoin"),
 * so PERPLEXITY_API_KEY being present never actually got exercised.
 *
 * Three ways a line matches:
 *   1. An explicit `search: <question>` prefix — what `web/src/pages/
 *      ResearchHub.tsx`'s ask box always sends (Ruling), so the Research Hub
 *      never depends on the classifier either. The query is everything after
 *      the prefix, verbatim.
 *   2. An explicit search VERB ("search", "look up", "google", "find out",
 *      "research") anywhere in the line. The query is the line with the verb
 *      phrase stripped (collapsing the resulting whitespace) — falls back to
 *      the whole line if stripping would leave nothing.
 *   3. A current-information CUE ("news", "latest", "today's", "this week",
 *      "current", "right now", "price of", "stock", "score", "weather", "who
 *      won", "what happened") anywhere in the line — but ONLY when the line
 *      doesn't also read like a request for Yoh's OWN planning data (a
 *      "plan"/"task"/"schedule"/"calendar"/"priorit-"/"due"/"homework"/
 *      "assignment"/"essay"/"working on" noun anywhere in it) or a
 *      first-person line about Spencer himself (I1, final-review: "what
 *      should I work on", "whats the latest on my lab report"). This is
 *      what keeps "today's plan", "my tasks this week", "what's due this
 *      week", and "what should I work on right now" off the search path —
 *      the cue words they happen to contain describe a planning question,
 *      not a real-world fact — while a genuine planning line built around
 *      those planning nouns has, in every case, already
 *      matched one of `chatTurn`'s earlier, MORE specific deterministic
 *      recognizers (`isPlanViewCommand`, `parseDayViewCommand`, etc.) and
 *      returned before this function is ever called at all; this guard only
 *      has to catch the phrasings those recognizers' own narrower shapes
 *      don't happen to match.
 *
 * Returns `undefined` (not an error) for any line that doesn't match at all,
 * so `chatTurn` can fall through to `classifyCapture`/`classifyChatIntent`
 * exactly as it already does for an unrecognized line.
 */

const EXPLICIT_SEARCH_PREFIX_RE = /^search:\s*(.+)$/is;

/** A leading polite/address phrase before an imperative ("hey Yoh, can you please look up …"). */
export const POLITE_LEAD = String.raw`(?:(?:hey\s+)?yoh[,:]?\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?`;

/** A search verb used as an imperative — only at the start of the message (after an optional polite lead), so "I need to research colleges" or "remind me to look up flights" stay tasks/captures. */
const SEARCH_VERB_RE = new RegExp(
  String.raw`^\s*${POLITE_LEAD}(?:search(?:\s+the\s+web)?(?:\s+for)?|look\s+up|google|find\s+out(?:\s+about)?|research(?!\s+vault))\b`,
  "i",
);

const CURRENT_INFO_CUE_RE =
  /\b(?:news|latest|today'?s|this\s+week|current(?:ly|\s+events)?|right\s+now|price\s+of|stock\s+(?:price|market)|score|weather|who\s+won|what\s+happened)\b/i;

/** The message reads as a request for information: a question (wh-/aux-word opener or a trailing "?"), "tell me …", or it opens with the cue itself ("price of bitcoin", "latest AI news"). First-person statements ("I'm feeling current…", "stock up on…") don't. */
const INFO_REQUEST_RE =
  /^\s*(?:(?:what|what's|whats|who|who's|when|where|which|why|how|how's|is|are|was|were|did|does|do|any|tell\s+me|give\s+me|show\s+me)\b|(?:news|latest|price\s+of|weather|current\s+events|today'?s|this\s+week'?s)\b)|\?\s*$/i;

export const PLANNING_NOUN_RE = /\b(?:plan|tasks?|schedule|calendar|priorit\w*|due|homework|assignments?|essays?|working\s+on|work\s+on)\b/i;

/**
 * I1 (final-review): checked ONLY on the current-info CUE path below (never
 * the explicit verb or `search:` prefix paths — "search: how am I doing"
 * still searches; Research Hub's ask box always searches). A first-person
 * line ("what should I work on", "whats the latest on my lab report") reads
 * as Spencer asking about himself or his own work, not a request for a
 * real-world fact, even when it also contains a current-info cue word.
 */
export const CUE_PATH_FIRST_PERSON_RE = /\b(?:i|i'm|me|my|mine)\b/i;

export interface SearchIntent {
  readonly query: string;
}

export function parseSearchIntent(line: string): SearchIntent | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;

  const prefixMatch = EXPLICIT_SEARCH_PREFIX_RE.exec(trimmed);
  if (prefixMatch) {
    const query = prefixMatch[1]!.trim();
    if (query.length > 0) return { query };
  }

  const verbMatch = SEARCH_VERB_RE.exec(trimmed);
  if (verbMatch) {
    const stripped = (trimmed.slice(0, verbMatch.index) + trimmed.slice(verbMatch.index + verbMatch[0].length))
      .replace(/\s+/g, " ")
      .trim();
    return { query: stripped.length > 0 ? stripped : trimmed };
  }

  if (
    CURRENT_INFO_CUE_RE.test(trimmed) &&
    INFO_REQUEST_RE.test(trimmed) &&
    !PLANNING_NOUN_RE.test(trimmed) &&
    !CUE_PATH_FIRST_PERSON_RE.test(trimmed)
  ) {
    return { query: trimmed };
  }

  return undefined;
}
