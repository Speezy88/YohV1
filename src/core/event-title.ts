/**
 * src/core/event-title.ts
 *
 * Shared logic for displaying Calendar event titles in chat replies.
 * Uses the same untitled-detection rule as web/src/lib/labels.ts:
 * blank or punctuation-only titles display as "(No title)".
 */

/** True for an empty string, or one made only of punctuation/whitespace (e.g. "...", "-", "  "). */
function isBlankOrPunctuationOnly(title: string): boolean {
  return title.trim().replace(/[\p{P}\p{S}\s]+/gu, "") === "";
}

/** `title`, or "(No title)" when it's blank or punctuation-only. */
export function displayEventTitle(title: string): string {
  return isBlankOrPunctuationOnly(title) ? "(No title)" : title;
}
