/**
 * src/core/research-paging.ts — Story 11.2 (E11-R1): the Research Hub's
 * `pages` query value as a page count. Pure.
 */

/** `raw` (a query string, or a number) as a whole page count; anything missing, non-integer or below 1 means 1. */
export function parsePageCount(raw: string | number | undefined): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
