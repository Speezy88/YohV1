# Yoh — SDD Plan: Polish 1 (after the fixes + UI refresh went live)

Found on the live app, 2026-09-27, right after merge `9eb9bdc`: three `operational` notifications on first launch. Their wording is developer jargon ("Data-Completeness Gate through Work/Break fitting", "self-healing, per AD-7", ISO timestamps). The notification cards are translucent, so their text overlaps the calendar underneath. And the Home day view stacks overlapping events on top of each other, unreadably.

Precedent and constraints: `sdd-plan-YohV1-phase2-fixes-ui.md` (Global Constraints) and `sdd-plan-YohV1-phase2-epic8.md` (Global Constraints + Interface Contract) still bind. Tokens only in `web/src/tokens.css`, WCAG AA in both themes, reduced motion respected, one commit per task with the trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `NotificationKind` stays the closed union. The AD-7 alert *conditions* stay unchanged. Only their wording changes.

## Task 1: Plain-language operational alerts + readable notification cards + side-by-side calendar events

**Owns:** the text of every AD-7/operational alert, both the Pushover alert text and the in-app `operational` notification (grep `src/shell/ritual-cli.ts`, `src/shell/ritual-cli/*.ts`, `src/rituals/*.ts` and `src/shell/server.ts` for `createNotificationInTx` / `sendFailureAlert` / `operational` / "degraded" / "does not show a successful run"); `web/src/components/NotificationOverlay.tsx` + tokens; `web/src/components/CalendarDayView.tsx`; tests.

**Behavior:**
1. **Plain alert copy.** Every operational alert reads like one short, calm sentence to Spencer, with no internal names (AD-7, Data-Completeness Gate, Work/Break fitting, ritual ids in quotes), no ISO timestamps, and no "grace: 36h". Say what happened and whether he needs to do anything. Examples of the intended register:
   - Slow Plan: "This morning's Plan took 8 seconds to build (usually under 5). Nothing to do. It's just slower than normal."
   - Missed run: "Yoh's morning Plan didn't run yesterday (the Mac may have been asleep or off). Today's ran normally."
   - Failure: "This morning's Plan couldn't be built: couldn't reach Notion. It'll try again at the next scheduled time, or type /plan."

   Keep the exact alert *conditions*. The Pushover title stays distinct from the in-app title where the code already distinguishes them. Put the copy builders in one place per alert kind, pure where possible, with tests pinning each exact string.
2. **First-run quietness.** A dead-man's-switch "missed run" alert must NOT fire when a subcommand has *never* run before (no prior invocation record at all). Only a genuinely missed run after a previous one counts. Test it: a fresh DB means no alert, and a stale previous run means an alert.
3. **Readable notification cards.** Notification overlay cards are opaque, or glass with a solid enough backdrop, so no underlying text shows through: a raised card surface from the tokens, with a subtle shadow. Stack them with a gap, at most 3 visible plus "+N more", and keep them compact (a title line + one or two body lines, clamped with "Show more" for long bodies). Text contrast is AA in both themes.
4. **Side-by-side calendar events.** In the Home day view, overlapping events share the width in columns (Google Calendar style), never drawn on top of each other. The title stays readable. Very short blocks show a one-line "Title · 10:30" label, and blocks under ~20 min show just the title, truncated with an ellipsis.

**Tests:** node tests for each alert string and the first-run rule; Vitest for overlay stacking/clamping and day-view column layout (two overlapping events → two columns, three → three); Playwright screenshot check left to the implementer's eyes (screenshots to `/Users/spencerhatch/.claude/jobs/4bbbaae1/tmp/polish1-shots/`).

**Commit:** `fix(ux): plain-language alerts, readable notification cards, side-by-side calendar events`
