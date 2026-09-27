/**
 * src/core/quick-add.ts
 *
 * Task 6B (Tasks page), extended by Polish 4 Task 1 (Spencer: "the
 * information is in the task name… change that so it fills the data in the
 * right spot"). The ONE parser for the Tasks page's quick-add line:
 * "Lab report due fri 90m high #bio" → title "Lab report", Due = Friday,
 * Estimated Duration = 90, Energy = high, Area = bio.
 *
 * Two real Spencer inputs that used to save with the WHOLE line as the
 * title and no fields — because the OLD rule only ever read tokens off the
 * very END of the line — now parse correctly:
 *  - "history poster due wednesday low energy" → title "history poster",
 *    Due = next Wednesday, Energy low.
 *  - "add ACT Math section to act. 60 minutes. deep work. status not
 *    started" → title "ACT Math section", 60 min, Energy high, Status
 *    not-started, Area (whichever live option "act" uniquely matches).
 *
 * The rules, in reading order:
 *  - A `#tag` anywhere in the line is Area (unchanged). With
 *    `ctx.resolveArea` (the live Notion options, matched by the caller), a
 *    tag with no matching option stays in the title and is listed in
 *    `unmatchedAreas` — and, either way, a `#tag`-shaped word is NEVER
 *    considered by any other rule below (it's transparent to them, exactly
 *    like before).
 *  - Everything else is found by ONE right-to-left scan over the remaining
 *    words. Some forms are recognized ANYWHERE in the line (an unambiguous
 *    shape carries its own meaning no matter where it sits): a duration
 *    ("90m", "1.5h", "1h30m", "20 min"), an explicit energy phrase ("high
 *    energy", "energy high", "deep work", "light work"), a `due`/`by`/`on`
 *    date phrase ("due fri", "by next week friday"), a `status <phrase>`
 *    (mapped to the real Status options — "status done"/"status completed"
 *    are recognized as NOT a match at all: quick-add must never set
 *    Completed, so those words are simply left as ordinary title text), and
 *    `for <area option>`/`to <area option>` (only when the word exactly,
 *    case-insensitively, and UNAMBIGUOUSLY matches one live Area option).
 *  - Two forms keep the OLD end-of-line-only rule: a BARE energy word
 *    ("high", "low", "med"/"medium") with no "energy"/"work" qualifier, and
 *    a BARE date phrase (no `due`/`by`/`on`) — both only read while the
 *    scan is still unbroken from the true end of the line. The very first
 *    word (scanning backward) that matches NEITHER an anywhere-form NOR one
 *    of these two bare forms permanently ends bare-form eligibility for
 *    everything further left (anywhere-forms keep being found regardless) —
 *    this is exactly why "Low tide walk" never loses "Low" (it's not at the
 *    true end) while "Lab report due fri 90m high" still reads "high" off
 *    the tail.
 *  - A field already read for this line is never read again: a second
 *    occurrence of the same field type is left as ordinary title text.
 *  - A leading imperative "add" is dropped from the title.
 *  - Title: what remains, trimmed of dangling whitespace/punctuation. If
 *    reading tokens would leave no title at all, nothing is read and the
 *    whole line is the title (unchanged safeguard).
 *
 * Clauses are split on `.`, `,`, `;` (but never a decimal point inside a
 * number like "1.5h") before words are read off — this is what lets
 * "to act. 60 minutes. deep work. status not started" read as four
 * independent clauses rather than one run-on phrase; the split characters
 * themselves are discarded, which is also what keeps them out of the final
 * title (no re-punctuation needed).
 *
 * Reuses the ONE relative-date resolver (`relative-date.ts`) and the ONE
 * planning-field-value parser (`planning-field-value.ts`) — no second copy
 * of either rule lives here.
 *
 * Pure (AD-2): no I/O, no module state, never throws. Imports only `core/`
 * and `types/` (AD-1).
 */
import type { Energy, IsoDate, TaskStatus } from "../types/domain.ts";
import { isDateWord } from "./relative-date.ts";
import { parsePlanningFieldValue, parsePriorityValue } from "./planning-field-value.ts";
import { resolveRelativeDate, type RelativeDateContext } from "./relative-date.ts";

export type QuickAddField = "dueDate" | "estimatedDurationMinutes" | "energy" | "area" | "status" | "priority";

export interface QuickAddFields {
  readonly dueDate?: IsoDate;
  readonly estimatedDurationMinutes?: number;
  readonly energy?: Energy;
  readonly area?: string;
  readonly status?: TaskStatus;
  /** Task 7: the live Priority option matched, verbatim (e.g. "🔴 High") — only ever set when `ctx.priorityOptions` is given. */
  readonly priority?: string;
}

/** One piece of the line that was read as a field — `raw` is the exact text it came from. */
export interface QuickAddToken {
  readonly field: QuickAddField;
  readonly raw: string;
}

export interface QuickAddParse {
  readonly title: string;
  readonly fields: QuickAddFields;
  /** In reading order: the Area tag first, then everything else left to right. */
  readonly tokens: readonly QuickAddToken[];
  /** `#tag` bodies that matched no live Area option (only when `resolveArea` is given). */
  readonly unmatchedAreas: readonly string[];
}

export interface QuickAddContext extends RelativeDateContext {
  /** Maps a `#tag` body onto a real Area option, or `undefined` when none is close. Absent: the tag body is used as-is. */
  readonly resolveArea?: (raw: string) => string | undefined;
  /** The live Area option NAMES, for the `for <area>`/`to <area>` rule only (exact-word match, never a prefix/typo match). Absent: that rule never fires. */
  readonly areaOptions?: readonly string[];
  /** Task 7: the live Priority option NAMES (e.g. ["🔴 High", "🟡 Medium", "🟢 Low"]), for "priority high"/"high priority"/"p1"/"p2"/"p3". Absent: Priority is never read (matches Area's `areaOptions` gate). */
  readonly priorityOptions?: readonly string[];
}

const HASHTAG_RE = /^#([\p{L}\p{N}][\p{L}\p{N}_\-/&.]*)$/u;
const DURATION_MINUTES_RE = /^(\d{1,4})(?:m|min|mins|minute|minutes)$/i;
const DURATION_HOURS_RE = /^(\d{1,2}(?:\.\d{1,2})?)(?:h|hr|hrs|hour|hours)$/i;
const DURATION_HOURS_MINUTES_RE = /^(\d{1,2})h(\d{1,2})m?$/i;
const MINUTE_UNIT_RE = /^(?:m|min|mins|minute|minutes)$/i;
/** The OLD bare-trailing-word energy set — unchanged from before this task; "deep"/"light"/"shallow" are only ever read via an explicit "energy"/"work" phrase (see `ENERGY_PHRASE_WORDS`), never bare. */
const ENERGY_WORDS: Readonly<Record<string, Energy>> = { high: "high", medium: "medium", med: "medium", low: "low" };
/** The wider alias set for the explicit "<word> energy"/"energy <word>" phrase forms. */
const ENERGY_PHRASE_WORDS: Readonly<Record<string, Energy>> = { ...ENERGY_WORDS, deep: "high", light: "low", shallow: "low" };
const DATE_CONNECTIVES = new Set(["due", "by", "on"]);
/** Fix round 1: connectives stripped from the very end of the title only, once dangling with nothing left after them (see the title-assembly step, below). */
const TRAILING_CONNECTIVES = new Set(["for", "to", "by", "on", "at", "due", "and", "with"]);
const MAX_DATE_WORDS = 3;

/** Minutes for a single-word duration, validated by the ONE planning-field parser (a whole, positive number). */
function durationFromWord(word: string): number | undefined {
  let minutes: number | undefined;
  const hm = DURATION_HOURS_MINUTES_RE.exec(word);
  const h = DURATION_HOURS_RE.exec(word);
  const m = DURATION_MINUTES_RE.exec(word);
  if (hm) minutes = Number(hm[1]) * 60 + Number(hm[2]);
  else if (h) minutes = Number(h[1]) * 60;
  else if (m) minutes = Number(m[1]);
  if (minutes === undefined) return undefined;
  const parsed = parsePlanningFieldValue("estimatedDurationMinutes", String(minutes));
  return parsed.ok ? parsed.value : undefined;
}

function energyFromWord(word: string): Energy | undefined {
  const candidate = ENERGY_WORDS[word.toLowerCase()];
  if (candidate === undefined) return undefined;
  const parsed = parsePlanningFieldValue("energy", candidate);
  return parsed.ok ? parsed.value : undefined;
}

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

/** Strips a small set of leading/trailing punctuation marks a clause split alone doesn't catch (quotes, a stray colon/bang) — never touches an internal character, so "1.5h" and "10/3" are untouched. */
function stripEdgePunct(word: string): string {
  return word.replace(/^['"(]+/, "").replace(/['")".,;:!?]+$/, "");
}

/**
 * Matches a `#tag` body against Spencer's live Area option names, the way a
 * tag is typed: an exact name ("#errands" → "Errands"), or the ONE option
 * the tag is a prefix of — of the whole name or of any word in it ("#bio" →
 * "AP Bio", "#school" → "School/ACT/College Apps", "#side-projects" → "Side
 * Projects/Business"). Two or more candidates is ambiguous: `undefined`,
 * never a coin flip. Callers may fall back to a typo-tolerant matcher.
 */
export function matchAreaTag(tag: string, areaOptions: readonly string[]): string | undefined {
  const needle = tag.replace(/[-_]+/g, " ").trim().toLowerCase();
  if (needle.length === 0) return undefined;
  const exact = areaOptions.find((o) => o.trim().toLowerCase() === needle);
  if (exact !== undefined) return exact;
  const needleWords = wordsOf(needle);
  const candidates = areaOptions.filter((option) => {
    const lowered = option.toLowerCase();
    if (lowered.startsWith(needle)) return true;
    const optionWords = wordsOf(option);
    // Every tag word must start some word of the option, in order.
    let from = 0;
    for (const w of needleWords) {
      const at = optionWords.findIndex((ow, i) => i >= from && ow.startsWith(w));
      if (at === -1) return false;
      from = at + 1;
    }
    return true;
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Matches a single bare word (from "for `<word>`"/"to `<word>`") against
 * Spencer's live Area option names by EXACT word equality, case-
 * insensitively — never a prefix or typo match (unlike `matchAreaTag`,
 * which a `#tag` deliberately allows to be looser). Matches either the
 * whole option name ("errands" → "Errands") or any one whole word inside a
 * multi-word/slash-joined name ("act" → "School/ACT/College Apps"'s "ACT").
 * Two or more candidates is ambiguous: `undefined`, never a coin flip.
 */
export function matchAreaWordExact(word: string, areaOptions: readonly string[]): string | undefined {
  const needle = word.trim().toLowerCase();
  if (needle.length === 0) return undefined;
  const candidates = areaOptions.filter((option) => option.trim().toLowerCase() === needle || wordsOf(option).includes(needle));
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Real-use fixes plan, Polish 4 Task 1: a cheap heuristic over an ALREADY-
 * parsed quick-add title — does it still contain a word that looks like it
 * names a Task field the deterministic parser (above) didn't manage to
 * read? `app/create-task.ts` calls this, on submit only, to decide whether
 * the line is worth a Haiku fallback call at all (never on every
 * keystroke). Deliberately loose/over-inclusive: a false positive just
 * costs one extra cheap Haiku call that finds nothing new; a false
 * negative silently loses real data, which is the failure this whole task
 * exists to fix.
 */
const FIELD_LIKE_WORDS_RE = /\b(energy|minutes?|hours?|hrs?|status|due|priority|deep|not\s+started|in\s+progress)\b/i;

export function hasUnresolvedFieldWords(title: string): boolean {
  if (FIELD_LIKE_WORDS_RE.test(title)) return true;
  return title.split(/\s+/).some((w) => isDateWord(stripEdgePunct(w)));
}

interface Match {
  readonly start: number; // inclusive index into `words`
  readonly end: number; // inclusive
  readonly field: QuickAddField;
  readonly value: string | number;
}

export function parseQuickAdd(text: string, ctx: QuickAddContext): QuickAddParse {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  const norm = words.map((w) => stripEdgePunct(w).toLowerCase());
  const used = new Array<boolean>(words.length).fill(false);
  const isHashtag = words.map((w) => HASHTAG_RE.test(w));
  const fields: { dueDate?: IsoDate; estimatedDurationMinutes?: number; energy?: Energy; area?: string; status?: TaskStatus; priority?: string } = {};
  const unmatchedAreas: string[] = [];
  const hashtagTokens: QuickAddToken[] = [];

  // 1. The first #tag anywhere is Area. Unchanged from before this task —
  // and an unmatched tag is never marked `used`, so it stays fully visible
  // to the title (never blocking anything) while still being invisible to
  // every rule below (`isHashtag` excludes it regardless of `used`).
  for (let i = 0; i < words.length; i++) {
    if (!isHashtag[i]) continue;
    const tag = HASHTAG_RE.exec(words[i]!)!;
    const body = tag[1]!;
    const resolved = ctx.resolveArea ? ctx.resolveArea(body) : body;
    if (resolved === undefined) {
      unmatchedAreas.push(body);
      continue;
    }
    const parsed = parsePlanningFieldValue("area", resolved);
    if (!parsed.ok || parsed.value === undefined || fields.area !== undefined) continue;
    fields.area = parsed.value;
    used[i] = true;
    hashtagTokens.push({ field: "area", raw: words[i]! });
  }

  // 2. One right-to-left scan for everything else. `frontier` tracks how
  // far the UNBROKEN run from the true end of the line still reaches — the
  // two "old rule" bare forms (`tryBareEnergy`/`tryBareDate`) only fire
  // while `i === frontier`; every other (anywhere) form fires regardless.
  const matches: Match[] = [];

  function bestDateWindow(i: number): { readonly start: number; readonly resolved: string } | undefined {
    const maxLen = Math.min(MAX_DATE_WORDS, i + 1);
    for (let len = maxLen; len >= 1; len--) {
      const start = i - len + 1;
      let contiguous = true;
      for (let j = start; j <= i; j++) {
        if (used[j] || isHashtag[j]) {
          contiguous = false;
          break;
        }
      }
      if (!contiguous) continue;
      const windowWords = norm.slice(start, i + 1);
      if (windowWords.some((w) => w === "at" || w.includes(":"))) continue;
      const resolved = resolveRelativeDate(windowWords.join(" "), ctx);
      if (resolved !== undefined) return { start, resolved };
    }
    return undefined;
  }

  function tryDuration2(i: number): Match | undefined {
    if (fields.estimatedDurationMinutes !== undefined) return undefined;
    if (i < 1 || used[i - 1] || isHashtag[i - 1]) return undefined;
    if (!MINUTE_UNIT_RE.test(norm[i]!) || !/^\d+$/.test(norm[i - 1]!)) return undefined;
    const minutes = durationFromWord(`${norm[i - 1]}m`);
    return minutes === undefined ? undefined : { start: i - 1, end: i, field: "estimatedDurationMinutes", value: minutes };
  }

  function tryDuration1(i: number): Match | undefined {
    if (fields.estimatedDurationMinutes !== undefined) return undefined;
    const minutes = durationFromWord(norm[i]!);
    return minutes === undefined ? undefined : { start: i, end: i, field: "estimatedDurationMinutes", value: minutes };
  }

  function tryEnergyPhrase(i: number): Match | undefined {
    if (fields.energy !== undefined) return undefined;
    if (i < 1 || used[i - 1] || isHashtag[i - 1]) return undefined;
    if (norm[i] === "energy") {
      const value = ENERGY_PHRASE_WORDS[norm[i - 1]!];
      if (value !== undefined) return { start: i - 1, end: i, field: "energy", value };
    }
    if (norm[i - 1] === "energy") {
      const value = ENERGY_PHRASE_WORDS[norm[i]!];
      if (value !== undefined) return { start: i - 1, end: i, field: "energy", value };
    }
    return undefined;
  }

  function tryDeepLightWork(i: number): Match | undefined {
    if (fields.energy !== undefined) return undefined;
    if (i < 1 || used[i - 1] || isHashtag[i - 1] || norm[i] !== "work") return undefined;
    if (norm[i - 1] === "deep") return { start: i - 1, end: i, field: "energy", value: "high" };
    if (norm[i - 1] === "light") return { start: i - 1, end: i, field: "energy", value: "low" };
    return undefined;
  }

  function tryDueAnywhere(i: number): Match | undefined {
    if (fields.dueDate !== undefined) return undefined;
    const window = bestDateWindow(i);
    if (!window) return undefined;
    const connectorIdx = window.start - 1;
    if (connectorIdx < 0 || used[connectorIdx] || isHashtag[connectorIdx] || !DATE_CONNECTIVES.has(norm[connectorIdx]!)) return undefined;
    return { start: connectorIdx, end: i, field: "dueDate", value: window.resolved };
  }

  function tryStatusPhrase(i: number): Match | undefined {
    if (fields.status !== undefined) return undefined;
    if (i < 2 || used[i - 2] || used[i - 1] || used[i] || isHashtag[i - 2] || isHashtag[i - 1] || isHashtag[i]) return undefined;
    const phrase = `${norm[i - 2]} ${norm[i - 1]} ${norm[i]}`;
    if (phrase === "status not started") return { start: i - 2, end: i, field: "status", value: "not-started" };
    if (phrase === "status in progress") return { start: i - 2, end: i, field: "status", value: "in-progress" };
    // "status done"/"status completed" are deliberately NOT matched here:
    // quick-add must never set Completed, so those words are simply left
    // as ordinary title text (never consumed, never applied).
    return undefined;
  }

  /** "p1"/"p2"/"p3" -> the concept word "high"/"medium"/"low", resolved against the live Priority options. */
  const PRIORITY_CODE_WORDS: Readonly<Record<string, string>> = { p1: "high", p2: "medium", p3: "low" };

  function tryPriorityPhrase(i: number): Match | undefined {
    if (fields.priority !== undefined || !ctx.priorityOptions || ctx.priorityOptions.length === 0) return undefined;
    if (i < 1 || used[i - 1] || isHashtag[i - 1]) return undefined;
    if (norm[i] === "priority") {
      const parsed = parsePriorityValue(norm[i - 1]!, ctx.priorityOptions);
      if (parsed.ok) return { start: i - 1, end: i, field: "priority", value: parsed.value };
    }
    if (norm[i - 1] === "priority") {
      const parsed = parsePriorityValue(norm[i]!, ctx.priorityOptions);
      if (parsed.ok) return { start: i - 1, end: i, field: "priority", value: parsed.value };
    }
    return undefined;
  }

  function tryPriorityCode(i: number): Match | undefined {
    if (fields.priority !== undefined || !ctx.priorityOptions || ctx.priorityOptions.length === 0) return undefined;
    const code = PRIORITY_CODE_WORDS[norm[i]!];
    if (code === undefined) return undefined;
    const parsed = parsePriorityValue(code, ctx.priorityOptions);
    return parsed.ok ? { start: i, end: i, field: "priority", value: parsed.value } : undefined;
  }

  function tryAreaForTo(i: number): Match | undefined {
    if (fields.area !== undefined || !ctx.areaOptions || ctx.areaOptions.length === 0) return undefined;
    if (i < 1 || used[i - 1] || isHashtag[i - 1]) return undefined;
    if (norm[i - 1] !== "for" && norm[i - 1] !== "to") return undefined;
    const matched = matchAreaWordExact(norm[i]!, ctx.areaOptions);
    return matched === undefined ? undefined : { start: i - 1, end: i, field: "area", value: matched };
  }

  function tryBareEnergy(i: number): Match | undefined {
    if (fields.energy !== undefined) return undefined;
    const value = energyFromWord(norm[i]!);
    return value === undefined ? undefined : { start: i, end: i, field: "energy", value };
  }

  function tryBareDate(i: number): Match | undefined {
    if (fields.dueDate !== undefined) return undefined;
    const window = bestDateWindow(i);
    return window === undefined ? undefined : { start: window.start, end: i, field: "dueDate", value: window.resolved };
  }

  const ANYWHERE_RULES = [tryDuration2, tryDuration1, tryEnergyPhrase, tryDeepLightWork, tryDueAnywhere, tryStatusPhrase, tryAreaForTo, tryPriorityPhrase, tryPriorityCode];

  let frontier = words.length - 1;
  let i = words.length - 1;
  while (i >= 0) {
    if (used[i] || isHashtag[i]) {
      if (frontier === i) frontier = i - 1;
      i--;
      continue;
    }

    let match: Match | undefined;
    for (const rule of ANYWHERE_RULES) {
      match = rule(i);
      if (match) break;
    }

    if (!match && i === frontier) {
      match = tryBareEnergy(i) ?? tryBareDate(i);
    }

    if (match) {
      for (let j = match.start; j <= match.end; j++) used[j] = true;
      if (match.field === "dueDate") fields.dueDate = match.value as IsoDate;
      else if (match.field === "estimatedDurationMinutes") fields.estimatedDurationMinutes = match.value as number;
      else if (match.field === "energy") fields.energy = match.value as Energy;
      else if (match.field === "status") fields.status = match.value as TaskStatus;
      else if (match.field === "area") fields.area = match.value as string;
      else if (match.field === "priority") fields.priority = match.value as string;
      matches.push(match);
      if (i === frontier) frontier = match.start - 1;
      i = match.start - 1;
      continue;
    }

    if (i === frontier) frontier = -1;
    i--;
  }

  matches.sort((a, b) => a.start - b.start);
  const trailingTokens: QuickAddToken[] = matches.map((m) => ({
    field: m.field,
    raw: words.slice(m.start, m.end + 1).join(" "),
  }));

  // 3. A leading imperative "add" is dropped from the title.
  let titleIndices = words.map((_, idx) => idx).filter((idx) => !used[idx]);
  if (titleIndices.length > 0 && norm[titleIndices[0]!] === "add") titleIndices = titleIndices.slice(1);

  // Fix round 1: a connective word ("for", "to", "by", "on", "at", "due",
  // "and", "with") left dangling at the very end once the field it
  // introduced was read out from under it ("call mom for 5 min" → duration
  // 5 reads "5 min", leaving "for" orphaned) is stripped too — but ONLY
  // from the true tail, and never down to nothing at all.
  while (titleIndices.length > 1 && TRAILING_CONNECTIVES.has(norm[titleIndices[titleIndices.length - 1]!]!)) {
    titleIndices = titleIndices.slice(0, -1);
  }

  const title = titleIndices
    .map((idx) => words[idx])
    .join(" ")
    .replace(/^[\s.,;:!?'"-]+|[\s.,;:!?'"-]+$/g, "")
    .trim();

  // A title is required: reading tokens must never leave nothing behind.
  if (title.length === 0) {
    return { title: words.join(" "), fields: {}, tokens: [], unmatchedAreas };
  }

  return { title, fields, tokens: [...hashtagTokens, ...trailingTokens], unmatchedAreas };
}
