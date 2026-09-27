/**
 * src/core/calendar-duration.ts
 *
 * Real-use fixes plan, Task 2 (post-review fix, Important #3). Pure,
 * deterministic cross-check for whether Spencer's OWN chat line states a
 * duration or an explicit end for a calendar-create request — used by
 * `app/calendar-edit.ts` to correct `draftCalendarEditRequest`'s own
 * `durationAssumed` flag rather than trusting the model's optional
 * `ASSUMED`/`EXPLICIT` marker unconditionally: if Spencer's line states
 * neither a duration nor an end at all, the duration MUST be treated as
 * assumed regardless of what the model's marker claims (a model that
 * forgets to say ASSUMED must never silently understate that a default was
 * applied). If Spencer's line DOES state a duration or an end, the drafted
 * end is trusted as-is (this function is never used to recompute or
 * override the actual end time itself — only to correct the ASSUMED/
 * EXPLICIT flag in the one direction that matters).
 *
 * Deliberately simple, documented pattern matching (NOT real free-text
 * NLU), the same convention every other recognizer in `core/chat-
 * commands.ts` uses — covers the phrasings Task 2's brief and the incident
 * itself name:
 *   - "for 45 minutes" / "for an hour" / "for half an hour" / "for 1.5
 *     hours" (an explicit "for <amount>" duration phrase);
 *   - "an hour and a half" / "half an hour" stated without "for";
 *   - a bare "<N> hour(s)"/"<N> minute(s)" amount (e.g. "1.5 hours", "90
 *     minutes", "45 mins");
 *   - an explicit end via "till"/"until"/"to" + a clock time (e.g. "till
 *     4", "until 4pm", "to 5");
 *   - a compact time range (e.g. "3-4pm", "10:45am-12:15pm").
 */

const DURATION_STATED_RE = new RegExp(
  [
    // "for 45 minutes" / "for an hour" / "for half an hour" / "for 1.5 hours"
    String.raw`\bfor\s+(?:\d+(?:\.\d+)?|an?|half\s+an?)\s*(?:hours?|hrs?|h\b|minutes?|mins?|m\b)`,
    // "an hour and a half" / "half an hour" stated without a leading "for"
    String.raw`\ban?\s+hour\s+and\s+an?\s+half\b`,
    String.raw`\bhalf\s+an?\s+hour\b`,
    // a bare amount of hours/minutes ("1.5 hours", "90 minutes", "45 mins")
    String.raw`\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?)\b`,
    // an explicit end via till/until/to + a clock time ("till 4", "until 4pm", "to 5")
    String.raw`\b(?:till|until|to)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b`,
    // a compact time range ("3-4pm", "10:45am-12:15pm", "2:30-3:30")
    String.raw`\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b`,
  ].join("|"),
  "i",
);

/**
 * `true` when `line` states an explicit duration or an explicit end for a
 * calendar-create request, `false` when it gives only a start (or nothing
 * time-related at all) — the ONE signal `app/calendar-edit.ts` needs to
 * decide whether it may trust `draftCalendarEditRequest`'s own
 * `durationAssumed` marker, or must force it to `true` itself.
 */
export function lineStatesDurationOrEnd(line: string): boolean {
  return DURATION_STATED_RE.test(line);
}
