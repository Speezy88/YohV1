/**
 * src/core/quick-add.ts
 *
 * Task 6B (Tasks page). The ONE parser for the Tasks page's quick-add line:
 * "Lab report due fri 90m high #bio" → title "Lab report", Due = Friday,
 * Estimated Duration = 90, Energy = high, Area = bio.
 *
 * Nothing is guessed silently. The rules, in order:
 *  - A `#tag` anywhere in the line is Area. With `ctx.resolveArea` (the
 *    live Notion options, matched by the caller), a tag with no matching
 *    option stays in the title and is listed in `unmatchedAreas`.
 *  - Everything else is read only from the END of the line, one token at a
 *    time: a duration ("90m", "1.5h", "1h30m", "20 min"), an energy word
 *    ("high", "medium"/"med", "low"), or a date phrase of up to three words
 *    ("fri", "tomorrow", "next week friday", "Oct 3", "10/3", an ISO date),
 *    optionally led by "due"/"by"/"on". The scan stops at the first word
 *    that is none of these, so a word like "Low" in "Low tide walk" is never
 *    taken out of the middle of a title.
 *  - A field already read stops the scan (a second duration is title text).
 *  - A time-of-day ("tomorrow at 5") is never half-read: the date resolver
 *    would drop the time, so any window containing "at" or ":" is skipped.
 *  - A title is required: if reading tokens would leave no title, nothing is
 *    read and the whole line is the title.
 *
 * Reuses the ONE relative-date resolver (`relative-date.ts`) and the ONE
 * planning-field-value parser (`planning-field-value.ts`) — no second
 * copy of either rule lives here.
 *
 * Pure (AD-2): no I/O, no module state, never throws. Imports only `core/`
 * and `types/` (AD-1).
 */
import type { Energy, IsoDate } from "../types/domain.ts";
import { parsePlanningFieldValue } from "./planning-field-value.ts";
import { resolveRelativeDate, type RelativeDateContext } from "./relative-date.ts";

export type QuickAddField = "dueDate" | "estimatedDurationMinutes" | "energy" | "area";

export interface QuickAddFields {
  readonly dueDate?: IsoDate;
  readonly estimatedDurationMinutes?: number;
  readonly energy?: Energy;
  readonly area?: string;
}

/** One piece of the line that was read as a field — `raw` is the exact text it came from. */
export interface QuickAddToken {
  readonly field: QuickAddField;
  readonly raw: string;
}

export interface QuickAddParse {
  readonly title: string;
  readonly fields: QuickAddFields;
  /** In reading order: the Area tag first, then the trailing tokens left to right. */
  readonly tokens: readonly QuickAddToken[];
  /** `#tag` bodies that matched no live Area option (only when `resolveArea` is given). */
  readonly unmatchedAreas: readonly string[];
}

export interface QuickAddContext extends RelativeDateContext {
  /** Maps a `#tag` body onto a real Area option, or `undefined` when none is close. Absent: the tag body is used as-is. */
  readonly resolveArea?: (raw: string) => string | undefined;
}

const HASHTAG_RE = /^#([\p{L}\p{N}][\p{L}\p{N}_\-/&.]*)$/u;
const DURATION_MINUTES_RE = /^(\d{1,4})(?:m|min|mins|minute|minutes)$/i;
const DURATION_HOURS_RE = /^(\d{1,2}(?:\.\d{1,2})?)(?:h|hr|hrs|hour|hours)$/i;
const DURATION_HOURS_MINUTES_RE = /^(\d{1,2})h(\d{1,2})m?$/i;
const MINUTE_UNIT_RE = /^(?:m|min|mins|minute|minutes)$/i;
const ENERGY_WORDS: Readonly<Record<string, Energy>> = { high: "high", medium: "medium", med: "medium", low: "low" };
const DATE_CONNECTIVES = new Set(["due", "by", "on"]);
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

interface Consumed {
  readonly start: number; // inclusive index into `words`
  readonly end: number; // inclusive
  readonly field: QuickAddField;
}

export function parseQuickAdd(text: string, ctx: QuickAddContext): QuickAddParse {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  const used = new Array<boolean>(words.length).fill(false);
  const consumed: Consumed[] = [];
  const fields: { dueDate?: IsoDate; estimatedDurationMinutes?: number; energy?: Energy; area?: string } = {};
  const unmatchedAreas: string[] = [];

  // 1. The first #tag anywhere is Area.
  for (let i = 0; i < words.length; i++) {
    const tag = HASHTAG_RE.exec(words[i]!);
    if (!tag) continue;
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
    consumed.push({ start: i, end: i, field: "area" });
  }

  // 2. Trailing tokens, right to left, over the words the tag pass left.
  // An unmatched `#tag` stays in the title but never blocks the scan.
  const remaining = words.map((_, i) => i).filter((i) => !used[i] && !HASHTAG_RE.test(words[i]!));
  const trailing: Consumed[] = [];
  let k = remaining.length - 1;
  while (k >= 0) {
    const index = remaining[k]!;
    const word = words[index]!;

    const minutes = durationFromWord(word);
    if (minutes !== undefined) {
      if (fields.estimatedDurationMinutes !== undefined) break;
      fields.estimatedDurationMinutes = minutes;
      trailing.push({ start: index, end: index, field: "estimatedDurationMinutes" });
      k--;
      continue;
    }

    if (MINUTE_UNIT_RE.test(word) && k >= 1) {
      const numberIndex = remaining[k - 1]!;
      const twoWord = durationFromWord(`${words[numberIndex]}m`);
      if (twoWord !== undefined && /^\d+$/.test(words[numberIndex]!)) {
        if (fields.estimatedDurationMinutes !== undefined) break;
        fields.estimatedDurationMinutes = twoWord;
        trailing.push({ start: numberIndex, end: index, field: "estimatedDurationMinutes" });
        k -= 2;
        continue;
      }
    }

    const energy = energyFromWord(word);
    if (energy !== undefined) {
      if (fields.energy !== undefined) break;
      fields.energy = energy;
      trailing.push({ start: index, end: index, field: "energy" });
      k--;
      continue;
    }

    let dateWords = 0;
    let dueDate: IsoDate | undefined;
    for (let len = Math.min(MAX_DATE_WORDS, k + 1); len >= 1 && dueDate === undefined; len--) {
      const window = remaining.slice(k - len + 1, k + 1).map((i) => words[i]!);
      if (window.some((w) => w.toLowerCase() === "at" || w.includes(":"))) continue;
      const resolved = resolveRelativeDate(window.join(" "), ctx);
      if (resolved !== undefined) {
        dueDate = resolved;
        dateWords = len;
      }
    }
    if (dueDate !== undefined) {
      if (fields.dueDate !== undefined) break;
      fields.dueDate = dueDate;
      let startK = k - dateWords + 1;
      if (startK >= 1 && DATE_CONNECTIVES.has(words[remaining[startK - 1]!]!.toLowerCase())) startK--;
      trailing.push({ start: remaining[startK]!, end: index, field: "dueDate" });
      k = startK - 1;
      continue;
    }

    break;
  }

  for (const t of trailing) for (let i = t.start; i <= t.end; i++) used[i] = true;
  const title = words.filter((_, i) => !used[i]).join(" ");

  // A title is required: reading tokens must never leave nothing behind.
  if (title.length === 0) {
    return { title: words.join(" "), fields: {}, tokens: [], unmatchedAreas };
  }

  const ordered = [...consumed, ...trailing.sort((a, b) => a.start - b.start)];
  const tokens: QuickAddToken[] = ordered.map((c) => ({ field: c.field, raw: words.slice(c.start, c.end + 1).join(" ") }));
  return { title, fields, tokens, unmatchedAreas };
}
