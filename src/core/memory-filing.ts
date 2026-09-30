/** Filing validation for memory candidates (Story 13.4). Pure. */
import type { MemoryCandidate, MemoryFolder, MemoryItem } from "../types/domain.ts";
import { MEMORY_ITEM_MAX_CHARS, STATED_ONLY_FOLDERS } from "./memory-folders.ts";
import { validateRuleValue } from "./planning-settings.ts";

/** Longest an explicit filing may take before the receipt reports failure. */
export const MEMORY_FILING_TIMEOUT_MS = 8000;

export const MEMORY_FILING_MAX_ITEMS = 2;
/** Story 13.5: the narrowest reading when Spencer's words name no scope. */
export const NARROWEST_FEEDBACK_SCOPE = "this kind of request";

export interface FilingContext {
  now: Date;
  /** Host `YOH_TIMEZONE`: "today" for expiry is the local date, never UTC. */
  timeZone: string;
  forceStated?: boolean;
  forceFolder?: MemoryFolder;
}

export interface FilingResult {
  accepted: MemoryCandidate[];
  dropped: { candidate: MemoryCandidate; reason: string }[];
}

function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function validateFiling(candidates: readonly MemoryCandidate[], ctx: FilingContext): FilingResult {
  const accepted: MemoryCandidate[] = [];
  const dropped: FilingResult["dropped"] = [];
  const today = localDate(ctx.now, ctx.timeZone);
  for (const raw of candidates) {
    if (accepted.length >= MEMORY_FILING_MAX_ITEMS) {
      dropped.push({ candidate: raw, reason: "over-limit" });
      continue;
    }
    const c: MemoryCandidate = { ...raw, text: raw.text.trim() };
    if (ctx.forceStated) c.origin = "stated";
    if (ctx.forceFolder) c.folder = ctx.forceFolder;
    let reason: string | undefined;
    if (c.text.length === 0) reason = "empty";
    else if (c.text.length > MEMORY_ITEM_MAX_CHARS) reason = "too-long";
    else if (c.origin === "inferred" && STATED_ONLY_FOLDERS.includes(c.folder)) reason = "inferred-in-stated-only-folder";
    else if (c.origin === "inferred" && c.sensitive) reason = "sensitive-inferred";
    else if (c.expiresOn !== undefined && (!validDate(c.expiresOn) || c.expiresOn < today)) reason = "bad-expiry";
    if (reason) {
      dropped.push({ candidate: raw, reason });
      continue;
    }
    if (c.folder === "feedback" && (c.scope === undefined || c.scope.trim() === "")) c.scope = NARROWEST_FEEDBACK_SCOPE;
    if (c.ruleChange && (c.folder !== "planning-preferences" || !validateRuleValue(c.ruleChange.key, c.ruleChange.value).ok)) {
      delete c.ruleChange;
    }
    accepted.push(c);
  }
  return { accepted, dropped };
}

const ACK_WORDS = new Set(
  ("ok okay thanks thank you yoh so much got it sounds good sure yes yeah yep no nope cool great perfect nice will do makes sense that works for me all a lot very appreciate").split(" "),
);

/** Story 13.5 (FR-54): a turn too small to be worth a model call. Pure. */
export function isTrivialTurn(text: string, ctx: { handledDeterministically: boolean; isStructuredAnswer: boolean }): boolean {
  if (ctx.handledDeterministically || ctx.isStructuredAnswer) return true;
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s':]/gu, " ").split(/\s+/).filter((w) => w !== "");
  if (words.length <= 3) return true;
  return words.every((w) => ACK_WORDS.has(w));
}

export interface FilingAction {
  kind: "insert" | "supersede";
  candidate: MemoryCandidate;
  targetId?: string;
}

/** Restating or contradicting a CURRENT item supersedes it; anything else inserts. One action per target id. */
export function planFilingActions(accepted: readonly MemoryCandidate[], current: readonly MemoryItem[]): FilingAction[] {
  const currentIds = new Set(current.filter((i) => i.status === "current").map((i) => i.id));
  const claimed = new Set<string>();
  return accepted.map((candidate) => {
    const targetId = [candidate.restatesId, candidate.contradictsId].find((id) => id !== undefined && currentIds.has(id) && !claimed.has(id));
    if (targetId === undefined) return { kind: "insert", candidate };
    claimed.add(targetId);
    return { kind: "supersede", candidate, targetId };
  });
}
