# Yoh — SDD Implementation Plan

**Derived plan file for superpowers:subagent-driven-development.** This file exists
only so the SDD scripts (`task-brief`, `review-package`) have `## Task N` headings
to key on. It is *not* a new source of requirements — it packages the two approved
planning documents into task-shaped briefs:

- **Spec (binding authority):** `_bmad-output/planning-artifacts/architecture/architecture-YohV1-2026-08-22/ARCHITECTURE-SPINE.md`
- **Plan argument (task/story breakdown):** `_bmad-output/planning-artifacts/epics.md`

Every acceptance-criteria block below is copied verbatim from `epics.md`. Task
numbering = epic order (1→5) then story order within the epic, which is also the
required build order: `types/domain.ts` first (AD-9), then per-epic dependency
direction `shell → rituals → {core, adapters}` (AD-1) with adapters/core built
before the ritual that assembles them, and Epic 2's `slip-bump.ts` /
`escalate-under-strain.ts` built before Epic 3 (night-ritual reuses them) and
Epic 4 (self-check reuses them).

## Global Constraints

These bind every task. Copy the relevant subset into each dispatch's
"global constraints" block — do not paste this whole section into every prompt.

**Design paradigm (AD-1, AD-2):** Functional Core / Imperative Shell. Dependency
direction is strictly `shell → rituals → {core, adapters}`; `adapters → types`
only. Files under `src/core/` import only from `src/types/` and other
`src/core/` files — never from `adapters/`, `rituals/`, or `shell/`. Every
`core/*.ts` file exports pure functions only: same inputs → same outputs, no
reads/writes to module-level variables, no mutation of arguments. Prior state a
function needs is passed in as an explicit parameter, never fetched internally.

**AD-3 — Propose-Don't-Impose:** any function that would suggest a behavior or
budget change returns a `Proposal<T>` (the suggested change, its reason, and a
snapshot/version of the entity it would change) instead of performing it.
`memory-store.ts` persists every open `Proposal` as an open interaction
request. Only `chat-cli.ts`, after an explicit yes/no from Spencer, may call
the matching `apply(proposal)` function — which first re-reads the live entity
and rejects with `YohError.kind: 'stale-proposal'` if its version no longer
matches the snapshot. Does not bind FR-10 (Blocker rescheduling is unconditional).

**AD-4 — Calendar ownership by construction:** `calendar-adapter.ts` writes,
updates, and deletes only within a dedicated "Yoh Plan" secondary calendar;
against the primary calendar it may only read, never insert/update/delete. On
first run it creates the "Yoh Plan" calendar via `Calendars.insert` if it
doesn't already exist, and `token-store.ts` persists the returned calendar ID.
Read access to primary and write access to "Yoh Plan" use separate OAuth
scopes.

**AD-5 — Ritual triggers are independent one-shot subcommands; interaction
requests are durable:** `ritual-cli.ts` exposes four independently
OS-scheduled one-shot subcommands, none blocking for input: `morning`,
`night-prompt`, `night-escalate`, `self-check`. Any that needs an answer
persists it in `memory-store.ts` as an open interaction request, then exits —
it does not wait. `chat-cli.ts` is the single on-demand REPL and the only
place an open interaction request or open `Proposal` gets resolved; on start,
and before accepting an unrelated command, it surfaces any open interaction
requests. Neither shell file contains ritual or core logic itself — both call
into `rituals/*`.

**AD-6 — Escalate-Under-Strain, one shared curve:** `core/escalate-under-strain.ts`
exports exactly `computeEscalation(strainCount: number, curve: EscalationCurve): EscalationLevel`,
both types defined once in `types/domain.ts`. `strainCount` is always a plain
non-negative integer count of consecutive strain events. No consumer
(`slip-bump.ts`, `self-check.ts`, `tone.ts`) derives its own normalized score
or level enum — each supplies only its own `curve` (cap, step).

**AD-7 — Observability:** every `ritual-cli.ts` subcommand wraps its entire
invocation in one top-level handler; any thrown error or `Result` failure
triggers a Pushover alert (via `notification-adapter.ts`) worded distinctly
from a normal notification, before the process exits non-zero. Every
subcommand also checks, on start, that `memory-store.ts` recorded a successful
run of its own previous scheduled occurrence; a missing prior run is itself
treated as a failure and alerted (self-referential dead-man's switch; total
host/scheduler outage is explicitly out of scope).

**AD-8 — Result types across the core/adapter boundary:** every `core/*.ts`
function returns `Result<T, YohError>` and never throws. `adapters/*.ts`
functions may throw on I/O failure; `rituals/*.ts` is the only layer allowed to
catch an adapter's throw and convert it into a `Result` failure or an AD-7
alert. `YohError.kind` includes at minimum: `missing-field`, `auth-expired`,
`unreachable`, `rate-limited`, `validation`, `stale-proposal`, `conflict`.

**AD-9 — File-level task ownership, shared types locked first:** every
behavior has exactly one file as its home; a new capability gets a new file,
never a bolt-on to a file owned by a different capability. `types/domain.ts`
is authored/locked before any file that imports from it. `PlanBlock` carries a
stable `id`; every reference addresses it by `id`, never array position.

**AD-10 — Storage split by concern:** `memory-store.ts` owns hot/cold memory
and all open interaction requests/Proposals. `token-store.ts` owns the Google
OAuth refresh token and is the sole constructor/holder of the `OAuth2Client` —
`calendar-adapter.ts` receives an already-authenticated client as a parameter
and never imports `google-auth-library` itself. `token-store.ts` rewrites the
refresh token to disk immediately after every refresh. Static secrets load
once from env vars at process start. Every multi-step read-modify-write
sequence in `memory-store.ts` runs inside a single SQLite transaction with
optimistic concurrency (a version/`updated_at` column checked on write),
surfacing a conflicting write as `YohError.kind: 'conflict'`.

**AD-11 — Data-Completeness Gate at the type level:** `data-completeness-gate.ts`
is the only function that produces a `CompleteTask` from a raw `Task`. Every
function downstream (`derived-priority.ts`, `work-break-fit.ts`,
`plan-reasoning.ts`) accepts `CompleteTask`, never `Task`, in its signature.

**AD-12 — Notion write surface is Status-only:** `notion-adapter.ts` exposes
exactly one write function, `setTaskStatus(taskId: string, status: TaskStatus): Promise<Result<void, YohError>>` —
no generic "update Task property" function exists.

**Conventions:** kebab-case filenames; one primary export per `core/`/`adapters/`
file, named to match the file. Dates: ISO-8601 UTC internally in `core/` and
storage, converted to local timezone only at the `shell/`/notification edge.
IDs: Notion page IDs and Google Calendar event IDs are opaque strings, never
parsed. Logging: single-line structured JSON to stderr, one line per ritual
step. External state changes only through an adapter call — `core/` and
`rituals/` never mutate external state directly.

**Stack:** Node.js 24.12+ (native TS type-stripping, no build step),
TypeScript 7.0.2 (`tsc --noEmit` type-check only), `@notionhq/client` ^5.22.0,
`@googleapis/calendar` ^16.0.0, `google-auth-library` ^11.0.2,
`better-sqlite3` ^13.0.3, `nodemailer` ^9.0.5, `@anthropic-ai/sdk` ^0.120.0,
`node:test`/`node:assert` (built-in, no separate dependency), Pushover via
Node's built-in `fetch` (no SDK).

**Structural Seed (file ownership map):**
```
src/
  core/derived-priority.ts        # FR-2 (consumes CompleteTask)
  core/slip-bump.ts               # FR-11
  core/time-budget.ts             # FR-5, FR-7
  core/work-break-fit.ts          # FR-6, FR-8 (consumes CompleteTask)
  core/data-completeness-gate.ts  # FR-4 — sole producer of CompleteTask
  core/escalate-under-strain.ts   # AD-6 shared curve
  core/tone.ts                    # FR-18, FR-19
  core/plan-reasoning.ts          # FR-3 (consumes CompleteTask)
  rituals/morning-ritual.ts       # FR-1
  rituals/night-ritual.ts         # FR-12-14
  rituals/mid-day-reflow.ts       # FR-9-10
  rituals/self-check.ts           # FR-17
  adapters/notion-adapter.ts      # FR-20, FR-23 (Status-only write, AD-12)
  adapters/calendar-adapter.ts    # FR-21, FR-22 (secondary-calendar write, AD-4)
  adapters/notification-adapter.ts # Pushover
  adapters/email-adapter.ts       # nodemailer — FR-13 second attempt
  adapters/llm-adapter.ts         # Claude API — chat intent routing + Tone
  adapters/memory-store.ts        # better-sqlite3: hot/cold memory, interaction requests/Proposals
  adapters/token-store.ts         # better-sqlite3: sole OAuth2Client holder, refresh-token persistence
  shell/ritual-cli.ts             # `yoh ritual morning|night-prompt|night-escalate|self-check`
  shell/chat-cli.ts               # `yoh chat` — on-demand persistent REPL
  types/domain.ts                 # Task, CompleteTask, Plan, PlanBlock, TimeBudget, Proposal<T>,
                                   # EscalationCurve, EscalationLevel, Result<T,E>, YohError
```

**Ruling — Story 1.2's live-account OAuth steps cannot be automated.**
Creating a Google Cloud project, flipping its OAuth consent screen to
"In production", and creating a live Notion integration all require Spencer's
own account access, which no subagent has. Task 2 below implements the code
(`token-store.ts`, `memory-store.ts`) and does the *docs-verification* items
(current Notion auth pattern, current Notion API version, exact 2026 Calendar
OAuth scope names, service-account-vs-user-consent confirmation) via public-web
research, writing the findings into code comments and a `SETUP.md` runbook.
The account-side actions (create GCP project, flip consent screen, create
Notion integration, obtain real tokens) are written into `SETUP.md` as
Spencer's manual prerequisite before any adapter can run against real APIs —
this does not block building or testing the adapters against a mocked client,
which is how every subsequent Notion/Calendar-touching task is implemented and
tested. **Cost if wrong:** none beyond what's already true — Spencer must
complete real OAuth setup manually regardless of this ruling; nothing here
changes that.

---

## Task 1: Story 1.1 — Project Scaffold & Shared Domain Types

**Depends on:** nothing (first task). **Owns:** entire repo scaffold;
`package.json`; `tsconfig.json`; `src/core/`, `src/rituals/`, `src/adapters/`,
`src/shell/`, `src/types/` directories; `src/types/domain.ts`; initial
`node:test` wiring and one trivial passing test.

As a developer building Yoh,
I want the project scaffold and shared domain types in place exactly as the Architecture Spine specifies,
So that every subsequent story has a stable, conflict-free foundation to build on.

**Acceptance Criteria:**

**Given** a fresh checkout of the Yoh repository
**When** the project scaffold is created
**Then** the `src/core/`, `src/rituals/`, `src/adapters/`, `src/shell/`, and `src/types/` directories exist matching the Architecture Spine's Structural Seed
**And** `types/domain.ts` exports `Task`, `CompleteTask`, `Plan`, `PlanBlock` (with a stable `id`), `TimeBudget`, `Proposal<T>`, `EscalationCurve`, `EscalationLevel`, `Result<T,E>`, and `YohError` (with at least `missing-field`, `auth-expired`, `unreachable`, `rate-limited`, `validation`, `stale-proposal`, `conflict` kinds)
**And** no other file in the tree locally redeclares, widens, or shadows a type `domain.ts` already exports
**And** `node:test` is wired up and a trivial passing test runs via `tsc --noEmit` + `node --test`
**And** `package.json` pins Node 24.12+ and the dependencies listed in the Architecture Spine's Stack table

**Note for implementer:** `Task` and `CompleteTask` need fields for Estimated
Duration, Area, Due Date, Status, Energy per FR-4/FR-1; `Task` has these as
optional/possibly-missing, `CompleteTask` has them required — the shape the
Data-Completeness Gate (Task 5 below) produces. `TaskStatus` (used by
`setTaskStatus`, AD-12) should include at least `completed` and `slipped`
states, plus whatever a not-yet-closed Task needs. Add fields as later tasks'
acceptance criteria require them, but do not let later tasks redeclare types —
extend `domain.ts` itself if a real gap shows up (flag it in the report rather
than silently improvising a parallel type).

---

## Task 2: Story 1.2 — Google & Notion Credential Setup and Storage Bootstrap

**Depends on:** Task 1 (`types/domain.ts`). **Owns:** `src/adapters/token-store.ts`,
`src/adapters/memory-store.ts` (initial schema/bootstrap only — later tasks
extend memory-store's surface for their own concerns), `.env.example`,
`SETUP.md`.

As Spencer,
I want Yoh's OAuth credentials, refresh-token storage, and local database bootstrapped and verified against current provider docs,
So that later stories can read/write my real Notion and Calendar data without hitting an auth dead end at launch.

**Acceptance Criteria:**

**Given** a Google Cloud project and a Notion integration have been created
**When** Yoh's OAuth setup is completed
**Then** the Google OAuth consent screen is confirmed set to "In production" (not "Testing"), preventing the 7-day silent refresh-token expiry
**And** the current Notion auth pattern (internal integration token vs. any newer OAuth requirement) has been confirmed against live Notion docs and matches AD-10's static-secret assumption
**And** it's confirmed Yoh is using OAuth 2.0 user consent (not a service account) to access Spencer's personal @gmail.com calendar
**And** the current Notion API version and the exact 2026 Google Calendar OAuth scope names (primary read-only / "Yoh Plan" write split) have been checked against live docs, not assumed from stale research

**Given** the above credentials exist
**When** `token-store.ts` is implemented
**Then** it is the sole constructor/holder of the `OAuth2Client`, and rewrites the refresh token to disk immediately after every refresh
**And** static secrets (Notion token, Google client id/secret, Pushover key, SMTP credentials, Claude API key) load once from environment variables at process start

**Given** `memory-store.ts` is implemented
**Then** it initializes its SQLite schema on first run and wraps every multi-step read-modify-write sequence in a single transaction with an optimistic-concurrency `updated_at`/version check, surfacing a conflicting write as `YohError.kind: 'conflict'`

**Per the Global Constraints ruling above:** the "confirmed"/"checked against
live docs" clauses are satisfied by (a) doing the actual public-docs research
for the Notion auth pattern, Notion API version, Calendar OAuth scope names,
and service-account-vs-user-consent question, recording findings with source
links in `SETUP.md` and as comments near where each is used in code; (b) the
GCP-console/consent-screen/integration-creation actions are Spencer's own
manual steps — write them as an explicit numbered runbook in `SETUP.md`
("before running Yoh against real APIs, do X/Y/Z"). `token-store.ts` and
`memory-store.ts` must be fully implemented and unit-testable without real
credentials (construct an `OAuth2Client` from env-var-shaped config; tests use
fake/placeholder env values, not a live account).

---

## Task 3: Story 1.3 — Read Notion Tasks and Projects

**Depends on:** Task 1 (types), Task 2 (`token-store.ts` env-var secret loading
pattern). **Owns:** `src/adapters/notion-adapter.ts` (read surface only —
Task 19/Epic 3 adds the Status-only write function to this same file, so leave
room, don't preclude it).

As Spencer,
I want Yoh to read my current Notion Tasks and Projects,
So that planning always reflects what's actually in my Notion workspace, not a stale copy.

**Acceptance Criteria:**

**Given** Spencer's Notion workspace has Task records with Estimated Duration, Area, Due Date, Status, and Energy set
**When** `notion-adapter.ts`'s read function runs
**Then** it returns every current Task with those five planning-relevant fields, plus its Project grouping
**And** a Task field changed in Notion since the last read is reflected the next time this function runs, with no manual re-sync step
**And** Projects are returned as organizational metadata only — nothing about them feeds priority or scheduling in this story

**Implementer note (AD-8):** use `@notionhq/client` behind an injectable
client parameter (constructor or function argument) so tests can supply a
fake/mock client — no live Notion account is available in this environment.
`notion-adapter.ts` is an `adapters/*.ts` file: per AD-8 it may throw on I/O
failure and must NOT return `Result` itself — let SDK/network errors
propagate as thrown exceptions. It is `rituals/*.ts` (the caller, in a later
task) that catches the throw and converts it into a `Result` failure or an
AD-7 alert. Do not wrap this function's return type in `Result` here.

---

## Task 4: Story 1.4 — Read Google Calendar Events as Fixed Plan Anchors

**Depends on:** Task 1 (types), Task 2 (`token-store.ts`). **Owns:**
`src/adapters/calendar-adapter.ts` (read surface only — Task 12/Story 1.12
adds the "Yoh Plan" write surface to this same file).

As Spencer,
I want Yoh to read today's Google Calendar events,
So that the Plan is built around my real fixed commitments, not blind to them.

**Acceptance Criteria:**

**Given** Spencer's primary Google Calendar has one or more events scheduled for today
**When** `calendar-adapter.ts`'s read function runs
**Then** it returns every one of today's events with start/end time
**And** it only reads from the primary calendar — no insert/update/delete call is made against it (enforced by using only the read-scoped client)
**And** an event added or changed on the primary calendar before this read runs is included in that read's result

**Implementer note (AD-10):** `calendar-adapter.ts` receives an
already-authenticated `OAuth2Client` as a parameter — it must never import
`google-auth-library` itself. Use `@googleapis/calendar` behind an injectable
client for testability; no live Google account is available here.

---

## Task 5: Story 1.5 — Data-Completeness Gate — Prompt for Missing Task Fields

**Depends on:** Task 1 (types), Task 2 (`memory-store.ts` for persisting
interaction requests). **Owns:** `src/core/data-completeness-gate.ts`; adds
the "open interaction request" read/write surface to `memory-store.ts`
(coordinate shape with Task 2's schema — extend, don't fork it); a minimal
`src/shell/chat-cli.ts` that, on start, surfaces any open interaction request
before accepting other input (later tasks — 11, 19, 22, 23 — extend
`chat-cli.ts` further; this task only needs enough to demonstrate the
prompt-surfacing pattern).

As Spencer,
I want Yoh to ask me for exactly the Task fields it's missing before planning around that Task,
So that I never get a Plan silently built on a guess, and never lose a Task to silent omission.

**Acceptance Criteria:**

**Given** a Task in today's candidate set is missing one of Estimated Duration, Area, Due Date, Status, or Energy
**When** `data-completeness-gate.ts` runs
**Then** that Task does not produce a `CompleteTask` value, and no other planning function ever receives it as a `Task`
**And** an open interaction request is persisted in `memory-store.ts` naming exactly the missing field(s) on exactly that Task

**Given** an open interaction request exists for a missing field
**When** Spencer next opens `chat-cli.ts`
**Then** it surfaces that request before accepting any unrelated command, with an accent-colored prompt line naming what's needed (UX-DR5, UX-DR10)
**And** if more than one Task is incomplete, one prompt covers all of them rather than one prompt per Task

**Given** Spencer answers the missing field
**When** the answer is provided
**Then** the Task becomes eligible to produce a `CompleteTask` on the next gate run, and the interaction request is cleared

**Given** an open prompt of any kind (this one included)
**Then** it waits indefinitely for Spencer's response — no timeout expires it; this establishes the prompt-waiting pattern reused by every later prompt (Night close-out, Self-Check, Propose-Don't-Impose) (UX-DR20)

**Implementer note (AD-11):** `data-completeness-gate.ts` is the *only*
function anywhere in the codebase allowed to produce a `CompleteTask` from a
`Task`. It's a pure `core/*.ts` function — `Result<T, YohError>`, no I/O; the
persisting-to-`memory-store` and prompt-rendering happen in the caller
(`chat-cli.ts` for the prompt; wire the gate's "missing field" output into an
interaction-request write via `memory-store.ts`, called from `shell/` or a
thin ritual, not from the gate itself — the gate must stay pure per AD-2).

---

## Task 6: Story 1.6 — Time Budget Declaration and Persistence

**Depends on:** Task 1 (types), Task 5 (`chat-cli.ts` skeleton, `memory-store.ts`
interaction-request pattern for reference — this task adds a plain
declare/persist path, not an interaction request). **Owns:**
`src/core/time-budget.ts`; extends `chat-cli.ts` with a Time Budget
declare/change command path; extends `memory-store.ts` with a
"today's Time Budget" read/write (day-scoped, persists across days including
weekends until explicitly changed).

As Spencer,
I want to declare or change how much time I have available today via chat,
So that Yoh fits my Plan to my real day instead of an assumed default.

**Acceptance Criteria:**

**Given** Spencer has not yet declared a Time Budget
**When** he sets one via `chat-cli.ts`
**Then** `time-budget.ts` persists it in `memory-store.ts` as today's value

**Given** a Time Budget was set on a prior day
**When** a new day begins, including across a weekend boundary
**Then** the same value persists as today's Time Budget until Spencer explicitly changes it again — it never silently reverts to a different default

**Given** Yoh has a suggested Time Budget change to propose
**When** that suggestion is generated
**Then** it is returned as a `Proposal<T>` (per AD-3) rather than applied directly — this story only covers Spencer's own explicit declaration path, not proposal application (Epic 4)

**Implementer note:** `time-budget.ts` itself should be pure (validates/shapes
the declared value, computes "does today already have one carried forward");
the actual read/write against `memory-store.ts` happens in `chat-cli.ts` or a
thin wiring function, per AD-1/AD-2.

---

## Task 7: Story 1.7 — Derived Priority Ordering

**Depends on:** Task 1 (types), Task 5 (`CompleteTask` shape, AD-11). **Owns:**
`src/core/derived-priority.ts`.

As Spencer,
I want my Tasks ordered automatically by an intelligent priority, never something I have to set myself,
So that the Plan always leads with what actually matters most today.

**Acceptance Criteria:**

**Given** two `CompleteTask`s with identical Estimated Duration and Area but different Due Dates
**When** `derived-priority.ts` orders them
**Then** the one with the closer Due Date is ordered first

**Given** a `CompleteTask` with a closer Due Date but a much larger Estimated Duration, compared to a smaller, later-due Task
**When** they are ordered
**Then** the closer-due Task is not automatically ranked ahead purely on proximity — duration weighs into the primary axis

**Given** two `CompleteTask`s tied on the primary axis
**When** they are ordered
**Then** Area, Energy fit, and difficulty (started as an even-split weighting) break the tie

**Given** the system's ordering
**When** Spencer looks for a way to manually set a Task's position
**Then** no such UI or interaction path exists — only the underlying inputs (Estimated Duration, Due Date, etc.) are editable

**Implementer note:** FR-2's secondary-factor weights (Area/Energy fit/difficulty)
start as an even split (1/3 each) per the Architecture Spine's Deferred
section — hardcode that starting value with a comment noting it's the
documented starting point, tunable later. Accepts a Slip-Bump input too
(consumed as an explicit parameter per AD-2, not fetched — Task 20/Story 2.5
is what actually computes it; this task should accept an already-computed
bump value/level as an optional parameter it factors in, defaulting to
"no bump" so this task doesn't have a forward dependency on Task 20).

---

## Task 8: Story 1.8 — Work/Break Block Fitting Within Time Budget

**Depends on:** Task 1 (types), Task 6 (Time Budget shape), Task 7 (Derived
Priority ordering, consumed as input). **Owns:** `src/core/work-break-fit.ts`.

As Spencer,
I want my Tasks fitted into clock-based work/break blocks that scale with how much time I actually have,
So that today's Plan is realistic, not padded or overstuffed.

**Acceptance Criteria:**

**Given** a declared Time Budget and a Derived-Priority-ordered list of `CompleteTask`s
**When** `work-break-fit.ts` runs
**Then** Tasks are fitted into 70-minutes-work/15-minutes-break blocks by default, split across multiple blocks if a Task is larger than one block
**And** a Task in progress at the 70-minute mark is split, not extended — block boundaries are strictly clock-based
**And** the 70/15 ratio is overridable by Spencer

**Given** a larger declared Time Budget compared to a shorter one
**When** blocks are fitted for each
**Then** the larger-budget day produces proportionally more Work/Break Blocks using the same ratio

**Given** a Task that cannot fit in the remaining Time Budget for today
**When** fitting completes
**Then** it is deferred (left eligible for a future Plan) rather than force-fit into today

**Implementer note (AD-9):** every `PlanBlock` produced must carry a stable
`id` and be addressed by that `id` everywhere — never by array position. This
function also needs to fit fixed Calendar events (Task 4's read output) in as
immovable anchors around which Work/Break Blocks are placed — accept them as
an explicit parameter.

---

## Task 9: Story 1.9 — Plan Reasoning Line

**Depends on:** Task 7 (Derived Priority), Task 8 (fitted Plan). **Owns:**
`src/core/plan-reasoning.ts`.

As Spencer,
I want a one-line, honest reason for what leads today's Plan,
So that I can trust the ordering instead of wondering why it picked what it picked.

**Acceptance Criteria:**

**Given** a completed, ordered Plan
**When** `plan-reasoning.ts` generates the reasoning line
**Then** it references the actual Derived Priority factors that produced the lead item's position (e.g., "due soonest, biggest chunk") — never a generic or static string
**And** the line is rendered in `{colors.muted}` directly under the block list, not interleaved with it (UX-DR4)

**Implementer note:** `plan-reasoning.ts` itself only produces the reasoning
*text* (pure `core/*.ts`, per AD-11 consumes `CompleteTask`/the ordering
factors) — the actual muted-color rendering/placement is the renderer's job,
exercised properly in Task 10 (Story 1.10) which is the first task that
assembles and delivers a full rendered Plan. This task's tests should assert
on the returned string's content (references real factors), not on ANSI
codes.

---

## Task 10: Story 1.10 — Generate and Deliver the Morning Plan

**Depends on:** Tasks 3, 4, 5, 6, 7, 8, 9 (this is the first `rituals/*.ts`
task — it assembles every `core/`+`adapters/` piece built so far). **Owns:**
`src/rituals/morning-ritual.ts`; `src/adapters/notification-adapter.ts`
(Pushover); `src/shell/ritual-cli.ts` (introduces the file with its `morning`
subcommand only — Epic 3/5 add the other three subcommands); a Plan renderer
(place it in `morning-ritual.ts` or a small renderer module `rituals/` owns —
implementer's call, but it must not leak into `core/`).

As Spencer,
I want one single notification each morning with my full ordered Plan and its reasoning,
So that I start the day with everything I need, without opening an app or reconciling anything myself.

**Acceptance Criteria:**

**Given** today's Tasks have passed the Data-Completeness Gate, been ordered by Derived Priority, and fitted into Work/Break Blocks around today's fixed Calendar events
**When** `ritual-cli.ts morning` runs (OS-cron-triggered, one-shot, non-blocking per AD-5)
**Then** exactly one Pushover notification is sent containing the ordered Plan and its reasoning line
**And** fixed Calendar events appear as immovable anchors in the Plan, never as Plan Blocks Yoh could reschedule
**And** the Plan block list renders per `DESIGN.md`: accent-colored label, one line per block (time range + item, nothing else), no emoji/ASCII art/celebratory flourish (UX-DR1, UX-DR3, UX-DR7, UX-DR8)
**And** output wraps at ~80 characters, one blank line separates each structural unit, and no box-drawing characters or ASCII dividers are used (UX-DR2)
**And** output is plain monospace text only (no image-only content), and every color cue used is paired with plain-text wording that carries the same meaning without it (UX-DR20)

**Given** the Morning Ritual has already run once today
**When** it is triggered again the same day
**Then** no second Plan-generation notification is sent

**Implementer note:** read the color tokens and layout conventions from
`_bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/DESIGN.md`
(accent `#5FAFFF`, attention `#D08A3E`, muted `#6B6B6B`, terminal-inherited
default body) with graceful ANSI/no-color degradation. `notification-adapter.ts`
talks to Pushover via `fetch` (no SDK, per Stack) — inject the HTTP call so
tests don't hit the network. `ritual-cli.ts morning` is the AD-8 boundary:
catch adapter throws here and convert to `Result` failures / structured log
lines (full AD-7 alerting is Epic 5 — this task just needs the try/catch
shape in place, not the Pushover failure-alert itself).

---

## Task 11: Story 1.11 — On-Demand Plan View via Chat

**Depends on:** Task 10 (`morning-ritual.ts`'s renderer/Plan shape). **Owns:**
extends `src/shell/chat-cli.ts` with an on-demand Plan-view intent (routes
free-text like "what's my plan").

As Spencer,
I want to ask Yoh for today's Plan any time from the terminal,
So that I can check it again without waiting for or hunting down the original notification.

**Acceptance Criteria:**

**Given** a Plan has already been generated for today
**When** Spencer asks `chat-cli.ts` something like "what's my plan"
**Then** it displays the same ordered Plan and reasoning line, rendered per `DESIGN.md` (UX-DR18)

**Given** no Plan has been generated yet for today
**When** Spencer asks for the Plan
**Then** Yoh says so plainly rather than fabricating one or erroring silently

**Implementer note:** this task doesn't need full NLU/LLM routing yet (that
scaffold is Story 2.1/Task 13) — a simple substring/keyword match against a
few phrasings ("plan", "what's my plan", "show plan") is sufficient here;
Task 13 replaces or wraps this with `llm-adapter.ts` intent routing without
changing this task's observable behavior.

---

## Task 12: Story 1.12 — Write Plan Blocks to a Dedicated "Yoh Plan" Calendar

**Depends on:** Task 4 (`calendar-adapter.ts` read surface — this task adds to
the same file), Task 10 (Plan Block shape being written). **Owns:** extends
`src/adapters/calendar-adapter.ts` with the "Yoh Plan" write surface; extends
`token-store.ts` to persist the created "Yoh Plan" calendar ID.

As Spencer,
I want Yoh's Plan written to my calendar without ever touching an event I created,
So that I can see my day laid out visually and trust my real calendar stays untouched.

**Acceptance Criteria:**

**Given** no "Yoh Plan" calendar exists yet on Spencer's Google account
**When** `calendar-adapter.ts` runs for the first time
**Then** it creates a dedicated "Yoh Plan" secondary calendar via the Calendars.insert API, and `token-store.ts` persists the returned calendar ID

**Given** today's Plan Blocks
**When** they are written to Calendar
**Then** every insert/update/delete call targets only the "Yoh Plan" calendar — never the primary calendar (enforced by separate OAuth scopes, not just a runtime check)

**Given** a prior day's Plan Block events already exist in "Yoh Plan"
**When** a new day's Plan is generated
**Then** those prior events remain untouched as passive history — they are not deleted as a side effect of writing the new Plan

**Implementer note (AD-4):** structure the injectable Calendar client so the
primary-read and "Yoh Plan"-write paths use genuinely separate scoped clients
in the type signature (e.g. two distinct client parameters/types), so a
coding mistake that tried to write the primary fails to type-check, not just
to review.

---

## Task 13: Story 2.1 — Persistent Chat Session & Natural-Language Routing

**Depends on:** Task 11 (`chat-cli.ts` REPL skeleton). **Owns:**
`src/adapters/llm-adapter.ts` (new file — Claude API intent routing); replaces
Task 11's keyword-match Plan-view routing with real intent routing through
this adapter (same observable behavior, now LLM-routed).

As Spencer,
I want a persistent, free-text chat session I can open any time and talk to naturally,
So that I can trigger re-flows, report blockers, or ask questions without memorizing commands.

**Acceptance Criteria:**

**Given** Spencer runs `yoh chat`
**When** the session starts
**Then** it opens as a persistent REPL (not a one-shot command) that accepts free-text input, not a fixed command grammar (UX-DR9)
**And** `llm-adapter.ts` routes each input to the correct intent (this story wires the routing scaffold; individual intents like Mid-Day Re-Flow and Blocker reports are implemented in later stories of this epic)

**Given** the Morning Plan has already been delivered and Spencer has not initiated anything
**When** time passes with no input from Spencer
**Then** Yoh produces no ambient "still here" or check-in output — silence between Spencer-initiated interactions is the default behavior (UX-DR17)

**Given** Spencer asks a general/factual question with no matching specific intent
**When** `llm-adapter.ts` responds
**Then** it still returns a response (routed as a general Q&A intent) rather than erroring or refusing

**Implementer note:** use `@anthropic-ai/sdk` behind an injectable client so
tests don't hit the real API (no live Claude API key is available in this
environment — mock the client's response shape). "No ambient output" is
naturally true of a REPL that only reacts to input events; a test asserting
"no output written between two input events with a fake timer/clock advance"
is sufficient evidence, no literal polling loop needed.

---

## Task 14: Story 2.2 — Default and Contextual Tone

**Depends on:** Task 13 (`llm-adapter.ts` routing scaffold). **Owns:**
`src/core/tone.ts`.

As Spencer,
I want Yoh to talk like a competent peer by default, and switch to a plain factual register for factual questions,
So that it never reads as corporate, sycophantic, or "AI-ey."

**Acceptance Criteria:**

**Given** Spencer sends a casual, conversational message
**When** `tone.ts` governs the response
**Then** the reply reads in a casual, peer-level register — no unearned enthusiasm, no filler preamble

**Given** Spencer asks a factual or intellectual question
**When** `tone.ts` governs the response
**Then** it switches to a concise/educational register and avoids the "it's not just X, it's Y" rhetorical framing

**Given** any response Yoh sends
**Then** it never uses corporate or assistant-boilerplate phrasing

**Implementer note:** `tone.ts` is a pure `core/*.ts` file per AD-1/AD-2 — it
cannot call the Claude API itself. Its job is to classify/select a register
(e.g. return a system-prompt fragment, register enum, or instruction string)
that `llm-adapter.ts` (Task 13's file) then uses when calling Claude. Tests
here assert on `tone.ts`'s pure classification output, not on actual LLM
prose. This task only covers the *default/contextual* half of Tone — the
Escalate-Under-Strain-driven urgency half is Task 18/Story 2.6, added to this
same file once `escalate-under-strain.ts` exists (Task 17).

---

## Task 15: Story 2.3 — User-Initiated Mid-Day Re-Flow

**Depends on:** Task 8 (`work-break-fit.ts`, re-used for re-fitting), Task 13
(`llm-adapter.ts`/chat routing to trigger it). **Owns:**
`src/rituals/mid-day-reflow.ts`.

As Spencer,
I want to tell Yoh a Task ran long or got skipped and have the rest of my day re-fit instantly,
So that I don't have to manually rebuild my schedule by hand.

**Acceptance Criteria:**

**Given** a Morning Plan is in progress with some Plan Blocks not yet completed
**When** Spencer triggers a Mid-Day Re-Flow via chat
**Then** `mid-day-reflow.ts` recomputes only the remaining, not-yet-completed Plan Blocks for today — it does not touch already-completed blocks or re-explain the whole day
**And** the updated remainder is shown in one short block (UX-DR11)

**Given** no code path exists for Yoh to initiate this itself
**Then** Mid-Day Re-Flow only ever runs in direct response to Spencer's own trigger — never proactively

**Implementer note:** re-fitting reuses `work-break-fit.ts` (Task 8) against
only the not-yet-completed subset of `PlanBlock`s, addressed by `id` (AD-9) —
`mid-day-reflow.ts` is the orchestration layer (`rituals/*.ts`) that slices
the Plan and calls back into the pure fitting function; it must not
reimplement fitting logic itself (AD-1).

---

## Task 16: Story 2.4 — Logistics-Only Blocker Handling

**Depends on:** Task 15 (`mid-day-reflow.ts`, since a Blocker report also
reschedules affected blocks). **Owns:** extends `src/rituals/mid-day-reflow.ts`
with the Blocker-report path (same file — Blocker handling is a variant of
mid-day rescheduling, per the Capability Map's Epic 2 grouping and AD-3's own
note that FR-10 is unconditional/automatic, unlike a Proposal).

As Spencer,
I want to report a logistical blocker and have Yoh just reschedule around it,
So that I don't get a discussion or unsolicited advice about something I didn't ask Yoh to solve.

**Acceptance Criteria:**

**Given** Spencer reports a Blocker in plain language (e.g., "meeting ran over")
**When** the blocker-handling path processes it
**Then** affected Plan Blocks are rescheduled around it
**And** the response is limited to a single confirmation line describing the schedule change — no suggestions for resolving the underlying obstacle, no commentary or judgment (UX-DR12, FR-10)

**Implementer note (AD-3):** per the Global Constraints AD-3 note, FR-10 is
explicitly *not* bound by Propose-Don't-Impose — reschedule immediately and
automatically, no `Proposal<T>`, no confirmation gate. Only the rendered
response is constrained (one confirmation line, nothing else).

---

## Task 17: Story 2.5 — Slip-Bump — Escalating Priority for Slipped Tasks

**Depends on:** Task 1 (types — this task adds `EscalationCurve`/`EscalationLevel`
if Task 1 didn't already stub them; coordinate by extending `domain.ts`, never
redeclaring). **Owns:** `src/core/escalate-under-strain.ts` (new file, AD-6
shared curve); `src/core/slip-bump.ts`; extends `chat-cli.ts` with a
"why is X prioritized" lineage-view intent.

As Spencer,
I want a Task that slips to automatically earn a fair, growing priority bump the more it slips,
So that repeatedly-slipping work doesn't quietly fall further behind.

**Acceptance Criteria:**

**Given** `core/escalate-under-strain.ts` does not yet exist
**When** this story is implemented
**Then** it exports exactly `computeEscalation(strainCount: number, curve: EscalationCurve): EscalationLevel` per AD-6, with both types defined once in `types/domain.ts`

**Given** a Task slips for the first time
**When** `slip-bump.ts` computes its bump using that shared curve
**Then** it receives a small priority increase toward tomorrow's Plan

**Given** a Task slips on a third consecutive day
**When** the bump is computed
**Then** it is larger than after the first or second slip, up to a defined maximum it never exceeds regardless of further consecutive slips

**Given** a Task slipped once and then completes the next day
**When** its state is next evaluated
**Then** its Slip-Bump is cleared, not carried indefinitely

**Given** Spencer asks "why is X prioritized today" about a Task with slip history
**When** chat-cli responds
**Then** it can show that Task's Slip-Bump lineage (UX-DR19)

**Implementer note:** the curve's starting shape per the Architecture Spine's
Deferred section: small bump on slip 1, ~double on slip 2, cap by slip 3–4 —
hardcode `slip-bump.ts`'s own `EscalationCurve` (cap, step) to that starting
shape with a comment noting it's tunable later. This is the task that makes
Task 7's optional bump parameter in `derived-priority.ts` real — if Task 7
left a TODO/seam for it, wire it here.

---

## Task 18: Story 2.6 — Tone Escalation Tied to Escalate-Under-Strain

**Depends on:** Task 14 (`tone.ts`'s default/contextual half), Task 17
(`escalate-under-strain.ts`, `slip-bump.ts`). **Owns:** extends
`src/core/tone.ts` (same file as Task 14 — this is the escalation half of the
same capability).

As Spencer,
I want Yoh's urgency to rise only when a Task is actually slipping repeatedly, never at random or on a schedule,
So that its tone always matches real strain, not mood or day of week.

**Acceptance Criteria:**

**Given** two days with identical slip history for a Task
**When** `tone.ts` computes the Tone escalation level for each, using `computeEscalation` with the Task's current Slip-Bump level as `strainCount`
**Then** both days produce the identical Tone escalation level, regardless of which day of the week or how much time has passed

**Given** no slip/strain signal exists for a Task
**When** Yoh discusses it
**Then** no elevated urgency language appears

**Given** Tone escalation is active for a Task
**Then** it never triggers from a fixed schedule, randomness, or session mood — only from the shared Escalate-Under-Strain computation

**Implementer note:** `tone.ts` supplies its own `curve` to
`computeEscalation` (AD-6 — cap/step distinct from `slip-bump.ts`'s own
curve, even though both consume the same Task strainCount input). Keep it
pure and deterministic — same `strainCount` + same `curve` in, same
`EscalationLevel` out, no clock/randomness inside `tone.ts` itself.

---

## Task 19: Story 3.1 — Night Ritual Close-Out Prompt & Status Write-Back

**Depends on:** Task 10 (Plan/`PlanBlock` shape), Task 3 (`notion-adapter.ts`
read surface — this task adds the write surface to the same file), Task 17
(`slip-bump.ts`, since a close-out-confirmed slip must trigger the same
computation). **Owns:** `src/rituals/night-ritual.ts` (new file); extends
`src/adapters/notion-adapter.ts` with `setTaskStatus` (AD-12, the adapter's
*only* write function); extends `src/shell/ritual-cli.ts` with the
`night-prompt` subcommand; extends `chat-cli.ts` to surface and resolve the
close-out prompt.

As Spencer,
I want Yoh to ask me once per day what got done and what slipped, and have that recorded both internally and in Notion,
So that tomorrow's Plan starts from an honest, synced state.

**Acceptance Criteria:**

**Given** today's Plan has run its course
**When** `ritual-cli.ts night-prompt` runs (one-shot, non-blocking per AD-5)
**Then** it persists an open interaction request asking Spencer to confirm what completed/slipped for each Plan Block, and exits without waiting

**Given** that open interaction request exists
**When** Spencer next opens `chat-cli.ts`
**Then** it surfaces the close-out prompt first and accepts Spencer's per-block completed/slipped answers

**Given** Spencer confirms a Task's status
**When** the confirmation is processed
**Then** `notion-adapter.ts`'s `setTaskStatus` writes that same status (completed or slipped) to the Task's Status field in Notion, and no other Task field is modified as a side effect
**And** the recorded close-out data feeds Derived Priority, Slip-Bump, and memory for subsequent days

**Given** a Task is confirmed slipped at close-out rather than caught earlier via a Mid-Day Re-Flow report
**When** the confirmation is processed
**Then** it receives its Slip-Bump via the same shared `slip-bump.ts` computation introduced in Epic 2 (Story 2.5), exactly as a mid-day-reported slip would — Night Ritual close-out is Slip-Bump's guaranteed, authoritative trigger; Mid-Day Re-Flow is the earlier, optional one

**Implementer note (AD-12):** `setTaskStatus(taskId: string, status: TaskStatus): Promise<Result<void, YohError>>`
is the exact signature — no generic "update Task property" function should
exist in `notion-adapter.ts` alongside it.

---

## Task 20: Story 3.2 — Capped Escalating Retry via Email

**Depends on:** Task 19 (`night-ritual.ts`, the open close-out request it
checks). **Owns:** `src/adapters/email-adapter.ts` (new file, nodemailer);
extends `src/shell/ritual-cli.ts` with the `night-escalate` subcommand;
extends `src/rituals/night-ritual.ts` with the escalation-check orchestration.

As Spencer,
I want a second, more attention-getting nudge if I miss the first close-out prompt, but never more than that,
So that Yoh gets my attention without becoming a nag.

**Acceptance Criteria:**

**Given** the night-prompt close-out request from Story 3.1 is still unanswered some hours later
**When** `ritual-cli.ts night-escalate` runs (scheduled after night-prompt)
**Then** it checks `memory-store.ts` for whether tonight's close-out was already answered
**And** if not, it sends a second, capped attempt via `email-adapter.ts` (nodemailer) — a channel distinct from the first attempt's push notification, not a repeat of the identical notification
**And** this second attempt is visually/textually marked with the `{colors.attention}` escalation marker and escalates in directness of wording, not volume of text (UX-DR6, UX-DR13)

**Given** the close-out was already answered before night-escalate runs
**When** `night-escalate` runs
**Then** it is a no-op — no second attempt is sent

**Given** both attempts have now been sent for tonight
**When** any further trigger occurs the same night
**Then** no third attempt is ever sent, regardless of continued non-response

**Implementer note:** `email-adapter.ts` uses `nodemailer` behind an
injectable transport so tests don't send real email (no live SMTP credentials
available here).

---

## Task 21: Story 3.3 — Unchecked-Day Handling & Rollover

**Depends on:** Task 20 (both escalation attempts). **Owns:** extends
`src/rituals/night-ritual.ts` (unchecked-day marking) and
`src/rituals/morning-ritual.ts` (Task 10's file — adds the unchecked-day flag
+ rolled-forward-Blocker display to the next Morning Plan).

As Spencer,
I want Yoh to stop chasing me after the second attempt and just carry forward what matters, flagging that last night wasn't closed,
So that a missed night never turns into endless nagging or silently vanishes.

**Acceptance Criteria:**

**Given** both close-out attempts (Story 3.1's prompt and Story 3.2's escalation) went unacknowledged
**When** the cap is reached
**Then** the system stops escalating for that night, marks the day as `unchecked` in memory, and does not attempt a third notification even if Spencer becomes active again later that night

**Given** the day is marked `unchecked`
**When** the next Morning Ritual runs
**Then** it visibly flags that last night wasn't closed and states which mandatory Blocker(s) rolled forward — shown once, not a standing repeating reminder (UX-DR14)

**Given** a day that was actually closed out normally
**Then** it is never silently treated as equivalent to an `unchecked` day — the two states are visibly distinguishable in the Plan or its history

---

## Task 22: Story 4.1 — Hot/Cold Memory Model

**Depends on:** Task 2 (`memory-store.ts`'s initial schema/transaction
pattern — this task is the capstone that completes memory-store's hot/cold
surface every prior task's interaction-requests/Proposals/Time-Budget/
close-out writes have been building against). **Owns:** completes
`src/adapters/memory-store.ts`'s hot/cold read surface (distillation into
cold-memory pattern-statements).

As Spencer,
I want Yoh to keep a fast "hot" memory of recent days and a full "cold" history it can query on demand,
So that everyday planning doesn't get slower as history piles up, but nothing is ever thrown away.

**Acceptance Criteria:**

**Given** recent-day context exists (e.g., yesterday's slip, this week's Time Budget)
**When** Plan generation or another ritual needs it
**Then** it's available from `memory-store.ts`'s hot memory without a full-history query

**Given** older history beyond the hot window
**When** it's needed (e.g., for a Self-Check trend or an explicit query)
**Then** it remains queryable via cold memory, distilled into pattern-statements over time, but is not loaded during routine daily operation

**Given** the hot/cold split
**Then** no ritual's routine daily operation requires querying the full cold history

**Implementer note:** this task's job is mainly to name and shape the
hot/cold boundary explicitly (which existing tables/queries in
`memory-store.ts` are "hot", add a cold-memory query path with basic
pattern-statement distillation) — most of the underlying data already exists
from earlier tasks' writes; don't re-litigate their schemas, extend them.

---

## Task 23: Story 4.2 — Propose-Don't-Impose Confirmation Gate

**Depends on:** Task 6 (Time Budget's own `Proposal<T>` stub from Story 1.6),
Task 22 (`memory-store.ts`'s completed interaction-request surface). **Owns:**
a general `apply(proposal)` confirm/apply pathway — place it in `chat-cli.ts`
(the AD-3-mandated sole caller) plus whatever small shared helper the
Proposal-versioning check needs (implementer's call on file, but it must not
duplicate logic already in `memory-store.ts`'s interaction-request handling).

As Spencer,
I want Yoh to ask before acting on anything it has learned or wants to suggest, and never trust a stale suggestion,
So that it never silently changes its own behavior based on a guess about me.

**Acceptance Criteria:**

**Given** Yoh has a learned behavioral pattern, a suggested Time Budget change, or a Blocker-handling decision to suggest
**When** that suggestion is generated
**Then** it is returned as a `Proposal<T>` (the change, its reason, and a version snapshot of the entity it would change) per AD-3, and persisted as an open interaction request — never applied directly

**Given** an open Proposal exists
**When** Spencer next opens `chat-cli.ts`
**Then** it surfaces the Proposal, states what Yoh wants to do, and waits for explicit yes/no — silence is never treated as consent (UX-DR16)

**Given** Spencer confirms yes
**When** `apply(proposal)` runs
**Then** it first re-reads the live entity; if its version no longer matches the snapshot, it rejects with `YohError.kind: 'stale-proposal'` instead of applying against outdated state

**Given** Spencer says no or the Proposal is stale
**Then** no behavior change is applied, and the interaction request is cleared or re-surfaced with fresh data as appropriate

**Implementer note:** per AD-3, "a Blocker resolution" is named in the
Glossary as a confirmation-gated case but Task 16/Story 2.4 already
established FR-10's Blocker rescheduling is unconditional/automatic — do not
retrofit a confirmation gate onto Task 16's path. This task's `apply(proposal)`
is generic over `Proposal<T>` and is exercised concretely by Task 6's Time
Budget change suggestion (now made real) plus any learned-pattern proposal
this task itself introduces as its own worked example.

---

## Task 24: Story 4.3 — Periodic Self-Check

**Depends on:** Task 17 (`escalate-under-strain.ts`, reused for the interval
curve), Task 23 (confirm/apply + interaction-request pattern). **Owns:**
`src/rituals/self-check.ts` (new file); extends `src/shell/ritual-cli.ts`
with the `self-check` subcommand; extends `chat-cli.ts` to resolve the
Self-Check prompt.

As Spencer,
I want Yoh to periodically ask how well it's doing, and check in sooner if I tell it something's wrong,
So that it stays accountable without me having to bring it up myself.

**Acceptance Criteria:**

**Given** no low Self-Check score has occurred recently
**When** the interval elapses (~every 4 days, at a randomized time)
**Then** `ritual-cli.ts self-check` prompts Spencer for a numeric score and a short written reason, computing the next randomized interval from the last check-in

**Given** Spencer responds with only a number and no written reason
**Then** the response is not accepted as complete — both are required (UX-DR15)

**Given** a Self-Check score below the defined low threshold (starting bias: under-triggering)
**When** the next interval is computed via the shared `computeEscalation` curve (AD-6)
**Then** it is shorter than the default ~4-day interval, triggered from that single low score alone rather than waiting for a trend

**Given** today isn't yet due for a Self-Check
**When** `ritual-cli.ts self-check` runs
**Then** it is a no-op

**Implementer note:** the low-score threshold's starting value is deliberately
biased toward under-triggering per the Architecture Spine's Deferred section
— pick a concrete conservative starting number (e.g. a low score on a 1–10
scale) and comment that it's a tunable starting point, not a load-bearing
constant to over-engineer.

---

## Task 25: Story 5.1 — Ritual Failure Alerting

**Depends on:** Task 10 (`notification-adapter.ts`), and touches all four
`ritual-cli.ts` subcommands built by Tasks 10, 19, 20, 24. **Owns:** the
top-level error-handling wrapper in `src/shell/ritual-cli.ts` (extends the
existing file — this is the AD-7 hardening pass across all four subcommands
at once, as the epic note specifies, not a new file).

As Spencer,
I want to be alerted immediately if any of Yoh's scheduled rituals crashes or fails,
So that a silent break in my planning system never goes unnoticed.

**Acceptance Criteria:**

**Given** any of the four `ritual-cli.ts` subcommands (morning, night-prompt, night-escalate, self-check) throws an error or returns a `Result` failure
**When** that subcommand's top-level handler catches it
**Then** it sends a Pushover alert worded distinctly from a normal Plan/close-out/Self-Check notification, before the process exits non-zero

**Given** a subcommand completes successfully
**Then** no failure alert is sent for that run

**Implementer note:** factor the top-level wrapper once (e.g. a
`withFailureAlert(subcommandFn)` helper in `ritual-cli.ts`) and apply it
identically to all four subcommands — per AD-9's spirit, don't duplicate the
same try/catch four times.

---

## Task 26: Story 5.2 — Dead-Man's-Switch — Missed-Run Detection

**Depends on:** Task 25 (the failure-alert path this reuses), Task 22
(`memory-store.ts`'s completed surface — this adds a "last successful run per
subcommand" record). **Owns:** extends `src/shell/ritual-cli.ts` (the same
top-level wrapper from Task 25) and `src/adapters/memory-store.ts` (a small
"last successful scheduled run per subcommand" table/query).

As Spencer,
I want to know if one of Yoh's scheduled rituals never ran at all, not just if it crashed,
So that a silent scheduler or host failure doesn't go unnoticed either.

**Acceptance Criteria:**

**Given** a `ritual-cli.ts` subcommand starts
**When** it checks `memory-store.ts` for whether its own previous scheduled occurrence recorded a successful run
**Then** a missing prior run is treated as a failure and triggers the same Pushover alert path as Story 5.1

**Given** a subcommand's previous scheduled occurrence did run successfully
**Then** no missed-run alert is triggered

**Given** this check is self-referential (each run checks the one before it)
**Then** a total host/scheduler outage spanning every future invocation is explicitly out of scope for detection by this story — that gap is documented, not silently claimed as solved

**Implementer note:** add a one-line doc comment (or a short section in
`SETUP.md`) stating the self-referential-only scope explicitly, so it reads
as a documented boundary rather than an oversight.

---

## Task 27: Story 5.3 — Structured Logging & Plan-Generation Performance Threshold

**Depends on:** Task 26 (final task — touches every ritual step across the
whole codebase). **Owns:** a shared structured-logging helper (new file,
implementer's call on name, e.g. `src/adapters/logger.ts` or colocated in
`ritual-cli.ts` if small enough — but if it grows into its own concern, give
it its own file per AD-9 rather than bolting it onto an unrelated owner);
instruments every ritual step across `src/rituals/*.ts` and
`src/shell/ritual-cli.ts` to log through it; adds Plan-generation timing to
`src/rituals/morning-ritual.ts`.

As Spencer,
I want every ritual step logged in a consistent, inspectable way, and to be told if Plan generation is running unusually slow,
So that I can reconstruct what happened after the fact and catch a "technically running but effectively broken" ritual.

**Acceptance Criteria:**

**Given** any ritual step executes
**When** it logs
**Then** it emits a single-line structured JSON entry to stderr, sufficient to reconstruct what that run did afterward

**Given** a Plan generation run (Data-Completeness Gate through Work/Break fitting, excluding notification delivery)
**When** it completes
**Then** its duration is timed and included as one field in that run's structured log line

**Given** that duration exceeds a defined low-seconds threshold
**When** the run completes
**Then** `ritual-cli.ts` treats it as degraded-not-failed and raises it through the same alert path as Story 5.1, rather than silently accepting it as normal

**Implementer note:** pick a concrete starting threshold (the Architecture
Spine defers the exact number to build time — a low-seconds value such as 5s
is a reasonable, clearly-commented starting point) rather than leaving it
unset.

---

## Retrospective note

This plan intentionally excludes the `epic-N-retrospective` entries tracked in
`_bmad-output/implementation-artifacts/sprint-status.yaml` — those are BMad's
own optional post-epic ritual, outside this SDD run's scope. Update
`sprint-status.yaml`'s per-story status alongside each task's ledger
completion (backlog → done) as a courtesy to keep it truthful, but it is not
itself a task this plan tracks review/fix loops against.
