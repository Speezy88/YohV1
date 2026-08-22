# Digest: Google Calendar API integration — Round 1

## Claims

- The Calendar API added an `eventType` field enabling apps to distinguish special event types (e.g., `outOfOffice`, and per a 2024 update, `fromGmail`); no v4/major-version break has occurred — v3 remains the current and only REST API version.
  - Source: https://developers.google.com/workspace/calendar/release-notes ; https://workspaceupdates.googleblog.com/2024/05/google-calendar-api-event-type-fromgmail.html
  - Publisher: Google Workspace (official) — pub_date: rolling/2024-05 — accessed: 2026-08-21 — confidence: high — class: version

- Google is deleting orphaned secondary calendars starting 2026-04-27 (personal accounts) / 2026-10-05 (Workspace), and is shipping a new Calendar "ownership transfer" API endpoint (~June 2026); neither directly affects a script only reading/writing its own events on an existing calendar, but signals active 2026 platform churn worth monitoring.
  - Source: https://workspaceupdates.googleblog.com/2026/03/an-update-on-secondary-calendar-lifecycle-changes-and-a-new-API.html
  - Publisher: Google Workspace Updates blog (official) — pub_date: 2026-03 — accessed: 2026-08-21 — confidence: high — class: version

- As of 2026-05-01, Google standardized Calendar API quotas: new Cloud projects get 10,000 requests/min per project, 600 requests/min per user/project, and a soft daily threshold around 1,000,000 requests/24h before charges may apply; projects created before this date keep prior quotas. Rate-limited calls return 403/429; Google recommends exponential backoff.
  - Source: https://developers.google.com/workspace/calendar/api/guides/quota
  - Publisher: Google (official docs) — pub_date: current (checked live) — accessed: 2026-08-21 — confidence: high — class: quota

- The Calendar API exposes ~19 OAuth scopes. Relevant: `calendar` (full access), `calendar.readonly`, `calendar.events` (read/write events across all calendars), `calendar.events.readonly`, `calendar.events.owned` (control over events on calendars *you own*, not events *your app created*), `calendar.app.created` (create secondary calendars and manage events only within calendars the app itself created). Google's own guidance: request the narrowest scope, use `calendar.events.readonly` unless the app actually creates/edits/deletes/responds to events.
  - Source: https://developers.google.com/workspace/calendar/api/auth
  - Publisher: Google (official docs, last updated 2026-07-22 UTC) — accessed: 2026-08-21 — confidence: high — class: auth

- No native scope restricts an app to "only events it created" *within an existing/primary calendar* (that guarantee only exists via `calendar.app.created`, which instead confines the app to a separate secondary calendar it creates). Practical pattern for "read existing events, write/manage only self-created events on the same calendar": grant `calendar.events` (read/write) at the OAuth layer, then use Calendar API **extended properties** (`extendedProperties.private`) to tag every event the app creates with a private key/value marker, and always filter/query with `privateExtendedProperty` before updating or deleting so the app only ever touches its own tagged events.
  - Source: https://developers.google.com/workspace/calendar/api/guides/extended-properties
  - Publisher: Google (official docs) — accessed: 2026-08-21 — confidence: high — class: pattern

- Service accounts cannot access a personal (@gmail.com) Google Calendar via domain-wide delegation — DWD only works for Google Workspace domains where an admin can grant it; no equivalent for personal consumer accounts. Correct auth path for a personal-account integration: OAuth 2.0 with user consent (installed-app / desktop flow), not a bare service account.
  - Source: https://www.unipile.com/gmail-api-service-account-domain-wide-delegation/ ; corroborated by Google Developer forum thread https://discuss.google.dev/t/narrow-domain-wide-delegation-to-specific-group-user/92980
  - Publisher: Unipile (secondary/vendor blog) + Google Developer forum (secondary) — pub_date: 2026 — accessed: 2026-08-21 — confidence: medium (no single official Google page fetched stating this explicitly, but structurally well-established and cross-confirmed by two independent secondary sources) — class: auth

- For an OAuth consent screen left in "Testing" publishing status (default for a new personal/single-user script), Google auto-expires **all** refresh tokens after exactly 7 days regardless of use, producing `invalid_grant` on next refresh. Moving the consent screen to "In production" removes the 7-day cap; a production/verified app's refresh token instead persists until ~6 months of inactivity, a 50-token-per-account-per-client cap is exceeded, or the user revokes access. Sensitive/restricted scopes additionally require full Google verification (security audit) to reach production status.
  - Source: https://www.unipile.com/google-oauth-refresh-token/ and https://tech.queenofsandiego.com/posts/2026-05-06-1850.html
  - Publisher: Unipile (vendor blog) + independent developer blog — pub_date: 2026-05 / 2026 — accessed: 2026-08-21 — confidence: medium-high (two-source rule satisfied via independent corroboration; did not independently re-fetch Google's own OAuth token-expiration page this run) — class: auth

- Google Calendar's ICS/iCal "subscribe by URL" feature is still supported in 2026, but refresh latency is coarse and not controllable via any API or UI button: multiple independent sources converge on roughly 8–24 hours (some report up to 48h) between a source calendar change and it appearing in a subscribed Google Calendar, because Google throttles external ICS fetch frequency at its discretion with no published SLA. Unsuitable as a near-real-time or same-day read channel, in contrast to the live API which reads current state on each call.
  - Source: https://usemooncal.com/en/guides/google-calendar-ics-refresh ; corroborated by https://twocal.app/p/google-calendar-ics-refresh-delay/ and https://www.hetk.io/blog/how-to-subscribe-ics-calendar-google/
  - Publisher: three independent third-party vendor/blog sources — pub_date: 2026 — accessed: 2026-08-21 — confidence: medium (consistent secondary corroboration; no official Google doc states a specific refresh interval — itself a documented gap) — class: pattern

## Leads

- `calendar.app.created` scope worth a second look if the architecture could instead use a *dedicated secondary calendar* the script owns outright (rather than writing into the user's existing/primary calendar) — much stronger read/write isolation than tagging with extended properties, at the cost of events living in a separate calendar the user must overlay/view alongside their main one.
- Google's official OAuth 2.0 / Identity documentation on refresh-token expiration policy (`developers.google.com/identity/protocols/oauth2`) not directly fetched this run — worth pulling to upgrade the refresh-token-expiry claim to fully official-doc-confirmed.
- The 2026-03 secondary-calendar-lifecycle and ownership-transfer API changes plus the May 2026 quota overhaul suggest active 2026 policy churn — worth a periodic recheck of the release-notes page before finalizing implementation.
- `calendar.events.owned` scope semantics vs. shared/delegated-calendar edge cases not fully explored — relevant only if the target calendar isn't the user's own primary calendar.
- Recurring-event creation and timezone-handling gotchas (question 3) not directly retrieved this round.

## Gaps

- No concrete, current developer-forum evidence on **recurring event creation gotchas** (RRULE edge cases, timezone handling in Events.insert) — remains unverified.
- Did not independently fetch Google's own official OAuth2/Identity docs page on refresh-token expiration to fully upgrade that claim beyond two corroborating secondary sources.
- No official Google page found stating a specific numeric ICS/iCal refresh interval — all timing figures are third-party observation, not documentation.
- Did not verify whether the ~1,000,000 requests/24h figure is a hard cap or a billing threshold — phrasing suggests a paid tier beyond it, not pursued further.
- Did not independently confirm Outlook/Apple/CalDAV ICS-subscription support in 2026 — results returned were Google-Calendar-specific.
