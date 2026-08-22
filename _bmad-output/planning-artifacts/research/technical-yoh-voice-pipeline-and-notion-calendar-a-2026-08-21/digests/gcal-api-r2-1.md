# Digest: Google Calendar API integration — Round 2 (lead-following)

## Claims

1. A Google Cloud OAuth consent screen (external user type) left in "Testing" publishing status issues refresh tokens that expire in **7 days**, UNLESS the only scopes requested are a subset of `openid`, `userinfo.email`, `userinfo.profile` — in which case the 7-day limit doesn't apply.
   - Source: https://developers.google.com/identity/protocols/oauth2 — Publisher: Google (official docs) — accessed: 2026-08-21 — confidence: high — class: auth (upgraded from R1's secondary-source-only confidence — directly fetched and confirmed)

2. Moving the consent screen to **"In production"** removes the 7-day testing expiration. The fetched page does NOT state an explicit numeric refresh-token lifetime for production apps — it only frames the 7-day rule as testing-specific and directs developers to production to avoid it; "no fixed expiration" is inferred by omission, not an explicit positive statement.
   - Source: https://developers.google.com/identity/protocols/oauth2 — confidence: medium-high — class: auth

3. Other documented conditions that invalidate a refresh token regardless of Testing/Production status: user revokes access; token unused for 6 months; user changes password (Gmail-scoped tokens); account exceeds refresh-token quota; time-based access expired; admin restricts scope via policy; GCP session length exceeded. Current stated limit: **100 refresh tokens per Google Account per OAuth 2.0 client ID** (exceeding it silently invalidates the oldest token). A conflicting "50 refresh tokens" figure appeared in a third-party/Google Groups source — the officially fetched page says 100; treat 100 as authoritative.
   - Source: https://developers.google.com/identity/protocols/oauth2 — confidence: high — class: auth

4. Real developer report: Calendar API recurring-event **updates** sometimes return HTTP 200 with only the etag changed but no actual recurrence-rule change applied (silent no-op update bug). Reported workaround: clear the `recurrence` field entirely first, then set the new RRULE — but this destroys all existing instances and any one-off per-instance edits, forcing full instance regeneration.
   - Source: https://discuss.google.dev/t/google-calendar-api-sometimes-silently-fails-to-update-recurrence-rules/269516 — Publisher: Google Developer Forums (community-reported) — confidence: medium (single-source anecdotal) — class: pattern

5. Developers report the Calendar API rejecting/erroring on RRULEs that should be spec-valid per RFC 5545 (e.g. `400 Invalid recurrence rule` for template-driven creation; a report that `FREQ=WEEKLY;UNTIL=...;INTERVAL=2` without `BYDAY` throws even though iCal spec permits omitting it).
   - Source: https://github.com/home-assistant/core/issues/85365 ; https://community.make.com/t/help-with-google-calendar-recurrence-rules-error/3423 — confidence: low-medium (snippet-only, not independently corroborated between unrelated codebases with matching root cause) — class: pattern

6. For recurring events, the Calendar API requires start/end to share a **single time zone** to correctly expand recurrence instances — unlike single (non-recurring) events, which permit differing start/end time zones.
   - Source: Google's recurring-events guide, https://developers.google.com/workspace/calendar/api/guides/recurringevents (summarized via search, not directly fetched this round — should be fetched directly to fully confirm wording) — confidence: medium — class: pattern

7. Extended properties come in two flavors: **private** (scoped to the specific calendarId+eventId the request hits) and **shared** (visible regardless of calendarId, across all attendee copies) — the mechanical basis for the primary-calendar + extendedProperties tagging pattern found in Round 1.
   - Source: https://developers.google.com/workspace/calendar/api/guides/extended-properties — confidence: high — class: pattern

8. **Gap, not a claim**: no genuine head-to-head implementation writeup was found comparing "tag script-created events on the primary calendar via extendedProperties + `calendar.events` scope" vs. "create a dedicated secondary calendar via `calendar.app.created`" for a personal single-user script — only the mechanics doc was found, not a practitioner comparison.

9. Real friction points developers report with `google-api-python-client` + stored OAuth refresh token for personal/unattended scheduled scripts: (a) needing to intercept/store the refresh token themselves since the library's automatic refresh doesn't persist the new token back to storage on its own; (b) refresh tokens going stale after ~6 months of disuse, prompting some to build a separate periodic "keep-alive" refresh cron job to prevent silent expiry.
   - Source: https://github.com/googleapis/google-api-python-client/issues/2339 ; https://github.com/googleapis/google-api-python-client/issues/1695 ; https://dev.to/cardinalby/dont-let-google-refresh-token-expire-pie — confidence: medium (two independent GitHub issues + one blog corroborating the same two friction points — meets the multi-source bar for anecdotal evidence) — class: pattern

## Leads

- Directly fetch the recurring-events guide (only snippet-summarized this round) for exact wording on timezone/RRULE constraints.
- Chase home-assistant/core issue #85365 fully for a root-cause identification.
- Try Stack Overflow's native search directly (general web search under-indexed it for this query) or Google's Issue Tracker for Calendar API RRULE bug reports.
- No source yet frames "calendar.app.created + dedicated secondary calendar" as a common alternative practitioner pattern — worth a dedicated follow-up.
- The 50-vs-100 refresh-token-limit discrepancy across sources suggests the number may have changed over time — worth checking doc revision history if load-bearing.

## Gaps

- No explicit official statement on the *numeric* refresh-token lifetime once "In production" — described as long-lived/effectively indefinite absent the listed invalidation triggers, but not found as an explicit positive claim.
- Whether "dedicated secondary calendar" is more common in practice than "primary + extendedProperties tagging" remains unconfirmed either way.
- The RRULE "BYDAY required" gotcha and the "silent no-op recurrence update" bug are each single-source/weakly corroborated — not verified against Google's Issue Tracker directly, could reflect outdated/fixed behavior.
- Dimension budget reached (max_depth=2 cap) — no further rounds; remaining gaps carry forward as open questions.
