# Audit "fix next" batch (2026-10-04)

Source: the "Not in this batch" list at the end of
`docs/superpowers/plans/2026-10-04-audit-fix-first.md` plus the six deferred
minors from that batch's final review. Each item was located again in the code
at `beb28aa`; grep for the named symbol if lines have moved.

Branch and worktree: `audit-fix-next` at `.claude/worktrees/audit-fix-next`.

Six tasks, all small and independent. One commit each, test first, built
inline. `npm run check` once at the end; Playwright only if `web/` changed.

## Task 1 — The chat loop says when it was cut short

**Problem.** `runToolTurn` (`src/adapters/llm-adapter.ts`) never reads
`message.stop_reason`, so a reply cut off at `max_tokens` is shown as if it
were complete, and a cut-off turn's tool calls are run as if whole. In
`chatAgent` (`src/app/chat-agent.ts`), when the loop reaches
`CHAT_AGENT_MAX_STEPS` with changes already staged, the Approve card appears
with no sign that the model stopped early.

**Change.**
- `ToolTurnResult` gains `truncated: boolean` (`stop_reason === "max_tokens"`).
- In `chatAgent`: a truncated turn's tool calls are not run. The loop ends
  there, marked incomplete. Reaching the step cap also marks it incomplete.
- `changeSetPrompt` (`src/core/chat-tools.ts`) takes `incomplete?: boolean`
  and appends `CHANGE_SET_INCOMPLETE_NOTE`: "I stopped before finishing, so
  this may not be everything you asked for."
- With nothing staged: a truncated text reply ends with
  `CHAT_AGENT_TRUNCATED_NOTE`: "That answer was cut off for length. Ask for
  the rest if you need it." A truncated turn with no text gets the existing
  `CHAT_AGENT_STEP_CAP_REPLY`.

**Tests first** (`tests/app-chat-agent.test.ts`, `tests/llm-adapter*.test.ts`,
`tests/core-chat-tools*.test.ts`): adapter maps `stop_reason`; step cap with
one staged item → reply contains the incomplete note; truncated turn with a
write tool call → the tool is not staged; truncated text → note appended.

## Task 2 — No raw error text reaches the user

**Problem.** Three places put `err.message` in user-facing text:
`getCalendarApplyBinding` in `src/shell/server.ts`; the `catch` in
`web/src/lib/timeBudget.ts`; the ritual failure alert body in
`src/shell/ritual-cli.ts` (thrown-error branch — left as it is: the alert is
Spencer's own operator alert, and relaying the message is a documented,
tested choice in `buildFailedAlertBody`). And `onError` in `server.ts`
answers every 400 `HTTPException` with the "isn't valid JSON" copy.

**Change.** `server.ts` uses `errorCopyForThrown`. `timeBudget.ts` returns
the fixed copy `checkOff.ts` already uses ("Couldn't reach Yoh — try again.";
web cannot import `core/`). `onError` uses
the JSON copy only when the exception is a JSON parse failure; other 400s get
"That request isn't valid."

**Tests first:** one assertion per site that a thrown `Error("secret-xyz")`
does not appear in the returned / sent text.

## Task 3 — Close the layering-test gaps

**Problem.** `tests/layering-rules.test.ts` has no test for "`core/` imports
only `types/` and `core/`", and `src/core/open-item-questions.ts` imports a
type from `rituals/night-ritual.ts`. Nothing pins which Notion writes
`rituals/` may name (`night-ritual.ts` takes `setTaskStatus` as a dep).

**Change.** Move `NightCloseOutTaskDetail` to `src/types/domain.ts`
(re-exported from `night-ritual.ts` so other importers are untouched). Add
two tests: every import in `src/core/*.ts` resolves to `core/` or `types/`;
under `src/rituals/` the write names appear only as `setTaskStatus` in
`night-ritual.ts` (an explicit allowlist of one, so a second write fails the
test).

## Task 4 — Routine changes tell the web (dropped)

Not built. A routine change shows only in its chat reply: no page reads the
routines table, and the stored Plan does not change until a re-fit, which
already appends its own `plan` row. An outbox row here would refresh nothing.

## Task 5 — A failed extra-calendar read is retried once

**Problem.** `readCalendarEvents` (`src/adapters/calendar-adapter.ts`) drops a
failing extra calendar's events with only a log line, so the planner treats
that time as free.

**Change (partial).** Retry that calendar's read once before giving up; the
log line is unchanged. Telling Spencer that a Plan was built without one
calendar is a product decision and is not in this batch.

**Tests first** (`tests/calendar-adapter.test.ts`): first call throws, second
succeeds → events included, no warn; both throw → omitted, one warn.

## Task 6 — Deferred minors from the fix-first review

- `confirmProposal` `field-value` branch: claim the request before the write
  (same as the other branches).
- `pruneOutbox`: clamp `keep` to at least 1.
- `backup-cli.ts`: prune failures go through `logger.ts`.
- `syncPlanFromCalendar`: log `plan-sync.missing-unconfirmed` (warn) when a
  missing event is not confirmed deleted.
- `readDeletedYohPlanEventIds` paging: not built. The read is one day of the
  Yoh Plan calendar; it cannot approach 250 events.

One test each, next to the existing tests for that function.

## Verification (once, at the end)

`npm run check` to a file; read failures and the summary. Playwright only if
Task 2's web change touches a spec'd flow (it does not change markup).

## Not in this batch

- Reshuffle / plan-day / morning ritual write the Yoh Plan calendar without
  syncing first (a Google Calendar move made in the last two minutes can be
  overwritten). Touches the sync path behind the 2026-09-29 incident; wants
  its own design.
- A user-visible notice when a Plan was built without one calendar.
- The regex-based false-claim guard.
- Cleanup: the dead pre-tool-loop chat path, unused exports, splitting
  `server.ts`, stale docs.
