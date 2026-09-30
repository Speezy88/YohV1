/** Filing validation for memory candidates (Story 13.4). Pure. */
import type { MemoryCandidate, MemoryFolder } from "../types/domain.ts";
import { MEMORY_ITEM_MAX_CHARS, STATED_ONLY_FOLDERS } from "./memory-folders.ts";
import { validateRuleValue } from "./planning-settings.ts";

/** Longest an explicit filing may take before the receipt reports failure. */
export const MEMORY_FILING_TIMEOUT_MS = 8000;

export const MEMORY_FILING_MAX_ITEMS = 2;
/** Story 13.5: the narrowest reading when Spencer's words name no scope. */
export const NARROWEST_FEEDBACK_SCOPE = "this kind of request";

export interface FilingContext {
  now: Date;
  forceStated?: boolean;
  forceFolder?: MemoryFolder;
}

export interface FilingResult {
  accepted: MemoryCandidate[];
  dropped: { candidate: MemoryCandidate; reason: string }[];
}

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function validateFiling(candidates: readonly MemoryCandidate[], ctx: FilingContext): FilingResult {
  const accepted: MemoryCandidate[] = [];
  const dropped: FilingResult["dropped"] = [];
  const today = ctx.now.toISOString().slice(0, 10);
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
