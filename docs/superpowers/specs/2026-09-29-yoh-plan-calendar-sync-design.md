# Yoh Plan calendar two-way sync — design

Date: 2026-09-29. Approved in chat by Spencer (decisions below are his).

## Problem
Yoh writes today's Plan work/break blocks to the "Yoh Plan" Google calendar
but never reads that calendar back. When Spencer moves, resizes, deletes or
adds events there, Home and the stored Plan ignore it.

## Outcome
Google Calendar becomes a second place to edit today's Plan. Within about two
minutes (immediately when Yoh's tab regains focus) the stored Plan, the Yoh
Plan calendar and Home reflect the edit, with the rest of the day re-fitted.

## Rulings (Spencer, 2026-09-29) — binding
- **S1. Added events** on the Yoh Plan calendar (no Yoh block tag) are fixed
  commitments, exactly like events on his other calendars: shown on Home,
  and the Plan fits around them. No Notion Task is created.
- **S2. Moved or resized** Yoh Plan blocks are applied **directly, with no
  approval step**: the block is pinned at its new start with its new length,
  and the rest of the day is re-fitted automatically. A Google Calendar edit
  is Spencer's own direct write (like a typed field answer), not a proposal.
- **S3. Deleted** Yoh Plan blocks drop that Task from **today only**; it stays
  open in Notion (not marked done) and the freed time is re-used.
- **S4.** Nothing in this feature writes to Notion.

## Design
### Detection — `app/sync-plan-from-calendar.ts`
`syncPlanFromCalendar(deps, { now })` reads today's events on the Yoh Plan
calendar (with `extendedProperties`) and compares them with what Yoh last
wrote for today's stored Plan:
- tagged event whose start or length differs from what Yoh last wrote →
  pin (task or routine subject) at the new start with the new duration.
  `DayPin` gains an optional duration; the fitter honors it.
- tagged block with no event → drop (today only).
- untagged event → fixed commitment. `readCalendarEvents` includes untagged
  Yoh Plan events from then on, so Home, reshuffle and re-flow all see them
  as ordinary busy events. (Detection of an untagged event only needs to
  trigger a re-fit when it overlaps a not-yet-past work/break block.)
- no differences → no-op (no write, no hint).

Pure diffing lives in `core/` (e.g. `core/plan-calendar-diff.ts`).

### Applying
When a difference exists: run the same re-fit the reshuffle flow uses with
the new pins/drops, save the stored Plan and pins/drops, rewrite the Yoh Plan
calendar via `writeTodaysPlanToCalendar`, and append one `plan` outbox row in
the same transaction as the Plan write. Home shows one line, e.g.
"Re-fit your afternoon around your 3:15 change." Past blocks never change.
Tasks that no longer fit are deferred as in a reshuffle.

### Not mistaking Yoh's own writes for Spencer's
The comparison baseline is the stored Plan's own block times (what Yoh last
wrote). Blocks listed in `writeTodaysPlanToCalendar`'s `failed` result from
the last write are skipped (not read as moves or deletes). One in-process
lock: a sync requested while one runs joins it. An open `reshuffle` proposal
is left alone; the sync's Plan write bumps the plan version, so approving the
stale preview recomputes (existing Epic 10 behavior).

### Triggers
- Server sweep every `PLAN_CALENDAR_SYNC_INTERVAL_MS` (2 min), modeled on the
  check-off commit sweep (injectable timers, `runOnce` joins in-flight, stop).
- `POST /api/plan/sync` — the web's focus/visibility refresh
  (`web/src/lib/visibleRefresh.ts` consumer in `homeView.ts`) calls it before
  refetching Home. Returns the serialized Result; changes arrive via the
  `plan` hint.

### Errors
Calendar unreachable / auth-expired → log one structured line, skip the
cycle, Plan untouched. The route returns the `YohError` envelope; the web
ignores sync failures silently (the Home fetch still runs and shows its own
errors).

### Scope limits
Today only; Yoh Plan calendar only (other calendars are already read live);
no Notion writes; no Google push notifications (Yoh is tailnet-only).

## Testing
- node:test with fake calendar + stores: move, resize, delete, added
  overlapping event, added non-overlapping event, no-op, failed-write block
  skipped, lock joining, calendar failure leaves Plan untouched, past blocks
  unchanged, idempotence (a second sync after apply is a no-op).
- Vitest: focus refresh calls the sync route then refetches.
- Playwright (fixture server): a simulated moved Yoh Plan event re-fits Home
  and shows the one-line notice.
