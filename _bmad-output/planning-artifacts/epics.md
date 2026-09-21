---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-YohV1-2026-08-21/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-YohV1-2026-08-22/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/EXPERIENCE.md
updated: '2026-09-18'
epic6Status: "Complete -- Epic 6 (Phase 1.5, FR-25-29, Stories 6.1-6.6) fully designed, validated, and approved. Epics 1-6 all done; workflow finished 2026-09-18."
---

# Yoh - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Yoh, decomposing the requirements from the PRD, UX Design, and Architecture Spine into implementable stories.

> **Epic 6 status (2026-09-18):** Epics 1–5 are complete and shipped (Phase 1, `sprint-status.yaml`). Epic 6 (Phase 1.5: FR-25–FR-29, Live Integrations — Stories 6.1–6.6) is now also complete: designed, story-generated, and validated via `bmad-create-epics-and-stories`. All six epics are ready for sprint planning.

## Requirements Inventory

### Functional Requirements

FR-1: Generate and deliver the Morning Plan — one ordered Plan per day from current Tasks (Estimated Duration, Area, Due Date, Status, Energy) and today's fixed Calendar events, delivered as a single notification.

FR-2: Derived Priority ordering — Tasks ordered by an automatically computed priority; primary axis is Due Date proximity adjusted by Estimated Duration, with a weighted score across Area/Energy fit/difficulty breaking ties. Never manually set.

FR-3: Plan reasoning line — every generated Plan includes a one-line, human-readable reason referencing the actual Derived Priority factors that produced the ordering.

FR-4: Data-Completeness Gate — before including a Task in a Plan, verify required fields (Estimated Duration, Area, Due Date, Status, Energy) are set; prompt Spencer for any missing rather than defaulting or silently omitting.

FR-5: Time Budget declaration and persistence — Spencer declares/changes his Time Budget via voice or chat; it persists day-to-day (including weekends) until explicitly changed again.

FR-6: Work/Break Block fitting — Tasks fitted into clock-based Work/Break Blocks (default 70/15), splitting a Task across blocks if needed; boundaries are strictly clock-based.

FR-7: Break count scales with Time Budget — number of Work/Break Blocks scales with the declared Time Budget for that day.

FR-8: Fit Plan within Time Budget — day's Plan Blocks fitted within the declared Time Budget in Derived Priority order around fixed Calendar events; anything that doesn't fit is deferred, not force-fit.

FR-9: User-initiated Mid-Day Re-Flow — Spencer can trigger a real-time re-flow of the remaining day's Plan Blocks; the system never initiates this proactively; only recomputes not-yet-completed blocks for the current day.

FR-10: Logistics-only Blocker handling — when Spencer reports a Blocker, the system reschedules affected Plan Blocks around it without attempting to resolve, judge, or problem-solve the Blocker itself.

FR-11: Slip-Bump — a Task that slips receives a priority increase toward the next day's Plan; the bump escalates with each additional consecutive slip, leveling off at a defined maximum, and clears once the Task completes.

FR-12: Night Ritual close-out prompt — prompts Spencer once per day to confirm what completed/slipped; feeds Derived Priority, Slip-Bump, and memory for subsequent days.

FR-13: Capped escalating retry — if the close-out prompt is unacknowledged, escalates through at most one additional attempt (two total): first via push notification, second (escalated) via email, a distinct channel.

FR-14: Unchecked-day handling — if both close-out attempts go unacknowledged, the system stops escalating for that night, marks the day as unchecked (visibly distinguishable from a closed day), and carries mandatory Blockers forward into the next Morning Ritual.

FR-15: Hot/Cold memory model — a fast-access "hot" memory of recent days/patterns/preferences, and a "cold" full-history store queried on demand and distilled into pattern-statements over time.

FR-16: Propose-Don't-Impose confirmation gate — any learned behavioral pattern, suggested Time Budget change, or Blocker-handling decision requires Spencer's explicit confirmation before Yoh acts on it.

FR-17: Periodic Self-Check — approximately every 4 days at a randomized time, prompts Spencer for a numeric score + short written reason; a single low score shortens the interval until the next check-in.

FR-18: Default and contextual Tone — casual, peer-level register by default, switching to concise/educational for factual/intellectual questions; avoids "it's not just X, it's Y" framing and corporate/assistant boilerplate.

FR-19: Tone escalation tied to Escalate-Under-Strain only — Tone becomes more urgent/authoritative only as a function of the Slip-Bump mechanic, never on a schedule, at random, or independent of actual slip/strain signals.

FR-20: Read Notion Tasks and Projects — reads current Task records (all planning-relevant fields) and Project groupings from Notion; a change to a Task's planning-relevant fields is reflected in the next Plan generation without manual re-sync.

FR-21: Read Google Calendar events — reads Spencer's Google Calendar events for the current day as fixed Plan anchors; an event added/changed before Morning Ritual runs is reflected in that day's Plan.

FR-22: Write Plan Blocks to Calendar without touching non-Yoh events — writes its own Plan Block events to Google Calendar; updates or deletes only events it created; a prior day's Plan Block events remain as passive history unless explicitly cleaned up.

FR-23: Write Task Status back to Notion — on Night Ritual close-out, writes each Plan Block's resulting status (completed/slipped) back to the corresponding Task's Status field in Notion; only the Status field is written, no other Task field.

FR-24: Write missing planning fields back to Notion via the CLI — when Spencer answers the Data-Completeness Gate's prompt via chat, the answer is written to Notion (not just stored locally); select-backed properties are fuzzy-matched to real existing options, fail-closed if unresolved. *(Already implemented directly, outside the epic/story process — listed here for traceability only; not part of Epic 6.)*

**Phase 1.5 (Epic 6):**

FR-25: Propose inferred values for the Data-Completeness Gate — when `llm-adapter.ts` can confidently derive a missing field's value from recent chat context, Yoh proposes it instead of a blind ask; Spencer confirms or corrects; falls back to FR-4's plain ask when no confident inference exists; the confirmed value flows through FR-24's existing write path. Generation is lazy, at `chat-cli.ts` display time — never eager, at ritual time (AD-11).

FR-26: Create Notion pages/DB items via chat — Spencer asks Yoh to create an item in Tasks, Projects, or Research Vault (the only valid targets); Yoh drafts it, shows the draft, creates only on Spencer's explicit confirmation; schema-validated against the target database's real properties both at draft time and write time (AD-12).

FR-27: Confirm-gated Calendar time-block editing beyond Yoh-owned events — Spencer asks Yoh to move, resize, or create a time block on his real Calendar, including events Yoh didn't create; Yoh shows what would change and edits only on explicit confirmation naming that event. Deletion of a non-Yoh event is never performed, confirmed or not — not a constructible value in the type system (AD-13).

FR-28: Web search lookup via chat — Spencer asks a factual/research question or explicitly asks Yoh to search; Yoh performs a live search and returns a synthesized, cited answer; triggered only by explicit ask or an unambiguous factual question, never on every chat turn; writes nothing to Notion or Calendar (AD-14).

FR-29: File a search result to the Research Vault on request — Spencer asks Yoh to save/file a search result (e.g. "save that"); Yoh creates a new page in the Research Vault database, tagged with source and date. Direct-write — the explicit request is the confirmation, no preview step (AD-12).

### NonFunctional Requirements

NFR-Reliability: The Morning and Night Rituals must run daily without manual intervention. A failure to run (crash, expired auth token, unreachable API) must be surfaced to Spencer, not fail silently — there is no other user to notice an absence.

NFR-DataIntegrity: Writes to Calendar or Notion must never corrupt or lose Task/Calendar data, and must never touch a record Yoh doesn't own (FR-22, FR-23) — with exactly one confirm-gated exception, FR-27 (AD-13). **Phase 1.5:** every write sits at one of three tiers, chosen per capability and never defaulted — automatic (FR-22, FR-23), direct-write (FR-24, FR-29), or confirm-then-write (FR-25, FR-26, FR-27). Every write triggered from chat (FR-24–FR-29) is echoed back to Spencer as a one-line receipt in that same session.

NFR-Latency: Plan generation must complete comfortably before the Morning Ritual notification is due — no hard SLA, but "fast enough to not feel broken" (low seconds, not minutes); a slow/hung Morning Ritual is functionally the same failure as one that doesn't run.

NFR-Observability: Yoh must be able to tell Spencer when something has gone wrong with its own operation (auth expired, integration unreachable, a scheduled ritual didn't fire) rather than simply going dark.

**Constraints (Cross-Cutting, not individually numbered):**
- Privacy: all Task/Calendar data is personal, single-user; no data leaves Spencer's own Notion workspace/Google account except as required by the integrations themselves; no third-party analytics/telemetry.
- Cost: must run on infrastructure Spencer already owns; no new recurring paid service required for Phase 1.
- Safety: not a meaningful concern for Phase 1's software-only surface (relevant from Phase 3 onward only).

### Additional Requirements

**Architecture / Technical (from Architecture Spine):**

- No starter template — greenfield Node.js project; project structure is fully specified by the Architecture Spine's Structural Seed (`src/core/`, `src/rituals/`, `src/adapters/`, `src/shell/`, `src/types/`). This directly impacts Epic 1 Story 1 (project scaffold).
- Stack: Node.js 24.12+ (native TS type-stripping, no build step), TypeScript 7.0.2 (`tsc --noEmit` type-check only), `@notionhq/client` ^5.22.0, `@googleapis/calendar` ^16.0.0, `google-auth-library` ^11.0.2, `better-sqlite3` ^13.0.3, `nodemailer` ^9.0.5, `@anthropic-ai/sdk` ^0.120.0, `node:test`/`node:assert` (built-in), Pushover via Node's built-in `fetch` (no SDK).
- Design paradigm (AD-1, AD-2): Functional Core / Imperative Shell — `core/` files are pure, no I/O, no shared mutable state, importing only from `types/` and other `core/` files; `adapters/` own all I/O; `rituals/` orchestrate; `shell/` (two CLI entry points) is the only way in. Dependency direction: `shell → rituals → {core, adapters}`; `adapters → types` only.
- Ritual execution model (AD-5): four independent, OS-scheduled, one-shot CLI subcommands under `ritual-cli.ts` — `morning`, `night-prompt`, `night-escalate`, `self-check` — none block for input; any that needs an answer persists an open interaction request in `memory-store.ts` and exits. `chat-cli.ts` is the single on-demand REPL and the only place open interaction requests / open Proposals get resolved.
- Propose-Don't-Impose data model (AD-3): any suggestion returns a `Proposal<T>` (change + reason + version snapshot); persisted as an open interaction request; only `chat-cli.ts`, after explicit yes/no, calls `apply(proposal)`, which re-reads the live entity and rejects with `YohError.kind: 'stale-proposal'` on version mismatch.
- Calendar ownership by construction (AD-4): a dedicated "Yoh Plan" secondary Google Calendar is created on first run (via Calendars.insert) if it doesn't exist, with its ID persisted in `token-store.ts`; writes/updates/deletes only within that secondary calendar; primary calendar is read-only, enforced via separate OAuth scopes.
- Escalate-Under-Strain shared curve (AD-6): `core/escalate-under-strain.ts` exports exactly `computeEscalation(strainCount, curve): EscalationLevel`; consumed identically by `slip-bump.ts`, `self-check.ts`, and `tone.ts`, each supplying only its own curve (cap, step).
- Observability / alerting (AD-7): every `ritual-cli.ts` subcommand wraps its invocation in a top-level handler that raises a distinctly-worded Pushover alert on any failure before exiting non-zero; each subcommand also checks that the prior scheduled occurrence of itself ran successfully (self-referential dead-man's switch) and alerts if not.
- Result-type error handling (AD-8): every `core/*.ts` function returns `Result<T, YohError>` and never throws; `adapters/*.ts` may throw on I/O failure; only `rituals/*.ts` catches an adapter throw and converts it to a `Result` failure or AD-7 alert. `YohError.kind` includes at minimum: `missing-field`, `auth-expired`, `unreachable`, `rate-limited`, `validation`, `stale-proposal`, `conflict`.
- File-level ownership (AD-9): `types/domain.ts` (Task, CompleteTask, Plan, PlanBlock, TimeBudget, Proposal<T>, EscalationCurve, EscalationLevel, Result<T,E>, YohError) is authored/locked as its own prerequisite task before any file importing from it is dispatched; `PlanBlock` carries a stable `id`, addressed by id everywhere, never array position.
- Storage split (AD-10): `memory-store.ts` (hot/cold memory + open interaction requests/Proposals) and `token-store.ts` (sole OAuth2Client constructor/holder, rewrites refresh token to disk immediately after every refresh) are two separate files. Static secrets load from env vars at process start; only the Google refresh token is a persisted mutable secret. Multi-step read-modify-write sequences in `memory-store.ts` run inside a single SQLite transaction with optimistic concurrency (version/`updated_at` check), surfacing conflicting writes as `YohError.kind: 'conflict'`.
- Data-Completeness Gate at the type level (AD-11): `data-completeness-gate.ts` is the only function producing a `CompleteTask` from a raw `Task`; every downstream function (`derived-priority.ts`, `work-break-fit.ts`, `plan-reasoning.ts`) accepts only `CompleteTask`, never `Task`.
- Notion write surface (AD-12, as extended for FR-24/FR-26/FR-29): `notion-adapter.ts`'s write surface is a closed, enumerated set — `setTaskStatus(taskId, status)`, `updateTaskField(client, config, taskId, field, value)` (FR-24, one field/value pair per call, singular), and `createPage(database, properties)` (FR-26/FR-29, `database` a closed enum `Tasks | Projects | ResearchVault`) — no generic "update/create any Notion property/page" function exists. `select`-backed properties are fuzzy-matched against their live option list before every write (exact → normalized → closest-match within a bounded threshold); a value that can't confidently resolve fails the write rather than guessing.
- Logging convention: single-line structured JSON to stderr, one line per ritual step, including Plan-generation timing as one logged field; a slow run (exceeding a low-seconds threshold, exact number set at build time) is treated as degraded-not-failed and raised through the AD-7 alert path.
- Dates/IDs/errors convention: ISO-8601 UTC internally in `core/` and storage, converted to Spencer's local timezone only at the `shell/`/notification edge; Notion page IDs and Google Calendar event IDs are opaque strings, never parsed; errors are the `Result<T, YohError>` discriminated union.
- Deployment: single environment, single host (laptop, Raspberry Pi, or existing server), one Node process tree, no containerization, no staging/prod split; SQLite file + `.env` secrets file are the only persistent state, living alongside the checkout.
- Build-time / launch-blocking verifications to track as explicit stories or gating tasks: OAuth production-mode consent-screen flip (blocking — Testing-mode default silently expires refresh tokens after 7 days); Notion internal-integration-token auth pattern confirmation against current docs; service-account-vs-personal-calendar constraint verification (OAuth 2.0 user consent required, not a service account); current Notion API version recheck before the build window; exact 2026 Google Calendar OAuth scope names verification for the primary-read/"Yoh Plan"-write split.
- Deferred tuning parameters (implementation decisions, not blocking, but should be represented as explicit story tasks with a stated starting value): FR-2 secondary-factor weights (start with an even split across Area/Energy fit/difficulty); FR-11 Slip-Bump increment curve and cap (small bump on slip 1, ~double on slip 2, cap by slip 3–4); FR-17 Self-Check low-score threshold (bias toward under-triggering initially); Plan-generation performance threshold's concrete low-seconds number.

**Phase 1.5 (Epic 6) — from ARCHITECTURE-SPINE.md AD-3/AD-10/AD-11/AD-12/AD-13/AD-14:**

- Two separately-scoped Google Calendar `OAuth2Client` instances, both sole-constructed/held by `token-store.ts` (AD-10, AD-13): the existing narrow client (`calendar.events.readonly` primary, `calendar.app.created` "Yoh Plan" write) stays exactly as built for the automatic path; a new, broader client (`calendar.events` — read/write across all accessible calendars) is provisioned only for FR-27's confirm-gated path. "Primary only" is enforced by `calendar-adapter.ts` checking `calendarId === 'primary'` in code, not by the OAuth grant itself — confirmed accepted trade-off, not an open question.
- New Perplexity API key (static secret, env var, same pattern as existing secrets) targeting the **Agent API** (`/v1/responses`) — explicitly not Sonar's `/v1/chat/completions`, which is deprecated 2026-09-27. Citation extraction reads the `search_results` item inside the response's `output[]` array, not a top-level `citations` field.
- New `adapters/search-adapter.ts` (FR-28, AD-14): exports exactly `search(query: string): Promise<Result<SearchAnswer, YohError>>`; structurally holds no write capability (no import path to any write function). A zero-result answer is a successful `Result`, never a `YohError`.
- `calendar-adapter.ts` gains (AD-13): `resolveCalendarEditRoute(eventId): {kind: 'owned'} | {kind: 'external'}` — the single named routing function every caller (including AD-4's own automatic path) goes through; `proposeCalendarEdit(eventId, change: MoveOrResize)` for move/resize on an existing event; `proposeNewCalendarEvent(change: CreateBlock)` for create (no `eventId` parameter — none exists yet); `applyCalendarEdit(proposal)`.
- `types/domain.ts`'s locked inventory (AD-9) gains: `FieldValueSuggestion`, `NotionPageDraft`, `CalendarEditChange` (union of `move | resize | create` only — no `delete` variant, so a non-Yoh event cannot be deleted even by a coding mistake), `ChatIntent` (discriminated union: `mid-day-reflow | blocker | open-prompt-answer | general-question | search-trigger`), `SearchAnswer`.
- `Proposal<T>`/`apply(proposal)` calling convention clarified (AD-3): `apply(proposal)` is a pattern name, not one shared signature — `applyCalendarEdit` takes the `Proposal` itself (needs the snapshot for the staleness re-check); `updateTaskField`/`createPage` take unwrapped arguments extracted from the confirmed `Proposal`. The stale-proposal re-read doesn't apply to a `Proposal<T>` that creates a new entity (`NotionPageDraft`; `CalendarEditChange`'s `create` variant) — there's no live entity yet to re-read; AD-12's schema re-resolution (or, for calendar `create`, nothing additional) is the substitute guarantee.
- FR-25's suggestion generation is lazy, at `chat-cli.ts` display time (AD-11) — `data-completeness-gate.ts` (`core/*`) cannot call `llm-adapter.ts` (an adapter) itself per AD-1; the gate always persists a bare `{kind: 'missing-field', taskId, field}` placeholder, and `chat-cli.ts` calls `llm-adapter.ts` on demand right before surfacing it, only then constructing the `Proposal<FieldValueSuggestion>`.
- `chat-cli.ts` echoes a one-line receipt for every chat-triggered write (FR-24–FR-29), naming what changed, using the returned success value from the write function — no re-query needed.
- **Open pre-build item, not yet resolved:** Research Vault's actual Notion database property names (source URL, search date, title/body fields) are unconfirmed anywhere in the PRD or spine — needed before FR-26/FR-29 stories can be built, since AD-12's schema validation can't validate against a schema nobody has captured. Should surface as an explicit early task/spike in Epic 6, not assumed.
- Deferred tuning parameters (Phase 1.5): FR-28's search-trigger classification rule (start narrow: explicit-ask phrasings + direct factual questions referencing something outside Yoh's own data); Perplexity Agent API pricing/context-tier confirmation + a daily cost ceiling (warn, not silently throttle).

### UX Design Requirements

UX-DR1: Implement the CLI color token system — `accent` (#5FAFFF, section/prompt labels only), `attention` (#D08A3E, escalation marker only, never a broader "error red"), `muted` (#6B6B6B, reasoning line only), and terminal-inherited default body text — with graceful degradation to ANSI/no-color on non-truecolor terminals, and every color cue paired with plain-text wording that carries the same meaning without color.

UX-DR2: Implement layout conventions — body text wraps at ~80 characters (`wrap-width`); exactly one blank line (`block-gap`) separates each structural unit (header from block list, block list from reasoning line, one prompt from the next); no box-drawing characters, rules, or ASCII dividers.

UX-DR3: Implement the Plan block component — one line per Task or fixed Calendar event in Plan order (time range, then item, nothing else); Plan label in `accent` color; each block line in default body color.

UX-DR4: Implement the Reasoning line component — the required one-sentence explanation of what leads the Plan (FR-3), rendered in `muted` color directly under the block list, never interleaved with it.

UX-DR5: Implement the Prompt component — any place Yoh asks for input (missing field, close-out confirmation, Self-Check score) opens with an `accent`-labeled line naming what's needed, then waits inline — no separate modal or multi-step wizard framing.

UX-DR6: Implement the Escalation marker component — used exactly twice per its occurrences: Night Ritual's second attempt, and an unchecked-day flag; never used for routine Plan content.

UX-DR7: Implement the Notification component — push notification title uses `accent` color where the platform supports styled text; body is the Plan's reasoning line or a short close-out cue.

UX-DR8: Enforce the anti-gamification stance across all output: no emoji, no ASCII art, no celebratory flourishes on task completion, no progress bars, no persistent status widget, no third accent color — output is a message, not a dashboard.

UX-DR9: Implement `chat-cli.ts` as a persistent, free-text chat-style REPL (not a fixed command grammar) — the home for on-demand Plan viewing, Mid-Day Re-Flow triggers, Blocker reports, Time Budget changes, and general questions, routed via the LLM adapter.

UX-DR10: Implement the Data-Completeness prompt to ask for exactly the missing field(s) on the Task(s) actually in play for today — never a bulk "clean up your whole database" request; one prompt may cover multiple missing fields across multiple Tasks if needed.

UX-DR11: Implement Mid-Day Re-Flow output behavior — re-fits and shows only the updated remainder of the day; does not re-explain or re-justify the whole day.

UX-DR12: Implement Blocker report output behavior — a single confirmation line describing the schedule change made; no discussion or suggestions about resolving the blocker itself.

UX-DR13: Implement Night close-out flow — first attempt is a simple confirm prompt; the second (capped) attempt escalates in directness of wording and channel (email) and uses the `attention` marker, not in volume of text or alarm language.

UX-DR14: Implement the Unchecked-day flag — the next Morning Plan visibly marks that last night wasn't closed and states which mandatory Blocker(s) rolled forward; informational, delivered once, not a standing repeating reminder.

UX-DR15: Implement Self-Check prompt validation — requires both a numeric score and a short written reason to be considered answered; a bare number alone is treated as incomplete.

UX-DR16: Implement the Propose-Don't-Impose confirmation pattern uniformly — state what Yoh wants to do, wait for explicit yes/no, never treat silence as consent; while a confirmation is open, treat it as a blocking question in the chat flow rather than queuing silently alongside unrelated commands.

UX-DR17: Implement "silence is a feature" behavior — no ambient "still here"/check-in output between the Morning Plan delivery and whatever Spencer next initiates.

UX-DR18: Implement the on-demand Morning Plan view — Spencer can retrieve today's Plan via a chat query (e.g., "what's my plan") in addition to the auto-delivered push notification.

UX-DR19: Implement Task-state lineage visibility — a slipped Task's Slip-Bump history should be answerable on request (e.g., "why is X prioritized today"), consistent with the Plan reasoning line's transparency principle.

UX-DR20: Implement accessibility floor — plain monospace text only (no image-only content, no meaning via layout alone); output wraps at the defined width rather than relying on terminal auto-wrap mid-word; no timing-dependent prompt expiry — every prompt (Data-Completeness, Night close-out, Self-Check, Propose-Don't-Impose) waits indefinitely for a response (FR-13's cap governs retry escalation, not a response deadline on the prompt itself).

UX-DR21: Cold-start behavior — first run has no Hot Memory and a near-empty Cold Memory; the Morning Ritual runs normally with fewer inputs (no prior day, no memory to draw on) rather than any special first-day messaging or onboarding flow. `[Decided 2026-08-22, resolving the open item EXPERIENCE.md flagged.]`

### FR Coverage Map

FR-1: Epic 1 - Generate and deliver the Morning Plan
FR-2: Epic 1 - Derived Priority ordering
FR-3: Epic 1 - Plan reasoning line
FR-4: Epic 1 - Data-Completeness Gate
FR-5: Epic 1 - Time Budget declaration and persistence
FR-6: Epic 1 - Work/Break Block fitting
FR-7: Epic 1 - Break count scales with Time Budget
FR-8: Epic 1 - Fit Plan within Time Budget
FR-9: Epic 2 - User-initiated Mid-Day Re-Flow
FR-10: Epic 2 - Logistics-only Blocker handling
FR-11: Epic 2 - Slip-Bump
FR-12: Epic 3 - Night Ritual close-out prompt
FR-13: Epic 3 - Capped escalating retry
FR-14: Epic 3 - Unchecked-day handling
FR-15: Epic 4 - Hot/Cold memory model
FR-16: Epic 4 - Propose-Don't-Impose confirmation gate
FR-17: Epic 4 - Periodic Self-Check
FR-18: Epic 2 - Default and contextual Tone
FR-19: Epic 2 - Tone escalation tied to Escalate-Under-Strain only
FR-20: Epic 1 - Read Notion Tasks and Projects
FR-21: Epic 1 - Read Google Calendar events
FR-22: Epic 1 - Write Plan Blocks to Calendar without touching non-Yoh events
FR-23: Epic 3 - Write Task Status back to Notion
FR-25: Epic 6 - Propose inferred values for Data-Completeness Gate
FR-26: Epic 6 - Create Notion pages/DB items via chat
FR-27: Epic 6 - Confirm-gated Calendar time-block editing beyond Yoh-owned events
FR-28: Epic 6 - Web search lookup via chat
FR-29: Epic 6 - File a search result to Research Vault on request

**NFR Coverage:** NFR-Reliability, NFR-Observability, NFR-Latency → Epic 5 (formalized/hardened here). NFR-DataIntegrity → structurally enforced in Epic 1 (AD-4, calendar ownership) and Epic 3 (AD-12, Status-only Notion writes).

## Epic List

### Epic 1: Morning Ritual — the day arrives already planned

Spencer wakes up to one trustworthy, ordered Plan built from his real Notion Tasks and Google Calendar — no manual reconciling, and no Task silently guessed at if it's missing data.

**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, FR-20, FR-21, FR-22

**Also carries:** project scaffold (Structural Seed, `types/domain.ts` locked first per AD-9), OAuth setup for Notion + Google Calendar including the blocking production-mode consent-screen flip and the Notion-auth-pattern / service-account-constraint / API-version / Calendar-scope verification tasks, `token-store.ts` + `memory-store.ts` bootstrap (AD-10), `notion-adapter.ts` (read, FR-20), `calendar-adapter.ts` (primary read-only + dedicated "Yoh Plan" secondary calendar create/read/write, AD-4), `notification-adapter.ts` (Pushover) for the Plan notification, `data-completeness-gate.ts` (AD-11, FR-4), core planning functions (`derived-priority.ts`, `time-budget.ts`, `work-break-fit.ts`, `plan-reasoning.ts`), FR-2's secondary-factor weights starting value (even split), and a minimal `chat-cli.ts` (resolves open interaction requests including Data-Completeness prompts, on-demand Plan view, Time Budget declare/change).

**UX:** UX-DR1 (colors), UX-DR2 (layout/spacing), UX-DR3 (Plan block), UX-DR4 (reasoning line), UX-DR5 (prompt component), UX-DR7 (notification), UX-DR8 (anti-gamification), UX-DR10 (Data-Completeness prompt wording), UX-DR18 (on-demand Plan view), UX-DR20 (accessibility floor), UX-DR21 (cold-start behavior)

### Epic 2: Mid-Day Adjustments, Slip Handling & Tone — talking to Yoh without a fight

Spencer can report a slip or blocker mid-day and get the rest of the day re-fit instantly, a slipped Task earns a fair capped bump toward tomorrow, and every reply reads like a peer, not a corporate assistant — urgency rising only when slip actually warrants it.

**FRs covered:** FR-9, FR-10, FR-11, FR-18, FR-19

**Also carries:** `mid-day-reflow.ts` (FR-9), `slip-bump.ts` (FR-11), `escalate-under-strain.ts` (AD-6 shared curve, introduced here), `llm-adapter.ts` (chat intent routing + Tone-governed responses), `tone.ts` (FR-18, FR-19), extended `chat-cli.ts` free-text routing for Blocker reports / re-flow triggers, FR-11's increment curve and cap starting values (small bump on slip 1, ~double on slip 2, cap by slip 3–4).

**UX:** UX-DR9 (persistent chat REPL), UX-DR11 (mid-day re-flow output), UX-DR12 (blocker report output), UX-DR17 (silence is a feature), UX-DR19 (Slip-Bump lineage visibility)

### Epic 3: Night Ritual — closing the day honestly

Every day closes cleanly: Spencer confirms what happened, or Yoh nudges once more (capped, on a different channel) and then backs off — never nagging indefinitely — carrying anything mandatory into tomorrow.

**FRs covered:** FR-12, FR-13, FR-14, FR-23

**Also carries:** `night-ritual.ts` (FR-12–14), `email-adapter.ts` (nodemailer, FR-13's second attempt), `ritual-cli.ts`'s `night-prompt` / `night-escalate` subcommands (AD-5), `notion-adapter.ts`'s `setTaskStatus` (AD-12, FR-23), extended `chat-cli.ts` to resolve the close-out confirmation.

**UX:** UX-DR6 (escalation marker), UX-DR13 (night close-out flow), UX-DR14 (unchecked-day flag)

### Epic 4: Memory & Self-Check — Yoh keeps track and asks how it's doing

Yoh remembers recent and historical patterns, never acts on a learned one without asking first, and periodically checks in on its own performance — checking in sooner after a bad signal.

**FRs covered:** FR-15, FR-16, FR-17

**Also carries:** completed hot/cold `memory-store.ts` model (FR-15), `Proposal<T>` + AD-3 confirm/apply flow with stale-proposal rejection (FR-16), `self-check.ts` + `ritual-cli.ts`'s `self-check` subcommand (FR-17), FR-17's low-score threshold starting value (bias toward under-triggering), extended `chat-cli.ts` to resolve Self-Check prompts and Propose-Don't-Impose confirmations.

**UX:** UX-DR15 (Self-Check validation), UX-DR16 (Propose-Don't-Impose pattern)

### Epic 5: Reliability & Observability — Spencer always knows when something's wrong

Since there's no one else to notice a silent failure, every ritual's crash, expired auth, or missed scheduled run gets surfaced to Spencer directly instead of going dark.

**NFRs covered:** NFR-Reliability, NFR-Observability, NFR-Latency

**Also carries:** top-level alert wrapper (AD-7) across all four `ritual-cli.ts` subcommands (`morning`, `night-prompt`, `night-escalate`, `self-check`) raising a distinctly-worded Pushover alert on any failure; the self-referential dead-man's-switch check (each subcommand verifies its own prior scheduled run succeeded); structured single-line JSON logging to stderr per ritual step; Plan-generation timing logged and treated as degraded (not failed) past a chosen low-seconds threshold, alerted through the same AD-7 path (NFR-Latency).

**Note:** no new FRs — this epic hardens the rituals Epics 1/3/4 already built, sequenced last so it wraps all four subcommands at once rather than being touched piecemeal per epic.

### Epic 6: Live Integrations — Yoh acts through chat, not just plans

Spencer can ask Yoh, from chat, to infer a missing Task field instead of guessing, create real items in Notion, edit Calendar events beyond the ones Yoh itself created, search the live web for an answer, and file research to the Vault — each write gated at the tier its risk warrants (automatic, direct, or confirm-then-write) before it ever touches his real data.

**FRs covered:** FR-25, FR-26, FR-27, FR-28, FR-29

**Also carries:** `llm-adapter.ts` lazy inference for FR-25 (AD-11, gate stays pure — adapter call happens at `chat-cli.ts` display time, not ritual time); `notion-adapter.ts`'s closed write surface gains `createPage(database, properties)` (FR-26, FR-29); a second, broader-scoped Calendar `OAuth2Client` (AD-13) plus `calendar-adapter.ts`'s `resolveCalendarEditRoute`, `proposeCalendarEdit`, `proposeNewCalendarEvent`, `applyCalendarEdit` (FR-27 — no delete variant exists in the type system, so a non-Yoh event can't be deleted even by mistake); new `search-adapter.ts`, structurally write-incapable (FR-28, AD-14); `types/domain.ts` additions (`FieldValueSuggestion`, `NotionPageDraft`, `CalendarEditChange`, `ChatIntent`, `SearchAnswer`); a `chat-cli.ts` one-line write receipt for every chat-triggered write (FR-24–FR-29); an early spike story to confirm Research Vault's real Notion schema, blocking for the FR-26/FR-29 stories.

**UX:** none new — reuses the existing Prompt component and the Propose-Don't-Impose confirmation pattern (UX-DR5, UX-DR16) already built for Epics 1 and 4.

**Note:** kept as a single epic rather than split per-FR — all five FRs extend the same surface (`chat-cli.ts`'s REPL and the `Proposal<T>`/confirm-then-`apply` pattern, AD-3), and the Architecture Spine already fully specifies each of them (AD-10–AD-14), so there's no open design risk a split would de-risk.

## Epic 1: Morning Ritual — the day arrives already planned

Spencer wakes up to one trustworthy, ordered Plan built from his real Notion Tasks and Google Calendar — no manual reconciling, and no Task silently guessed at if it's missing data.

### Story 1.1: Project Scaffold & Shared Domain Types

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

### Story 1.2: Google & Notion Credential Setup and Storage Bootstrap

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

### Story 1.3: Read Notion Tasks and Projects

As Spencer,
I want Yoh to read my current Notion Tasks and Projects,
So that planning always reflects what's actually in my Notion workspace, not a stale copy.

**Acceptance Criteria:**

**Given** Spencer's Notion workspace has Task records with Estimated Duration, Area, Due Date, Status, and Energy set
**When** `notion-adapter.ts`'s read function runs
**Then** it returns every current Task with those five planning-relevant fields, plus its Project grouping
**And** a Task field changed in Notion since the last read is reflected the next time this function runs, with no manual re-sync step
**And** Projects are returned as organizational metadata only — nothing about them feeds priority or scheduling in this story

### Story 1.4: Read Google Calendar Events as Fixed Plan Anchors

As Spencer,
I want Yoh to read today's Google Calendar events,
So that the Plan is built around my real fixed commitments, not blind to them.

**Acceptance Criteria:**

**Given** Spencer's primary Google Calendar has one or more events scheduled for today
**When** `calendar-adapter.ts`'s read function runs
**Then** it returns every one of today's events with start/end time
**And** it only reads from the primary calendar — no insert/update/delete call is made against it (enforced by using only the read-scoped client)
**And** an event added or changed on the primary calendar before this read runs is included in that read's result

### Story 1.5: Data-Completeness Gate — Prompt for Missing Task Fields

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

### Story 1.6: Time Budget Declaration and Persistence

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

### Story 1.7: Derived Priority Ordering

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

### Story 1.8: Work/Break Block Fitting Within Time Budget

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

### Story 1.9: Plan Reasoning Line

As Spencer,
I want a one-line, honest reason for what leads today's Plan,
So that I can trust the ordering instead of wondering why it picked what it picked.

**Acceptance Criteria:**

**Given** a completed, ordered Plan
**When** `plan-reasoning.ts` generates the reasoning line
**Then** it references the actual Derived Priority factors that produced the lead item's position (e.g., "due soonest, biggest chunk") — never a generic or static string
**And** the line is rendered in `{colors.muted}` directly under the block list, not interleaved with it (UX-DR4)

### Story 1.10: Generate and Deliver the Morning Plan

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

### Story 1.11: On-Demand Plan View via Chat

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

### Story 1.12: Write Plan Blocks to a Dedicated "Yoh Plan" Calendar

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

## Epic 2: Mid-Day Adjustments, Slip Handling & Tone — talking to Yoh without a fight

Spencer can report a slip or blocker mid-day and get the rest of the day re-fit instantly, a slipped Task earns a fair capped bump toward tomorrow, and every reply reads like a peer, not a corporate assistant — urgency rising only when slip actually warrants it.

### Story 2.1: Persistent Chat Session & Natural-Language Routing

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

### Story 2.2: Default and Contextual Tone

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

### Story 2.3: User-Initiated Mid-Day Re-Flow

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

### Story 2.4: Logistics-Only Blocker Handling

As Spencer,
I want to report a logistical blocker and have Yoh just reschedule around it,
So that I don't get a discussion or unsolicited advice about something I didn't ask Yoh to solve.

**Acceptance Criteria:**

**Given** Spencer reports a Blocker in plain language (e.g., "meeting ran over")
**When** the blocker-handling path processes it
**Then** affected Plan Blocks are rescheduled around it
**And** the response is limited to a single confirmation line describing the schedule change — no suggestions for resolving the underlying obstacle, no commentary or judgment (UX-DR12, FR-10)

### Story 2.5: Slip-Bump — Escalating Priority for Slipped Tasks

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

### Story 2.6: Tone Escalation Tied to Escalate-Under-Strain

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

## Epic 3: Night Ritual — closing the day honestly

Every day closes cleanly: Spencer confirms what happened, or Yoh nudges once more (capped, on a different channel) and then backs off — never nagging indefinitely — carrying anything mandatory into tomorrow.

### Story 3.1: Night Ritual Close-Out Prompt & Status Write-Back

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

### Story 3.2: Capped Escalating Retry via Email

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

### Story 3.3: Unchecked-Day Handling & Rollover

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

## Epic 4: Memory & Self-Check — Yoh keeps track and asks how it's doing

Yoh remembers recent and historical patterns, never acts on a learned one without asking first, and periodically checks in on its own performance — checking in sooner after a bad signal.

### Story 4.1: Hot/Cold Memory Model

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

### Story 4.2: Propose-Don't-Impose Confirmation Gate

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

### Story 4.3: Periodic Self-Check

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

## Epic 5: Reliability & Observability — Spencer always knows when something's wrong

Since there's no one else to notice a silent failure, every ritual's crash, expired auth, or missed scheduled run gets surfaced to Spencer directly instead of going dark. No new FRs — this epic hardens the rituals Epics 1/3/4 already built.

### Story 5.1: Ritual Failure Alerting

As Spencer,
I want to be alerted immediately if any of Yoh's scheduled rituals crashes or fails,
So that a silent break in my planning system never goes unnoticed.

**Acceptance Criteria:**

**Given** any of the four `ritual-cli.ts` subcommands (morning, night-prompt, night-escalate, self-check) throws an error or returns a `Result` failure
**When** that subcommand's top-level handler catches it
**Then** it sends a Pushover alert worded distinctly from a normal Plan/close-out/Self-Check notification, before the process exits non-zero

**Given** a subcommand completes successfully
**Then** no failure alert is sent for that run

### Story 5.2: Dead-Man's-Switch — Missed-Run Detection

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

### Story 5.3: Structured Logging & Plan-Generation Performance Threshold

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

## Epic 6: Live Integrations — Yoh acts through chat, not just plans

Spencer can ask Yoh, from chat, to infer a missing Task field instead of guessing, create real items in Notion, edit Calendar events beyond the ones Yoh itself created, search the live web for an answer, and file research to the Vault — each write gated at the tier its risk warrants (automatic, direct, or confirm-then-write) before it ever touches his real data.

### Story 6.1: Confirm the Research Vault's Notion Schema

As a developer building Yoh,
I want the Research Vault database's actual property names (source URL, search date, title/body) confirmed and documented,
So that FR-26's and FR-29's schema validation has real property names to validate against instead of an assumption nobody has captured.

**Acceptance Criteria:**

**Given** the Research Vault database in Spencer's live Notion workspace
**When** its schema is inspected via the Notion API
**Then** the actual property names and types for source URL, search date, and title/body fields are documented in the codebase (e.g. alongside `notion-adapter.ts`) rather than assumed

**Given** the confirmed schema
**When** `createPage(database, properties)` is called with `database: 'ResearchVault'`
**Then** it maps Yoh's internal field names to the real Notion property names one-to-one, with no silent renaming or guessing at call sites

**Given** a property in the confirmed schema that is `select`-backed
**When** a value is written to it
**Then** it goes through the same fuzzy-match-then-fail-closed resolution as every other `select`-backed Notion write (AD-12)

### Story 6.2: Propose Inferred Values for the Data-Completeness Gate

As Spencer,
I want Yoh to propose a likely value for a missing Task field when it can confidently infer one from our recent chat, instead of always just asking blind,
So that answering the Data-Completeness Gate is faster when Yoh actually knows the answer, without ever guessing silently.

**Acceptance Criteria:**

**Given** an open `missing-field` interaction request for a Task
**When** `chat-cli.ts` is about to surface it
**Then** it calls `llm-adapter.ts` at that moment (not before, per AD-11 — `data-completeness-gate.ts` itself never calls an adapter) to check for a confident inference from recent chat context

**Given** `llm-adapter.ts` returns a confident inferred value
**When** the prompt is shown to Spencer
**Then** it is presented as a `Proposal<FieldValueSuggestion>` — stating the proposed value and why — rather than a blind "what's the value?" ask

**Given** Spencer confirms the proposed value
**When** it is applied
**Then** it flows through FR-24's existing Notion write path exactly as a manually-typed answer would — no separate write path for inferred vs. typed answers

**Given** Spencer corrects the proposed value, or `llm-adapter.ts` has no confident inference
**Then** Yoh falls back to FR-4's plain, blind ask — the inference path never blocks or replaces the baseline gate behavior

### Story 6.3: Create Notion Pages via Chat

As Spencer,
I want to ask Yoh to create a new item in Tasks, Projects, or the Research Vault from chat, and see exactly what it will create before it's real,
So that I can add things on the fly without opening Notion, and never get a page created that I didn't actually approve.

**Acceptance Criteria:**

**Given** Spencer asks Yoh to create an item and names one of Tasks, Projects, or Research Vault
**When** Yoh drafts it
**Then** the draft is validated against that database's real, live properties (AD-12) and shown to Spencer as a `Proposal<NotionPageDraft>` before anything is written

**Given** Spencer asks for a target database that isn't Tasks, Projects, or Research Vault
**Then** Yoh does not attempt the creation — those three are the only valid targets, enforced by `createPage`'s closed enum, not by a runtime string check alone

**Given** Spencer confirms the draft
**When** `createPage(database, properties)` runs
**Then** the schema is re-validated at write time (not just draft time) against the database's live properties, and the page is created only if it still resolves cleanly

**Given** a `select`-backed property in the draft
**When** it's validated, at draft time and again at write time
**Then** it is fuzzy-matched against the database's real live option list (exact → normalized → closest-match within a bounded threshold); a value that can't confidently resolve fails the write rather than guessing (AD-12)

**Given** the page is created
**When** `chat-cli.ts` responds
**Then** it echoes a one-line receipt naming what was created, built from `createPage`'s returned success value — no re-query needed

### Story 6.4: Web Search Lookup via Chat

As Spencer,
I want to ask Yoh a factual question and get a live, cited answer instead of a stale or made-up one,
So that I can get real answers without leaving chat, and trust that they're actually sourced.

**Acceptance Criteria:**

**Given** Spencer asks an explicit "search for X" request, or asks an unambiguous factual/research question
**When** `chat-cli.ts` classifies the `ChatIntent`
**Then** it routes to `search-adapter.ts`'s `search(query)`, calling Perplexity's Agent API (`/v1/responses`), never the deprecated Sonar chat-completions endpoint

**Given** a search completes
**When** the response is parsed
**Then** citations are extracted from the `search_results` item inside the response's `output[]` array, not from a top-level `citations` field

**Given** a search returns zero usable results
**Then** that is a successful `Result` carrying an empty/no-answer `SearchAnswer`, not a `YohError` — a search that legitimately found nothing hasn't failed

**Given** any other chat turn that is not an explicit search request or an unambiguous factual question
**Then** Yoh does not trigger a search — this is not run on every turn (FR-28)

**Given** a search runs
**Then** nothing is written to Notion or Calendar as a side effect of running it — search is read-only end to end

### Story 6.5: File a Search Result to the Research Vault

As Spencer,
I want to tell Yoh to save a search result it just gave me, and have it filed immediately,
So that useful research doesn't get lost, without an extra confirmation step for something I already just asked for.

**Acceptance Criteria:**

**Given** Yoh has just returned a `SearchAnswer` in the current chat session
**When** Spencer asks to save/file it (e.g. "save that")
**Then** `createPage('ResearchVault', properties)` is called directly, without a preview/confirm step — the save request itself is the confirmation (AD-12)

**Given** the page is created
**When** it's written
**Then** it is tagged with the search's source (from the `SearchAnswer`'s citations) and today's date, using the schema confirmed in Story 6.1

**Given** Spencer asks to save something that isn't a recent `SearchAnswer` from this session
**Then** Yoh does not fabricate a page from nothing — there must be an actual search result in play to file

**Given** the page is created
**When** `chat-cli.ts` responds
**Then** it echoes a one-line receipt naming what was filed

### Story 6.6: Confirm-Gated Calendar Editing Beyond Yoh-Owned Events

As Spencer,
I want to ask Yoh to move, resize, or create a time block on my real Calendar — including events it didn't create — and see exactly what will change before it touches anything,
So that I can manage my whole calendar through chat, without ever risking an event I care about being silently altered or deleted.

**Acceptance Criteria:**

**Given** `token-store.ts` needs to support FR-27
**When** it is provisioned
**Then** it holds a second, separately-scoped `OAuth2Client` (`calendar.events`, read/write across all accessible calendars) alongside the existing narrow client — both sole-constructed and held by `token-store.ts` per AD-10, and the existing narrow client's automatic "Yoh Plan" path is untouched

**Given** Spencer asks to move, resize, or create a time block on his Calendar
**When** `calendar-adapter.ts`'s `resolveCalendarEditRoute(eventId)` runs
**Then** every caller — including AD-4's own automatic path — routes through this single named function, returning `{kind: 'owned'}` or `{kind: 'external'}`

**Given** the target event is external (`{kind: 'external'}`) or the request is to create a new block
**When** Yoh proposes the change
**Then** it calls `proposeCalendarEdit(eventId, change)` (move/resize) or `proposeNewCalendarEvent(change)` (create, no `eventId`) and shows Spencer exactly what would change as a `Proposal<CalendarEditChange>`, naming the specific event

**Given** Spencer confirms, naming that specific event
**When** `applyCalendarEdit(proposal)` runs
**Then** it re-reads the live event and applies only a `move` or `resize` or `create` change — `CalendarEditChange`'s union has no `delete` variant, so a non-Yoh event cannot be deleted through this path even by a coding mistake

**Given** Spencer asks Yoh to delete a non-Yoh-owned event
**Then** Yoh does not perform it, confirmed or not — deletion of an external event isn't a constructible value in `CalendarEditChange`, so there is no code path that could carry it out

**Given** the edit is applied
**When** `chat-cli.ts` responds
**Then** it echoes a one-line receipt naming the event and what changed
