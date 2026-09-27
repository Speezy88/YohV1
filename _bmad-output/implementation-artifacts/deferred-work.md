# Deferred Work

## Deferred from: code review of Story 6.6 (2026-09-22)

- **`resolveCalendarEditRoute`'s `{kind: 'owned'}` branch is unreachable through the real call path.** Yoh-owned ("Yoh Plan") events only ever live on the separate secondary calendar `writeTodaysPlanToCalendar` writes to (AD-4/AD-10), never on `primary`. The current as-built routing is FR-27-only: events are sourced exclusively from the primary calendar (`readCalendarEvents` in `src/adapters/calendar-adapter.ts`), and calls to `resolveCalendarEditRoute` (the route function at `src/adapters/calendar-adapter.ts:548`) only reach events from that primary-calendar source. The decline-message handling ("That's one of my own Plan blocks…") lives in the caller, `src/app/calendar-edit.ts:125`. So no event reachable through this flow can ever carry `PLAN_BLOCK_ID_EXTENDED_PROPERTY`, and that decline message is dead code. Not a safety hole — it fails toward more confirmation, not less — but the Story 6.6 AC's "owned" routing behavior is unexercised by any real call path. Pre-existing since commit `fb3537a` (Story 6.6's original implementation), not introduced or fixed by the current review's diff.

  **Decision needed (Epic 6 retro, 2026-09-26):** Two options:
  1. **Drop the unreachable branch:** Remove the `{ kind: "owned" }` case from `src/adapters/calendar-adapter.ts:resolveCalendarEditRoute`, remove the corresponding decline handling from `src/app/calendar-edit.ts:125`, and delete the tests: `tests/calendar-adapter.test.ts:759` (route function) and `tests/calendar-edit.test.ts:103` (decline handling).
  2. **Keep as a fail-safe:** Retain both the route function's return case and the decline-message handler as a safety check in case Yoh-owned events on `primary` become possible in future phases.

  Owner: Spencerhatch (architecture decision). Revisit if/when Yoh-owned events on `primary` become possible, or confirm the primary-calendar-read-only constraint for the confirm-gated path (FR-27).

## Deferred from: Epic 6 retrospective (2026-09-26)

- **Perplexity Agent API pricing, context-tier confirmation, and daily cost ceiling (AD-14, F3).** The spine's Deferred section documents the Perplexity pricing question: the Agent API this spine targets (AD-14's 2026-09-18 correction away from deprecated Sonar chat-completions) has not yet had its own pricing independently confirmed as identical to Sonar's confirmed figures ($1/$1 per M tokens for input/output, $5–12/1,000 requests). Before FR-28 implementation, verify the Agent API's actual pricing against Perplexity's current docs, pick the cheapest tier/preset that still returns usable citations, and define a daily cost ceiling Spencer is warned about rather than silently throttled by. Owner: Spencerhatch. Revisit: before FR-28 implementation.

## Deferred from: Story 7.4 (2026-09-26)

- **The nightly backup's actual second-location path (`YOH_BACKUP_PATH`) is unset.** Controller ruling (SDD plan Task 4 notes): the backup target is read from configuration and defaults to nothing on purpose — `src/shell/backup-cli.ts` fails loudly through the AD-7 alert path (a Pushover alert plus an `operational` in-app notification) rather than silently skipping the backup when it's unconfigured. Spencer names the real location (another disk, the Mac, or a USB drive) during this story's manual verification (`docs/superpowers/plans/2026-09-25-story-7.4-server-liveness-and-backup.md`'s "Manual verification checklist") and sets it in `.env` on the real host; `.env.example` documents the variable but ships it empty. **Action item:** once the real path is chosen, set `YOH_BACKUP_PATH` in the host's `.env` and confirm a manual `node src/shell/backup-cli.ts` run produces a valid SQLite file there before relying on the cron entry (`deploy/DEPLOY.md`'s "Nightly backup" section).

## Deferred from: Story 7.2 (2026-09-25) — Epic 8

- **Resolved in Story 8.4.** `shell/chat-cli.ts` is allowlisted in `tests/layering-rules.test.ts`'s AD-16 write-surface check (Ruling R1). It still calls `setTaskStatus`/`updateTaskField`/`createPage`/`applyCalendarEdit` directly: Phase 1 logic that Epic 8 moves into `app/` (AD-16). Every other shell file, including `shell/server.ts`, is checked now. **Epic 8 item:** once `chat-cli.ts` is transport over `app/` (or is deleted, FR-50), remove `"chat-cli.ts"` from `SHELL_WRITE_ALLOWLIST` in the same change. The test's "allowlist entry still names a real file" check fails if `chat-cli.ts` is deleted while the entry remains.

## Deferred from: Epic 7 (Phase 2) SDD run — per-story reviews and final whole-branch review (2026-09-26)

The final whole-branch review triaged every item below as "defer": none blocks merge.

### Tracked follow-ups
- **No outbox pruning (7.3).** `notification-store.ts`'s event outbox has no retention, so it grows forever. SSE replay only needs rows newer than the oldest connected client's `Last-Event-ID`. Add a retention sweep (e.g. keep 7 days or the last N rows) in the server's outbox poll.
- **No backup retention or rotation (7.4).** `backup-cli.ts` writes nightly copies to `YOH_BACKUP_PATH` and never prunes them. Add keep-last-N once the real target (a USB drive) is chosen.
- **Check-off vs close-out window (7.10 × 7.9).** A check-off reaches the Completion Log only when the commit sweep runs, about 5 s after the click (longer if held). If `night-prompt`'s close-out runs inside that window, it can still ask about the Task just checked off. Consider having close-out also exclude `plan-state-store`'s uncommitted pending check-offs.
- **`App.tsx` has no `<main>` landmark (7.6).** A small a11y follow-up.
- **Undo is lost on reload (7.10).** Reloading during the undo window shows the row unchecked with no Undo. Checking it again reuses the same pending record, so nothing is completed twice. Hold/release request failures are also silent: the toast falls back to its own timer, and the server caps holds at 10 min.
- **Manual in-browser checks:** WCAG contrast of the Calendar Day View's cross-hatch/`event-fixed-ink` and raised-block shadow in both themes (7.8). Screen-reader pass on the notification overlay's single `aria-live` region (7.7).
- ~~**`ritual-cli.ts` is ~1500 lines.** Split it when Epic 8 restructures the shells.~~ **Resolved (Epic 8, Task 12):** `ritual-cli.ts` now keeps only the entry point, dispatch, and the AD-7 top-level handler; each subcommand's real adapter wiring moved to its own per-subcommand deps builder under `src/shell/ritual-cli/` (`morning-deps.ts`, `night-deps.ts`, `self-check-deps.ts`) — a pure move, no behavior change.

### Minors
- 7.1: `writeTx` re-wraps `db.transaction` per call (perf nit). No test distinguishes BEGIN IMMEDIATE from deferred locking.
- 7.2: hono/@hono/node-server are exact-pinned while other deps use carets. The spine's Stack row for @hono/node-server is stale. `EventHint`/`NotificationRecord` have no negative-case lock tests.
- 7.3: the `/api/events` duration log measures time-to-headers, not stream lifetime.
- 7.4: the notification-store invariant test doesn't list `backup-cli.ts`. The unwritable-target path isn't asserted through `main()`. The runEntry comment's ritual-cli analogy is loose.
- 7.5: CSP tests don't cover static files or SSE (the middleware is global, verified). vitest reports EBADENGINE on Node 25 (the deploy host is Node 24 LTS). The web-import-rule regex misses dynamic `import()` and `export … from`. `--glass-saturate` isn't in Tailwind's `--saturate-*` namespace.
- 7.6: the Screensaver's per-dot stagger isn't tokenized. The PageIndicator gradient is 90°, DESIGN.md says 135°. The keydown effect re-binds on every page change. Some tests assert class-name strings. With more than one launch gate, a later-registering gate could trip the one-way splash latch early, so keep "home-data" the only one.
- 7.7: `resolveDeepLinkIndex` handles only a bare id or "/id". `dismissedIds` grows for the whole session. Reconnect uses a fixed ~20 s cadence, not exponential backoff.
- 7.8: Confetti removal relies only on `animationend`, with no time backstop (the overlay is pointer-events-none). `STAGGER_MS` is a JS constant. The Home skeleton row count is a literal. `buildHomeViewDeps`'s real Notion/Google wiring is only fake-tested.
- 7.9: `getCompletedTaskIdsToday` uses its own `new Date()` rather than `deps.now` (midnight edge). The snapshot `area` is typed `string | null`, not `Area | null`.
- 7.10: the `completion-log.ts` header comment is stale (the Task lookup now happens at commit time). `addLocalFailureNotice` has no dedup. `retryAt` calls `deps.now()` twice per sweep pass.
- Epic 6 retro: `updateTaskField`'s rich_text (Area) path is unchunked. There's no guard for Notion's ~100-segment rich_text cap.
- Tests: a few server/ritual tests still write real structured log lines to stderr, so test output isn't pristine.
