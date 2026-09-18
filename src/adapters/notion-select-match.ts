/**
 * src/adapters/notion-select-match.ts
 *
 * FR-24 / AD-12's data-integrity guard: resolves a Spencer-typed answer to
 * one of a `select`-backed Notion property's REAL, currently-existing
 * options — never a raw string written as-is, which Notion would otherwise
 * silently accept as a brand-new option, corrupting Spencer's taxonomy with
 * a near-duplicate.
 *
 * A pure string-matching algorithm with no I/O and no module-level state,
 * but deliberately placed here in `adapters/` rather than `core/`: AD-1
 * restricts `core/*.ts` files to importing only `types/`/other `core/`
 * files, and restricts `adapters/*.ts` to importing only `types/` — a
 * `core/*.ts` module could never be consumed by `notion-adapter.ts` without
 * violating that layering. This file has exactly one caller
 * (`notion-adapter.ts`, its sibling in this same layer) and no
 * knowledge of Notion or `MemoryStore` at all — it just resolves a string
 * against a list of strings.
 *
 * Three-tier resolution, most to least confident:
 *  1. Exact match, case/whitespace-insensitive — returns the candidate's
 *     real casing.
 *  2. Closest match by Levenshtein edit distance, accepted only within a
 *     bounded threshold (guards against "corrected" into something Spencer
 *     never meant) and only when a single candidate is strictly closest — a
 *     tie is treated as ambiguous, not a coin flip.
 *  3. No confident match: `undefined`, so the caller fails the write and
 *     re-prompts rather than guessing.
 */

/** Case/whitespace-insensitive key used for both the exact-match check and as the basis for edit-distance comparison. */
function normalize(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Standard Levenshtein edit distance (insert/delete/substitute, unit cost)
 * between two strings. O(a.length * b.length) — candidate lists here are
 * short (a handful of Notion select options), so no faster algorithm is
 * warranted.
 */
function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) distances[i]![0] = i;
  for (let j = 0; j < cols; j++) distances[0]![j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      distances[i]![j] = Math.min(
        distances[i - 1]![j]! + 1, // deletion
        distances[i]![j - 1]! + 1, // insertion
        distances[i - 1]![j - 1]! + cost, // substitution
      );
    }
  }

  return distances[rows - 1]![cols - 1]!;
}

/** The largest edit distance still treated as "the same word, mistyped" for a string of this length — roughly a 30% character-difference allowance, floored at 1 so a single-character typo is always correctable. */
function threshold(length: number): number {
  return Math.max(1, Math.floor(length * 0.3));
}

/**
 * Resolves `input` to one of `candidates` — the real option names a Notion
 * `select` property currently has — or `undefined` if no candidate can be
 * matched with confidence. Never returns a value not present in
 * `candidates`.
 */
export function closestOption(input: string, candidates: readonly string[]): string | undefined {
  const normalizedInput = normalize(input);
  if (normalizedInput.length === 0 || candidates.length === 0) return undefined;

  const exact = candidates.find((candidate) => normalize(candidate) === normalizedInput);
  if (exact !== undefined) return exact;

  let best: { readonly candidate: string; readonly distance: number } | undefined;
  let tied = false;

  for (const candidate of candidates) {
    const distance = levenshtein(normalizedInput, normalize(candidate));
    if (best === undefined || distance < best.distance) {
      best = { candidate, distance };
      tied = false;
    } else if (distance === best.distance) {
      tied = true;
    }
  }

  if (best === undefined || tied) return undefined;
  if (best.distance > threshold(normalizedInput.length)) return undefined;
  return best.candidate;
}
