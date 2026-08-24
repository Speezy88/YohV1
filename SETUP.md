# Yoh — Setup Runbook

Before running Yoh against real Google/Notion data, Spencer needs to do the
account-side setup below by hand — creating a Google Cloud project, flipping
the OAuth consent screen, and creating a Notion integration are account
actions that only Spencer's own GCP/Notion login can perform. No agent or
script in this repo can do these steps (see the Task 2 brief's Ruling); this
document is the numbered runbook for doing them once.

`token-store.ts` and `memory-store.ts` (this task's code) are fully
implemented and unit-tested against placeholder config already — nothing
below is required to run `npm run check`. It's required before Yoh's later
`ritual-cli.ts`/`chat-cli.ts` commands can talk to Spencer's real Google
Calendar and Notion workspace.

---

## 1. Create a Google Cloud project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a new project (e.g. "Yoh").
2. In **APIs & Services → Library**, search for **Google Calendar API** and
   click **Enable**.

## 2. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External** (Spencer's account is a personal `@gmail.com`
   account, not a Google Workspace-managed domain — the **Internal** user
   type is only available to Workspace organizations, so External is the
   only option here).
3. Fill in the required app fields (app name "Yoh", Spencer's email as
   support/developer contact). No published/public listing needed — this
   app is never distributed.
4. Add scopes: search for and add both
   - `https://www.googleapis.com/auth/calendar.events.readonly`
   - `https://www.googleapis.com/auth/calendar.app.created`

   (These are the exact two scope strings `token-store.ts` uses — see
   Research Findings below for why these two and not `calendar`/
   `calendar.events`.)
5. Add Spencer's own Google account as a **test user** for now (needed
   before the app is published, so the very first consent grant in step 6
   below can succeed).
6. Save.

## 3. Create an OAuth 2.0 Client ID

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application** (simplest for a redirect URI you
   control, even though Yoh runs as a local script — a Desktop-app-type
   client works too if preferred, but then step 6's redirect URI handling
   differs slightly).
3. Add an Authorized redirect URI, e.g. `http://localhost:3000/oauth2callback`.
4. Save. Copy the **Client ID** and **Client Secret** — these go in
   `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## 4. Move the consent screen to "In production"

1. Back in **OAuth consent screen**, click **Publish App** to move
   publishing status from **Testing** to **In production**.
2. Google will likely still show Spencer an "unverified app" warning
   screen the first time he authorizes (see Research Findings — Calendar
   scopes are "sensitive," and formal verification is not required for an
   app used only by its own developer, but the warning screen can still
   appear). Click **Advanced → Go to Yoh (unsafe)** to proceed — this is
   safe because Spencer is both the app's developer and its only user.
3. **Confirm the publishing status now reads "In production," not
   "Testing," before continuing.** This is the step that prevents the
   7-day silent refresh-token expiry described in the Task 2 acceptance
   criteria — a token issued while still in "Testing" expires in 7 days
   regardless of use; "In production" removes that cap.

## 5. Enable the Calendar API for the project (if not already)

Confirm under **APIs & Services → Enabled APIs** that "Google Calendar API"
is listed. (Done in step 1, but a second checkpoint here since AC #3 hinges
on OAuth being wired to the real Calendar API and not, say, only the
People/Contacts API.)

## 6. Obtain the initial refresh token (one-time)

`token-store.ts` needs one real refresh token to seed `GOOGLE_REFRESH_TOKEN`
(or the on-disk token file directly). This is a one-time interactive OAuth
flow — there's no `shell/` CLI command for it yet in this repo (a later
task may add one), so do it by hand once:

1. Build a consent URL (substitute your own `GOOGLE_CLIENT_ID` and
   `GOOGLE_REDIRECT_URI` from step 3):

   ```
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id=YOUR_CLIENT_ID
     &redirect_uri=YOUR_REDIRECT_URI
     &response_type=code
     &access_type=offline
     &prompt=consent
     &scope=https://www.googleapis.com/auth/calendar.events.readonly%20https://www.googleapis.com/auth/calendar.app.created
   ```

   `access_type=offline` and `prompt=consent` are both required to get a
   `refresh_token` back — Google only issues one on the *first* consent
   grant (or when `prompt=consent` forces re-consent) by default.

2. Open that URL in a browser, sign in as Spencer, approve. Google
   redirects to `YOUR_REDIRECT_URI?code=...` — copy the `code` query param
   (there's no server listening on that port yet; the browser will show a
   "can't connect" page after redirecting, which is fine — the code is
   already in the address bar).
3. Exchange the code for tokens with one `curl` call:

   ```
   curl -s https://oauth2.googleapis.com/token \
     -d client_id=YOUR_CLIENT_ID \
     -d client_secret=YOUR_CLIENT_SECRET \
     -d code=THE_CODE_FROM_STEP_2 \
     -d grant_type=authorization_code \
     -d redirect_uri=YOUR_REDIRECT_URI
   ```

   The JSON response's `refresh_token` field is the value for
   `GOOGLE_REFRESH_TOKEN` in `.env`.
4. From here on, `token-store.ts` owns this token: on first run it copies
   `GOOGLE_REFRESH_TOKEN` into `GOOGLE_TOKEN_FILE_PATH` (default
   `./data/google-token.json`) and rewrites that file — not `.env` —
   immediately after every subsequent refresh.

## 7. Create a Notion internal integration

1. Go to <https://www.notion.so/profile/integrations> (Notion's "My
   integrations" page) and click **New integration**.
2. Choose the workspace, give it a name ("Yoh"), and select **Internal**
   integration type (not Public) — internal integrations use a static
   token with no OAuth flow, which is what AD-10 assumes and what the
   Research Findings below confirm is still the current pattern.
3. Under **Capabilities**, grant read content and update content (Yoh only
   ever writes a Task's Status property per AD-12, but Notion's
   capabilities are granted at the integration level, not per-property).
4. Copy the **Internal Integration Secret** — this is `NOTION_TOKEN` in
   `.env`.
5. **Share the relevant pages/databases with the integration**: internal
   integrations only see pages/databases explicitly shared with them.
   Open Spencer's Tasks database (and any other database Yoh needs) in
   Notion, click **···  → Connections**, and add the "Yoh" integration.

## 8. Pushover

1. Create an account at <https://pushover.net/> if Spencer doesn't already
   have one, and install the Pushover app on his phone.
2. Create a Pushover Application/API token at
   <https://pushover.net/apps/build> — this is `PUSHOVER_APP_TOKEN`.
3. Spencer's personal **User Key**, shown on the Pushover dashboard, is
   `PUSHOVER_USER_KEY`.

## 9. SMTP (email fallback for night-escalate)

Use whatever mail provider Spencer already has (Gmail app password, a
transactional-email provider, etc.) and fill in `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` accordingly. No specific provider
is mandated by the architecture.

## 10. Claude API key

Create an API key at <https://console.anthropic.com/> and set
`CLAUDE_API_KEY`.

## 11. Populate `.env`

```
cp .env.example .env
```

Then fill in every value gathered above. `.env` is gitignored — never
commit it.

## 12. Dead-man's-switch scope note (Task 26 / Story 5.2)

`ritual-cli.ts` checks, on every subcommand run, whether that SAME
subcommand's own previous scheduled occurrence recorded a successful run —
if not, it sends a Pushover alert through the same channel Story 5.1's
failure alerts use, worded distinctly ("missed a run," not "failed"), then
proceeds with that run's own normal work regardless (self-healing: a single
missed occurrence never blocks the current one, so it can never cascade
into permanent failure).

**This check is self-referential only.** It runs from INSIDE a live
`ritual-cli.ts` invocation, so it can only ever detect a miss from a LATER
invocation that itself still gets to run. A total host/scheduler outage
spanning every FUTURE invocation — cron itself dies, the host is off,
permanently — has no detection from inside Yoh at all, since there is no
later invocation left to run the check. This is a documented, accepted gap
for this story, not something claimed as solved. Closing it would require
an external, off-host monitor (e.g. a third-party heartbeat/dead-man's-
switch service Yoh pings on every successful run, watched from OUTSIDE this
process) — out of scope here.

---

## Running Yoh

Yoh has no `yoh` binary and no `ritual` subcommand — every invocation below
is a plain `node` command run against this repo's own files, from a working
directory where `.env` is loadable (either `cwd` when you run it, or
wherever your process manager sets it — see the crontab example below).

### The four ritual-cli subcommands (AD-5)

`src/shell/ritual-cli.ts` takes exactly one positional subcommand:

```
node src/shell/ritual-cli.ts morning
node src/shell/ritual-cli.ts night-prompt
node src/shell/ritual-cli.ts night-escalate
node src/shell/ritual-cli.ts self-check
```

- `morning` — generates and delivers today's Plan (Story 1.10).
- `night-prompt` — the first, un-escalated close-out prompt (Story 3.1).
- `night-escalate` — the second, escalated close-out attempt if the first
  went unanswered (Story 3.2).
- `self-check` — asks (roughly every `SELF_CHECK_DEFAULT_INTERVAL_DAYS`
  days — see below) how well Yoh is doing (Story 4.3).

Each is a **one-shot process that runs and exits** — see "Not a daemon"
below.

### The interactive chat CLI

```
node src/shell/chat-cli.ts
```

This is the interactive surface: ask "what's my plan", answer an open
interaction request (a Data-Completeness prompt, a close-out confirmation, a
Self-Check score, a Time-Budget-change Proposal), declare a Time Budget, and
so on. Run it whenever you want to talk to Yoh — it is not cron-triggered.

### A sample crontab

`self-check`'s own due-date check happens *inside* the ritual, not by
picking the right cron cadence for it (see `src/rituals/self-check.ts`'s own
"Randomization mechanism" doc comment): the ritual decides for itself
whether today is close enough to its own randomized target time, and is a
cheap no-op every other trigger. Its default interval is
`SELF_CHECK_DEFAULT_INTERVAL_DAYS = 4` days (shortening to as few as
`SELF_CHECK_MIN_INTERVAL_DAYS = 1` day after a low score), so it needs to be
triggered more often than that interval — e.g. hourly — for its own
randomized time-of-day to land promptly.

```cron
# Morning Plan, once daily in the morning.
0 7 * * * cd /path/to/yoh && node src/shell/ritual-cli.ts morning >> /var/log/yoh/morning.log 2>&1

# Night close-out prompt, once daily in the evening.
0 21 * * * cd /path/to/yoh && node src/shell/ritual-cli.ts night-prompt >> /var/log/yoh/night-prompt.log 2>&1

# Night escalation, a couple hours after the prompt, in case it went unanswered.
0 23 * * * cd /path/to/yoh && node src/shell/ritual-cli.ts night-escalate >> /var/log/yoh/night-escalate.log 2>&1

# Self-Check: triggered hourly; the ritual itself is a no-op except on its
# own ~4-day (or shorter, after a low score) randomized due date/time.
0 * * * * cd /path/to/yoh && node src/shell/ritual-cli.ts self-check >> /var/log/yoh/self-check.log 2>&1
```

Use real absolute paths in place of `/path/to/yoh`. `.env` must be loadable
from that same working directory — `cd /path/to/yoh &&` before each command
is what makes that true under cron, whose own working directory is
otherwise unspecified.

### Not a daemon (AD-5)

All four `ritual-cli.ts` subcommands are independent, one-shot processes:
each cron firing starts a fresh process that does its work and exits — there
is no long-running Yoh daemon to keep alive, restart, or monitor as a
service. `chat-cli.ts` is the one long-lived-per-session process, and only
for as long as you're actively talking to it.

---

## Research Findings (Task 2 AC — confirmed live, 2026-08-22)

Per the Task 2 brief's Ruling, the items below were confirmed against
current public docs in this session (not carried over from the pre-build
technical research alone, though that research — dated 2026-08-21, one day
prior — turned out to already match). Corresponding code comments live next
to each fact's point of use in `src/adapters/token-store.ts`.

1. **Notion auth pattern (internal integration token vs. OAuth) — confirmed
   unchanged.** Internal integrations use a static, per-workspace
   "Internal Integration Secret" included as a bearer token on every
   request; no OAuth flow, no token refresh. Only *public* integrations
   (multi-workspace distribution) use OAuth 2.0. This matches AD-10's
   assumption that the Notion token is a static, non-refreshing secret.
   Source: <https://developers.notion.com/docs/authorization> (fetched
   live 2026-08-22).

2. **Current Notion API version.** `2026-03-11`, used as the
   `Notion-Version` request header (the `@notionhq/client` SDK sets this
   automatically from its own bundled default, but `NOTION_API_VERSION` in
   `.env.example` pins it explicitly so a future SDK bump can't silently
   change the wire format). Source:
   <https://developers.notion.com/reference/versioning> (fetched live
   2026-08-22; the page states "our latest version is 2026-03-11").

3. **Google Calendar OAuth scope names — primary read-only.**
   `https://www.googleapis.com/auth/calendar.events.readonly` ("View
   events on all your calendars"). Source:
   <https://developers.google.com/workspace/calendar/api/auth> (fetched
   live 2026-08-22).

4. **Google Calendar OAuth scope names — "Yoh Plan" write.**
   `https://www.googleapis.com/auth/calendar.app.created` ("Make secondary
   Google calendars, and see, create, change, and delete events on them")
   — deliberately narrower than the general-purpose `calendar.events`
   (read/write on *every* calendar) scope, and it's the scope that matches
   AD-10's design: `calendar-adapter.ts` creates the "Yoh Plan" secondary
   calendar itself via `Calendars.insert` on first run and only ever
   writes within calendars the app created — `calendar.app.created` is
   exactly that guarantee enforced at the API layer, not just by
   convention. Source: same as #3.

5. **OAuth 2.0 user consent vs. service account for a personal Google
   account.** Confirmed: accessing a personal `@gmail.com` Google Calendar
   requires OAuth 2.0 user consent. Service accounts work without user
   consent only for server-to-server access patterns (e.g. domain-wide
   delegation), and domain-wide delegation is only available to Google
   Workspace-managed domains — there is no equivalent mechanism for a
   personal consumer account. `token-store.ts` therefore constructs an
   `OAuth2Client` (user-consent flow), never a service-account credential.
   Source: <https://developers.google.com/identity/protocols/oauth2>
   (fetched live 2026-08-22).

6. **"Testing" vs. "In production" consent-screen status and the 7-day
   refresh-token expiry.** Confirmed: a consent screen with an External
   user type left in "Testing" publishing status issues refresh tokens
   that expire in 7 days (unless the only requested scopes are a subset of
   `openid`/`userinfo.email`/`userinfo.profile`, which don't apply here).
   Moving to "In production" removes that 7-day cap; Google's own docs
   don't state an explicit fixed lifetime for production tokens, framing
   it instead by the conditions that *do* invalidate a token (user
   revokes access, 6 months of disuse, password change, 100-refresh-tokens-
   per-account-per-client-ID cap, etc.). Source: same as #5.

7. **Whether moving to "In production" requires full Google app
   verification first.** Confirmed: no. "Publish App" (Testing →
   Production) is a self-service action in the Cloud Console, not gated on
   verification. Verification is a separate, subsequent, optional step.
   Google Calendar scopes are classified **"sensitive"** (not
   "restricted" — restricted scopes require an annual third-party security
   assessment; sensitive scopes don't). Google's own docs describe an
   explicit exemption from full verification for "the only user of your
   app, or … used by only a few users, all of whom are known personally to
   you" — exactly Yoh's situation (Spencer is the sole user) — subject to
   a user cap well above 1. Practically: Spencer will still see an
   "unverified app" warning the first time he authorizes (step 4 above),
   which he can click through; this does not reintroduce the 7-day expiry,
   since that's governed by publishing status, not verification status.
   Sources:
   <https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification>,
   <https://support.google.com/cloud/answer/9110914> (both fetched live
   2026-08-22).

None of the findings above contradicted the architecture's existing
assumptions (AD-10, AD-12) — this research closes out the "medium
confidence, confirm against live docs before build" flag the technical
research and Architecture Spine both carried forward from planning.
