# Yoh — SDD Implementation Plan, Phase 2 (Epic 7)

**Derived plan file for superpowers:subagent-driven-development.** This file exists
only so the SDD scripts (`task-brief`, `review-package`) have `## Task N` headings
to key on. It is *not* a new source of requirements — it packages the approved
planning documents into task-shaped briefs:

- **Spec (binding authority):** `_bmad-output/planning-artifacts/architecture/architecture-YohV1-2026-08-22/ARCHITECTURE-SPINE.md`
  (Phase 2 = amended AD-1/3/5/7/9/10/11/12 + new AD-15..AD-24)
- **Plan argument (task/story breakdown):** `_bmad-output/planning-artifacts/epics.md`, "## Epic 7" (Stories 7.1–7.10)
- **UX:** `_bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/DESIGN.md` and `EXPERIENCE.md`
  (UX-DR22–32, UX-DR45–52 apply to Epic 7)
- **Per-story implementation plans:** `docs/superpowers/plans/2026-09-25-story-7.N-*.md` (one per task below)

Every acceptance-criteria block below is copied verbatim from `epics.md`. The
"Depends on / Owns / Implementer notes" lines above each story are packaging
only — they point at spine rules and resolve ordering; they add no requirements.
Task numbering = story order 7.1 → 7.10, which is also the build order:
Story 7.1's shared SQLite handle (`adapters/sqlite.ts`) comes before any new
store; Story 7.2 authors and locks `types/api.ts` before any `app/`,
`shell/server.ts`, or `web/` file (AD-9). Task 11 packages the Epic 6 retro
action items 1–4 (small, self-contained fixes), run only after Tasks 1–10.

## Global Constraints

These bind every task. Copy the relevant subset into each dispatch's
"global constraints" block — do not paste this whole section into every prompt.

**Layering (AD-1, revised for Phase 2):** dependency direction is
`shell/{server,chat-cli}.ts → app → {rituals, core, adapters}`;
`shell/ritual-cli.ts → rituals → {core, adapters}`; `adapters → types` only.
`shell/ritual-cli.ts` **never imports `app/`**, and `rituals/` never imports
`app/`. `core/` imports only `types/` and other `core/`. `web/` is outside this
graph: it reaches the system only over HTTP/SSE and imports only `import type`
from `src/types/` (AD-17).

**Functional core (AD-2, AD-8):** every `core/*.ts` export is pure and returns
`Result<T, YohError>`, never throws. `adapters/*.ts` may throw on I/O failure;
`rituals/*` (and `app/*` for interactive flows) catch and convert. `YohError.kind`
includes at minimum `missing-field`, `auth-expired`, `unreachable`,
`rate-limited`, `validation`, `stale-proposal`, `conflict`.

**`app/` layer (AD-16):** one file per interaction use-case; each export is
shaped `(deps, input) → Promise<Result<Output, YohError>>` with `input`/`Output`
from `types/api.ts` or `types/domain.ts`. Shells contain transport only: parse
the request, call one `app/` function, render its `Result`. A shell file never
calls an adapter's write function, never constructs/applies a `Proposal`, never
branches on business rules. `app/` is the only layer that may call AD-12's Notion
writes (`setTaskStatus`, `updateTaskField`, `createPage`). `app/` files are named
for the use-case (`check-off.ts` exports `checkOff`).

**Shared types locked first (AD-9):** `types/domain.ts` and `types/api.ts` are the
single homes for shared shapes. `types/api.ts` (serialized `Result` envelope, event
hint `{seq, topic, entityId}`, notification record, closed `NotificationKind`
union) is authored and reviewed before any `app/`, `shell/server.ts`, or `web/`
file that uses it. Later stories may add new shapes but never redeclare or widen
an existing one. No file locally redeclares, widens, or shadows an exported type.
Blocks and Tasks are addressed by `PlanBlock.id` / Notion Task id, never by
screen position or index. Every behavior has exactly one file as its home; a new
capability gets a new file.

**Storage (AD-10, revised for Phase 2):** `adapters/sqlite.ts` is the **only**
file that opens the SQLite file: one connection per process, WAL, a
`busy_timeout`, `foreign_keys` on; exports `writeTx(fn)` running `fn` inside
`BEGIN IMMEDIATE`. Every store receives that handle and does all multi-step writes
through `writeTx`; no store opens its own connection. A change spanning owners runs
inside one `writeTx`, calling each owner's exported `…InTx(tx, …)` function. New
Phase 2 owners get **dedicated SQL tables**, created idempotently on startup —
not `memory-store.ts`'s generic `(kind, id)` blob table. Each record kind has
exactly one owning file; no file reads or writes another file's tables directly.
Owners in this epic: `notification-store.ts` (notifications, read state, event
outbox), `plan-state-store.ts` (server heartbeat; pending check-offs from 7.10),
`completion-log.ts` (completions). `memory-store.ts` keeps its existing kinds and
takes on none of these. Optimistic concurrency surfaces a conflicting write as
`YohError.kind: 'conflict'`. No process holds a read transaction open across an
`await`.

**Process model & hosting (AD-15):** `shell/server.ts` (Hono + `@hono/node-server`)
is a separate long-running, systemd-supervised process (`Restart=always`),
listening on **loopback only**, reached exclusively via `tailscale serve` HTTPS on
the MagicDNS name — never Funnel, port-forward, or a public domain. Tailnet
membership is the authentication: no login screen, session cookie, or password.
The server serves the built `web/` bundle, `/api/*`, and SSE, and runs AD-20's
commit sweep. It **schedules no ritual**; the four cron one-shots (`morning`,
`night-prompt`, `night-escalate`, `self-check`) stay OS-scheduled and unchanged.

**Browser client (AD-17):** `web/` is a Vite + React SPA with its own tsconfig,
built to static files served by `shell/server.ts`. API calls go through the typed
Hono RPC client (`hono/client`). Every Plan, priority, and placement is computed
server-side; client state is a cache of server state, refreshed after each
mutation and on each SSE hint. Optimistic UI is visual only; a failure renders as
a failure. Ephemeral view state (scroll position, current page, unsent text) is
client-only. No secret, API key, or OAuth token is ever sent to the browser.
Content-Security-Policy is `default-src 'self'`.

**Live delivery (AD-18):** a notification is a durable record owned by
`notification-store.ts`: `{id, kind: NotificationKind, title, body, deepLink,
createdAt, readAt?}`. `NotificationKind` is the closed union `research-ready |
research-failed | sandbox-complete | sandbox-failed | needs-data |
reshuffle-apply-failed | operational`. Every user-visible change, including a new
notification, appends one outbox row `{seq (monotonic), topic, entityId}` in the
same transaction. The server tails the outbox (~2 s poll, exported once) and
pushes `{seq, topic, entityId}` hints over one SSE stream per client
(`GET /api/events`); SSE carries hints, never data; the client re-fetches through
the API. Reconnect sends `Last-Event-ID` and the server replays from that `seq`.
An SSE comment keep-alive goes out on every poll tick.

**Observability (AD-7, revised):** every `ritual-cli.ts` subcommand keeps its
top-level handler (Pushover alert worded distinctly, exit non-zero) and its
dead-man's switch. Phase 2: the server writes a heartbeat on a fixed interval;
`ritual-cli.ts morning` checks it on start and sends a Pushover alert if stale,
without blocking the Morning Plan. Every alert condition also appends an
`operational` in-app notification via `notification-store.ts`; Pushover remains
the channel that doesn't depend on the server being up.

**Notion writes (AD-12, reverted 2026-09-25):** `setTaskStatus` writes the Status
property only (schema-checked via the existing live-option `closestOption`
resolution) and **never sets `in_trash`**, from any trigger. No Phase 2 capability
deletes anything from Notion. The write surface stays the closed set
`setTaskStatus` / `updateTaskField` / `createPage`.

**Check-off (AD-20) & Completion Log (AD-23):** `app/check-off.ts` records a
pending completion in `plan-state-store.ts` with `completedAt` = click instant and
`commitAt = completedAt + undo window` (~5 s, exported once), returning `commitAt`.
Undo deletes the pending record. The server commits due records on a timer and
sweeps overdue ones on startup. Commit order is fixed: `completion-log.ts`
`recordCompletion` first, then `setTaskStatus(completed)`. A Notion failure keeps
the log entry, marks Notion sync pending for retry on the next sweep, and raises an
`operational` notification; it never rolls back the log. `completion-log.ts`
exports exactly one completion write, `recordCompletion({taskId, taskName, area,
dueDate, estimatedMinutes, completedAt, source: 'check-off' | 'close-out'})` (plus
its `…InTx` variant), snapshotting those fields; nothing else writes completions.
`night-ritual.ts` excludes Tasks completed today from close-out questions.

**Conventions:** kebab-case filenames; one primary export per `core/`/`adapters/`
file named to match; React components in `web/` are PascalCase files. API routes
are `/api/<noun>[/<verb>]`, JSON in and out, returning the serialized `Result`
`{ok: true, value} | {ok: false, error: YohError}`. Dates are ISO-8601 UTC in
`core/` and storage; "today", day boundaries, and date-triggered UI use the one
configured host timezone (`TZ`), never the browser's. Logging is single-line
structured JSON to stderr; the server logs duration per API request. **Shared
tuning constants** (heartbeat interval and staleness, undo window, outbox poll,
Screensaver idle) each have exactly one defining export in the file that owns the
behavior; the client receives any it needs in API responses and never redeclares
them.

**Web UI (FR-46, NFR-Accessibility):** one design-token source in `web/` (CSS
custom properties, light + dark values per DESIGN.md), consumed through Tailwind
v4's theme; no component hard-codes a color, shadow, radius, or duration. Motion
reads one reduced-motion flag; every animation has a fade or instant fallback.
Fonts are self-hosted (Figtree UI, Montserrat wordmark), never from a CDN; no
`system-ui` in any font stack. Contrast meets WCAG 2.2 AA in both themes.
Per-device preferences (theme) live in `localStorage`, wrapped so blocked storage
never breaks the page. From Story 7.5 on, every web story follows UX-DR48
(skeleton loads, never a static spinner; every write visibly acknowledged or
visibly failed), UX-DR49 (every animation tied to a state change, reads the single
reduced-motion flag), UX-DR50 (neutral, guilt-free copy, no emoji, no button that
duplicates a slash command), and UX-DR47 (1.8 px-stroke line icons, neutral
`ink-secondary` / active `accent-solid`, always with a label or accessible name).

**Stack (pinned by the spine):** Node 24.12+ with native type-stripping (no server
build step); TypeScript 7.0.2 for `tsc --noEmit`; `better-sqlite3` ^13.0.3; Hono +
`@hono/node-server` ^4.13; React ^19.3; Vite ^8.3 (client bundler only, the only
build step); Tailwind CSS 4.x via `@tailwindcss/vite` ^4.2.2; shadcn/ui copied-in
source; Motion (`motion`) ^13.4; `@fontsource/*` Figtree/Montserrat. Tests:
server/app/core/rituals/adapters use `node:test` with fake adapters; `web/` uses
Vitest + React Testing Library (jsdom), plus one Playwright smoke suite; pin
versions at install.

**Phase 1 must keep passing:** the CLI isn't retired until Epic 8. Every existing
ritual and `chat-cli` test keeps passing after every task (`npm run check`).

**Manual spikes (not blockable here):** Tailscale on the school network, Windows
PWA install, SSE through `tailscale serve`, and Windows `backdrop-filter` fallback
need Spencer's real network and devices. Build everything verifiable locally and
write a short manual-verification checklist into the story's per-story plan.

---


## Task 1: Story 7.1 — Shared SQLite Connection for Concurrent Processes

**Depends on:** nothing (first task). **Owns:** `src/adapters/sqlite.ts` (new); refactor of `src/adapters/memory-store.ts` to take the shared handle; handle construction in `src/shell/ritual-cli.ts` and `src/shell/chat-cli.ts`; a repo-scan test for the sole-opener rule.

**Per-story plan:** `docs/superpowers/plans/2026-09-25-story-7.1-shared-sqlite-connection.md`

**Implementer notes:** Today `memory-store.ts` is the only file that constructs a `better-sqlite3` database. Keep its public behavior identical — this is a pure refactor plus the new helper.

As Spencer,
I want the cron rituals and the upcoming web server to share one safely configured database connection per process,
So that two processes writing at once never corrupt or silently overwrite my Plan, memory, or proposals.

**Acceptance Criteria:**

**Given** the existing `memory-store.ts` opens its own SQLite connection
**When** this story is complete
**Then** `adapters/sqlite.ts` is the only file that opens the SQLite file, and a test fails if any other `src/` file constructs a `better-sqlite3` database
**And** it opens one connection per process with WAL mode, a `busy_timeout`, and `foreign_keys` on (AD-10)

**Given** a caller needs a multi-step write
**When** it calls `writeTx(fn)`
**Then** `fn` runs inside `BEGIN IMMEDIATE`, commits on success, and rolls back if `fn` throws

**Given** `memory-store.ts` is refactored to receive the shared handle
**When** the existing test suite runs
**Then** every existing memory-store, ritual, and chat-cli test passes unchanged in behavior, including the optimistic-concurrency `YohError.kind: 'conflict'` path

**Given** `ritual-cli.ts` and `chat-cli.ts` start
**When** they need storage
**Then** each builds exactly one handle through `sqlite.ts` and passes it to every store it uses

---

## Task 2: Story 7.2 — Web Server Reachable Only From My Devices

**Depends on:** Task 1 (`sqlite.ts`). **Owns:** `src/types/api.ts` (new, authored and locked **first** within this task); `src/app/` scaffold; `src/shell/server.ts` (new); an import-rule test; systemd unit + deploy doc under `deploy/` or `docs/`; `package.json` deps for Hono.

**Per-story plan:** `docs/superpowers/plans/2026-09-25-story-7.2-web-server.md`

**Implementer notes:** Ruling (controller, preflight): the AC "a shell file calls an adapter write function directly" is enforced for `shell/server.ts` and every new shell file now. `shell/chat-cli.ts` still calls `setTaskStatus`/`updateTaskField`/`createPage`/`applyCalendarEdit` directly (Phase 1 logic that Epic 8 moves into `app/`, AD-16), so it is exempted by an explicit, named allowlist entry in the test that Epic 8 deletes; record that in `deferred-work.md`. Ruling (controller, preflight): so the web client can use Hono's typed RPC client while importing only from `src/types/` (AD-17, Story 7.5), `src/types/api.ts` (or a sibling `src/types/api-routes.ts`) carries a single **type-only** re-export of the server's route type (`export type { AppType } from "../shell/server.ts"` or equivalent); the import-rule test permits exactly that type-only edge. Spike (Tailscale on the school network, Windows reachability) goes in the per-story plan's manual checklist; do not block on it.

As Spencer,
I want a supervised Yoh server on my always-on home host that only my own devices can reach,
So that the Web App is available from home and from class with no login and no public exposure.

**Acceptance Criteria:**

**Given** no browser-server contract exists yet
**When** this story starts
**Then** `types/api.ts` is authored and reviewed first (AD-9). It contains the serialized `Result` envelope `{ok:true,value} | {ok:false,error:YohError}`, the event-hint shape `{seq, topic, entityId}`, the notification record shape, and the closed `NotificationKind` union (`research-ready | research-failed | sandbox-complete | sandbox-failed | needs-data | reshuffle-apply-failed | operational`)
**And** later stories may add new shapes to `api.ts` but never redeclare or widen an existing one

**Given** the `app/` layer is scaffolded
**When** an `app/` function is added
**Then** it has the shape `(deps, input) → Promise<Result<Output, YohError>>`
**And** an import-rule test fails if `shell/ritual-cli.ts` or anything in `rituals/` imports from `app/`, or if a shell file calls an adapter write function directly (AD-1, AD-16)

**Given** `shell/server.ts` (Hono + `@hono/node-server`) starts
**When** it binds
**Then** it listens on loopback only, and `GET /api/health` returns `{ok:true}`
**And** it schedules no ritual; the four cron one-shots stay OS-scheduled and unchanged (AD-5, AD-15)

**Given** the host is set up
**When** the server is deployed
**Then** it runs as a systemd unit with `Restart=always` and is exposed only through `tailscale serve` HTTPS on the MagicDNS name, with no Funnel, port-forward, or public domain
**And** the deploy steps (`git pull` → `npm ci` → build → restart unit) are documented in the repo

**Given** this story includes a verification spike
**When** Spencer opens the tailnet origin from the Mac on the school network and from the Windows PC
**Then** `/api/health` loads on both, and the results are recorded in the story
**And** if school blocks Tailscale, the story stops and flags AD-15 for re-opening instead of adding public exposure or a login

---

## Task 3: Story 7.3 — In-App Notification Store and Live Event Stream

**Depends on:** Tasks 1–2 (`sqlite.ts`, `api.ts`, `server.ts`, `app/` scaffold). **Owns:** `src/adapters/notification-store.ts` (new: notifications + outbox tables, `createNotificationInTx`, outbox append/tail/replay, the poll-interval export); `src/app/notifications.ts` (new); `GET /api/events`, `GET /api/notifications`, mark-read route in `shell/server.ts`; a type test for the closed union.

**Per-story plan:** `docs/superpowers/plans/2026-09-25-story-7.3-notification-store-and-event-stream.md`

**Implementer notes:** Other owners will need to append outbox rows for their own user-visible changes (e.g. the Plan in Task 8, check-offs in Task 10): export a generic `appendOutboxInTx(tx, {topic, entityId})` alongside `createNotificationInTx` so they never touch the outbox table directly (AD-10). SSE-through-`tailscale serve` timing goes in the manual checklist.

As Spencer,
I want anything Yoh needs to tell me to be stored durably and pushed to the open Web App,
So that a notification from the server or a cron ritual is never lost just because no tab was open when it happened.

**Acceptance Criteria:**

**Given** `adapters/notification-store.ts` starts
**When** it initializes
**Then** it idempotently creates its own dedicated tables for notifications (`{id, kind, title, body, deepLink, createdAt, readAt?}`) and the outbox (`{seq monotonic, topic, entityId}`), and no other file touches them (AD-10, AD-18)

**Given** any process (server or cron ritual) creates a notification (FR-49)
**When** it calls `notification-store.ts`'s `createNotificationInTx(tx, …)` inside a `writeTx`
**Then** the notification row and its outbox row commit atomically
**And** a check-in or progress notification can't be constructed, because the kind must be a member of the closed `NotificationKind` union (a type test proves this)

**Given** the Web App is open
**When** it connects to `GET /api/events`
**Then** the server tails the outbox on the poll interval (starting at ~2 s, exported once from the owning file) and sends only `{seq, topic, entityId}` hints, never data
**And** it sends an SSE comment keep-alive on every poll tick
**And** on reconnect with `Last-Event-ID`, it replays every hint after that `seq`

**Given** notifications exist
**When** the client calls `GET /api/notifications` or marks one read
**Then** it gets the unread list, or the `readAt` is set, through an `app/notifications.ts` function

**Given** SSE runs through `tailscale serve`
**When** a notification is created
**Then** its hint arrives at a browser on the tailnet origin within a few seconds, verified empirically and recorded in the story (spine Deferred)

---

## Task 4: Story 7.4 — Server Liveness Alerting and Nightly Backup

**Depends on:** Tasks 1–3. **Owns:** `src/adapters/plan-state-store.ts` (new, heartbeat table only, heartbeat interval + staleness exports); heartbeat writer in `shell/server.ts`; stale-heartbeat check in the `morning` path of `shell/ritual-cli.ts` (via `rituals/`); `operational` notification on every existing AD-7 alert condition; nightly backup job (online backup API) + its cron entry doc.

**Per-story plan:** `docs/superpowers/plans/2026-09-25-story-7.4-server-liveness-and-backup.md`

**Implementer notes:** `ritual-cli.ts` reaches `notification-store.ts` only through `rituals/` or its own alert handler — never through `app/` (AD-1). Ruling (controller, preflight): the backup target is read from configuration (e.g. an env var) and defaults to nothing (backup job fails loudly through AD-7 if unset); Spencer names the actual location during manual verification — recorded in the manual checklist and `deferred-work.md`.

As Spencer,
I want to be told if the Yoh server dies, and my Yoh-only data backed up every night,
So that a dead server or a failed disk never silently costs me days of Completion Log history.

**Acceptance Criteria:**

**Given** `adapters/plan-state-store.ts` is created with only a heartbeat table for now
**When** the server runs
**Then** it writes a heartbeat on a fixed interval
**And** the interval and staleness threshold are each exported once from `plan-state-store.ts` (Shared tuning constants convention)

**Given** the heartbeat is older than the staleness threshold
**When** `ritual-cli.ts morning` starts
**Then** it sends a distinctly worded Pushover alert that the server is down, without blocking the Morning Plan (AD-7)

**Given** any existing AD-7 alert condition fires (a ritual failure or a missed prior run)
**When** the Pushover alert is sent
**Then** an `operational` in-app notification (FR-49) is also created through `notification-store.ts`, and Pushover remains the channel that doesn't depend on the server being up

**Given** a nightly cron job is installed
**When** it runs
**Then** it copies the SQLite file with SQLite's online backup API to the configured second location, which Spencer names during this story (another disk, the Mac, or a USB drive)
**And** a backup failure goes through the same AD-7 alert path

---

## Task 5: Story 7.5 — Web Client Foundation — Design Tokens, Fonts, Themes, Installable App

**Depends on:** Tasks 2–3 (`server.ts` static serving, `api.ts`, route type). **Owns:** `web/` (new Vite + React + TS SPA, own tsconfig): tokens CSS, Tailwind v4 theme, self-hosted fonts, Theme Toggle, PWA manifest + icon, typed Hono RPC client, Vitest + RTL + Playwright config; the web-import-rule test; the token-contrast check; CSP header in `shell/server.ts`; build + test scripts in `package.json`.

**Per-story plan:** `docs/superpowers/plans/2026-09-25-story-7.5-web-client-foundation.md`

**Implementer notes:** `web/` tests are wired into the repo's test gate without breaking `npm run check`'s existing `node --test` run (e.g. a separate `test:web` script that `check` also runs). Windows PWA install goes in the manual checklist.

As Spencer,
I want a Yoh web app I can install as an icon, styled in the agreed warm neumorphic look in light and dark,
So that opening Yoh feels crafted and identical on my Mac and my Windows PC.

**Acceptance Criteria:**

**Given** `web/` is scaffolded as a Vite + React + TypeScript SPA with its own tsconfig
**When** it's built
**Then** `shell/server.ts` serves the static bundle
**And** a test fails if any `web/` file imports anything from `src/` other than `import type` from `src/types/` (AD-17)
**And** API calls go through the typed Hono RPC client

**Given** the design tokens
**When** they're implemented
**Then** every DESIGN.md color, spacing, radius, elevation, rim, and focus token exists once as a CSS custom property with light and dark values, consumed through the Tailwind v4 theme (FR-46, UX-DR22, UX-DR24, UX-DR25, UX-DR26)
**And** an automated check computes the contrast of each load-bearing pair from DESIGN.md's measured table from the token values and fails below its threshold in either theme (NFR-Accessibility)

**Given** fonts
**When** a page loads
**Then** Figtree and Montserrat are served from the Yoh origin (self-hosted `@fontsource`) with Figtree preloaded and a metric-matched fallback face, and `system-ui` appears in no font stack (UX-DR23)

**Given** the Theme Toggle in the page corner
**When** Spencer first launches
**Then** the theme follows the OS appearance
**And** after he clicks the toggle, the choice persists per device in `localStorage`, wrapped so blocked storage never breaks the page (UX-DR27)

**Given** the server's responses
**When** the page loads
**Then** the Content-Security-Policy is `default-src 'self'`, and no secret or token ever appears in any response to the browser

**Given** a PWA manifest and icon
**When** Spencer installs the app from the tailnet origin on the Mac and on the Windows browser
**Then** clicking the icon opens Yoh directly, with no login, picker, or intermediate screen (FR-39)

**Given** `web/` tests
**When** they run
**Then** Vitest + React Testing Library (jsdom) and Playwright are configured, with pinned versions. The Playwright smoke suite starts here and grows in 7.10, 8.8, and 10.4.

**Given** every web story from here on
**When** it adds UI
**Then** it follows the cross-cutting rules:
- UX-DR48: skeleton loads, never a static spinner; every write is visibly acknowledged or visibly failed.
- UX-DR49: every animation is tied to a state change and reads the single reduced-motion flag.
- UX-DR50: neutral, guilt-free copy with no emoji, and no button that duplicates a slash command (FR-46).
Reviews check each web story against these three rules.

**Given** the icon set
**When** any icon renders
**Then** it's a 1.8 px-stroke line icon (neutral `ink-secondary`, active `accent-solid`) paired with a label or accessible name, never emoji and never the only signal of state (UX-DR47)

---

## Task 6: Story 7.6 — Page Shell, Navigation, and Screensaver

**Depends on:** Task 5. **Owns:** `web/` page shell, Page Indicator, swipe/arrow navigation, Screensaver (splash + idle overlay), the readiness hook, and their tests.

**Per-story plan:** `docs/superpowers/plans/2026-09-25-story-7.6-page-shell-navigation-screensaver.md`

**Implementer notes:** Chat, Tasks, Desk are placeholders. The readiness hook is designed so Task 8 can extend it to wait for Home's data.

As Spencer,
I want to move between Home, Chat, Tasks, and Desk with a swipe, a click, or an arrow key, and see the Yoh splash on launch and when idle,
So that every page is one gesture away and the app feels alive without ever getting in my way.

**Acceptance Criteria:**

**Given** the page shell
**When** it renders
**Then** the four pages Home → Chat → Tasks → Desk exist in that order, one in view at a time. Chat, Tasks, and Desk are placeholders until their epics.

**Given** a two-finger horizontal trackpad swipe that starts outside a horizontally scrollable region
**When** Spencer swipes
**Then** the view moves one page in the swipe direction with a slide transition (a cross-fade under reduced motion)
**And** the root sets `overscroll-behavior-x: none`, so the browser's back/forward gesture never fires (UX-DR28)

**Given** the Page Indicator (four dots; the active one is the gradient pill)
**When** Spencer clicks a dot, or presses ← or → with no text field focused
**Then** that page shows, and a screen reader announces e.g. "Chat, page 2 of 4"
**And** `[ASSUMPTION: resolves UX OQ1]` the indicator sits bottom-center, unlabeled, with each dot carrying an accessible name

**Given** a cold launch
**When** the app opens
**Then** the Screensaver shows as a launch splash covering the load and auto-fades into Home once the page shell is ready, with no click (FR-45, UX-DR29). The readiness signal is a hook that 7.8 extends to wait for Home's data.

**Given** 10 minutes with no input (keys, pointer movement, or scroll; the idle time is exported once)
**When** the idle time elapses
**Then** the Screensaver appears as an overlay, not a navigation
**And** any input dismisses it and restores the same page, scroll position, and client-side view state untouched

**Given** the Screensaver
**When** it's showing
**Then** it renders only the drifting gradient-dot field with the centered Montserrat "Yoh Meeseek" wordmark, never data or notifications
**And** under reduced motion the dot field is static
**And** `[ASSUMPTION: resolves UX OQ15]` dot count, speed, and wordmark size are exported constants tuned by eye

---

## Task 7: Story 7.7 — In-App Notification Overlay

**Depends on:** Tasks 3, 5, 6. **Owns:** `web/` notification overlay, `events.ts` SSE client (reconnect with `Last-Event-ID`, server-unreachable local notification), glass-surface fallback, and their tests.

**Per-story plan:** `docs/superpowers/plans/2026-09-25-story-7.7-notification-overlay.md`

**Implementer notes:** Windows Chromium/Edge + macOS `backdrop-filter` fallback check goes in the manual checklist; verify the `@supports` fallback locally in tests.

As Spencer,
I want Yoh's notifications to appear on whatever page I'm on and take me to the right place in one click,
So that I learn about a problem or a finished job without hunting for it.

**Acceptance Criteria:**

**Given** the Web App is open
**When** it receives an SSE hint for a new notification
**Then** it re-fetches through the API and shows the notification as a glass card with a 3 px `accent-solid` left bar, a pulsing dot, and a one-line message, on the current page (UX-DR45)
**And** it enters with a 0.55 s drop and fade (fade only, with no pulse, under reduced motion) and is announced via `aria-live="polite"`

**Given** a notification with a deep link
**When** Spencer clicks anywhere on it
**Then** he lands on its target in one click, and the notification is marked read

**Given** an `operational` notification
**When** it shows
**Then** it's message-only, with no deep link, e.g. "Notion sign-in expired"

**Given** several notifications arrive
**When** they display
**Then** `[ASSUMPTION: resolves UX OQ8]` they stack newest-first, up to three visible, and each stays until clicked or dismissed with its close control. A failure is never auto-dismissed unseen.

**Given** the event stream drops
**When** the client reconnects
**Then** it sends `Last-Event-ID` and shows any notification it missed

**Given** the host is unreachable
**When** the stream can't reconnect
**Then** the client shows a local "Yoh server unreachable" notification of the same shape. There is no silent failure.

**Given** a browser without `backdrop-filter` support
**When** a glass surface renders
**Then** it falls back to an opaque `surface-raised` fill with the same rim, verified on Windows Chromium/Edge and macOS (UX-DR24, UX-DR52)

---

## Task 8: Story 7.8 — Home — Today's Plan and Calendar

**Depends on:** Tasks 3, 5, 6 (and reads Phase 1 `memory-store.ts` Plan + `calendar-adapter.ts` reads). **Owns:** a new `app/` use-case file for Home's data (e.g. `app/home-view.ts`) + its route; `web/` Home page (Plan checklist, Calendar Day View, skeletons, empty states, Feb 19 confetti); outbox hint on Plan change; tests.

**Per-story plan:** `docs/superpowers/plans/2026-09-25-story-7.8-home-plan-and-calendar.md`

**Implementer notes:** Ruling (controller, preflight): "the Plan or calendar changes on the server" is signalled by an outbox hint appended in the same `writeTx` as the stored Plan write (via `notification-store.ts`'s `appendOutboxInTx`), and Home re-fetches both Plan and today's calendar on that hint. Changes made directly in Google Calendar by someone else have no server-side trigger in this epic; no calendar polling is added (not in the ACs).

As Spencer,
I want Home to show today's Plan as a checklist next to today's calendar,
So that I can see what to do, in what order, and when, at a glance.

**Acceptance Criteria:**

**Given** today's Plan exists
**When** Home loads
**Then** the left column lists Plan Rows in exactly the stored Plan's order (FR-2, FR-40), and every order and placement is computed server-side (AD-17)
**And** cold loads show skeleton rows and cards matching the layout, never a static spinner

**Given** today's calendar
**When** the right column renders the Calendar Day View
**Then** it shows today only, with caption-style hour labels and a structural rail
**And** Yoh-owned blocks (Work/Break, Task) render as raised blocks
**And** events Yoh didn't create render as fixed anchors: cross-hatch, `event-fixed-ink`, label suffixed "(fixed)", no shadow (UX-DR32; drag behavior is Epic 10)
**And** completed and past blocks are visibly read-only

**Given** no Plan exists yet today
**When** Home loads
**Then** it reads "No Plan yet today."

**Given** every Task on today's Plan is completed
**When** Home renders
**Then** the checklist reads "Nothing left on today's Plan." with no celebration, and the calendar stays

**Given** the Plan or calendar changes on the server
**When** a matching SSE hint arrives
**Then** Home re-fetches and updates without a reload

**Given** today is February 19 in the host timezone
**When** Spencer first views Home that day
**Then** a single short confetti burst plays in `accent-solid` plus neutral inks, never under reduced motion (UX-DR46)

---

## Task 9: Story 7.9 — Completion Log and Status-Only Completion Writes

**Depends on:** Task 1 (`sqlite.ts`); independent of the web tasks. **Owns:** `src/adapters/completion-log.ts` (new: completions table, `recordCompletion` + `recordCompletionInTx`, completed-today read); the `setTaskStatus` trash revert in `src/adapters/notion-adapter.ts`; the Night Ritual `recordCompletion({source: 'close-out'})` call and close-out exclusion in `src/rituals/night-ritual.ts` (and whichever Phase 1 file performs the close-out Status write today).

**Per-story plan:** `docs/superpowers/plans/2026-09-25-story-7.9-completion-log-status-only-writes.md`

**Implementer notes:** Known carry-in: the AD-12 revert — `setTaskStatus` writes Status only and never moves a page to trash (see `notion-adapter.ts` around line 561); its tests change to assert `in_trash` is never sent.

As Spencer,
I want Yoh to keep its own permanent record of everything I complete, and to stop sending completed Tasks to Notion's trash,
So that my history survives whatever happens in Notion, and completed Tasks stay findable.

**Acceptance Criteria:**

**Given** `setTaskStatus` currently moves completed Tasks to Notion Trash (the 2026-09-22 revision)
**When** this story is complete
**Then** `setTaskStatus` writes the Status property only and never sets `in_trash`, from any trigger
**And** it keeps its schema-checked `closestOption` resolution (AD-12)

**Given** `adapters/completion-log.ts` starts
**When** it initializes
**Then** it idempotently creates its own completions table with date-indexed columns (AD-10)

**Given** a completion is recorded
**When** `recordCompletion({taskId, taskName, area, dueDate, estimatedMinutes, completedAt, source})` (or its `…InTx` variant) is called
**Then** those fields are snapshotted at completion time, with `source` equal to `'check-off'` or `'close-out'`
**And** the entry survives any later change to, or deletion of, the Task in Notion (FR-47, AD-23)
**And** no other function writes completions

**Given** the Night Ritual close-out records a Task as completed
**When** it runs
**Then** it calls `recordCompletion` with `source: 'close-out'` alongside the existing Status write

**Given** `completion-log.ts` shows a Task completed today
**When** the Night Ritual builds its close-out questions
**Then** that Task is excluded and never asked about (FR-41, AD-20)

---

## Task 10: Story 7.10 — Check Off a Task With Undo

**Depends on:** Tasks 3, 4, 8, 9. **Owns:** `src/app/check-off.ts` (new: check-off, undo, hold/release, commit sweep logic); pending-check-offs table in `plan-state-store.ts` + undo-window export; server commit timer + startup sweep in `shell/server.ts`; check-off routes; `web/` Checkbox fade, Undo Toast; Playwright smoke for both paths.

**Per-story plan:** `docs/superpowers/plans/2026-09-25-story-7.10-check-off-with-undo.md`

**Implementer notes:** The Playwright smoke runs against a server wired to fake Notion (no real Notion writes in tests).

As Spencer,
I want to tick a Task on Home and see it fade away, with a few seconds to undo,
So that marking progress is instant and a mis-click costs nothing.

**Acceptance Criteria:**

**Given** a Plan Row on Home
**When** Spencer checks its Checkbox
**Then** the row immediately shows checkmark + strikethrough + 50% opacity and dissolves (instantly hidden under reduced motion), before any server response (NFR-Latency, UX-DR30)
**And** the client calls `app/check-off.ts`, which records a pending completion in `plan-state-store.ts` (a new pending-check-offs table) with `completedAt` = the click instant and `commitAt = completedAt + undo window` (~5 s, exported once)
**And** the response returns `commitAt`, so the client never hard-codes the window (AD-20)

**Given** the check is pending
**When** the Undo Toast shows "Checked off {Task} · Undo" (glass, accent bar, Secondary Undo button, `aria-live="polite"`)
**Then** it stays visible until `commitAt`
**And** while it's hovered or focused, the client asks the server to hold the pending record and releases the hold when hover or focus ends, so the timer effectively pauses (WCAG 2.2.1, UX-DR31)

**Given** Spencer clicks Undo before commit
**When** the undo request completes
**Then** the pending record is deleted, the row returns, and nothing is written to Notion or the Completion Log

**Given** a pending record reaches `commitAt`
**When** the server's commit timer runs, or the startup sweep finds an overdue record
**Then** it commits in fixed order: first `recordCompletion` (`source: 'check-off'`), then `setTaskStatus(completed)` as a Status-only write (FR-23 amended), regardless of whether the browser tab still exists

**Given** the Notion Status write fails at commit
**When** the commit runs
**Then** the Completion Log entry is kept, the Notion sync is marked pending and retried on the next sweep, and an `operational` notification says "Couldn't update Notion for {Task} — retrying"
**And** `[ASSUMPTION: architecture wins over UX's "row returns"]` the row does not reappear, because Yoh's record says it's done

**Given** Spencer checks off several Tasks in quick succession
**When** the toasts would overlap
**Then** `[ASSUMPTION: resolves UX OQ7]` each check-off gets its own pending record and commits independently, and the toast shows the most recent one; its Undo undoes only that one

**Given** the Playwright smoke suite
**When** it runs
**Then** it covers check-off → toast → Undo (nothing written) and check-off → commit (Status written, log entry present)

---

## Task 11: Epic 6 retro action items 1–4

**Depends on:** Tasks 1–10 complete (run only if time allows). **Owns:** the four
small fixes below, each in the file that already owns the behavior, plus marking
each item `done` in `sprint-status.yaml`'s `action_items`. Item 7 is left for Epic 8.

Source: `_bmad-output/implementation-artifacts/epic-6-retro-2026-09-24.md`
(findings F4, F5, F6, F2). Action text copied verbatim from `sprint-status.yaml`:

1. `epic-6-retro-item-1-chunk-rich_text-values-into-2000-char-se` — "Chunk rich_text values into <=2000-char segments in resolveCreatePageProperty; classify Notion 400s as validation; add 5000-char FR-29 test (F4)"
2. `epic-6-retro-item-2-do-not-set-lastsearchanswer-on-empty-ans` — "Do not set lastSearchAnswer on empty answers; clear it on search failure (F5)"
3. `epic-6-retro-item-3-route-save-that-to-notion-research-vault` — "Route save-that-to-notion-research-vault phrasing to FR-29 save, not FR-26 create; add regression test (F6)"
4. `epic-6-retro-item-4-delete-unused-toresearchvaultpagepropert` — "Delete unused toResearchVaultPageProperties and its tests, or route FR-29 through it (F2)"

---

## Retrospective note

This plan excludes `epic-7-retrospective` (BMad's optional post-epic ritual).
Update `sprint-status.yaml` per story alongside each task's ledger completion
(`epic-7` → `in-progress` at Task 1's start; each story key → `done` in that
story's commit).
