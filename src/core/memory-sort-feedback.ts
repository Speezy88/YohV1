/** Sorting feedback: Spencer's verdicts on where memory items were filed, as example lines for the filer. Pure. */
import type { MemorySortFeedback } from "../types/domain.ts";

/** Longest sorting-feedback reason, in characters. */
export const MEMORY_SORT_REASON_MAX_CHARS = 280;

/** How many verdicts (newest first) the filer is shown. */
export const MEMORY_SORT_EXAMPLES_MAX = 12;

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** One line per verdict, in the order given (the store lists newest first), capped at `MEMORY_SORT_EXAMPLES_MAX`. */
export function sortingExampleLines(feedback: readonly MemorySortFeedback[]): string[] {
  return feedback.slice(0, MEMORY_SORT_EXAMPLES_MAX).map((f) => {
    const verdict = f.verdict === "right" ? "right" : f.belongsIn ? `wrong, belongs in ${f.belongsIn}` : "wrong";
    return `- "${oneLine(f.text)}" filed in ${f.folder}: ${verdict}. Reason: ${oneLine(f.reason)}`;
  });
}
