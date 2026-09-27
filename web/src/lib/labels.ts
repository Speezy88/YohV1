/**
 * web/src/lib/labels.ts — Task 6A.
 *
 * Shared by `PlanChecklist.tsx` and `CalendarDayView.tsx`: an untitled or
 * punctuation-only Task/event label reads as "(No title)" rather than a
 * blank or confusing row.
 */

/** True for an empty string, or one made only of punctuation/whitespace (e.g. "...", "-", "  "). */
function isBlankOrPunctuationOnly(label: string): boolean {
  return label.trim().replace(/[\p{P}\p{S}\s]+/gu, "") === "";
}

/** `label`, or "(No title)" when it's blank or punctuation-only. */
export function displayLabel(label: string): string {
  return isBlankOrPunctuationOnly(label) ? "(No title)" : label;
}
