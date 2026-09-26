# Deferred Work

## Deferred from: code review of Story 6.6 (2026-09-22)

- **`resolveCalendarEditRoute`'s `{kind: 'owned'}` branch is unreachable through the real call path.** Yoh-owned ("Yoh Plan") events only ever live on the separate secondary calendar `writeTodaysPlanToCalendar` writes to (AD-4/AD-10), never on `primary`. `chat-cli.ts`'s FR-27 wiring only ever calls `resolveRoute("primary", matchedEvent.id)` against events sourced from the primary-calendar-only `readCalendarEvents`. So no event reachable through this flow can ever carry `PLAN_BLOCK_ID_EXTENDED_PROPERTY`, and the "That's one of my own Plan blocks…" decline message is dead code. Not a safety hole — it fails toward more confirmation, not less — but the Story 6.6 AC's "owned" routing behavior is unexercised by any real call path. Pre-existing since commit `fb3537a` (Story 6.6's original implementation), not introduced or fixed by the current review's diff. Revisit if/when Yoh-owned events on `primary` become possible, or drop the branch and its test if that's confirmed to never happen.

## Deferred from: Story 7.2 (2026-09-25) — Epic 8

- **`shell/chat-cli.ts` is allowlisted in `tests/layering-rules.test.ts`'s AD-16 write-surface check (Ruling R1).** It still calls `setTaskStatus`/`updateTaskField`/`createPage`/`applyCalendarEdit` directly: Phase 1 logic that Epic 8 moves into `app/` (AD-16). Every other shell file, including `shell/server.ts`, is checked now. **Epic 8 item:** once `chat-cli.ts` is transport over `app/` (or is deleted, FR-50), remove `"chat-cli.ts"` from `SHELL_WRITE_ALLOWLIST` in the same change. The test's "allowlist entry still names a real file" check fails if `chat-cli.ts` is deleted while the entry remains.
