/** FTS5 query builder shared by the memory item and chat stores. Pure. */

/** Quotes each distinct token of 3+ letters/digits and ORs them; undefined when nothing is searchable. */
export function ftsQuery(text: string): string | undefined {
  const tokens = (text.match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length >= 3);
  if (tokens.length === 0) return undefined;
  return [...new Set(tokens)].map((t) => `"${t}"`).join(" OR ");
}
