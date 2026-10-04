# Audit "fix first" batch (2026-10-04)

Source: the codebase audit run on 2026-10-04 at `867caf8` (knip, madge, jscpd,
coverage, `npm audit`, then six scoped review agents; each finding below was
re-checked against the code by the coordinator). Line numbers are as of
`867caf8` — grep for the named symbol if they have moved.

Branch and worktree: `audit-fix-first` at `.claude/worktrees/audit-fix-first`
(needs `npm ci` in the root and in `web/` before tests run).

Six tasks, all small. Each is independent; do them in this order, one commit
each, test first. Build inline (no subagents needed at this size).

## Task 1 — A repeated Yes must not write twice

**Problem.** In `confirmProposal` (`src/app/confirm-proposal.ts`) the
`notion-page-draft` branch (`await deps.createPage(...)`, about line 610) and
the `calendar-edit` branch (`await deps.applyCalendarEdit(...)`, about line
628) call `clearRequestIfGiven` only after the awaited write. A double-tap or
client retry passes the open-request check twice and creates two Notion pages
or two calendar events. The `change-set` branch (about line 665) already does
it right: "Claim the request BEFORE the awaited writes".

**Change.** Move `clearRequestIfGiven(deps.store, requestId)` before the
awaited write in both branches, matching the change-set branch.

**Decide while doing it.** Today a failed write leaves the request open so the
user can retry. Claiming first removes that. The change-set branch accepted
that trade (failure text in the reply, no retry); follow it and make sure the
failure reply tells the user to ask again.

**Tests first** (`tests/confirm-proposal.test.ts`): for each kind, start two
`confirmProposal` calls for the same request without awaiting the first
(`Promise.all`), with a `createPage` / `applyCalendarEdit` fake that resolves
on a later tick. Assert the write fake ran exactly once and the second call
returns a conflict / "nothing open" result.

## Task 2 — Refuse cross-origin POSTs

**Problem.** `createApp` (`src/shell/server.ts`) has mutating routes with no
body validator and no content-type or Origin check:
`/api/notifications/:id/read`, `/api/plan/sync`, `/api/check-off/:id/undo`,
`/api/check-off/:id/hold`, `/api/check-off/:id/release`,
`/api/chat-history/clear`. A page open in the browser can send a simple
cross-origin POST (`text/plain`, no preflight) to them. Only
`/api/memory/import` guards against this (it requires `text/markdown`; see its
comment). A local probe of `/api/plan/sync` with `text/plain` returned 200.
Not tested from a real browser through `tailscale serve`.

**Change.** One guard at the top of the route chain: for every non-GET/HEAD
request under `/api/*`, refuse unless `Content-Type` starts with
`application/json` (or `text/markdown` for `/api/memory/import`), returning a
`validation` failure through the existing envelope. Then make sure the web
client sends `Content-Type: application/json` on the body-less POSTs (check
how `apiClient` calls those six routes; a `$post()` with no body may send no
content type — give them an empty JSON body).

**Also in this task (same area, small):** add `.onError` to the app so a
thrown error or malformed JSON returns the Result envelope (logged through
`src/adapters/logger.ts`), not Hono's plain-text default.

**Tests first** (nearest `tests/server-*.test.ts`): each of the six routes
with `Content-Type: text/plain` → refused, nothing written; with
`application/json` → works as before; malformed JSON on a validated route →
JSON envelope with `ok: false`. Run the Playwright suite at the end — it
exercises the real client against these routes.

## Task 3 — A missing calendar event is a deletion only when Google says so

**Problem.** `syncPlanFromCalendar` (`src/app/sync-plan-from-calendar.ts`,
about line 113) asks `readDeletedYohPlanEventIds` to confirm deletions only
when the calendar returns no Yoh events at all. If some come back and one
snapshot entry is missing, `diffPlanCalendar`
(`src/core/plan-calendar-diff.ts`, about line 57) counts it as deleted by
Spencer; a Task whose only block is missing lands in `drops` and leaves
today's Plan with no confirmation. A list lag after an insert, or a read that
omits one event, is enough. Notion is not touched.

**Change.** Confirm every missing snapshot entry, not just the all-missing
case: when any future snapshot entry is absent from the events, read the
deleted ids; pass the confirmed set into `diffPlanCalendar` (new input field)
and have the diff ignore a missing entry that is not confirmed deleted (treat
it as unchanged). Keep the diff pure — the read stays in `app/`. Keep the
existing all-missing early return.

**Tests first:** `tests/app-sync-plan-from-calendar.test.ts` — two blocks in
the snapshot, one event missing, not in the deleted set → status `unchanged`,
no drop, Plan version unchanged; same with the id in the deleted set → the
Task is dropped as today. Core diff test for the new input.

**While here:** in the existing test "a write in flight … the calendar is not
even read", add `assert.equal(s.written.length, 0)`. Removing the in-flight
guard currently leaves all 23 tests green.

## Task 4 — Pin the stale change-set check with a test

**Problem.** `confirmProposal` refuses a change set staged on an earlier local
day (`changeSetIsStale`, `src/core/chat-tools.ts`; used about line 660 of
`confirm-proposal.ts`). No test references it: disabling the check left all 48
tests in `tests/confirm-proposal.test.ts` green.

**Change (tests only):**
- `createdAt` yesterday, `now` today → `{ ok: false, error.kind:
  "stale-proposal" }`, no change-set dep called, request cleared.
- Same-day control still applies.
- Successful Approve with a real in-memory connection → exactly one outbox row
  with topic `plan` (the hint is also unpinned today).

Confirm each new test fails when the guarded line is disabled, then restore.

## Task 5 — Prune the outbox and old backups

**Problem.** Nothing deletes old rows from the `outbox` table
(`src/adapters/notification-store.ts`), and `src/shell/backup-cli.ts` writes a
backup each night into `YOH_BACKUP_PATH` and never removes old ones. Both grow
without limit on the Pi's SD card.

**Change.**
- Outbox: a `pruneOutbox(connection, { keep })` in `notification-store.ts`
  that deletes rows below `MAX(seq) - keep` inside `writeTx`. The event stream
  resumes from a `sinceSeq`; check how a client behind the pruned range is
  handled before choosing `keep` (a generous default such as the last 10,000
  rows). Call it from the backup run, after a successful backup.
- Backups: after a successful backup, delete Yoh's own backup files beyond the
  newest N (default 14), matching only the file name pattern `backup-cli`
  writes. One defining export per constant.

**Tests first:** `tests/backup-cli.test.ts` and the notification-store tests —
prune keeps the newest N, never touches files that do not match the pattern,
does nothing when the backup failed; outbox prune keeps the newest rows and a
reader at a still-present seq is unaffected.

**Ask Spencer:** retention numbers (14 backups, 10,000 outbox rows are
proposals). The Pi's current disk use was not checked.

## Task 6 — Dependency vulnerabilities

**Problem.** Root `npm audit`: 2 high (`nodemailer` ≤ 10.0.5,
`brace-expansion` 2.0.0–2.1.6), 1 moderate (`qs`). `web/` is clean.

**Change.** `npm audit fix` in the root (no `--force`). Read the diff of
`package.json` / `package-lock.json`: if the nodemailer fix crosses a major
version, read its changelog and check `src/adapters/notification-adapter.ts`
still type-checks and its tests pass. If `qs` is not fixed without `--force`,
leave it and record why.

## Verification (once, at the end)

`npm run check` with output sent to a file, read failures and the summary only;
then `cd web && npx playwright test`. Baseline at `867caf8`: node 2334, web
862, all passing.

## Not in this batch

The "fix next" and "cleanup" lists from the audit: failed extra-calendar read
treated as free time; reshuffle/plan-day/morning ritual writing the Yoh Plan
calendar without syncing first; chat step cap silent when changes are staged;
`stop_reason` never read; regex-based false-claim guard; raw error text at
`server.ts` `getCalendarApplyBinding`, `web/src/lib/timeBudget.ts` and the
ritual failure alert body; layering-test gaps (`core/` import rule, Notion
writes in `rituals/`); routine writes with no outbox row; the dead
pre-tool-loop chat path; unused exports; splitting `server.ts`; stale docs
(`AGENTS.md` topics, architecture spine, `sprint-status.yaml`, `chat-cli`
mentions).
