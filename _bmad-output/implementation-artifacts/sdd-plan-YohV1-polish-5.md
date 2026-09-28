# Yoh — SDD Plan: Polish 5 (after Epic 9, 2026-09-27)

Sources: Epic 9 ledger "Polish-5 additions" + deferred minors, Epic 9 `final-review.md` OK-TO-DEFER list, polish-4 parked M1/M3/M4/M5 + "done but not the reading", Spencer's extra-calendar + school-rules asks (Epic 9 ledger "Calendar ask" lines, all binding), and the pre-existing bug that the morning planning path never excludes completed Tasks.

Precedent and constraints: `sdd-plan-YohV1-phase2-epic8.md` Global Constraints still bind (layering, app exports `(deps,input)=>Promise<Result>`, pure parsers in core/, shells call one app fn, tokens only, WCAG AA). One commit per task, trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never write to Spencer's real Notion or Calendar. Each task ≤ ~5 source files.

Test order for every task: focused tests while iterating → `npm run check` ONCE → ONE full `cd web && npx playwright test` (only if web/ or a route changed) → rerun only failing specs by file.

## Task 1: Completed Tasks are never planned; needs-data copy

**Owns:** `src/rituals/morning-ritual.ts`, `src/rituals/mid-day-reflow.ts`, `src/rituals/ritual-shared.ts` (+ their tests).

**Behavior:**
1. morning-ritual and mid-day-reflow drop completed Tasks (`isOpenTask` from `src/core/planning-field-value.ts`) BEFORE the data-completeness gate, so a Completed Task is never a plan candidate, never counted incomplete, never in `missingRefining`. The needs-data count keeps its current meaning (open incomplete Tasks); simplify its computation now that the input is already open-only.
2. `missingRefiningFor` moves to `ritual-shared.ts` (one definition; both rituals import it; grep finds no second copy).
3. Needs-data notification copy pluralizes: "1 Task needs data to be placed" / "N Tasks need data to be placed".

**Tests:** a Completed Task with Duration + Due is absent from the morning plan and from a mid-day reflow; needs-data copy singular/plural.

**Commit:** `fix(rituals): never plan completed Tasks; share missingRefiningFor; pluralize needs-data`

## Task 2: Read extra Google calendars (read-only)

**Owns:** `src/adapters/calendar-adapter.ts`, the CalendarEvent type (where it lives), the deps builders that read env for the calendar (`src/shell/server.ts` `buildCalendarDayDeps`, the ritual CLI's deps builder), + tests.

**Behavior:**
1. New optional env `YOH_EXTRA_CALENDAR_IDS` — comma-separated Google calendar IDs (Spencer's: `spencerhatch@seattleacademy.org`), read with the existing OAuth token. Trim, drop empties, dedupe, ignore `primary`. (`YOH_EXTRA_CALENDAR_ICAL_URLS` is reserved by ruling but NOT built — no iCal needed.)
2. Every calendar read that feeds the planner and `/api/calendar/day` returns primary events merged with each extra calendar's events, sorted by start. Each event carries its source calendar id (e.g. `calendarId`), so later code can tell school events apart.
3. Extra-calendar events are READ-ONLY: `assertPrimaryCalendar` still guards every edit; a calendar-edit proposal can never target an extra-calendar event (reject with a plain `validation` message if one is attempted).
4. One extra calendar failing (403/404/network) never fails the read: log a warn event (never the token), return the other calendars' events.

**Tests:** merge + sort; env parsing; one failing extra calendar still returns primary events; edit of an extra event rejected; unset env = today's behaviour exactly.

**Commit:** `feat(calendar): read extra Google calendars (YOH_EXTRA_CALENDAR_IDS), read-only`

## Task 3: School-day rules in the planner

Depends on Task 2 (events carry `calendarId`). Rulings (Epic 9 ledger, Spencer-confirmed): school calendar = the first/only id in `YOH_EXTRA_CALENDAR_IDS` whose events are school events; lunch 10:55–11:40 and community time 12:55–13:45 are PROTECTED on school days; a school day = a weekday (Mon–Fri) with ≥1 school-calendar event; school events whose title starts with "Study Block" (case-insensitive) are FREE time; every other school event is busy.

**Owns:** new `src/core/school-day.ts` (+ test), `src/rituals/morning-ritual.ts`, `src/rituals/mid-day-reflow.ts` (+ tests). Touch `src/core/work-break-fit.ts` only if the last-resort pass can't be done by calling `fitWorkBreakBlocks` twice.

**Behavior:**
1. Pure core fn: given the day's events, the school calendar id and the date → `{ anchors, protectedWindows }`: Study Block events removed from anchors (free time); other events stay anchors; on a school day, lunch and community time become protected windows. School-calendar id comes from the env via ritual deps (a plain string, no env reads in core).
2. First pass: protected windows are treated as busy (like anchors, labelled so they aren't shown as real events).
3. Last resort: if a Task due today (or overdue) did not fit in pass 1, re-fit allowing protected windows for those deadline Tasks only. Non-deadline Tasks never land in a protected window.
4. With no school calendar configured, or on a non-school day, the plan is exactly as before.

**Tests:** Study Block time gets work; lunch/community stay empty when other free time suffices; a deadline Task that otherwise wouldn't fit lands in a protected window; weekend / no-event day unchanged; no school calendar configured unchanged.

**Commit:** `feat(plan): school-day rules — study blocks free, lunch + community time protected`

## Task 4: Tasks page Missing-data toggle; retire /api/tasks/missing-count

**Owns:** `web/src/pages/Tasks.tsx` (+ `Tasks.test.tsx`), `src/shell/server.ts` (route delete), `src/app/tasks-view.ts`, `src/types/api.ts`, `tests/server-tasks.test.ts`, `tests/tasks-view.test.ts` (deletions are mechanical).

**Behavior:**
1. A "Missing data" toggle button in the Tasks toolbar arms/disarms `setMissingDataFilterActive` (`aria-pressed`), same styling as the other toolbar controls, tokens only. Fix the stale comments at Tasks.tsx ~319 and ~438-442.
2. Delete `/api/tasks/missing-count`, `countTasksMissingData`, `TasksMissingCountDeps`, `TasksMissingCountResponse` and their tests. Keep `taskMissingFields`. Keep the "Priority never counted" assertion if it tests `taskMissingFields` rather than the count.

**Tests:** Vitest toggle arms and clears the filter; grep finds no `missing-count`/`countTasksMissingData`.

**Commit:** `feat(tasks): Missing-data toolbar toggle; retire /api/tasks/missing-count`

## Task 5: SandboxCard Area/Energy as live-option selects

**Owns:** `src/types/api.ts` (`SandboxCardView`), `src/core/sandbox-card-view.ts` and the app fn(s) that build the card (`sandbox-queue.ts` / `sandbox-submit.ts` / `chat-turn.ts` — whichever calls `firstCardView`), `web/src/components/SandboxCard.tsx` (+ tests), `web/e2e/sandbox.spec.ts` if selectors change.

**Behavior:**
1. `SandboxCardView` gains `options: { area: readonly string[]; energy: readonly string[] }` read via the existing `readFieldOptions` dep (same source as `GET /api/tasks`). If options can't be read, send empty arrays and the card falls back to today's free-text input for that field.
2. SandboxCard renders Area and Energy as `<select>` (with an empty "—" choice) when options exist, pre-selected from the view. Drop the duplicate `aria-label` where a `<label>` already names the control.

**Tests:** node — card view carries options; options read failure → empty arrays. Vitest — selects render with options, fallback to text input on empty. Playwright sandbox spec still green.

**Commit:** `feat(sandbox): Area and Energy pick from live Notion options`

## Task 6: Sandbox client robustness

**Owns:** `web/src/lib/sandboxClient.ts`, `web/src/lib/checkOff.ts`, `web/src/lib/sandbox.ts`, `web/src/components/SandboxCard.tsx` (+ tests).

**Behavior:**
1. `settle` catch in sandboxClient and checkOff returns fixed copy ("Couldn't reach Yoh — try again.") instead of `err.message`; log nothing new.
2. A failed Skip shows an inline `role=alert` line on the card ("Couldn't skip — try again.") and leaves the card usable.
3. The all-skip finale message id uses `crypto.randomUUID()`.
4. SandboxCard's settled announcement uses a persistent `role=status` region that is mounted from first render and whose text changes (not a node mounted with its content).

**Tests:** Vitest for each (thrown fetch → fixed copy; skip failure → alert; persistent region present before settle).

**Commit:** `fix(sandbox): fixed error copy, visible skip failure, persistent status region`

## Task 7: Sandbox finale copy, chip during a turn, deep links

**Owns:** `src/app/sandbox-submit.ts`, `web/src/components/SandboxFinale.tsx`, `web/src/lib/chatPanel.ts` (and `chatStore.ts` only if needed), `web/src/components/NotificationOverlay.tsx` (+ tests).

**Behavior:**
1. "Saved 1 Task" / "Saved N Tasks" in both `sandboxCompleteBody` and SandboxFinale.
2. SandboxFinale uses a persistent `role=status` region (same idiom as Task 6 item 4).
3. `openChatWithCommand` while a turn is in flight: queue the command (one slot, latest wins) and send it when `sending` clears — never a silent drop.
4. NotificationOverlay parses any `chat:<command>` deep link generically (strip the `chat:` prefix; empty → just open), instead of hardcoding `chat:/sandbox`.

**Tests:** node pluralization; Vitest finale copy + region, queued command sent after the in-flight turn, generic deep link.

**Commit:** `fix(sandbox): pluralize finale, queue chip command during a turn, generic chat deep links`

## Task 8: Command palette Enter race; calendar cache refresh

**Owns:** `web/src/components/CommandPalette.tsx` (+ test), `src/app/confirm-proposal.ts` (+ test), `web/src/lib/calendarDay.ts` (+ test).

**Behavior:**
1. Palette Enter only `preventDefault`/`stopPropagation` when a row is actually picked. If commands haven't loaded yet, Enter falls through to ChatInput's normal send, so the typed `/command` is sent as text and the server's slash dispatch handles it. Never swallow the keypress.
2. After a confirmed calendar edit, `confirm-proposal` appends an outbox hint `{topic: "plan", entityId: <the event's local date>}` (same append idiom the rituals use inside `putPlan`), so `calendarDay.ts` refetches that date. Also: re-selecting a cached non-today date in Month refetches it in the background (stale-while-revalidate).

**Tests:** Vitest Enter before commands load sends the text; node confirm path appends the plan hint; Vitest re-select refetch.

**Commit:** `fix(chat): palette never swallows Enter; calendar views refresh after a confirmed edit`

## Task 9: Quick-add and answer parsing fixes (polish-4 parked)

**Owns:** `src/app/update-task.ts`, `src/core/quick-add.ts`, `src/app/create-task.ts`, `src/core/open-item-answers.ts` (+ tests).

**Behavior:**
1. M1: Priority inline edit — options read failure → `unreachable` with the existing error copy; options read OK but empty → "Priority isn't set up in Notion."
2. M3: `p1/p2/p3` codes only at the end-of-line frontier (like bare energy words); "Physics p1 homework" keeps the title intact. Explicit "priority high" phrases stay anywhere.
3. M4: fields filled by the Haiku fallback are listed in the receipt: `Added "X" to Tasks — also read: Due Mon, 60 min.` Update the create-task header comment.
4. Night close-out: a reply that has a completion word followed by a partial clause (`but not`, `except`, `apart from`, `other than`, `besides`) is `slipped` (the Task stays open — never a false completion). "done, not bad" stays completed.

**Tests:** pin "Physics p1 homework", "Physics homework p1", "done but not the reading", "done except the reading", "done, not bad", the M1 two cases, and the M4 receipt.

**Commit:** `fix(tasks): polish-4 parked — priority copy, p-codes at end only, Haiku fields in receipt, partial close-outs`

## Task 10: Hygiene (deferred minors)

**Owns:** `src/shell/server.ts`, `src/app/sandbox-submit.ts`, `web/src/lib/chatStore.ts`, `tests/server-sandbox-count.test.ts`, the ChatPanel test file.

**Behavior:** one shared `NOTION_NOT_CONFIGURED` const replaces `TASKS_NOT_CONFIGURED` + `SANDBOX_NOT_CONFIGURED` (same copy); `SandboxFinishOutput` becomes an alias of the wire `SandboxFinishResponse`; `updateStreamEntry` / `appendStreamEntry` typed per kind (generic over the `kind` discriminant, no `as StreamEntry`); server-sandbox-count test uses one connection and closes it; rename the ChatPanel "interleaved" test title to what it asserts. No behavior change.

**Commit:** `chore: polish-5 hygiene — shared not-configured copy, typed stream updates, test cleanup`
