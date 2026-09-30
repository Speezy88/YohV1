---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-YohV1-2026-08-21/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-YohV1-2026-08-22/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/EXPERIENCE.md
updated: '2026-09-29'
epic13Status: "Planned 2026-09-29 — Epic 13 (FR-52–FR-60), Stories 13.1–13.13, from PRD §5.14, UX 2026-09-29 rows, and ARCHITECTURE-SPINE AD-25–AD-31. Replaces the 2026-09-27 sketch. FR-17 is superseded by FR-60 (Story 13.12 retires Self-Check)."
phase2StepsCompleted: [1, 2, 3, 4]
phase2Status: "Complete — Phase 2 (FR-30–FR-51 + amended FR-1/2/4/12–14/23/24), Epics 7–12, Stories 7.1–12.4 designed, validated, and approved 2026-09-25. Ready for sprint planning. Amended 2026-09-27 (Spencer): page order Home/Tasks/Desk/Research Hub, Chat is a panel (not a page), swipe navigation retired, Tasks page (Story 11.1) delivered early via the 2026-09-27 fixes + UI plan, Research Hub page shell added, Desk gains a Claude-spend tile, and backlog Epic 13 'Yoh remembers you' added."
epic6Status: "Complete -- Epic 6 (Phase 1.5, FR-25-29, Stories 6.1-6.6) fully designed, validated, and approved. Epics 1-6 all done; workflow finished 2026-09-18."
---

# Yoh - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Yoh, decomposing the requirements from the PRD, UX Design, and Architecture Spine into implementable stories.

> **Epic 6 status (2026-09-18):** Epics 1–5 are complete and shipped (Phase 1, `sprint-status.yaml`). Epic 6 (Phase 1.5: FR-25–FR-29, Live Integrations — Stories 6.1–6.6) is now also complete: designed, story-generated, and validated via `bmad-create-epics-and-stories`. All six epics are ready for sprint planning.

## Requirements Inventory

### Functional Requirements

FR-1: Generate and deliver the Morning Plan — one ordered Plan per day from current Tasks (Estimated Duration, Area, Due Date, Status, Energy) and today's fixed Calendar events, delivered as a single notification. *Amended 2026-09-27 (Spencer): delivery is in-app only — no Pushover push for the Morning Plan (FR-1 itself stands; only the delivery channel changes). `/plan` builds today's Plan on demand; `/morning` still never generates one.*

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

**Phase 2 — Web App (PRD §5.9–§5.13, updated 2026-09-25):**

*Amendments to shipped requirements (PRD §9.3 item 5). Each one changes behavior in a done epic and needs its own Phase 2 story:*

FR-2 (amended): A Pin (FR-31) fixes a Task's *time* for today only and never changes its Derived Priority. There is still no way to set priority manually.

FR-4 (amended — replaces Epic 1's gating on all five fields): Planning fields come in two tiers. **Required Fields** are Due Date and Estimated Duration. A Task missing either is not placed, and Spencer is notified that it needs data (FR-34). **Refining Fields** are Area and Energy. A Task missing one is still planned, with a neutral value on that factor, and is visibly marked as incomplete. The neutral value is never written to Notion. Status decides eligibility and is not a gate field. `[ASSUMPTION: empty Status = eligible]`

FR-23 (amended): Checking a Task off on Home (FR-41) is a second trigger for the same Status-only write. Night close-out does not re-ask about a Task already checked off.

FR-24 (amended): Missing-field answers are written back when they come from Chat on any surface, including /sandbox (FR-38). They are never written from an unattended Ritual run.

FR-1 / FR-12–FR-14 (amended): `/morning` and `/night` (FR-42) add on-demand entry points. The once-per-day push and the two-attempt escalation cap are unchanged.

*§5.9 Drag-to-Reshuffle (priority 1):*

FR-30: Drag a work block to a new time — Spencer drags a Yoh-owned Work/Break Block, with every Task in it, to a new start time on today's calendar in one gesture, and a Reshuffle Preview follows. Drag-and-release is the whole input. Only Yoh-owned blocks are draggable, and non-Yoh events render as fixed anchors. A split Task moves as a whole when any of its segments is dragged. Only today's not-yet-completed blocks can be dragged. `[ASSUMPTION: whole-Task drag; today-only]`

FR-31: Drag an individual Task (Pin) — dragging a single Task to a specific time makes it a Pin for today only, and a Reshuffle Preview places everything else around it. A Pin changes placement, never Derived Priority. It expires at the end of the day and never feeds Slip-Bump, memory, or learned patterns. Unpinning produces a fresh preview; per UX, this is done by clicking the pin icon on the calendar block.

FR-32: Animated Reshuffle Preview with one-click Approve — every drag produces an animated proposed day with a single Approve and a single Discard. There is no Calendar write before Approve, and Discard or navigating away leaves the Calendar exactly as it was. One Approve applies every moved block. The preview marks moved blocks against unchanged ones and names any Task deferred out of today. A stale preview (the Calendar changed) is recomputed rather than applied. A successful apply settles in-page. A failed or partial apply raises an In-App Notification and is never shown as success.

FR-33: Reshuffle scope and rules — a reshuffle recomputes only today's remaining, not-yet-completed, Yoh-owned blocks (Task blocks and Routine Blocks) around fixed anchors, using the Morning Plan's rules: Time Budget, Work/Break rhythm, Derived Priority for unpinned Tasks, active Pins, and Routines. It never moves, resizes, or deletes a non-Yoh event. A Task that no longer fits is deferred and named. Routine Blocks can shift but are never deleted. `[ASSUMPTION]`

FR-34: Needs-data notification for unplaceable Tasks — when a Morning Plan or a reshuffle would include a Task missing a Required Field, that Task is not placed. Instead, a needs-data In-App Notification deep-links to /sandbox. The Task never shows a guessed value and never silently disappears. The rest of the day is still planned.

FR-35: Routines (life-context blocks) — Spencer declares recurring time such as a commute or meals once. Yoh stores it as a Routine (not a Google recurring event) and places it each applicable day as an ordinary Yoh-owned Routine Block. Routine Blocks count against the day, can be dragged, and can be moved by a reshuffle. Routines are added, changed, or removed from Chat. Only declared Routines become blocks. `[ASSUMPTION: Chat-only declaration]`

*§5.10 /sandbox (priority 2):*

FR-36: /sandbox walks Tasks missing Required Fields — `/sandbox` in Chat starts a guided session with one card per Task missing Due Date or Estimated Duration. A card can't be completed with a Required Field empty. Refining and other fields are optional on the card. Order is stable, soonest-due first. Tasks missing only Refining Fields are not queued. `[ASSUMPTION: ordering; Refining-only excluded]`

FR-37: Skip, live counter, and per-card reward — Spencer can skip any card, which writes nothing and keeps the Task in the count for next time. A live count of Tasks still missing Required Fields decrements without a reload. Each completed card gets a reward cue, and a skipped card never gets one. *(UX refines this: a visual pulse per saved card, plus one sound when the batch is cleared — see UX-DR39.)*

FR-38: /sandbox write-back and proof-of-action finale — each completed card is written through FR-24's path. This is direct-write, with no second confirmation, and select-backed values go through the same guard (real options only; an unresolvable value re-prompts on that card). At the end, a loading-bar finale plays while writes settle. The completion In-App Notification appears only after every write has succeeded. Otherwise it names the Tasks that failed. The finale never adds a required click.

*§5.11 Pages and App Shell (priority 3):*

FR-39: Three-action capture flow — from a closed laptop: open the laptop → click the Yoh icon → type the Task in the ~~chat bubble~~ **Ask Yoh pill** *(amended 2026-09-27)* and press Enter. There is no login, picker, or intermediate screen, and no Phase 2 feature may add a required click. This is a regression gate. Every page is reachable from every other in one gesture or click. ~~swipe, plus a visible non-swipe fallback~~ **Swipe navigation retired 2026-09-27 (Spencer):** navigation is a vertical page stack (smooth up/down arrow buttons, ↑/↓ keys, an edge-aware mouse wheel, and a left nav sidebar).

FR-40: Home page — today's Plan checklist on the left (in exact Plan order, reflecting any approved reshuffle without a reload), today's calendar day view on the right (where drag happens, with non-Yoh events visibly fixed) plus, *added 2026-09-27*, today's Time Budget (editable in place) and a mini month, and the Ask Yoh pill fixed bottom-center *(was: a small chat bubble at the bottom — renamed 2026-09-27, now on every page)*. Pressing Enter sends the message and opens the Chat panel with it as the first turn.

FR-41: Check off a Task — checking a Task on Home fades the row, writes Status = completed to Notion (Status only, never a delete), and writes a Completion Log record. Night close-out doesn't re-ask about it. A short undo window applies. `[ASSUMPTION: ~5 s undo]`

FR-42: ~~Chat page~~ **Chat panel** *(amended 2026-09-27: there is no Chat page — Chat is a panel over every page, opened from the Ask Yoh pill or ⌘K)* and slash commands — Chat replaces the CLI as the Chat surface. It has five commands (`/morning`, `/plan` *(added 2026-09-27: builds today's Plan on demand; `/morning` never does)*, `/night`, `/sandbox`, `/research`), and typing `/` opens a filterable Command Palette that lists each command with a description and an example. While Yoh works, a loading indicator shows status text, and responses stream. Parity with every CLI Chat capability is required before retirement: Time Budget, Re-Flow, Blockers, open interaction requests and Proposals, FR-24–FR-29, and Self-Check. Yoh never claims a capability it doesn't have, and it closes conversations naturally. `/morning` shows today's Plan, its reasoning line, and pending items, without re-pushing or regenerating. `/night` runs close-out interactively; that counts as the night's close-out, cancels the scheduled prompt and the escalation, and the day is never marked unchecked. ~~The left menu bar is empty or hidden in Phase 2.~~ *Amended 2026-09-27: the left menu bar is the nav sidebar (Home/Tasks/Desk/Research Hub + Theme Toggle) — no longer empty.*

FR-43: Tasks page — the full Notion Tasks database, grouped by Area with other groupings available, ~~plus one research box: the latest research output up front and the full Research Vault library browsable in the same box. It is the only research surface.~~ *Amended 2026-09-27 (Spencer): the research box moves to the new Research Hub page (see Epic List). Tasks itself is pulled forward from Epic 11 into the 2026-09-27 fixes + UI plan, with a quick-add row and Notion-speed inline editing; a Task Spencer types himself is a direct write (FR-24 tier), amending AD-3/AD-12.* A research-ready notification deep-links straight to the new document on Research Hub.

FR-44: Desk dashboard — widgets built from Yoh's own data (Completion/Activity Log only, never Notion history): Tasks Completed list, minutes worked, on-time rate, usage streak, hours worked with Yoh, a usage heatmap, and *(added 2026-09-27)* a "Claude API spend this month" tile computed locally from Task 9's per-call usage records × one price table. Public-feed widgets: BTC/ETH/SOL tickers, weather for Seattle WA *(confirmed 2026-09-27)*, and news — the biggest business stories with an AI emphasis *(confirmed 2026-09-27)*. Each feed widget fails independently, showing "unavailable" or its last value with a timestamp. No Task or Calendar data is sent to any feed provider. `[ASSUMPTION: on-time = completedAt ≤ dueDate]`

FR-45: Screensaver — animated gradient-dot field with the centered "Yoh Meeseek" wordmark. It shows as a launch splash that auto-fades into Home with no click, and after inactivity. Any input dismisses it and returns to the same page with unsent chat text intact. It is decorative only and shows no data or notifications.

*§5.12 Design System (priority 3):*

FR-46: Consistent design system — one shared token set (color, surface/shadow, type, motion) across every page: off-white/black neumorphism and a bold Montserrat "Yoh Meeseek" wordmark. Motion accompanies state changes (check-off, reshuffle, thinking, streaming, page transitions), and no page ships a static loading state. Contrast meets NFR-Accessibility. No persistent action button duplicates a slash command. *(UX extends this with a blue accent, dark mode, glass on floating elements, and the Theme Toggle as a sanctioned exception — see UX-DR22–UX-DR27.)*

*§5.13 Groundwork (required by §5.9–§5.12):*

FR-47: Yoh-owned Completion and Activity Log — a durable record of every completion (from check-off or close-out) with Task identity and name, Area, Due Date, Estimated Duration, and completion time. It also records every day Spencer used the Web App, enough for the streak, heatmap, and hours metrics. Entries survive Notion changes and deletions. Keeping both the estimate and the completion time preserves Phase 6 self-calibration without a later migration.

FR-48: Surface-agnostic confirmation — any confirm-then-write can be confirmed from any interactive surface. A Web App control (Approve, a Chat confirm) counts exactly like a typed "yes", under the same rules: apply only after an explicit confirmation, and reject a stale proposal. Unattended Ritual runs never supply a confirmation. Proposals left open when the CLI retires stay visible and resolvable in the Web App.

FR-49: In-app notifications — one reusable capability that appears on whatever page is open and deep-links to its target in one click. Consumers: research ready/failed, /sandbox complete/failed, needs data, reshuffle apply failed, and operational problems. A notification fires only as the result of something Spencer started or a system failure, never as a proactive check-in. ~~It does not replace the Morning push or the Night push/email channels.~~ *Amended 2026-09-27 (Spencer): the Morning Plan no longer pushes — it's in-app only. It does not replace the Night Ritual's push/email escalation, which is unchanged.*

FR-50: Retire the CLI — once the Web App covers FR-42's parity list, the interactive CLI is retired. Rituals keep running unattended on schedule. No capability is lost. Open interaction requests and Proposals created by Rituals surface in the Web App.

FR-51: /research — asynchronous research questions — `/research <question>` queues a research question. Yoh searches, files the result to the Research Vault (direct-write, because the command is the save request), and raises a research-ready notification. Spencer can leave the page or close Chat and the result still arrives. FR-29's provenance rule and FR-28's citation and honest-failure rules apply, and a failed search raises a failure notification. Research never runs without the command. *(UX adds a one-time Structured Question offer, which runs only if accepted — see UX-DR38.)*
FR-52: Persistent chat history — transcripts stored on the host, kept until Spencer deletes one Conversation or clears all (confirm step); searchable from the Memory page; never replays an action.
FR-53: Memory folders and items — eight fixed folders (Feedback, Planning preferences, Corrections, About you, Patterns always loaded; Goals & projects, Decisions & commitments when relevant; Ideas & notes only when asked); stated vs inferred; expiry; Feedback scope; nothing duplicated from Notion/Calendar/Yoh stores.
FR-54: Automatic filing with a visible Remembered Receipt and Undo — after the reply, ≤2 items per turn, only from Spencer's typed words, restate updates, contradiction supersedes, no inferred health/emotion/finance.
FR-55: Memory commands — "remember that …", `/remember`, "forget …", `/forget`, "what do you remember about …", recognized deterministically; "remember to …" stays a Task.
FR-56: Recall in answers and planning — always-loaded folders capped, relevant folders on keyword match, never in routing; live data wins; 120-day and over-cap items to Needs review; the scheduler never reads memory.
FR-57: Memory never silently overrides a built-in rule — a conflicting preference raises a Yes/No rule-change Proposal; confirmed changes are revertible settings.
FR-58: Patterns are proposed with evidence, never assumed — repeated evidence over ≥2 weeks; a No is quiet for 30 days.
FR-59: Memory page — the fifth page: folders, search over memories and chat history, edit/move/delete/expiry, history, Needs review, changed settings.
FR-60: "How is Yoh doing?" 1–3 Rating — replaces FR-17; ≤1/day after a substantive turn, in-app only; a 1 asks "What was off?" and brings the next prompt forward; ratings never loaded into a model call.

### NonFunctional Requirements

NFR-Reliability: The Morning and Night Rituals must run daily without manual intervention. A failure to run (crash, expired auth token, unreachable API) must be surfaced to Spencer, not fail silently — there is no other user to notice an absence.

NFR-DataIntegrity: Writes to Calendar or Notion must never corrupt or lose Task/Calendar data, and must never touch a record Yoh doesn't own (FR-22, FR-23) — with exactly one confirm-gated exception, FR-27 (AD-13). **Phase 1.5:** every write sits at one of three tiers, chosen per capability and never defaulted — automatic (FR-22, FR-23), direct-write (FR-24, FR-29), or confirm-then-write (FR-25, FR-26, FR-27). Every write triggered from chat (FR-24–FR-29) is echoed back to Spencer as a one-line receipt in that same session.

NFR-Latency: Plan generation must complete comfortably before the Morning Ritual notification is due — no hard SLA, but "fast enough to not feel broken" (low seconds, not minutes); a slow/hung Morning Ritual is functionally the same failure as one that doesn't run.

NFR-Observability: Yoh must be able to tell Spencer when something has gone wrong with its own operation (auth expired, integration unreachable, a scheduled ritual didn't fire) rather than simply going dark.

**Phase 2 NFRs (PRD §6, updated 2026-09-24):**

NFR-DataIntegrity (Phase 2 writes): Every Phase 2 write sits at an existing tier.
- **Direct-write:** check-off (FR-41, Status only), /sandbox answers (FR-38), and `/research` filing (FR-51).
- **Confirm-then-write:** applying a Reshuffle Preview (FR-32, with Approve as the confirmation, Yoh-owned events only).
- No Phase 2 capability deletes anything from Notion.
- On the Web App, a write triggered in Chat gets its receipt in Chat. A write triggered elsewhere is acknowledged by its visible result or an In-App Notification. A failed write is always surfaced and never shown as success.

NFR-Latency (Phase 2 interactive): These are starting targets, to be tuned in use.
- The Reshuffle Preview begins animating within about 2 s of drag-release.
- A check-off fades immediately, and the Notion write finishes in the background.
- Chat shows a thinking state within a fraction of a second of sending.

NFR-Accessibility (new): WCAG 2.2 AA in both themes.
- Text meets 4.5:1, and interactive boundaries (checkboxes, Approve/Discard, chat input) meet 3:1.
- A soft shadow is never the only cue that something is clickable or checked.
- Motion respects the OS reduced-motion setting by shortening or becoming a fade, and no information is conveyed by motion alone.

NFR-CaptureSpeed (new): The three-action capture flow (FR-39) is a standing requirement. Any change that adds a required step is a regression.

NFR-Observability (Phase 2): Operational problems also raise an In-App Notification (FR-49) when the Web App is open, in addition to the existing Pushover channel.

**Constraints (Cross-Cutting, not individually numbered):**
- Privacy: all Task/Calendar data is personal, single-user; no data leaves Spencer's own Notion workspace/Google account except as required by the integrations themselves; no third-party analytics/telemetry.
- Cost: must run on infrastructure Spencer already owns; no new recurring paid service required for Phase 1.
- Safety: not a meaningful concern for Phase 1's software-only surface (relevant from Phase 3 onward only).
- Privacy, Phase 2 exception: Desk's public feeds (crypto tickers, weather, news) send only the query itself: ticker symbols, a location, or news categories. They never send Task, Calendar, or usage data. No third-party analytics script ships in the Web App.
- Cost, Phase 2: public feeds use free tiers only. A feed whose free tier disappears is dropped or replaced, never upgraded. The Web App is hosted on infrastructure Spencer already owns and must be reachable from the laptop in class.

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

**Phase 2 (Web App) — from ARCHITECTURE-SPINE.md AD-15–AD-24 and the Phase 2 revisions to AD-1/3/5/7/9/10/11/12 (spine updated 2026-09-25):**

*Starter / scaffold:* No starter template. This is a brownfield extension of the existing repo. A new `web/` Vite + React SPA with its own tsconfig is the only build step in the repo. New stack:
- Server: Hono + `@hono/node-server` ^4.13 (routes, `streamSSE`, `hono/client` typed RPC).
- Client framework and build: React ^19.3, Vite ^8.3, Tailwind CSS 4.x via `@tailwindcss/vite` ^4.2.2 (CSS-first config carrying the DESIGN.md tokens).
- UI and motion: shadcn/ui (component source copied in, Tailwind v4 mode) and `motion` ^13.4.
- Drag: `@dnd-kit/react` 0.5.x — pin the exact version and keep it behind one `web/` hook. Never use the legacy `@dnd-kit/core`.
- Fonts: Figtree and Montserrat, self-hosted (`@fontsource/*`).
- Tests: Vitest + React Testing Library (jsdom) and one Playwright smoke suite covering capture, check-off/undo, and drag → preview → Approve. Pin versions at install.
- Hosting: Tailscale free personal plan.

*Brownfield refactors that come before new Phase 2 feature work (spine Deferred, last bullet):*
- `adapters/sqlite.ts` becomes the only file that opens the SQLite file. It opens one connection per process (WAL, `busy_timeout`, `foreign_keys` on) and exports `writeTx(fn)` using `BEGIN IMMEDIATE`. `memory-store.ts` is refactored to take the shared handle (AD-10).
- `chat-cli.ts`'s blocking multi-question `io.readLine()` handlers (data-completeness, night close-out, Self-Check, Proposal answer) are **restructured into resumable, one-shot-per-turn `app/` flows**. The logic is moved, not copied, and its tests move and adapt with it (AD-16).
- `rituals/mid-day-reflow.ts` moves onto `rituals/reshuffle.ts`'s single day-refit pipeline (AD-19).
- FR-4 two-tier gate. `CompleteTask` requires only Due Date and Estimated Duration. Refining fields are typed `Refining<T> = {kind:'set',value:T} | {kind:'missing'}`, never `T | undefined` and never defaulted. `derived-priority.ts` maps `'missing'` to a neutral score that exists only inside that computation. It is never stored, sent as a real value, or written to Notion. The Plan and `ReshufflePreview` carry each placed Task's missing-Refining list (AD-11).
- `setTaskStatus` writes Status only and **never trashes**. This reverts the 2026-09-22 trash-on-completion behavior. Its schema-checked `closestOption` resolution stays (AD-12).

*Layering and contracts:*
- AD-1 revised: `shell/{server,chat-cli}.ts → app → {rituals, core, adapters}`. `shell/ritual-cli.ts` and `rituals/` never import `app/`. `web/` reaches the system only over HTTP/SSE and uses only `import type` from `types/`.
- AD-9 revised: `types/api.ts` is authored and locked before any `app/`, `shell/server.ts`, or `web/` file that uses it. It holds request/response DTOs, `ChatMessage` including the Structured Question variant, `NotificationKind`, the event-hint shape, and `ReshufflePreview`'s wire shape.
- `types/domain.ts` gains `Refining<T>`, `PlanBlockKind` (extended, never replaced) = `'work' | 'break' | 'calendar-anchor' | 'routine'` plus `routineId`, `Pin`, `Routine`, `ReshufflePreview`, `Completion`, and `ResearchJob`.
- The drag UI addresses blocks and Tasks by `PlanBlock.id` or Notion Task id, never by screen position or index.
- AD-16 `app/` layer: one file per use-case, e.g. `confirm-proposal`, `surface-open-items`, `chat-turn`, `morning-view`, `night-close-out`, `check-off`, `sandbox-queue`, `sandbox-submit`, `request-reshuffle`, `approve-reshuffle`, `queue-research`, `routines`, `notifications`, `desk`, `tasks-view`, `time-budget`.
  - Each exports `(deps, input) → Promise<Result<Output, YohError>>`.
  - Shells are transport only. `app/` is the only caller of AD-12 Notion writes, AD-13 `applyCalendarEdit`, and the AD-19 reshuffle apply.
- AD-17 browser client:
  - Vite + React SPA served by `server.ts`, calling through the typed Hono RPC client.
  - **Every Plan, priority, reshuffle, gate result, and Desk metric is computed server-side.** The client caches server state and refreshes it after each mutation and on each SSE hint.
  - Optimistic UI is visual only.
  - Ephemeral view state (unsent chat text, scroll position, current page, an in-progress drag) is client-only.
  - No secret ever reaches the browser, and the CSP is `default-src 'self'`.
- API convention: routes are `/api/<noun>[/<verb>]`, JSON in and out, returning `{ok:true,value} | {ok:false,error:YohError}`. React components use PascalCase files.

*Process, hosting, and liveness:*
- AD-15:
  - Everything runs on the always-on Pi/home server. Cron rituals stay OS-scheduled one-shots.
  - `shell/server.ts` is a separate systemd-supervised process (`Restart=always`). It serves the `web/` bundle, `/api/*`, SSE, AD-20's commit sweep, and AD-21's job runner. It schedules no ritual.
  - It listens on loopback only and is reached solely via `tailscale serve` HTTPS (MagicDNS). No Funnel, port-forwarding, or public domain.
  - Tailnet membership is the authentication, so there is no login.
  - The one-click icon is a PWA installed from the tailnet origin.
  - **Verification spike:** Tailscale on the real school network and PWA install in Spencer's Windows browser. If school blocks Tailscale, reopen AD-15.
- AD-7 Phase 2:
  - The server writes a heartbeat on a fixed interval. `ritual-cli.ts morning` checks it and sends a Pushover alert if it's stale.
  - Every alert condition also appends an `operational` in-app notification.
- Deployment: `git pull` → `npm ci` → build `web/` → restart the server unit. A nightly cron job does a SQLite online backup to a second location. **The target location must be chosen before Phase 2 goes live.**

*Storage (AD-10 Phase 2):*
- The server and the cron one-shots share one SQLite file in WAL mode. No read transaction is held across an `await`.
- New owner files each own **dedicated SQL tables**, created idempotently on startup: `completion-log.ts`, `routine-store.ts`, `plan-state-store.ts` (Pins, pending check-offs, open reshuffle pointer, server heartbeat), `notification-store.ts` (notifications, read state, outbox), and `job-store.ts`.
- Each record kind has exactly one owning file. A change that spans owners runs in one `writeTx` through each owner's `…InTx(tx, …)` exports.
- `memory-store.ts` takes on none of these kinds.

*Interaction, confirmation, notifications:*
- AD-3 / FR-48: Web controls (Approve, a Chat confirm button, a Structured Question option) and a typed "yes" all call the same `app/` confirm function with the same staleness check. No surface has its own apply path.
- AD-5 Phase 2:
  - Open interaction requests and Proposals render at the top of Chat. They block only conflicting writes (a second answer to the same field, or a second reshuffle), never unrelated chat.
  - `/morning` reads the stored Plan and open items and never regenerates or re-pushes.
  - `/night` records close-out in the same `memory-store.ts` record that `night-escalate` checks, and `night-prompt` gains the same no-op check.
  - Ritual close-out and Self-Check raise **no** in-app notification. The only ritual-raised kinds are `needs-data` and `operational`.
  - `chat-cli.ts` is deleted once FR-42 parity passes.
- AD-18 live delivery:
  - `notification-store.ts` record: `{id, kind, title, body, deepLink, createdAt, readAt?}`.
  - `NotificationKind` is a **closed** union: `research-ready | research-failed | sandbox-complete | sandbox-failed | needs-data | reshuffle-apply-failed | operational`. A check-in notification can't be constructed.
  - Every user-visible change appends an outbox row `{seq, topic, entityId}` in the same transaction. The server tails the outbox (~2 s poll) and pushes hints only over one SSE stream, `GET /api/events`, with `Last-Event-ID` replay and a keep-alive comment on each tick.
  - Chat responses stream on their own SSE response.
  - **Verify:** SSE behaviour through `tailscale serve`.

*Feature mechanics:*
- AD-11 /sandbox queue: computed, not stored, by `app/sandbox-queue.ts` running the gate over live Notion Tasks, soonest-due first. The counter, the needs-data indicator, and the needs-data notification count all read this one function.
- AD-12 revised:
  - Notion writes are called only from `app/*`.
  - /sandbox cards call `updateTaskField` synchronously per card. `app/sandbox-submit.ts` raises `sandbox-complete` or `sandbox-failed` only after every card write has settled.
  - `/research` filing uses `createPage('ResearchVault', …)` through the AD-21 job runner.
- AD-19 reshuffle:
  - Requests are `move-block`, `pin-task`, or `reflow-now`; a typed Re-Flow uses `reflow-now` and serves as the WCAG 2.5.7 non-drag path. `rituals/reshuffle.ts` runs the **same** core pipeline as the Morning Plan.
  - The result is a `Proposal<ReshufflePreview>` whose snapshot is `Plan.version` plus a calendar hash (event ids + `updated`).
  - One open proposal at a time, server-enforced: a new request supersedes it, with a ~10 min TTL.
  - Pins live only inside the proposal until Approve. After that, `plan-state-store.ts` persists them dated today. Pins are never an input to priority, Slip-Bump, learning, or the Completion Log.
  - `approve-reshuffle` re-reads the calendar and recomputes if stale. Otherwise it writes the Plan and Pins in one `writeTx`, then applies changes on the **narrow** client only. Each target goes through `resolveCalendarEditRoute`, and `'external'` aborts.
  - Writes are idempotent via the `PLAN_BLOCK_ID_EXTENDED_PROPERTY` tag. A partial failure lists the written blocks and raises `reshuffle-apply-failed`.
  - A Blocker report stays an unconditional apply through the same refit.
- AD-20 check-off:
  - `app/check-off.ts` records a pending completion in `plan-state-store.ts` with `completedAt` set to the click instant and `commitAt = completedAt + undo window`. The response returns `commitAt`, and Undo deletes the pending record.
  - A server timer commits due records, and a startup sweep catches overdue ones.
  - Commit order: `recordCompletion` first, then `setTaskStatus(completed)`. A Notion failure keeps the log entry, marks the sync as pending retry, and raises `operational`.
  - `night-ritual.ts` excludes Tasks completed today.
- AD-21 /research job: `app/queue-research.ts` inserts a queued job. An in-server runner claims one job at a time, runs search → `createPage` → marks the job done, and raises `research-ready`. A failure raises `research-failed`. A job left `running` after a crash is set to failed with a notification and is **never** auto-re-run. Nothing else creates research jobs.
- AD-22 public feeds:
  - `crypto-feed.ts`, `weather-feed.ts`, and `news-feed.ts` are server-only. Each has its own cache with a last-good value and a `fetchedAt` timestamp (refresh starting points ~5/30/60 min).
  - They return `{status:'ok'|'stale'|'unavailable', value?, fetchedAt?}` and never throw.
  - Their request signatures cannot carry Task, Calendar, or usage data. They share no code with Notion or Calendar.
  - **Providers and weather location not yet chosen** (free tier only).
- AD-23 Completion Log:
  - `recordCompletion({taskId, taskName, area, dueDate, estimatedMinutes, completedAt, source:'check-off'|'close-out'})` is the only completion write, called by both AD-20 and `night-ritual.ts`.
  - `recordActivityDay(date)` is an idempotent upsert.
  - Every Desk metric is a pure function in `core/desk-metrics.ts` over log rows: list, minutes today, all-time hours, on-time rate, current and longest streak, heatmap.
- AD-24 Routines:
  - `routine-store.ts` stores `{id, label, days, start, durationMinutes}`. Routines change only via Chat through `app/routines.ts`.
  - The same `core/work-break-fit.ts` step places them for both the Morning Plan and a reshuffle.
  - Placement precedence: anchors and Pins first (a Pin overlapping an anchor is rejected, and the preview says why); then Routines, at or near their declared time, shiftable but never dropped (an unfittable Routine is flagged); then work and break blocks.
  - Each Routine is one tagged event per day on "Yoh Plan", never an RRULE.

*Conventions:*
- Timezone: "today", Pin expiry, activity days, the streak, and the Feb 19 confetti all use the host's configured `TZ`, never the browser's.
- Design tokens: one source (CSS custom properties, light and dark) consumed through the Tailwind v4 theme. No component hard-codes a color, shadow, radius, or duration.
- Motion and fonts: animations read one reduced-motion flag. Fonts are self-hosted, never loaded from a CDN.
- Per-device preferences (theme, Tasks grouping) live in `localStorage`.
- Tuning constants (heartbeat interval and staleness, undo window, reshuffle TTL, outbox poll): each cross-file number has exactly one defining export, and the client gets them from API responses.
- The server logs duration per API request and per reshuffle computation.

*Deferred tuning (a starting value belongs in the owning story):* outbox poll ~2 s, heartbeat interval and staleness threshold, undo window ~5 s, reshuffle TTL ~10 min, Screensaver idle 10 min, feed refresh ~5/30/60 min.

*Open pre-build items (surface as spikes or gating tasks):*
- Public-feed providers and weather location.
- Nightly backup target.
- Tailscale on the school network, plus Windows PWA install.
- SSE through `tailscale serve`.
- Chat transcript persistence. Phase 2 default is client memory only. If it must survive a reload, a new `chat-store.ts` owner is needed; `web/` must not invent storage.
- `@dnd-kit/react` pre-1.0 risk.

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

**Phase 2 — Web App (from `DESIGN.md` + `EXPERIENCE.md`, web-primary spines, status draft, updated 2026-09-25).** Where the spines and `.working/` explorations disagree, the spines win. UX-DR1–UX-DR21 (CLI) stay in force until FR-50 retires `chat-cli.ts`. The Phase 1 no-gamification ban (UX-DR8) still applies inside the CLI. The web app uses the relaxed rule in UX-DR50.

*Foundations and tokens:*

UX-DR22: Color token system. Implement every DESIGN.md color token as a CSS custom property with a light value and a `-dark` value, consumed through the Tailwind v4 theme.
- Surfaces: `surface-base`, `surface-raised`, `surface-sunken`.
- Ink: `ink-primary`, `ink-secondary`.
- Rims: `rim-interactive`, `rim-structural`, `rim-highlight`.
- Shadows: `shadow-light`, `shadow-dark`.
- Glass: `glass-fill`.
- Accent: `accent-gradient-start` / `accent-gradient-end`, `accent-solid`, `on-accent-solid`, `accent-glow`.
- Fixed events: `event-fixed-stripe-a` / `event-fixed-stripe-b`, `event-fixed-ink`.
- No component hard-codes a value.
- The palette is two neutral families plus one accent, with no second accent hue.
- No error or warning color exists yet. Failures are carried by words.

UX-DR23: Typography.
- Figtree is self-hosted (SIL OFL) and preloaded. The fallback face carries metric overrides (`size-adjust`, `ascent-override`) so the swap causes no layout shift.
- `system-ui` and SF Pro are never in the stack.
- Roles: ~~display 26/700, title 17/700, body 13.5/500~~ *(amended 2026-09-27, Spencer: bigger scale — body 17-18px, headings ~40px, controls 44-64px; exact values confirmed against the approved mockup in Task 6A)*, label 11.5/700, caption 10.6/700 uppercase +0.06em, and numerals 13.6/600 with `tabular-nums` for every Desk figure, time, and counter.
- Montserrat bold is used only for the "Yoh Meeseek" wordmark on the splash and Screensaver.
- `[ASSUMPTION]` Sizes carry over 1:1 at full laptop size; confirm on key-screen mocks.

UX-DR24: Spacing, radius, and elevation scales.
- Spacing: a 4 px scale (`spacing.1`–`6` = 4–32 px), `rim-width` 1.5 px, `focus-ring-width` 2 px.
- Radius: xs 5, sm 8, md 10, lg 16, xl 24, full.
- Elevation recipes in light and dark: Inset, Extruded-sm/md/lg (light source top-left at 135°), and Glass (fill + 14–18 px backdrop blur, saturate 140%, + rim).
- Glass is only for floating elements: the Ask Yoh pill *(was Chat Bubble)*, Chat Input, Undo Toast, In-App Notification, Command Palette.
- Where `backdrop-filter` is unsupported, fall back to an opaque `surface-raised` fill with the same rim.
- Pills are only for things that float or navigate.
- Page frame: `spacing.5` padding and `rounded.xl`.

UX-DR25: Hairline rim rule. Every interactive surface gets a 1.5 px neutral rim.
- Light: `#807C72`, 3.20:1.
- Dark: `#7A7367` plus an inset `rim-highlight`.
- A shadow is never the only boundary.
- `accent-solid` marks only focus and primary elements.
- Focus: 2 px `accent-solid` ring. The Ask Yoh pill *(was Chat Bubble)* and Chat Input also get `accent-glow`.
- `rim-structural` is for non-interactive seams only.
- The contrast pairs in DESIGN.md's measured table must hold in both themes.

UX-DR26: Gradient rule.
- ~~The full two-stop "Sky → Azure" gradient (135°) is used in exactly two places: the Thinking Indicator shimmer and the active Page Indicator pill.~~ *Amended 2026-09-27 (Spencer): the two-moment limit is lifted.* The gradient now also runs on the active nav sidebar item, primary buttons, checked Checkboxes, today's date, and Plan blocks, in addition to the Thinking Indicator shimmer and accent headings.
- Every other accent, and anything carrying text or a glyph on the light gradient stop, uses `accent-solid`: focus rings, the dragging and moved outlines, toast bars, the Sandbox Finale bar, active icons.
- The gradient is never a page or card background.

UX-DR27: Light and dark themes with a Theme Toggle.
- Toggle: a 30 px circle, ~~in a top corner of every page~~ *(amended 2026-09-27: lives in the left nav sidebar, below the page list)*, 1 px `accent-solid` border, Extruded-sm, sun or moon glyph.
- First launch follows the OS appearance. A manual toggle persists per device in `localStorage`. `[ASSUMPTION]`
- The toggle is a sanctioned exception to FR-46's no-persistent-button rule.

*Navigation and shell:*

UX-DR28: Pages, Nav Sidebar, and navigation.

**Swipe navigation retired 2026-09-27 (Spencer).** This rule is rewritten; the pre-2026-09-27 version (four pages including Chat, swipe as primary navigation) is superseded in full.

- Pages run Home → Tasks → Desk → Research Hub, in a vertical stack, one in view at a time. There is no Chat page — Chat is a panel over every page (see UX-DR35/36).
- Navigation moves one page via: on-screen up/down arrow buttons (smooth transition); the ↑/↓ keys (and Page Up/Page Down) when no text field has focus; the mouse wheel, only when the hovered scroll area is at its edge (never hijacks in-page scrolling); or the left nav sidebar, which jumps directly to any page.
- Nav Sidebar: Yoh wordmark, then Home/Tasks/Desk/Research Hub as icon+label rows, then the Theme Toggle. The active item is a gradient-filled pill.
  - Page changes announce "Tasks, page 2 of 4".
- Page transitions slide vertically, or cross-fade under reduced motion.
- Modal depth is one: the Command Palette is the only layered panel.
- No swipe gesture exists anywhere in the app.

UX-DR29: Screensaver.
- A full-bleed `surface-base` field of drifting gradient dots at varied transparency, with the centered Montserrat "Yoh Meeseek" wordmark. It shows no data or notifications.
- As a launch splash it covers the cold load and auto-fades into Home with no click.
- It also appears after 10 min idle. Scroll and pointer movement count as input.
- It is an overlay, not a navigation. Any input restores the same page, scroll position, and unsent chat text.
- Reduced motion: a static dot field.
- `[OPEN: dot count, speed, wordmark size]`

*Home:*

UX-DR30: Plan Row and Checkbox.
- The Plan Row is ordered exactly as the Plan and reflects an approved reshuffle without a reload.
- Checkbox: 17 px, `rounded.xs`, inset well, rim. Checked = `accent-solid` fill with an `on-accent-solid` mark.
- On check: checkmark + strikethrough + 50% opacity, then the row dissolves immediately and an Undo Toast appears. Reduced motion hides the row instantly.
- A pinned Task shows a "pinned" badge on its row. The badge is an indicator only.
- Empty-checklist state: "Nothing left on today's Plan." No celebration.
- No-Plan state: "No Plan yet today. Type /plan to build it now." ~~The Chat Bubble stays live.~~ *(amended 2026-09-27: the Ask Yoh pill stays live)*
- `[OPEN: any further Home reaction on check-off]`
- *Added 2026-09-27 (Spencer):* Home also always shows today's Time Budget (editable in place) and a mini month, alongside a Google-Calendar-style day view (a scrolling hour grid opening at the current time, with a now-line and rounded event blocks). It never stretches the full screen height. Untitled or punctuation-only events show "(No title)".

UX-DR31: Undo Toast.
- Glass with a 3 px `accent-solid` left bar: "Checked off {Task} · Undo". Undo is a Secondary button.
- It stays visible until the server-provided `commitAt`, about 5 s.
- The timer pauses while the toast is hovered or focused (WCAG 2.2.1). `[ASSUMPTION]`
- Undo restores the row and cancels the pending write.
- It is announced via `aria-live="polite"`.
- It is local feedback, not an FR-49 notification.
- Check-off write failure: the row returns and an In-App Notification appears: "Couldn't check off {Task}".
- `[OPEN: several check-offs in quick succession — queue, merge, or restart the timer]`

UX-DR32: Calendar Day View and Calendar Block.
- The day view shows today only: hour labels in caption style, a `rim-structural` rail, and faint hour lines.
- Three block variants:
  - **Yoh-owned** (Task, Work/Break, Routine): `surface-raised` + Extruded-sm, draggable.
  - **Fixed anchor** (non-Yoh): cross-hatch stripes, `event-fixed-ink`, label suffixed "(fixed)", no shadow, can't be picked up.
  - **Dragging**: 1.5 px `accent-solid` outline, labeled "(dragging, from 2:00)", with a gentle bob (2.6 s, 1.5 px).
- Completed and past blocks are read-only.
- Dragging a Task out of a block pins it.
- Every color cue is paired with a glyph or word.

UX-DR33: Pin Control.
- A small pin glyph on a pinned Calendar Block, in a `surface-sunken` pill with an `event-fixed-ink` glyph.
- Clicking the pin icon unpins the Task and produces a fresh Reshuffle Preview. This is also the non-drag unpin path.

UX-DR34: Reshuffle Preview.
- A `surface-raised` card under the calendar: a one-line summary in body/600 naming moved blocks and deferred Tasks (e.g. "Moving Study block to 4:00. Dinner shifts 15 min; Read Ch. 6 moves to tomorrow."), then a Primary "Approve" and a Secondary "Discard".
- Blocks glide to their proposed slots. Moved blocks reuse the accent-solid outline, and unchanged blocks stay plain. Reduced motion cross-fades.
- The preview opens within ~2 s of release.
- While it's open, further drags are blocked until Approve or Discard. `[ASSUMPTION]`
- A stale Approve recomputes and shows a fresh preview.
- Success: the calendar settles and the Plan list reorders.
- Failure: the calendar shows the true state and a "Couldn't update your calendar" notification deep-links to Home.

UX-DR35: ~~Chat Bubble (Home only)~~ Ask Yoh pill (every page). *Amended 2026-09-27 (Spencer).*
- A glass pill (~46px tall, ~30px above the bottom edge), fixed bottom-center on every page, never covering content, with a "/" chip and the placeholder "Ask Yoh, or type / for commands".
- Compact and raised. Click it, or press ⌘K, to open the Chat panel with the input focused.
- Enter sends and opens the Chat panel with the message as the first turn.
- "/" opens the Command Palette in place. `[ASSUMPTION]`
- Esc closes the panel and returns focus to where it was.
- It adds no required click to the capture flow (FR-39).

*Chat:*

UX-DR36: Chat panel layout, Chat Input, and Chat Message. *(Amended 2026-09-27: "Chat" here is the panel, not a page — it covers the content area right of the sidebar, inset ~24px, opened from the Ask Yoh pill or ⌘K; the page behind is dimmed context.)*
- Layout: the left-bar space is reserved for the Skill Switcher, which is hidden in Phase 2; the stream is centered; the Chat Input sits at the bottom, always wide, in the Ask Yoh pill's material.
- Messages: Spencer's turns are right-aligned on `surface-sunken`. Yoh's turns are left-aligned and flat on the page, and they stream as they generate. Markdown renders through a bundled library (no raw HTML, CSP-safe).
- A write triggered in Chat echoes a one-line receipt in caption style.
- Unsent text survives the Screensaver and ~~page swipes~~ *(swipe retired 2026-09-27)* panel close.
- Open interaction requests and Proposals render at the top of the panel.
- Yoh ends conversations naturally.

UX-DR37: Thinking Indicator.
- A dot-matrix loader plus live status text ("Thinking…", "Searching Notion…").
- It appears within a fraction of a second of sending and gives way to streaming text.
- The text has the gradient shimmer (2.8 s linear loop). Reduced motion: static `ink-secondary` text.
- The status text is an aria-live region.
- `[OPEN: shimmer legibility — the light stop is 1.49:1 on the light surface; may need a legibility floor]`

UX-DR38: Command Palette and Structured Question.
- **Command Palette**
  - A glass panel rising from the Chat Input or Ask Yoh pill. It lists `/morning`, `/plan` *(added 2026-09-27: builds today's Plan on demand; `/morning` never does)*, `/night`, `/sandbox`, and `/research`, each with a one-line description and an example.
  - Filters as Spencer types. The highlighted row gets a 1.5 px `accent-solid` rim.
  - ↑↓ moves, Enter runs, Esc closes. Fully keyboard-operable.
  - No-match state: "No matching command" plus the full list.
  - It is the only command-discovery surface.
- **Structured Question**
  - An inline question with selectable option chips (Secondary style, flipping to Primary when selected) plus a free-text "Other" field.
  - One pick answers it and is recorded as Spencer's turn. Fully keyboard-operable.
  - Used for clarifying questions, the **one-time /research offer** ("Do you want to do research on this?", which runs only if accepted; declining or ignoring runs nothing), and Proposal confirmations (FR-16/25/26/27 via FR-48).
  - An unanswered question blocks conflicting writes, not unrelated chat.

UX-DR39: Sandbox Card and Sandbox Finale.
- **Sandbox Card**
  - One inline Yoh message card (neumorphic, `rounded.md`) per Task: Task name (title style), the Required Due Date and Estimated Duration fields with rims, optional Refining fields (Area, Energy), a Secondary "Skip", a Primary "Save", and "N remaining" in numerals.
  - Save stays disabled until both Required fields are filled.
  - Save pulses the rim once in accent-solid and settles into a "Saved" state. Reduced motion shows "Saved" text only.
  - The counter decrements live and is announced.
  - Skip gives no cue and keeps the Task in the count.
  - An unresolvable select value re-prompts on that card.
  - The next card appears below, and cards stay in chat history.
  - **The reward sound plays once, when the batch is cleared**, not per card. It respects system mute and is never the only confirmation.
- **Sandbox Finale**
  - A right-aligned `accent-solid` loading bar that runs while writes settle. It never adds a click.
  - It is followed by "Saved {n} Tasks", or "Couldn't save {Task}" naming each failure.
- Empty queue: "Nothing's missing a Due Date or Duration." No finale.
- `[OPEN: does "batch cleared" mean every card saved or skipped, or the count reaching zero; sound asset and volume]`

UX-DR40: Skill Switcher reserved.
- Hidden in Phase 2, since only General chat exists and Research is not a skill.
- Chat's layout reserves the left bar.
- Nothing is built beyond the reserved space.

*Tasks and Desk:*

UX-DR41: Tasks page layout. *(Amended 2026-09-27, Spencer: Tasks is pulled forward from Epic 11 into the fixes+UI plan and ships standalone — no Research Box, see UX-DR43.)*
- ~~The grouped Task list sits on the left and the Research Box on the right.~~ A quick-add row sits at the top, always focused on page arrival, with the grouped Task list below.
- A Task Spencer types himself is a **direct write** (the same tier as FR-24), not a Yoh-drafted Proposal — amends AD-3/AD-12. Yoh-drafted items (from Chat, FR-26) still go through Proposal/confirm.
- Task Group: a caption header (e.g. "AREA: SCHOOL") over rows of Task name and due date. Every Notion Task is findable. A checked-off Task shows as completed, not deleted. Empty groups are omitted.
- Grouping Control: a segmented control in a `surface-sunken` well with the options Area (default), Due Date, Energy, and Status. The active segment is an `accent-solid` pill. The choice persists per device.
- Notion unreachable: the last-loaded Tasks stay visible with a "last updated" time, and an operational notification appears.

UX-DR42: Needs-Data Indicator.
- A persistent count on Tasks ("3 need data"), in numerals, inside a Secondary-style rim.
- Clicking it opens Chat with `/sandbox` already started.
- It reads the same computed queue as the /sandbox counter.
- It is hidden when the count is 0.

UX-DR43: Research Box, ~~on Tasks~~ **on the Research Hub page** *(moved 2026-09-27, Spencer — Research Hub is a new fourth page; its shell ships now, the async `/research` job and offer stay Epic 11)*.
- A card showing the latest research output up front (a title-style heading, the body, and a source list), with the Research Vault library as rows below, plus an "ask a research question" box that sends into the Chat panel.
- A research-ready notification opens the new doc here.
- Empty state: "Nothing saved yet. Ask a question, then say "save that"."
- Output follows the dedicated research prompt's consistent shape.

UX-DR44: Desk widgets.
- A grid of neumorphic cards, each with a caption header and a numerals value.
- Tasks Completed: a scrollable list of checked, struck-through rows.
- Worked: **one merged widget**. The primary figure is today's minutes (the sum of Estimated Duration of Tasks completed today). A secondary caption line shows all-time hours with Yoh, on the same basis.
- On-Time Rate.
- Streak: "Streak: 1 day · Longest: 12 days", in neutral wording.
- Usage Heatmap: GitHub-style, weeks × 7 days, with hover tooltips and `accent-solid` at stepped opacities. `[OPEN: ramp]`
- *(Added 2026-09-27, Spencer)* Claude API spend this month: computed locally from Task 9's per-call usage records × one price table, no Admin API key needed.
- Feed widgets: BTC/ETH/SOL tickers, weather for Seattle WA, and a news hub of the biggest business stories with an AI emphasis (confirmed 2026-09-27, Spencer). An unavailable feed shows "Unavailable · last updated 2:14 PM" in `ink-secondary` and never affects the other widgets.
- No completions yet: "0" / "Streak: 0 days".

*Cross-cutting overlays and feedback:*

UX-DR45: In-App Notification.
- Glass, with a 3 px `accent-solid` left bar, a pulsing accent dot (2.2 s), and a one-line message. The whole surface is clickable and deep-links in one click.
- Enter animation: 0.55 s ease-out with a 5 px drop and fade. Reduced motion: fade only, no pulse.
- Announced via `aria-live="polite"`.
- Failure variants use the same shape; the words carry the failure.
- Message shapes and targets:
  - "Research ready: {topic}" → Research Box.
  - "Couldn't finish research: {topic}" → Chat.
  - "Saved {n} Tasks" → Chat.
  - "Couldn't save {Task}" → Chat, into /sandbox.
  - "{n} Tasks need data to be placed" → Chat, with /sandbox started.
  - "Couldn't update your calendar" → Home.
  - "{integration} unreachable" / "Notion sign-in expired" → message only.
  - "Couldn't check off {Task}" → Home.
- It never replaces the Ritual push or email.
- `[OPEN: duration, stacking, manual dismissal]`

UX-DR46: Birthday Confetti.
- Plays on Feb 19 only, in the host timezone: one short burst on the first Home view that day.
- Colors: `accent-solid` plus neutral inks. No emoji.
- Skipped under reduced motion.
- It is the only named celebration.

UX-DR47: Icons.
- A line icon set with 1.8 px stroke and round caps.
- Neutral icons use `ink-secondary`. Active icons use an `accent-solid` stroke plus a 1.4 px ring on the chip.
- Every icon is paired with a label or an accessible name, and is never the only signal of state.
- Never emoji.

*State, voice, accessibility, platform:*

UX-DR48: State patterns. Every state in EXPERIENCE.md's State Patterns table has a defined treatment.
- Cold data loads show skeleton rows or cards matching the layout, never a static spinner.
- Offline or host unreachable: an operational notification, and Chat keeps unsent text.
- /research running: Spencer can leave the page.
- The remaining states follow the table rules listed above.
- Every write is visibly acknowledged or visibly failed.

UX-DR49: State-tied motion. Every animation corresponds to a state change and has a reduced-motion fallback read from one flag: check-off dissolve, reshuffle glide, thinking shimmer, streaming text, toast enter, page slide, sandbox pulse, Screensaver drift, confetti. Nothing is animated for decoration, and no information is conveyed by motion alone.

UX-DR50: Web voice, tone, and relaxed-gamification rules.
- Copy is peer-level and neutral, with no guilt: "3 need data", not "You have 3 incomplete tasks…". A failure is never shown as "All done!".
- Streak, on-time rate, heatmap, and the /sandbox pulse are allowed, in neutral wording.
- No broken-streak alarms, badges, levels, or emoji. No celebration other than UX-DR46.
- No button duplicates a slash command.
- No proactive mid-block prompts.
- Research never runs automatically.
- Not an Apple imitation: no SF Pro, no system blue, no cloned controls.

UX-DR51: Web accessibility floor.
- WCAG 2.2 AA in both themes.
- Never color or motion alone:
  - checked = glyph + strikethrough + fade
  - fixed = hatch + "(fixed)"
  - moved = outline + label
  - reward = sound + pulse + counter text
- Every control is keyboard-reachable, and tab order follows reading order.
- Live regions: notifications, the Undo Toast, the /sandbox counter, page changes, and the Thinking status.
- WCAG 2.5.7 dragging alternative: a typed Chat Re-Flow ("move my study block to 4") produces the same Reshuffle Preview, and the pin icon handles unpin. `[OPEN: is Chat enough, or is a dedicated control needed]`
- WCAG 2.2.1: the Undo Toast timer pauses on hover or focus.

UX-DR52: Platform parity.
- macOS is primary. The Windows laptop browser must reach parity: self-hosted fonts, ~~precision-touchpad swipe (or indicator + arrow keys as the fallback)~~ *(amended 2026-09-27: swipe retired everywhere — both platforms use the same vertical-stack navigation: sidebar, arrow buttons, ↑/↓ keys, edge-aware wheel)*, and `backdrop-filter` verified with an opaque fallback.
- Every blur- or font-dependent detail is verified on Windows Chromium/Edge and on macOS before it ships.
- Narrow windows and phones are not specified; the iOS app is Phase 4.

*UX refinements that diverge from PRD text (the UX spine flags these for a PRD update; stories follow the UX unless you say otherwise):*
- FR-37: a pulse per card plus one sound per batch (the PRD says a ping per card).
- FR-44: Worked is one merged widget (the PRD lists two).
- FR-46: blue accent, dark mode, glass, and the Theme Toggle.
- FR-42: the Structured Question, and a Skill Switcher that is hidden rather than an "empty menu".
- FR-51: a one-time research offer.
- *(2026-09-27, Spencer, already applied above, not just flagged):* FR-39 swipe retired for a vertical page stack; FR-40/FR-42 Chat Bubble/Chat page renamed to the Ask Yoh pill/Chat panel; FR-43 splits into a standalone Tasks page (direct-write for Spencer-typed Tasks, amends AD-3/AD-12) plus a new Research Hub page; FR-44 gains a Claude-spend tile and confirmed feed choices (Seattle WA weather, BTC/ETH/SOL, business+AI news); FR-46 gains the brighter cool-white/stronger-neumorphism palette, lifted gradient limit, and bigger scale; FR-1/FR-49 gain in-app-only Morning Plan delivery and `/plan` on demand.

*Remaining UX open questions:* OQ1–OQ17 from EXPERIENCE.md. Each is carried into the owning UX-DR above as `[OPEN]` or `[ASSUMPTION]`; the owning story either resolves it or ships the stated assumption. OQ9 is not yet mapped to a UX-DR: where Ritual-created Proposals, Self-Check prompts, and the unchecked-day flag surface. The spine answers it: at the top of Chat plus the existing push/email, with no in-app notification.

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
FR-17: Epic 4 - Periodic Self-Check *(superseded 2026-09-29 by FR-60; retired in Story 13.12)*
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

**Phase 2:**

FR-1 / FR-12–FR-14 (amended): Epic 8 - `/morning` and `/night` on-demand entry points
FR-2 (amended): Epic 10 - Pin never changes Derived Priority
FR-4 (amended): Epic 9 - Two-tier Required/Refining gate
FR-9 (Phase 2 trigger): Epic 10 - Drag and typed `reflow-now` share the one reshuffle pipeline
FR-23 (amended): Epic 7 - Home check-off as a second Status-write trigger
FR-24 (amended): Epic 8 - Chat on any surface (/sandbox reuse in Epic 9)
FR-30: Epic 10 - Drag a work block to a new time
FR-31: Epic 10 - Drag an individual Task (Pin)
FR-32: Epic 10 - Animated Reshuffle Preview with one-click Approve
FR-33: Epic 10 - Reshuffle scope and rules
FR-34: Epic 9 - Needs-data notification for unplaceable Tasks (reshuffle raises the same one in Epic 10)
FR-35: Epic 10 - Routines
FR-36: Epic 9 - /sandbox walks Tasks missing Required Fields
FR-37: Epic 9 - Skip, live counter, reward cue
FR-38: Epic 9 - /sandbox write-back and proof-of-action finale
FR-39: Epic 8 - Three-action capture flow (verified end to end)
FR-40: Epic 7 (Plan list + calendar) / Epic 8 (Ask Yoh pill, was Chat Bubble)
FR-41: Epic 7 - Check off a Task
FR-42: Epic 8 - Chat panel (was "Chat page", amended 2026-09-27) and slash commands
FR-43: Epic 11 - Tasks page
FR-44: Epic 12 - Desk dashboard
FR-45: Epic 7 - Screensaver (launch splash + idle)
FR-46: Epic 7 - Consistent design system (tokens applied by every later epic)
FR-47: Epic 7 (completions) / Epic 12 (activity days + metrics)
FR-48: Epic 8 - Surface-agnostic confirmation
FR-49: Epic 7 (infrastructure + `operational`) / each consuming epic adds its own kinds
FR-50: Epic 8 - Retire the CLI
FR-51: Epic 11 - /research asynchronous research
FR-52: Epic 13 - Persistent chat history (13.1, 13.9)
FR-53: Epic 13 - Memory folders and items (13.3)
FR-54: Epic 13 - Automatic filing + Remembered Receipt (13.4, 13.5)
FR-55: Epic 13 - Memory commands (13.4)
FR-56: Epic 13 - Recall (13.6)
FR-57: Epic 13 - Rule-change proposals and settings (13.7, 13.8, 13.10)
FR-58: Epic 13 - Patterns (13.2, 13.13)
FR-59: Epic 13 - Memory page (13.9, 13.10)
FR-60: Epic 13 - Rating, replaces FR-17 (13.11, 13.12)

**Phase 2 NFR coverage:** NFR-Accessibility → Epic 7 (token and rim foundation), enforced in each epic's UI stories. NFR-CaptureSpeed → Epic 8 (Playwright capture gate). NFR-Latency (interactive) → Epics 7, 8, and 10. NFR-DataIntegrity (Phase 2 writes) → Epics 7, 9, 10, and 11. NFR-Observability (in-app) → Epic 7.

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

**Phase 2 — Web App (Epics 7–12, approved 2026-09-25).**
- **Build order:** 7 → 8 → 9 → 10. Epics 11 and 12 need only 7 and 8.
- **Why this order rather than the PRD's priority order (reshuffle first):** FR-34's needs-data link goes to /sandbox, and the WCAG 2.5.7 typed re-flow needs Chat. Putting Drag-to-Reshuffle first would make it depend on later epics.

### Epic 7: Yoh opens in one click and shows today

Spencer clicks the Yoh icon on his Mac or Windows PC. The splash fades into Home, where today's Plan checklist sits next to the calendar. He checks Tasks off with undo; each check-off lands in Notion (Status only, never deleted) and in Yoh's own Completion Log. If something in Yoh breaks, an in-app notification says so.

**FRs covered:** FR-40 (Plan list + calendar), FR-41, FR-23 (amended), FR-45, FR-46, FR-47 (completions), FR-49 (infrastructure + `operational`)

**Also carries:**
- Brownfield refactor to the shared `adapters/sqlite.ts` handle with `writeTx`; `memory-store.ts` moves onto it (AD-10).
- `types/api.ts` locked before any server or web file (AD-9).
- `app/` scaffold (AD-16).
- `shell/server.ts` (Hono, systemd, loopback + `tailscale serve`, PWA), with a spike to verify Tailscale on the school network and PWA install on Windows (AD-15).
- `notification-store.ts` + outbox + `/api/events` SSE, including verifying SSE through `tailscale serve` (AD-18).
- Server heartbeat checked by the morning ritual (AD-7).
- `setTaskStatus` trash revert (AD-12).
- `plan-state-store.ts` pending check-offs with the commit sweep (AD-20).
- `completion-log.ts` `recordCompletion`, also called from `night-ritual.ts`, which skips Tasks completed today (AD-23).
- Nightly SQLite backup.
- `web/` scaffold: design tokens, self-hosted fonts, themes, page shell and navigation, Screensaver.

**UX:** UX-DR22–UX-DR32 (tokens, typography, scales, rim, gradient, themes, navigation, Screensaver, Plan Row/Checkbox, Undo Toast, Calendar Day View/Block — drag behavior deferred to Epic 10), UX-DR45 (In-App Notification), UX-DR46, UX-DR47, UX-DR48, UX-DR49, UX-DR50, UX-DR51, UX-DR52 (foundations applied from here on)

### Epic 8: Chat moves to the web, and the CLI retires

Everything Spencer did in the terminal now happens in the Web App's Chat ~~page~~ *(amended 2026-09-27: Chat is a panel over every page, not a page)*, with streaming replies, a thinking state, `/morning`, `/plan` *(added 2026-09-27)*, `/night`, a Command Palette, and Structured Questions. Capturing a Task takes three actions from a closed laptop. A Proposal is confirmed the same way from any surface. Once parity is proven, the CLI is gone and nothing is lost.

**FRs covered:** FR-39, FR-40 (Ask Yoh pill, was Chat Bubble), FR-42, FR-48, FR-50, FR-24 (amended), FR-1 / FR-12–FR-14 (amended)

**NFRs:** NFR-CaptureSpeed (Playwright capture-flow gate)

**Also carries:**
- Restructuring `chat-cli.ts`'s blocking `readLine` handlers (data-completeness, close-out, Self-Check, Proposal answer) into resumable, one-shot-per-turn `app/` flows. The logic and tests are moved, not copied (AD-16).
- `app/confirm-proposal.ts` as the single confirm path (AD-3 / FR-48).
- Open items rendered at the top of Chat, blocking only conflicting writes (AD-5).
- `/night` recording the close-out, with a no-op check added to `night-prompt` (AD-5).
- Streaming for `llm-adapter.ts`.
- Decision on chat transcript persistence (AD Deferred).
- Deleting `chat-cli.ts` once the FR-42 parity checklist passes.

**UX:** UX-DR35 (Ask Yoh pill, was Chat Bubble), UX-DR36, UX-DR37, UX-DR38, UX-DR40

### Epic 9: Missing data never blocks the day

A Task missing only Area or Energy still gets planned and is visibly marked. A Task missing a Due Date or Estimated Duration is held back with a needs-data notification instead of disappearing. `/sandbox` clears the backlog one card at a time, with a live counter, a reward cue, and a finale that appears only once Notion has confirmed every write.

**FRs covered:** FR-4 (amended, two-tier), FR-34, FR-36, FR-37, FR-38

**Also carries:**
- The two-tier gate: `CompleteTask` requires only the Required fields, `Refining<T>` is added, and the neutral score exists only inside `derived-priority.ts`. Plans carry each Task's missing-Refining list (AD-11).
- `app/sandbox-queue.ts` as the single computed source for the counter, the indicator, and the notification count.
- `app/sandbox-submit.ts`, with synchronous per-card `updateTaskField` writes (AD-12).
- `needs-data`, `sandbox-complete`, and `sandbox-failed` notification kinds.
- The Needs-Data Indicator, placed on Tasks. Epic 11 builds the Tasks page, so until then the indicator ships on a minimal Tasks route stub.

**UX:** UX-DR39, UX-DR42

### Epic 10: Drag-to-Reshuffle and Routines

Spencer drags a block, or pins a single Task, on today's calendar. He sees the animated Reshuffle Preview and approves it in one click; nothing reaches Google Calendar before Approve. Routines such as commute and meals are declared once in Chat and placed every day, so the Plan stops ignoring transition time. Typing "move my study block to 4" produces the same preview.

**FRs covered:** FR-30, FR-31, FR-32, FR-33, FR-35, FR-2 (amended), FR-9 (typed `reflow-now` trigger)

**Also carries:**
- `rituals/reshuffle.ts` as the single day-refit pipeline, with `mid-day-reflow.ts` folded onto it (AD-19).
- `Proposal<ReshufflePreview>`, whose snapshot is the Plan version plus a calendar hash.
- One open proposal at a time, with a TTL.
- `app/request-reshuffle.ts` and `app/approve-reshuffle.ts`, applying on the narrow calendar client only, idempotent by tag.
- The `reshuffle-apply-failed` notification kind.
- Pins in `plan-state-store.ts`.
- `routine-store.ts` and `app/routines.ts`.
- `PlanBlockKind` gains `'routine'`.
- Placement precedence in `work-break-fit.ts` (AD-24).
- The `@dnd-kit/react` exact pin behind one hook.

**UX:** UX-DR32 (drag variant), UX-DR33, UX-DR34

### Epic 11: ~~Tasks page and~~ asynchronous research

*Amended 2026-09-27 (Spencer): the Tasks page is pulled forward and delivered early, in the 2026-09-27 fixes + UI plan — see Story 11.1 below. Epic 11 now keeps only the Research Box/`/research` background job and the one-time research offer, both now landing on the new Research Hub page (also delivered early, as a shell) instead of Tasks.*

Spencer fires off `/research` in class, closes the laptop, and later reads the answer on Research Hub via a "research ready" notification.

**FRs covered:** FR-43 (research-box portion only), FR-51

**Also carries:**
- `job-store.ts` and the in-server job runner. A job crashed while running becomes failed and is never auto-re-run (AD-21).
- The `research-ready` and `research-failed` notification kinds.
- The one-time Structured Question offer to run research.
- ~~Replacing the Epic 9 Tasks route stub with the full page.~~ *(moot 2026-09-27: the Tasks page ships early — see Story 11.1)*

**UX:** UX-DR43

### Epic 12: Desk — the after-school view

At his desk, Spencer sees Tasks completed, minutes worked, on-time rate, streak, a usage heatmap, and *(added 2026-09-27)* a Claude API spend-this-month tile, all computed from Yoh's own log/usage store. Next to them are crypto (BTC/ETH/SOL), weather (Seattle, WA), and news (biggest business stories, AI emphasis) widgets — all confirmed 2026-09-27 — each of which fails on its own without breaking the rest.

**FRs covered:** FR-44, FR-47 (activity days + metrics)

**Also carries:**
- `completion-log.ts` `recordActivityDay`.
- `core/desk-metrics.ts`, pure over log rows (AD-23).
- `app/desk.ts`.
- `crypto-feed.ts`, `weather-feed.ts`, and `news-feed.ts`, each with its own cache and an `{status}` return (AD-22).
- A spike to pick the free-tier feed providers (location and category confirmed 2026-09-27; terms-check still open).
- *(Added 2026-09-27)* the "Claude API spend this month" tile, reading Task 9's per-call usage-recording store (prompt caching also lands in Task 9) × one price table — no Admin API key needed.

**UX:** UX-DR44

### Epic 13: "Yoh remembers you" — persistent memory

Spencer's chat history survives reloads and devices. Yoh files what he tells it into eight visible folders with a one-line receipt and Undo, uses it in answers, asks before any memory changes a planning rule, proposes patterns with evidence, and checks in with an occasional 1–3 rating instead of the old Self-Check. Everything is browsable and editable on a fifth page, Memory.

**FRs covered:** FR-52, FR-53, FR-54, FR-55, FR-56, FR-57, FR-58, FR-59, FR-60 (FR-17 retired)

**Also carries:** `chat-store.ts`, `memory-item-store.ts`, `settings-store.ts`, `rating-store.ts` (AD-25, AD-26, AD-29, AD-31); the `ChatStreamEvent` contract (AD-27); `completions.planned_start/end` + `slip_events` (AD-30); the `PlanningSettings` refactor (AD-29); Self-Check removal.

**UX:** EXPERIENCE.md/DESIGN.md 2026-09-29 rows; mock `ux-designs/ux-YohV1-2026-08-21/mockups/memory-key-screens-2026-09-29.html`.

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

## Epic 7: Yoh opens in one click and shows today

Spencer clicks the Yoh icon on his Mac or Windows PC. The splash fades into Home, where today's Plan checklist sits next to the calendar. He checks Tasks off with undo; each check-off lands in Notion (Status only, never deleted) and in Yoh's own Completion Log. If something in Yoh breaks, an in-app notification says so.

### Story 7.1: Shared SQLite Connection for Concurrent Processes

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

### Story 7.2: Web Server Reachable Only From My Devices

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

### Story 7.3: In-App Notification Store and Live Event Stream

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

### Story 7.4: Server Liveness Alerting and Nightly Backup

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

### Story 7.5: Web Client Foundation — Design Tokens, Fonts, Themes, Installable App

As Spencer,
I want a Yoh web app I can install as an icon, styled in the agreed ~~warm~~ *(amended 2026-09-27: brighter cool-white, stronger)* neumorphic look in light and dark,
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

### Story 7.6: Page Shell, Navigation, and Screensaver

*Amended 2026-09-27 (Spencer): this story's page list and navigation model are superseded — see the amended ACs below. "Swipe navigation retired 2026-09-27 (Spencer)": swipe is removed from this story entirely.*

As Spencer,
~~I want to move between Home, Chat, Tasks, and Desk with a swipe, a click, or an arrow key~~ *(amended 2026-09-27)* I want to move between Home, Tasks, Desk, and Research Hub with a vertical page stack — arrow buttons, ↑/↓ keys, an edge-aware wheel, or the sidebar — and see the Yoh splash on launch and when idle,
So that every page is one gesture away and the app feels alive without ever getting in my way.

**Acceptance Criteria:**

**Given** the page shell
**When** it renders
**Then** ~~the four pages Home → Chat → Tasks → Desk exist in that order, one in view at a time. Chat, Tasks, and Desk are placeholders until their epics.~~ *(amended 2026-09-27)* the four pages Home → Tasks → Desk → Research Hub exist in that order, in a vertical stack, one in view at a time. There is no Chat page — Chat is a panel available over every page (Epic 8, superseded 2026-09-27). Tasks, Desk, and Research Hub are placeholders until their epics/tasks.

~~**Given** a two-finger horizontal trackpad swipe that starts outside a horizontally scrollable region
**When** Spencer swipes
**Then** the view moves one page in the swipe direction with a slide transition (a cross-fade under reduced motion)
**And** the root sets `overscroll-behavior-x: none`, so the browser's back/forward gesture never fires (UX-DR28)~~
**Swipe navigation retired 2026-09-27 (Spencer).** *Replaced by:*

**Given** the vertical page stack
**When** Spencer clicks an on-screen up/down arrow button, presses ↑/↓ or Page Up/Page Down with no text field focused, or scrolls the mouse wheel while the hovered scroll area is already at its edge
**Then** the view moves one page with a smooth slide transition (a cross-fade under reduced motion)

**Given** ~~the Page Indicator (four dots; the active one is the gradient pill)~~ *(amended 2026-09-27)* the left nav sidebar (wordmark, then Home/Tasks/Desk/Research Hub, then the Theme Toggle; active item in a gradient pill)
**When** Spencer clicks a sidebar item
**Then** that page shows directly, and a screen reader announces e.g. "Tasks, page 2 of 4"

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

### Story 7.7: In-App Notification Overlay

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

### Story 7.8: Home — Today's Plan and Calendar

As Spencer,
I want Home to show today's Plan as a checklist next to today's calendar,
So that I can see what to do, in what order, and when, at a glance.

*Amended 2026-09-27 (Spencer):* Home also always shows today's Time Budget (the declared budget, how much of it the Plan uses, and time done so far), editable in place through the existing `app/time-budget.ts`, plus a mini month alongside the Calendar Day View.

**Acceptance Criteria:**

**Given** today's declared Time Budget *(added 2026-09-27)*
**When** Home loads
**Then** it shows the budget, how much of it the Plan uses, and time done so far (e.g. "Time Budget 6 h · 4 h planned · 1 h done"), clickable to change the budget in place; with no budget set today, it shows the default and "Set today's budget"

**Given** the Calendar Day View *(added 2026-09-27)*
**When** Home renders
**Then** a mini month also renders alongside it

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

### Story 7.9: Completion Log and Status-Only Completion Writes

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

### Story 7.10: Check Off a Task With Undo

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

## Epic 8: Chat moves to the web, and the CLI retires

Everything Spencer did in the terminal now happens in the Web App's Chat ~~page~~ *(amended 2026-09-27: Chat is a panel over every page, not a page)*, with streaming replies, a thinking state, `/morning`, `/plan` *(added 2026-09-27)*, `/night`, a Command Palette, and Structured Questions. Capturing a Task takes three actions from a closed laptop. A Proposal is confirmed the same way from any surface. Once parity is proven, the CLI is gone and nothing is lost.

### Story 8.1: Open Interaction Requests as Resumable Turns

As Spencer,
I want Yoh's pending questions (missing Task fields, night close-out, Self-Check) to be answerable one turn at a time from any surface,
So that the Web App can resolve them exactly as the terminal does, without either surface blocking on input.

**Acceptance Criteria:**

**Given** `chat-cli.ts`'s `answerDataCompletenessRequest`, `answerNightCloseOutRequest`, and `answerSelfCheckRequest` each loop on `io.readLine()`
**When** this story is complete
**Then** their logic lives in `app/surface-open-items.ts` plus one answer function per request kind. The logic is **moved, not copied**, along with `parseFieldAnswer`, `parseNightCloseOutAnswer`, `parseSelfCheckAnswer`, and their tests (AD-16).
**And** each `app/` call answers exactly one question: the interaction request records which question is pending, and the response carries the next question, or "done".

**Given** a missing-field request is surfaced
**When** `llm-adapter.ts` can infer a value from recent chat context
**Then** the app layer builds the `Proposal<FieldValueSuggestion>` lazily at display time, exactly as before (AD-11, FR-25)
**And** a confirmed or typed answer writes through `updateTaskField` with the existing select guard, and is echoed as a one-line receipt (FR-24)

**Given** `chat-cli.ts` after the refactor
**When** Spencer uses it
**Then** it is transport only over these `app/` functions: it prints each returned question, reads one line, and calls `app/` again. Every existing data-completeness, close-out, and Self-Check behavior (validation, re-prompts, skip, the number-plus-reason rule) is unchanged, and its tests pass.

**Given** a Self-Check or close-out request raised by a ritual
**When** it is open
**Then** it raises **no** in-app notification (AD-5)

### Story 8.2: One Confirmation Path for Every Proposal

As Spencer,
I want every Yoh proposal to be confirmed through one set of rules, whether I type "yes" or click a button,
So that no surface can apply something I didn't approve, or apply it against stale data.

**Acceptance Criteria:**

**Given** `chat-cli.ts`'s `apply`, `answerProposalRequest`, and `parseProposalAnswer`
**When** this story is complete
**Then** `app/confirm-proposal.ts` is the single confirm path for learned-pattern and Time Budget proposals (FR-16, FR-5) and for FR-25, FR-26, and FR-27 proposals. The logic and tests are moved, not copied (AD-3, FR-48). FR-25's inline confirm, which 8.1 moved, is re-pointed at `confirmProposal`.
**And** each proposal keeps its existing calling convention: `applyCalendarEdit` takes the `Proposal` itself; `updateTaskField` and `createPage` take the extracted payload.
**And** FR-29's direct `createPage` call site stays separate and is never routed through this path.

**Given** a confirmation arrives from any interactive surface (a typed yes/no, or a web control)
**When** `confirmProposal` runs
**Then** the same staleness check applies: an existing entity whose version changed rejects with `stale-proposal`, and a create-type proposal skips the re-read, as already specified
**And** a decline writes nothing

**Given** a non-interactive ritual run
**When** any code path tries to confirm a proposal from it
**Then** it cannot, because `rituals/` and `ritual-cli.ts` can't import `app/` (the AD-1 import test from 7.2)

**Given** a proposal is open
**When** Spencer sends an unrelated message
**Then** only writes that conflict with the proposal are blocked (another answer to the same field, a second proposal on the same entity). Unrelated chat proceeds (AD-5 Phase 2).

### Story 8.3: Chat Turn Routing for Planning Commands

As Spencer,
I want my everyday chat messages (what's my plan, I'm behind, a blocker, change my time budget, why is X first, general questions) handled by one surface-agnostic chat turn,
So that the terminal and the Web App answer them identically, in Yoh's usual tone.

**Acceptance Criteria:**

**Given** `chat-cli.ts`'s plan-view, mid-day re-flow, blocker, Time Budget, why-prioritized, and general-question handlers
**When** this story is complete
**Then** `app/chat-turn.ts` dispatches on `llm-adapter.ts`'s `ChatIntent` and on the existing command parsers, calling one `app/` function per capability (`app/time-budget.ts` among them). The logic and tests are moved, not copied (AD-16).
**And** `chat-cli.ts`'s main loop calls `chatTurn` for each non-slash line.

**Given** a re-flow or blocker report
**When** it runs
**Then** the behavior is unchanged from Epic 2: a re-flow shows only the updated remainder, and a blocker applies unconditionally with a one-line confirmation. (Both move onto the single reshuffle pipeline in Epic 10.)

**Given** replies
**When** Yoh answers
**Then** Tone rules hold (FR-18, FR-19): peer-level, no filler, no "it's not just X, it's Y"
**And** Yoh never claims a capability it doesn't have, and it ends a conversation naturally rather than fishing for more (FR-42)

**Given** `llm-adapter.ts`
**When** a caller requests a streamed reply
**Then** it exposes a streaming variant that yields text chunks plus status events ("Thinking…", "Searching Notion…"). The non-streaming path the CLI uses still works.

### Story 8.4: Chat Turn Routing for Notion, Calendar, and Search Commands

As Spencer,
I want creating Notion items, editing my Calendar, searching the web, and saving results to work through the same chat turn,
So that the Phase 1.5 capabilities carry over to the Web App with their trust boundaries intact.

**Acceptance Criteria:**

**Given** `chat-cli.ts`'s create-item, calendar-edit, search, and save-search-result handlers
**When** this story is complete
**Then** they are dispatched from `app/chat-turn.ts`. Logic and tests are moved, not copied.
**And** create-item and calendar-edit produce their `Proposal`s and confirm only through `app/confirm-proposal.ts` (8.2)
**And** a calendar edit still requires confirmation that names the specific event, and has no delete variant (AD-13)

**Given** a search-trigger intent
**When** it's handled
**Then** `search-adapter.ts` is called exactly as before: only on an explicit ask or an unambiguous factual question, with citations, and with honest failure and no-results replies (FR-28, AD-14)
**And** "save that" files the most recent `SearchAnswer` directly via `createPage('ResearchVault', …)` (FR-29)

**Given** any chat-triggered write (FR-24 through FR-29)
**When** it succeeds
**Then** the `app/` result carries a one-line receipt naming what changed, which both shells render

### Story 8.5: ~~Chat Page~~ Chat Panel With Streaming Replies

*Amended 2026-09-27 (Spencer): there is no Chat page. Chat is a panel available over every page, opened from a small bottom-center "Ask Yoh" pill (or ⌘K), covering the content area right of the sidebar. Everywhere below that said "Chat page" now means the Chat panel.*

As Spencer,
I want a Chat panel in the Web App where Yoh's replies stream in behind a live thinking indicator,
So that talking to Yoh feels immediate and I can always see what it's doing.

**Acceptance Criteria:**

**Given** the Chat panel
**When** it renders
**Then** the conversation stream is centered with the Chat Input at the bottom: glass, always wide, with a focus ring and glow. The left-bar space is reserved and empty, because the Skill Switcher is hidden (UX-DR36, UX-DR40).

**Given** Spencer sends a message
**When** he presses Enter
**Then** his turn appears right-aligned on `surface-sunken`, and within a fraction of a second, before any server response, the Thinking Indicator appears: a dot-matrix loader and live status text (NFR-Latency, UX-DR37)
**And** the server handles `POST /api/chat` by calling `app/chat-turn.ts` and streaming the reply on that request's own SSE response. The Thinking Indicator gives way to streaming text in Yoh's left-aligned turn (AD-18).

**Given** the Thinking Indicator's status text
**When** it shows
**Then** it carries the gradient shimmer (static `ink-secondary` text under reduced motion) and is an `aria-live` region
**And** `[ASSUMPTION: resolves UX OQ17]` the shimmer runs over text that is already legible: the text renders in `ink-primary` and the shimmer is a translucent overlay sweep, so contrast never drops below 4.5:1

**Given** a chat-triggered write succeeds
**When** the reply renders
**Then** the one-line receipt appears in caption style in the stream

**Given** ~~Spencer swipes away~~ *(swipe retired 2026-09-27)* Spencer navigates to another page, or the Screensaver shows
**When** he returns
**Then** the unsent Chat Input text and the stream are intact

**Given** chat history persistence (spine Deferred, UX OQ13)
**When** this story is built
**Then** ~~`[DECISION DEFAULT: client memory only for Phase 2]` the transcript lasts for the page session. If Spencer instead wants it to survive a reload, this story adds a `chat-store.ts` owner under AD-10, and `web/` never invents its own storage.~~ *Superseded 2026-09-27 (Spencer): client-memory-only is no longer the plan. Persistent history plus Facts about me / Decisions & commitments / Ideas & notes folders is planned as the "Yoh remembers you" epic, queued after Epic 9 — see `epics.md`'s Epic List. This story still ships session-only memory for now; the persistent version is that epic's job, not this story's.*

### Story 8.6: Open Items and Structured Questions in Chat

As Spencer,
I want Yoh's pending questions and proposals to appear at the top of Chat as tappable options,
So that I can answer or approve them with one click, and I never lose a proposal the rituals created.

**Acceptance Criteria:**

**Given** open interaction requests or Proposals exist, including ones created while the CLI was in use
**When** the Chat panel *(amended 2026-09-27, was "Chat page")* opens
**Then** they render at the top of Chat through `app/surface-open-items.ts` (AD-5, FR-48, FR-50)

**Given** Yoh asks a question with discrete answers (a proposal confirmation, a close-out status, a clarifying question)
**When** it renders
**Then** it appears as a Structured Question: the question text, option chips (Secondary style, flipping to Primary when selected), and a free-text "Other" field (UX-DR38)
**And** one pick answers it, is recorded as Spencer's turn, and calls the same `app/` function that a typed answer would call
**And** chips and "Other" are fully keyboard-operable

**Given** a proposal is confirmed via a chip
**When** it is stale
**Then** the stale rejection is shown honestly, and nothing is applied (FR-48)

**Given** an unanswered Structured Question
**When** Spencer types unrelated chat
**Then** the chat proceeds, and only conflicting writes are blocked

### Story 8.7: Command Palette, /morning, and /night

As Spencer,
I want to type "/" to see every command, open today's Morning Ritual in Chat, and close out my day early,
So that commands are discoverable without cluttering any page, and an early close-out stops tonight's nagging.

**Acceptance Criteria:**

**Given** "/" is the first character in the Chat Input
**When** Spencer types it
**Then** the Command Palette (a glass panel) lists the commands available so far, each with a one-line description and an example, and filters as he types. ↑↓ moves, Enter runs, and Esc closes (UX-DR38).
**And** a query with no match shows "No matching command" plus the full list
**And** the palette's command list comes from one server-provided registry, so `/sandbox` (Epic 9) and `/research` (Epic 11) appear when their stories register them

**Given** `/morning`
**When** Spencer runs it
**Then** `app/morning-view.ts` shows today's stored Plan, its reasoning line, and any pending questions or proposals in Chat
**And** it never sends a push and never regenerates the Plan (FR-1, FR-42)
**And** with no Plan yet, it says so

**Given** `/plan` *(added 2026-09-27, Spencer)*
**When** Spencer runs it
**Then** it builds today's Plan on demand. `/morning` still never generates one (FR-1 stands).

**Given** `/night`
**When** Spencer runs it
**Then** `app/night-close-out.ts` runs the close-out interactively through 8.1's resumable flow, excluding Tasks already completed today, and records it in the same `memory-store.ts` record `night-escalate` checks

**Given** tonight's close-out is already recorded via `/night`
**When** `ritual-cli.ts night-prompt` and later `night-escalate` run
**Then** both are no-ops for that night, and the day is never marked unchecked (FR-12–FR-14, AD-5)

### Story 8.8: ~~Chat Bubble on Home~~ Ask Yoh Pill on Every Page and the Three-Action Capture Flow

*Amended 2026-09-27 (Spencer): the Chat Bubble is renamed the "Ask Yoh" pill, fixed bottom-center on every page (not Home only), like Wispr Flow's — ~46px tall, ~30px above the bottom edge, never covering content.*

As Spencer,
I want to open my laptop, click the Yoh icon, type a Task into the Ask Yoh pill, and press Enter,
So that capturing something in class takes seconds.

**Acceptance Criteria:**

**Given** any page
**When** it renders
**Then** the Ask Yoh pill is fixed bottom-center: a small glass pill with a "/" chip and "Ask Yoh, or type / for commands". Click it or press ⌘K to open the Chat panel with the input focused. Esc closes the panel and returns focus (UX-DR35).

**Given** text in the Ask Yoh pill
**When** Spencer presses Enter
**Then** the Chat panel opens over the current page, and the message is sent as the first turn of the conversation (FR-40)
**And** "/" in the pill opens the Command Palette in place

**Given** a message describing a new Task (e.g. "Lab report draft, due Thursday")
**When** it is sent
**Then** Yoh drafts it through FR-26's create path and shows the draft as a Structured Question
**And** confirmation follows FR-26's confirm-then-write rule. The "Create" option is pre-focused, so Enter confirms it. On success the receipt names the Task and its database. `[DECIDED 2026-09-25: FR-39's three actions are counted up to the message being sent; the one-click FR-26 confirmation is kept as a trust boundary and is not a regression of NFR-CaptureSpeed]`

**Given** the Playwright smoke suite
**When** it runs the capture flow from a fresh launch
**Then** it asserts no login, picker, or extra screen appears between launch and a focused Ask Yoh pill *(was Chat Bubble)*, and the flow takes at most three actions to send. This test is the NFR-CaptureSpeed regression gate for every later story.

### Story 8.9: CLI Parity Check and Retirement

As Spencer,
I want the terminal chat removed only after the Web App provably does everything it did,
So that I end up with one surface and lose nothing.

**Acceptance Criteria:**

**Given** FR-42's parity list: Time Budget, Mid-Day Re-Flow, Blocker reports, open interaction requests and Proposals, FR-24 through FR-29, Self-Check responses, plan view, and why-prioritized
**When** the parity check runs
**Then** each item has a passing `app/`-level test and a manual check in the Web App, and the checklist is recorded in the story

**Given** parity passes
**When** `chat-cli.ts` is deleted
**Then** no logic is lost, because every handler already lives in `app/`. The CLI entry point and its package script are removed, and the full test suite passes (FR-50).

**Given** the CLI is retired
**When** the Morning, Night, and Self-Check rituals run on schedule
**Then** they are unaffected, and their open items and proposals surface in Chat

**Given** the CLI sections of the UX spines (UX-DR1 through UX-DR21, CLI rendering)
**When** retirement completes
**Then** the ritual push and email text keep their existing wording, and no CLI-only rendering code remains

## Epic 9: Missing data never blocks the day

A Task missing only Area or Energy still gets planned and is visibly marked. A Task missing a Due Date or Estimated Duration is held back with a needs-data notification instead of disappearing. `/sandbox` clears the backlog one card at a time, with a live counter, a reward cue, and a finale that appears only once Notion has confirmed every write.

### Story 9.1: Two-Tier Data-Completeness Gate

As Spencer,
I want a Task missing only its Area or Energy to still be planned, and clearly marked as incomplete,
So that one empty tie-breaker field no longer keeps real work off my day.

**Acceptance Criteria:**

**Given** `types/domain.ts`
**When** this story is complete
**Then** `CompleteTask` requires only Due Date and Estimated Duration. Area and Energy are typed `Refining<T> = {kind:'set', value:T} | {kind:'missing'}`, never `T | undefined` and never a defaulted `T` (AD-11, FR-4 amended).
**And** `data-completeness-gate.ts` is still the only producer of `CompleteTask`

**Given** a Task missing only Area and/or Energy
**When** the Morning Plan, or any later re-plan, is built
**Then** it is placed. `derived-priority.ts` maps `'missing'` to a neutral score that neither favors nor penalizes the Task, and that value exists only inside the scoring computation. It is never stored, never sent to the client as a real value, and never written to Notion.
**And** the Plan carries that Task's list of missing Refining fields

**Given** a placed Task with missing Refining fields
**When** Home renders its Plan Row
**Then** the row is visibly marked incomplete with a glyph plus text (e.g. "no Energy"), never by color alone

**Given** a Task missing a Required field
**When** the Plan is built
**Then** it is not placed and cannot become a `CompleteTask`. The existing `missing-field` placeholder request is still created.

**Given** a Task with an empty Status
**When** the gate runs
**Then** it is treated as eligible, not gated `[PRD ASSUMPTION, adopted]`

**Given** the Epic 1 tests that assumed all five fields gate
**When** the suite runs
**Then** those tests are updated to the two-tier contract. Every other planning test passes.

### Story 9.2: /sandbox Card Flow

As Spencer,
I want `/sandbox` to walk me through each Task missing data, one card at a time, with a live count,
So that I can fill in what the planner needs in a couple of minutes in class.

**Acceptance Criteria:**

**Given** `app/sandbox-queue.ts`
**When** it is called
**Then** it derives the queue live from Notion Tasks by running the gate: Tasks missing a Required field, soonest-due first, with no due date last (AD-11)
**And** it is the only source for the /sandbox counter, the Needs-Data Indicator, and the needs-data notification count. None of them keeps its own count.

**Given** the command registry
**When** this story ships
**Then** `/sandbox` appears in the Command Palette with a description and an example

**Given** Spencer runs `/sandbox`
**When** the queue is non-empty
**Then** a Sandbox Card appears inline in the stream for the first Task: the Task name, Due Date and Estimated Duration fields with rims, optional Area and Energy fields, a Secondary "Skip", a Primary "Save", and "N remaining" in tabular numerals (FR-36, UX-DR39)
**And** Save stays disabled until both Required fields are filled

**Given** Spencer clicks Save
**When** the card is submitted
**Then** the card's values are written synchronously through `updateTaskField` as a direct write, with no second confirmation. Due Date and Estimated Duration use the existing strict validation, and select values use the existing guard (FR-38, AD-12).
**And** on success the card's rim pulses once in `accent-solid` and settles into "Saved" (text only under reduced motion). The counter decrements live and is announced to screen readers (FR-37).
**And** a select value that can't be resolved re-prompts on that card and writes nothing

**Given** Spencer clicks Skip
**When** the card advances
**Then** nothing is written, no cue plays, and the Task stays in the count, eligible for the next session

**Given** one card is finished
**When** the next Task exists
**Then** its card appears below. Earlier cards stay in the chat history.

**Given** an empty queue
**When** Spencer runs `/sandbox`
**Then** Yoh replies "Nothing's missing a Due Date or Duration." and the session ends with no finale

### Story 9.3: /sandbox Finale and Proof-of-Action Notification

As Spencer,
I want the end of a /sandbox session to show that my answers actually landed in Notion,
So that I trust the data is there, and I'm told exactly what failed if something didn't save.

**Acceptance Criteria:**

**Given** the last card in the session is saved or skipped
**When** the session ends
**Then** the Sandbox Finale (a right-aligned `accent-solid` loading bar) runs in the stream while `app/sandbox-submit.ts` waits for every card write to settle. It never requires a click (FR-38).

**Given** every write succeeded
**When** they have all settled
**Then** a `sandbox-complete` notification, "Saved {n} Tasks", deep-links to Chat. It never appears before the writes succeed.

**Given** any write failed
**When** the writes settle
**Then** a `sandbox-failed` notification names each failed Task, e.g. "Couldn't save Chem problem set", and never claims completion. Failed Tasks stay in the count.

**Given** the session saved at least one card and reached the end of the queue
**When** the finale completes
**Then** `[ASSUMPTION: resolves UX OQ10 — "batch cleared" means the session reached the end of its queue]` the reward sound plays once, respecting system mute. It is never the only confirmation.
**And** `[ASSUMPTION: resolves UX OQ16]` the sound is a short, self-hosted asset at modest volume, swappable in one place

### Story 9.4: Needs-Data Notification and Indicator

As Spencer,
I want to be told how many Tasks need data before they can be planned, with one click into fixing them,
So that an unplaceable Task never silently falls off my radar.

**Acceptance Criteria:**

**Given** a Morning Plan run leaves one or more Tasks unplaced for a missing Required field
**When** the ritual finishes
**Then** it creates one `needs-data` notification, "{n} Tasks need data to be placed", deep-linking to Chat with `/sandbox` started (FR-34)
**And** this is one of the only two notification kinds a ritual may raise (AD-5). No notification is raised when the count is zero.

**Given** the Tasks page (a minimal route stub until Epic 11 builds the full page)
**When** the queue count is greater than zero
**Then** the Needs-Data Indicator shows e.g. "3 need data" in tabular numerals inside a Secondary-style rim. It is hidden when the count is zero (UX-DR42).
**And** clicking it opens Chat with `/sandbox` started

**Given** a Task is unplaced
**When** anything on the web surface shows the day
**Then** that Task never appears with a guessed Due Date or Estimated Duration, and is always reachable through the indicator or the notification (FR-34)

**Given** a /sandbox session ends
**When** the Needs-Data Indicator next renders
**Then** it reflects the new queue count from `app/sandbox-queue.ts`

## Epic 10: Drag-to-Reshuffle and Routines

Spencer drags a block, or pins a single Task, on today's calendar. He sees the animated Reshuffle Preview and approves it in one click; nothing reaches Google Calendar before Approve. Routines such as commute and meals are declared once in Chat and placed every day, so the Plan stops ignoring transition time. Typing "move my study block to 4" produces the same preview.

### Story 10.1: One Re-Planning Pipeline and the Reshuffle Preview

As Spencer,
I want every mid-day re-plan to produce a preview I can approve, computed by the same rules as my Morning Plan,
So that Yoh never rearranges my day by a second set of rules or behind my back.

**Acceptance Criteria:**

**Given** `rituals/mid-day-reflow.ts` has its own fitting path
**When** this story is complete
**Then** `rituals/reshuffle.ts` exports the single day-refit computation. It runs the same `core/` pipeline as the Morning Plan (gate → Derived Priority → Work/Break fit within the Time Budget), with today's non-Yoh events, active Pins, and completed blocks as fixed inputs, and `mid-day-reflow.ts` calls it. There is no second fitting path (AD-19).
**And** a reshuffle only ever moves today's remaining, not-yet-completed, Yoh-owned blocks (FR-33)

**Given** a request to `app/request-reshuffle.ts` (`{kind:'reflow-now'}` in this story)
**When** it is computed
**Then** it returns a `Proposal<ReshufflePreview>` whose snapshot is today's stored `Plan.version` plus a calendar version (a hash over event ids and `updated` timestamps). The preview lists moved blocks, unchanged blocks, and Tasks deferred out of today (FR-8, FR-32).
**And** a Task missing a Required field is left unplaced and raises `needs-data`. Everything else is still planned (FR-34).
**And** the reshuffle computation's duration is logged per request

**Given** one reshuffle proposal is already open
**When** a new request arrives
**Then** the new one supersedes it; there is only ever one open, enforced server-side
**And** an open proposal expires after the TTL (~10 min, exported once). Discard deletes it. Nothing is written to the Calendar before Approve.

**Given** a same-day Morning Plan regeneration
**When** it bumps `Plan.version`
**Then** any open preview is stale

**Given** Spencer types a re-flow request in Chat
**When** this story ships
**Then** Epic 2's typed re-flow behavior is unchanged. It just runs on the single pipeline. (10.2 switches it to preview-then-Approve.)

**Given** a Blocker report (FR-10)
**When** it is handled
**Then** it applies unconditionally, with no Proposal, through the same refit computation (AD-3)

### Story 10.2: Approve or Discard a Reshuffle

As Spencer,
I want one Approve to apply the whole proposed day, and Discard to leave my calendar exactly as it was,
So that direct manipulation stays trustworthy.

**Acceptance Criteria:**

**Given** an open reshuffle proposal
**When** Spencer approves it (from any surface, through the same confirm rules, FR-48)
**Then** `app/approve-reshuffle.ts` re-reads the calendar. If the version changed, it recomputes and returns a fresh preview instead of applying (FR-32).

**Given** the proposal is still current
**When** it applies
**Then** it first writes the new Plan (version-checked) in one `writeTx`. 10.5 adds today's Pins to that same transaction. It then updates every changed block on Calendar through AD-4's **narrow** client only, and never uses the AD-13 broad client (AD-19).
**And** each target first goes through `resolveCalendarEditRoute`, and an `'external'` result aborts before any write
**And** writes are idempotent by `PLAN_BLOCK_ID_EXTENDED_PROPERTY`: the tagged event is updated, never duplicated

**Given** some block writes fail
**When** the apply finishes
**Then** it returns which blocks were written, and a `reshuffle-apply-failed` notification ("Couldn't update your calendar") deep-links to Home. It is never reported as success.

**Given** Discard, or the proposal expiring
**When** it happens
**Then** nothing is written anywhere

**Given** a successful apply
**When** Home or Chat next renders
**Then** the Plan reflects the new order through an SSE hint, without a reload (FR-40)

**Given** Approve exists, and Spencer types a re-flow request in Chat ("I'm behind", "move my study block to 4")
**When** `chat-turn` routes the `mid-day-reflow` intent
**Then** it goes to `app/request-reshuffle.ts`. The preview's summary line renders in Chat with an Approve/Discard Structured Question. This is the WCAG 2.5.7 non-drag path (UX-DR51).

### Story 10.3: Routines — Declare Once, Placed Every Day

As Spencer,
I want to tell Yoh my commute and meal times once, and have them blocked out every applicable day,
So that my Plan stops scheduling homework the minute school ends.

**Acceptance Criteria:**

**Given** `adapters/routine-store.ts`
**When** it initializes
**Then** it idempotently creates its own table for Routines `{id, label, days, start, durationMinutes}` (AD-24)

**Given** Spencer says in Chat e.g. "my commute is 3:00–3:30 on weekdays", or asks to change or remove a Routine
**When** `chat-turn` routes it to `app/routines.ts`
**Then** the Routine is added, changed, or removed, with a one-line receipt `[PRD ASSUMPTION adopted: Chat-only declaration; resolves UX OQ14]`

**Given** `PlanBlockKind`
**When** it is extended
**Then** it is `'work' | 'break' | 'calendar-anchor' | 'routine'`, plus `routineId` on routine blocks, and `calendar-anchor` keeps its meaning

**Given** the Morning Plan and a reshuffle
**When** `core/work-break-fit.ts` places blocks
**Then** precedence is: anchors and Pins first; then each Routine at, or as near as fits to, its declared time; then work and break blocks in what remains (AD-24)
**And** a Routine may shift but is never dropped. A Routine that can't fit is flagged in the Plan or preview (FR-33).
**And** Routine Blocks count against the day

**Given** Routine Blocks are written to Calendar
**When** the Plan is written
**Then** each is one ordinary tagged event per day on "Yoh Plan" through AD-4's automatic path, never a Google recurring event (FR-35)

**Given** Home's calendar
**When** a Routine Block renders
**Then** it uses the Yoh-owned block style with its label

### Story 10.4: Drag a Block and Approve the Animated Preview

As Spencer,
I want to drag a block to a new time on Home and watch Yoh rearrange the rest of the afternoon before I approve it,
So that changing my day is one gesture plus one click.

**Acceptance Criteria:**

**Given** Home's Calendar Day View
**When** Spencer picks up a Yoh-owned, not-yet-completed block from today (a Work/Break block or a Routine Block)
**Then** it lifts with a 1.5 px `accent-solid` outline, the label "(dragging, from 2:00)", and a gentle bob. Fixed anchors, completed blocks, and past blocks can't be picked up (FR-30, UX-DR32).
**And** drag handling lives behind one `web/` hook built on `@dnd-kit/react`, pinned to an exact version
**And** drags address blocks by `PlanBlock.id`

**Given** a Task split across several blocks
**When** any of its segments is dragged
**Then** the whole Task moves, and the reshuffle re-splits it `[PRD ASSUMPTION adopted]`

**Given** Spencer releases the block
**When** the client sends `{kind:'move-block', planBlockId, newStart}`
**Then** there is no dialog or form. Within ~2 s the Reshuffle Preview animates: blocks glide to their proposed slots, moved blocks keep the accent outline, and unchanged blocks stay plain (NFR-Latency, UX-DR34).
**And** under reduced motion the calendar cross-fades to the final layout
**And** the preview card under the calendar shows a one-line summary naming moves and deferred Tasks, a Primary "Approve", and a Secondary "Discard"

**Given** a preview is open
**When** Spencer tries another drag
**Then** further drags are blocked until Approve or Discard `[ASSUMPTION]`

**Given** Approve succeeds
**When** the calendar settles
**Then** the Plan checklist reorders without a reload
**And** a stale Approve shows the fresh recomputed preview instead

**Given** Discard, or navigating away
**When** it happens
**Then** the calendar returns to its prior layout, and nothing is written

**Given** the Playwright smoke suite
**When** it runs drag → preview → Approve
**Then** it asserts the preview appears and the Plan reorders after Approve

### Story 10.5: Pin a Task and Unpin It

As Spencer,
I want to drag one Task to a specific time today and have everything else flow around it, and to undo that with one click,
So that I can lock in "Chem at 7" without changing how Yoh prioritizes anything.

**Acceptance Criteria:**

**Given** a Task inside a block on Home's calendar
**When** Spencer drags that Task out to a specific time
**Then** the client sends `{kind:'pin-task', taskId, newStart}`, and a Reshuffle Preview places everything else around the Pin (FR-31)
**And** the pinned Task is removed from the ordinary population before ordering and fitting, so it is placed exactly once, at its Pin

**Given** a Pin that overlaps a fixed anchor
**When** the preview is computed
**Then** the Pin is rejected, and the preview says why (AD-24)

**Given** a preview containing a Pin
**When** it is approved
**Then** `approve-reshuffle` persists the Pin, dated today, in the same `writeTx` as the Plan, using a new Pins table in `plan-state-store.ts`. The Pin expires at local day end in the host timezone.
**And** before Approve, the Pin exists only inside the proposal

**Given** Pins
**When** Derived Priority, Slip-Bump, memory or learning, or the Completion Log run
**Then** none of them receives Pins as an input, and every unpinned Task keeps its Derived Priority order (FR-2 amended, Non-Goal §8), proven by tests

**Given** a pinned block on the calendar
**When** it renders
**Then** it shows the Pin Control (a pin glyph on a `surface-sunken` pill), and its Plan Row shows a "pinned" badge that is an indicator only (UX-DR33)
**And** clicking the pin icon unpins the Task and produces a fresh Reshuffle Preview. This is also the non-drag unpin path.

## Epic 11: ~~Tasks page and~~ asynchronous research

*Amended 2026-09-27 (Spencer): the Tasks page is delivered early, in the 2026-09-27 fixes + UI plan (Story 11.1 below is marked accordingly). Epic 11 keeps only the Research Box/`/research` background job and the one-time research offer, now landing on the Research Hub page.*

Spencer fires off `/research` in class, closes the laptop, and later reads the answer on Research Hub via a "research ready" notification.

### Story 11.1: Tasks Page — Every Task, Grouped — **delivered early in the 2026-09-27 fixes + UI plan (Task 6B)**

*Amended 2026-09-27 (Spencer): this story shipped as Task 6B of the 2026-09-27 fixes + UI plan, standalone (no Research Box column — that moved to the new Research Hub page, Story 11.2 below), with a quick-add row and Notion-speed inline editing added, and the direct-write ruling for Spencer-typed Tasks (amends AD-3/AD-12). Kept here for FR/UX traceability; the plan's Task 6B brief is authoritative for exact scope.*

As Spencer,
I want a Tasks page showing my whole Notion Tasks database, grouped by Area or another field,
So that I can find anything without opening Notion.

**Acceptance Criteria:**

**Given** the Tasks page (replacing Epic 9's route stub and keeping its Needs-Data Indicator, or creating the page fresh if Epic 11 runs before Epic 9)
**When** it loads
**Then** `app/tasks-view.ts` returns every Task in the Notion Tasks database. ~~The left column renders~~ *(amended 2026-09-27: Tasks is a standalone page, full width, with a quick-add row at top)* Task Groups: a caption header (e.g. "AREA: SCHOOL") over rows showing the Task name and due date (FR-43, UX-DR41).
**And** a checked-off Task shows as completed, not deleted
**And** cold loads show skeleton rows

**Given** a Task Spencer types himself in the quick-add row *(added 2026-09-27)*
**When** he presses Enter
**Then** it is a direct write (the same tier as FR-24), not a Yoh-drafted Proposal — amends AD-3/AD-12. Yoh-drafted items (from Chat, FR-26) still go through Proposal/confirm.

**Given** the Grouping Control (a segmented control in a `surface-sunken` well)
**When** Spencer picks Area (the default), Due Date, Energy, or Status
**Then** the list regroups, empty groups are omitted, and the choice persists per device in `localStorage` (guarded)

**Given** Notion is unreachable
**When** the page loads
**Then** the last-loaded Tasks stay visible with a "last updated" time, and an `operational` notification appears

### Story 11.2: Research Box ~~on Tasks~~ on Research Hub

*Amended 2026-09-27 (Spencer): the Research Hub page shell (Task 6C) ships in the 2026-09-27 fixes + UI plan, ahead of this story — a fourth page (Home, Tasks, Desk, Research Hub) rather than a column on Tasks. This story's Research Box content lands there; the async `/research` job (Story 11.3) and the one-time offer (Story 11.4) remain Epic 11's job.*

As Spencer,
I want my latest research up front on Research Hub and my whole Research Vault browsable underneath it,
So that research answers live in one obvious place.

**Acceptance Criteria:**

**Given** the Research Hub page
**When** it loads
**Then** the Research Box shows the latest research output first (a title-style heading, the body, and a source list), with the Research Vault library listed as rows below, read through `notion-adapter.ts` reads (FR-43, UX-DR43)
**And** an "ask a research question" box sends the question into the Chat panel
**And** clicking a library row opens that document in the box

**Given** an empty Research Vault
**When** the box renders
**Then** it reads "Nothing saved yet. Ask a question, then say "save that"."

**Given** Desk
**When** it is built (Epic 12)
**Then** it has no research surface, because the Research Box is the only one

### Story 11.3: /research Runs as a Background Job

As Spencer,
I want to type `/research <question>`, leave, and have the answer filed and waiting for me later,
So that I can fire off questions in class without waiting on them.

**Acceptance Criteria:**

**Given** the command registry
**When** this story ships
**Then** `/research` appears in the Command Palette with a description and an example

**Given** `/research <question>`
**When** Spencer sends it
**Then** `app/queue-research.ts` inserts a `queued` job in `adapters/job-store.ts` (its own table, with status and `claimed_at`) and returns immediately with a one-line acknowledgment. Yoh asks no narrowing questions (FR-51, AD-21).

**Given** the in-server job runner
**When** it claims a job (one at a time)
**Then** it calls `search-adapter.ts`, then `createPage('ResearchVault', …)` with FR-29's provenance (source-tagged, dated) as a direct write, then marks the job `done` with the page id and raises `research-ready`, "Research ready: {topic}", deep-linking to that page in the Research Box on Research Hub *(amended 2026-09-27, was Tasks)*
**And** the notification arrives even if Spencer closed the tab

**Given** the search fails, or filing fails
**When** the job ends
**Then** it is marked `failed`, and a `research-failed` notification, "Couldn't finish research: {topic}", deep-links to Chat. A failure is never reported as research-ready.

**Given** the server restarts
**When** a job is still marked `running`
**Then** it is set to `failed` with a notification and is **never** automatically re-run

**Given** any code path other than `app/queue-research.ts`
**When** it tries to create a research job
**Then** it cannot. `queue-research.ts` is the only writer, so research never runs without the command (FR-28 boundary).

**Given** a `research-ready` notification
**When** Spencer clicks it
**Then** he lands ~~on Tasks~~ *(amended 2026-09-27: on Research Hub)* with that new document open in the Research Box, in one click

### Story 11.4: One-Time Research Offer

As Spencer,
I want Yoh to ask once whether I'd like research when I describe something obviously research-sized,
So that I don't have to remember the command, and Yoh still never searches on its own.

**Acceptance Criteria:**

**Given** a Chat message describing an obviously research-sized question, without `/research`
**When** `chat-turn` classifies it
**Then** Yoh offers once, via a Structured Question: "Do you want to do research on this?"

**Given** the offer
**When** Spencer accepts
**Then** it calls `app/queue-research.ts` with the question, exactly as `/research` would

**Given** the offer
**When** Spencer declines or ignores it
**Then** nothing runs, and Yoh doesn't repeat the offer for that message (FR-16, FR-48)

**Given** an ordinary planning or status message
**When** it is classified
**Then** no offer is made. The classification boundary follows FR-28's existing search-trigger rule.

## Epic 12: Desk — the after-school view

At his desk, Spencer sees Tasks completed, minutes worked, on-time rate, streak, a usage heatmap, and *(added 2026-09-27)* a Claude API spend-this-month tile, all computed from Yoh's own log/usage store. Next to them are crypto (BTC/ETH/SOL), weather (Seattle, WA), and news (biggest business stories, AI emphasis) widgets — confirmed 2026-09-27 — each of which fails on its own without breaking the rest.

### Story 12.1: Activity Days and Desk Metrics

As Spencer,
I want Desk to show what I got done, minutes worked, my on-time rate, and my streak, from Yoh's own records,
So that I can see my day summed up at a glance, with numbers that never depend on Notion's history.

**Acceptance Criteria:**

**Given** `completion-log.ts`
**When** this story is complete
**Then** it exports `recordActivityDay(date)`, an idempotent upsert keyed by local date in the host timezone. The server calls it on any Web App request (FR-47, AD-23).

**Given** `core/desk-metrics.ts`
**When** it computes metrics
**Then** each is a pure function over log rows, with no Notion read:
- Tasks completed today
- Minutes today: the sum of `estimatedMinutes` for completions today
- All-time hours with Yoh, on the same Completion Log basis (resolves PRD OQ10 per UX)
- On-time rate: completions with `completedAt ≤ dueDate` over all completions `[PRD ASSUMPTION adopted]`
- Current streak: consecutive activity days ending today, or ending yesterday if today has no activity yet `[ASSUMPTION]`
- Longest streak

**Given** Desk
**When** `app/desk.ts` returns the metrics
**Then** the widget grid renders (UX-DR44):
- **Tasks Completed:** a scrollable list of checked, struck-through rows
- **Worked:** one merged widget, "145 min today" as the primary figure, with "212 h with Yoh" as a caption line beneath
- **On-Time Rate**
- **Streak:** "Streak: 1 day · Longest: 12 days"

All figures use tabular numerals.
**And** the wording is neutral, with no guilt copy, and zero completions show "0" and "Streak: 0 days"

### Story 12.2: Usage Heatmap

As Spencer,
I want a GitHub-style heatmap of the days I've used Yoh,
So that I can see my rhythm over weeks at a glance.

**Acceptance Criteria:**

**Given** activity days in the log
**When** Desk renders the Usage Heatmap
**Then** it shows weeks as columns by 7 days, computed server-side by `core/desk-metrics.ts`
**And** `[ASSUMPTION: resolves UX OQ5]` cells use `accent-solid` at four stepped opacities, plus an empty step with a rim, with a legend

**Given** a cell
**When** Spencer hovers or focuses it
**Then** a tooltip shows the date and that day's count, and the cell is keyboard-focusable with an accessible label

**Given** the heatmap sits in a horizontally scrollable region
**When** Spencer scrolls or drags inside it ~~swipes inside it~~ *(swipe navigation retired 2026-09-27; the heatmap's own horizontal scroll is unaffected)*
**Then** the page doesn't change, and the edge-aware page-navigation wheel doesn't fire while the pointer is over this region (UX-DR28)

### Story 12.3: Feed Providers and Crypto Tickers

As Spencer,
I want BTC, SOL, and ETH prices on Desk from a free provider that never sees my data,
So that I get the glance I want without leaking anything or paying for it.

**Acceptance Criteria:**

**Given** a provider spike
**When** this story starts
**Then** free-tier crypto, weather, and news providers whose terms allow this use are chosen and recorded. ~~and the weather location is set in config~~ *(resolved 2026-09-27, Spencer: weather location is Seattle, WA; crypto is BTC/ETH/SOL; news is the biggest business stories with an AI emphasis — spine Deferred, PRD OQ11 partially resolved, provider terms-check remains open)*

**Given** `adapters/crypto-feed.ts`
**When** the server calls it
**Then** it fetches only the ticker symbols, keeps its own cache with the last-good value and `fetchedAt` (refresh starting at ~5 min, exported once), and returns `{status:'ok'|'stale'|'unavailable', value?, fetchedAt?}` without throwing (AD-22)
**And** its request signature has no parameter that could carry Task, Calendar, or usage data, and it shares no client or error handling with Notion or Calendar

**Given** Desk
**When** the ticker widget renders
**Then** it shows BTC, SOL, and ETH
**And** when the feed is unavailable it shows "Unavailable · last updated {time}" (or "Unavailable" if there's no last value) in `ink-secondary`, and no other widget is affected
**And** the browser never contacts the provider (CSP from 7.5)

### Story 12.4: Weather and News Widgets

As Spencer,
I want the weather and top business and AI news on Desk, each failing on its own,
So that one flaky feed never blanks my desk view.

**Acceptance Criteria:**

**Given** `adapters/weather-feed.ts` and `adapters/news-feed.ts`
**When** the server calls them
**Then** each follows 12.3's contract: only the configured location, or only the news categories, go out; each keeps its own cache (refresh starting at ~30 min for weather and ~60 min for news); and each returns a status without throwing (AD-22)

**Given** Desk
**When** the weather and news widgets render
**Then** weather shows current conditions for Seattle, WA *(confirmed 2026-09-27)*, and the news hub shows the biggest business stories with an AI emphasis *(confirmed 2026-09-27, was "top business and top AI headlines")*, linking out

**Given** either feed is down or rate-limited
**When** Desk renders
**Then** that widget alone shows "Unavailable · last updated {time}", and the rest of Desk is unaffected (FR-44, UJ-6 failure path)

### Story 12.5: Claude API Spend Tile *(added 2026-09-27, Spencer)*

As Spencer,
I want to see this month's Claude API spend on Desk,
So that I can spot-check real usage cost without hunting through a separate billing dashboard.

**Acceptance Criteria:**

**Given** Task 9's per-call usage-recording store (prompt caching and per-call usage recording, landed 2026-09-27 as Task 9 of the fixes + UI plan)
**When** Desk renders the spend tile
**Then** it computes this month's spend locally from recorded usage rows × one price table — no Admin API key needed
**And** it follows the same widget shape as the other Desk widgets (neumorphic card, caption header, numerals value)

**Given** the usage store has no rows yet this month
**When** the tile renders
**Then** it shows "$0.00" or an equivalent zero state, not an error

## Epic 13: "Yoh remembers you" — persistent memory

*Planned 2026-09-29. Replaces the 2026-09-27 sketch (Stories 13.1–13.4: chat-store, three folders, browsing, backfill). The three-folder model became eight folders (PRD §5.14). The backfill story is dropped: before this epic, history lived only in the browser, so there is nothing on the host to migrate.* Sources: PRD FR-52–FR-60, EXPERIENCE.md/DESIGN.md 2026-09-29 rows, ARCHITECTURE-SPINE AD-25–AD-31.

Spencer's chat history survives reloads and devices. Yoh files what he tells it into eight visible folders with a one-line receipt and Undo, uses it in answers, asks before any memory changes a planning rule, proposes patterns with evidence, and checks in with an occasional 1–3 rating. Everything is browsable and editable on the Memory page.

**Order:** 13.1 → 13.2 (ships early so Pattern data starts accruing) → 13.3 → 13.4 → 13.5 → 13.6 → 13.7 → 13.8 → 13.9 → 13.10 → 13.11 → 13.12 → 13.13. Stories 13.7 and 13.2 touch disjoint files from 13.3–13.6 and can run alongside them.

### Story 13.1: Server-Owned Chat History

As Spencer,
I want my chat to still be there after a reload or on another device,
So that I never lose a conversation or have to repeat context.

**Acceptance Criteria:**

**Given** `adapters/chat-store.ts` (sole owner of Conversations, turns, and a turns FTS5 index; `CREATE TABLE IF NOT EXISTS`; writes in `writeTx`)
**When** Spencer sends a message
**Then** his turn is stored before the model call, and Yoh's turn when the stream ends. An aborted stream stores the partial text with `truncated: true` (AD-25).
**And** a Conversation is one calendar day in `YOH_TIMEZONE`

**Given** `POST /api/chat`
**When** this story ships
**Then** the request carries only the new message. `ChatTurnRequest.history`, the server's `isChatHistory` check, `trimHistory`, and the fixture server are updated. `app/chat-turn.ts` reads the last `MAX_CHAT_HISTORY_TURNS` turns from the store.

**Given** the Chat panel opens (fresh load, or another device)
**When** today's Conversation has turns
**Then** they render, scrolled to the end. Stored Structured Questions and Proposals render as answered text or re-enter `confirm-proposal`'s stale check; nothing in a transcript re-runs an action (FR-52).

**Given** the chat store throws on read or write
**When** Spencer sends a message
**Then** Yoh still answers (logged, no history) (FR-52)

**Given** a Playwright run against the fixture server
**When** Spencer sends a message and reloads
**Then** the message and the reply are still shown

### Story 13.2: Record Planned Times and Slip Events for Patterns

As Spencer,
I want Yoh to start keeping the data a pattern needs now,
So that pattern proposals (Story 13.13) have weeks of real evidence when they arrive.

**Acceptance Criteria:**

**Given** `completion-log.ts` `completions`
**When** this story ships
**Then** it gains nullable `planned_start` and `planned_end` columns (idempotent migration). A check-off fills them from today's Plan block for that Task; close-out completions and Tasks with no block leave them null (AD-30).

**Given** a slip is recorded anywhere (night close-out, Slip-Bump)
**When** it is written
**Then** an append-only `slip_events` row `{taskId, area, date}` is written in the same transaction. The existing consecutive-slip record is unchanged.

**Given** existing rows
**When** the migration runs
**Then** nothing is backfilled or altered, and the Desk metrics still pass their tests

### Story 13.3: Memory Item Store

As Spencer,
I want every memory to be one versioned, recoverable item in a fixed folder,
So that edits, supersedes, and Undo never lose what came before.

**Acceptance Criteria:**

**Given** `types/domain.ts`
**When** this story ships
**Then** it defines the closed `MemoryFolder` union (eight folders, PRD order) and `MemoryItem`. One `core/` function maps folder → load class (always / relevant / on-ask); it is never stored (AD-26).

**Given** `adapters/memory-item-store.ts` (sole owner of `memory_items`, its external-content FTS5 index, `pattern_state`, and `searchRelevant`)
**When** an item is restated, contradicted, edited, or moved
**Then** a new row is inserted with `replaces_id`, and the old one becomes `superseded`. A merge supersedes both. A new version inherits `rule_change`.
**And** text over `MEMORY_ITEM_MAX_CHARS` (280) is rejected as `validation`

**Given** a forget
**When** it runs
**Then** the chain is marked `deleted`, and purged on Spencer's next user turn. Undo before then restores it.
**And** "keep as history" sets `status: history` (kept, never loaded, never in Needs review)

**Given** any write
**When** it commits
**Then** it ran in `writeTx` and appended one outbox row on `MEMORY_TOPIC`

**Given** the store throws
**When** a caller in `app/` uses it
**Then** the error is caught and logged, and the caller proceeds without memory (AD-26 degradation)

### Story 13.4: Memory Commands, the Remembered Receipt, and Undo

As Spencer,
I want to say "remember that …" or "forget …" and see exactly what Yoh kept,
So that memory is never silent and a mistake is one click to undo.

**Acceptance Criteria:**

**Given** `core/memory-commands.ts`
**When** a turn starts with "remember that …", "remember: …", `/remember`, "forget …", "forget that", `/forget`, or "what do you remember about …"
**Then** it is recognized before capture, with no LLM routing guess. "remember to …" and "remind me to …" still create Tasks (FR-55).

**Given** `types/api.ts`
**When** this story ships
**Then** it extends the existing `ChatStreamEvent` union in `types/api.ts` with the fixed order `status`* → `delta`* → `done` (carries `substantive`) → `remembered` → `proposal` → `rating` → close (AD-27). `remembered` is `{receiptId, kind: 'remembered'|'forgot', items: [{id, text, folder, scope?, expiresOn?}]}`.

**Given** "remember that Chem club is a club, not a class"
**When** the reply finishes
**Then** Haiku `extractMemories` runs with `forceStated`; `core` `validateFiling` checks it; the item is filed as Stated; and a `remembered` event is sent. The web renders one muted line under the reply: "Remembered: Chem club is a club, not a class · Corrections · Undo" (UX Remembered Receipt; scope and "until {date}" when present; two items joined on one line).
**And** `aria-live="polite"` announces it; Undo is a real button

**Given** Undo on the receipt
**When** no later user turn exists in that Conversation
**Then** `POST /api/memory/undo {receiptId}` removes the item (or restores the version it replaced, or restores a forgotten chain), and the line reads "Removed from memory." After Spencer's next message, the server refuses it and the line shows "View in Memory".

**Given** "forget …" with several matches
**When** it runs
**Then** a disambiguation Structured Question lists them with their folders plus "None of these", stored as an interaction request. Nothing is deleted until it is answered. No match → "Nothing in memory matches '{words}'." (FR-55)

**Given** "forget that" or a single "forget …" match
**When** it runs
**Then** "forget that" targets the most recent filing receipt in this Conversation (AD-27); the chain is marked `deleted` and a `remembered` event with `kind: 'forgot'` renders "Forgot: {text} · Undo" (UX). Undo restores the chain under the same no-later-turn rule.

**Given** "what do you remember about AP Bio"
**When** it runs
**Then** Yoh lists the matching items grouped by folder (Ideas & notes included), each linking to it on the Memory page

**Given** filing fails or times out (`MEMORY_FILING_TIMEOUT_MS` = 8000)
**When** it was an explicit command
**Then** the line reads "Couldn't save that to memory." Otherwise nothing is shown. The reply is never delayed.

**Given** the Command Palette
**When** Spencer types "/"
**Then** `/remember` and `/forget` are listed with a description and an example

### Story 13.5: Automatic Filing After Each Turn

As Spencer,
I want Yoh to notice what's worth remembering without my asking,
So that it gets to know me without me repeating myself.

**Acceptance Criteria:**

**Given** a turn not handled by a memory command
**When** `core` `isTrivialTurn` is true (3 words or fewer, an acknowledgement, a turn handled by another deterministic command, or a Structured Question answer)
**Then** no model call is made and nothing is filed (FR-54)

**Given** a non-trivial turn
**When** the reply's `done` has been sent
**Then** one Haiku `extractMemories` call sees only Spencer's typed text plus the always-loaded set. It never sees the reply, search results, Research Vault pages, or Notion content.
**And** `validateFiling` enforces: at most 2 items; no inferred item in Feedback or Planning preferences; inferred health, emotion, or finance items dropped; a valid expiry; the text length

**Given** a candidate that restates an existing item
**When** it is filed
**Then** it becomes a new version of that item, not a duplicate. A contradiction supersedes the old item, which stays viewable as history (FR-54).

**Given** a Feedback item
**When** it is filed
**Then** it stores its scope, with the narrowest reading when Spencer's words don't say. The receipt shows "for {scope}".

**Given** a fake-LLM test suite
**When** it runs
**Then** it covers: a trivial turn (no call), a ≤2 clamp, an inferred Feedback candidate dropped, an inferred health candidate dropped, a restate, a contradiction, and a timeout with no receipt

### Story 13.6: Recall in Answers and Plan Reasoning

As Spencer,
I want Yoh's answers and Plan explanations to use what it knows about me,
So that I don't have to repeat context.

**Acceptance Criteria:**

**Given** the pure `core/memory-context.ts` selector
**When** it runs over current items, relevant matches, and `now`
**Then** it returns the `MemoryContext` plus each item's load state. The always-loaded set is current, unexpired items of the five always folders, newest `confirmed_at` first, capped at `ALWAYS_LOADED_CAP` (60). Overflow, expired, 120-day-stale, and `entity_ref`-conflict items are "not loaded" with a Needs review reason (AD-28).

**Given** `answerGeneralQuestion`/`streamGeneralQuestion`, `draftNotionPageFields`, and Plan-reasoning generation
**When** they are called
**Then** they take a `MemoryContext`. The always block is a cached stable system block after the fixed prompt; relevant items (`searchRelevant`, FTS5 bm25 top 5 over the two relevant folders) go in the volatile block. A match bumps `last_matched_at`.

**Given** `classifyCapture`, `classifyChatIntent`, search-intent, and the scheduler
**When** this story ships
**Then** their signatures take no memory, and a test asserts it. `confirm-proposal.ts` never reads memory (FR-56).

**Given** the memory store is down
**When** Spencer asks a question
**Then** Yoh answers without memory

### Story 13.7: Planning Settings Threaded Through the Scheduler

As Spencer,
I want every planning rule to come from one settings value,
So that a rule change I approve (Story 13.8) changes planning everywhere, and nothing else can.

**Acceptance Criteria:**

**Given** `core/planning-settings.ts` `resolvePlanningSettings(defaults, overrides)` and `adapters/settings-store.ts` (closed `RuleSettingKey`: `schoolDayWorkStart`, `otherDayWorkStart`, `lunchWindow`, `communityWindow`, `areaDurationPadding`)
**When** this story ships
**Then** the `core/school-day.ts` work-start and protected-window functions, `work-break-fit`, `routine-placement`, and the morning / reshuffle / re-flow pipelines take a `PlanningSettings` parameter (AD-29)
**And** a source-scan test forbids reading `WORK_START_TIMES` or the protected-window defaults anywhere but `resolvePlanningSettings`

**Given** no overrides are stored
**When** the full test suite runs
**Then** every existing planning test passes unchanged: a pure refactor, no behavior change

**Given** the Time Budget
**When** this story ships
**Then** it is not a `RuleSettingKey` and keeps its existing owner and proposal path

**Given** an override value for any `RuleSettingKey`
**When** the settings store or `validateFiling` checks it
**Then** it must match the AD-29 value shape (work starts `"HH:MM"` 06:00–21:00 on 5-minute steps; windows `{start, end}` with start < end, 5–180 min; `areaDurationPadding` `{area, minutes 0–120, multiple of 5}`), or it is rejected as `validation`

### Story 13.8: Rule-Change Proposals From Planning Preferences

As Spencer,
I want "start work at 2:30 on school days" to ask me before it changes my Plan,
So that memory never silently overrides a planning rule.

**Acceptance Criteria:**

**Given** a filed Planning-preferences item whose `extractMemories` candidate carries a `ruleChange` that `validateFiling` accepts
**When** it is filed
**Then** `app/chat-turn.ts` creates a `Proposal<RuleChange>` in the same transaction, marks the item `pending`, and sends a `proposal` event after `remembered`. The card reads "Change school-day work start from 3:15 PM to 2:30 PM?" Yes/No (FR-57).

**Given** Yes
**When** it is confirmed
**Then** `confirm-proposal.ts` writes the override, marks the item `confirmed`, and replies "Changed school-day work start to 2:30 PM. Revert it on the Memory page." The next Plan uses it.

**Given** No
**When** it is answered
**Then** nothing changes in planning; the item is `declined` and replies "Kept 3:15 PM. Your preference stays saved, marked declined." A restate of a declined preference is not re-proposed.

**Given** Undo on that filing's receipt
**When** the Proposal is still pending
**Then** the Proposal is withdrawn with the item

**Given** a pending Proposal
**When** a Plan is built
**Then** the preference has no effect

**Given** a `Proposal<RuleChange>` (`{key, value, previous, memoryItemId}`)
**When** Spencer says Yes after the resolved value has changed from `previous`, or 7 days pass unanswered
**Then** a stale Yes returns `stale-proposal` and writes nothing; an expired one is withdrawn and the item is marked `declined`, staying as a soft preference (AD-29)

**Given** a soft preference ("I like hard tasks first") or one about Derived Priority weights, block length, or buffers
**When** it is filed
**Then** no Proposal is raised; it affects only AI-written text

### Story 13.9: Memory Page — Folders, Search, and Chat History

As Spencer,
I want a Memory page where I can see everything Yoh remembers and every past chat,
So that nothing is remembered behind my back.

**Acceptance Criteria:**

**Given** the page stack
**When** this story ships
**Then** Memory is the fifth page after Research Hub, in the sidebar, and announced "Memory, page 5 of 5" (FR-59, UX)

**Given** the Memory page
**When** it loads
**Then** it shows skeletons, then the Memory Rail (Needs review with count, hidden at zero; the eight folders with counts under "Always used" / "Used when relevant" / "Only when asked"; Changed settings; Chat history), with the last selection restored. Items show text, Stated/Inferred, date, scope, expiry, a Source link ("source deleted" when gone), "Not loaded" badges from the shared selector, and "{n} earlier versions".

**Given** Memory Search
**When** Spencer types
**Then** one keyword search covers memories and chat history. Each result shows its folder or Conversation date and opens in place. Esc clears it.

**Given** Chat history
**When** Spencer opens a Conversation
**Then** its read-only transcript shows. Delete conversation uses the Undo Toast and commits when it closes. "Clear all history" asks inline ("Clear all chat history? This can't be undone. Memories stay.") before `POST /api/chat-history/clear`. Delete conversation sends `POST /api/chat-history/delete {conversationId}` when the toast closes (routes: AD-26).

**Given** the memory or chat store is down
**When** the page loads
**Then** that pane shows "Couldn't load memory right now." and nothing is shown as saved

**Given** a Playwright run
**When** the fixture server has memory items and two Conversations
**Then** the page lists them, and search finds an item and a chat turn. Light and dark pass axe.

### Story 13.10: Memory Page — Edit, Needs Review, and Changed Settings

As Spencer,
I want to fix, move, expire, or delete any memory, and undo a rule change,
So that I stay in control of what Yoh uses.

**Acceptance Criteria:**

**Given** a Memory Item
**When** Spencer clicks its text (or presses Edit on focus)
**Then** it edits in place: Enter saves as a new version (inferred becomes Stated), Esc cancels. A duplicate of another item offers "Merge with '{other}'?" Yes/No. A failure restores the old text with an error.

**Given** the overflow menu
**When** Spencer picks Move to folder, Set/Clear expiry, or Delete
**Then** each is a direct write with a visible result (`POST /api/memory/move`, `/api/memory/expiry`, `/api/memory/delete`; edit is `/api/memory/edit`, Renew/Keep is `/api/memory/review`, Revert is `/api/settings/revert`; AD-26). Delete dissolves the row with "Deleted '{text}' · Undo" and commits when the toast closes (FR-59).

**Given** Needs review
**When** it lists items
**Then** each shows its reason ("Expired Dec 19", "Not loaded: over the cap", "Unused since May 2", "Notion now says Due Oct 4") and offers Renew (only where it applies), Edit, Delete, and Keep as history

**Given** Changed settings
**When** a confirmed rule change exists
**Then** it reads "School-day work start: 2:30 PM (was 3:15 PM) · changed Sep 29" with Revert. Revert deletes the override and shows "Reverted to 3:15 PM." Empty: "No planning rules changed."

**Given** the Patterns folder
**When** a Pattern proposal is pending (Story 13.13)
**Then** it appears at the top with its evidence and Yes/No, answered through `POST /api/open-items/answer` → `app/confirm-proposal.ts` (AD-30)

### Story 13.11: "How Is Yoh Doing?" Rating

As Spencer,
I want an occasional one-click 1–3 rating instead of a written Self-Check,
So that Yoh hears when it's off without nagging me.

**Acceptance Criteria:**

**Given** `adapters/rating-store.ts` and the pure `core/rating-schedule.ts` `decideRatingPrompt(state, {substantive, now, draw})`
**When** a substantive chat turn ends (a plan change or re-fit asked in chat, a researched answer, `/morning`, `/night`)
**Then** a `rating` event is sent with probability `RATING_PROMPT_PROBABILITY` (0.35) until that day's one prompt is shown. It never appears after a non-substantive turn, in a push, or on the Morning Ritual (FR-60).

**Given** the prompt ("How is Yoh doing?" · 1 Poor · 2 Okay · 3 Good · Not now)
**When** Spencer picks a score
**Then** `POST /api/rating {promptId, score}` stores it, resets consecutive dismissals, and the prompt folds to "Rated 3 (good)". Keys 1–3 work while it has focus.

**Given** "Not now", or a new message sent while it is open
**When** it is dismissed
**Then** the dismissal is recorded (server-side for a new message). Three in a row pause prompts for a week.

**Given** a 1
**When** it is picked
**Then** an optional "What was off?" field appears with Send and Skip. A sent answer (`POST /api/rating {promptId, score: 1, note}`) files to Feedback as Stated through the explicit path; the route's JSON response carries the `remembered` receipt payload, rendered with the Remembered Receipt component (AD-31). `extra_prompt_due` lets the next substantive turn prompt again, at most one extra per day.

**Given** any model call
**When** it is built
**Then** ratings are never included

### Story 13.12: Retire Self-Check

As Spencer,
I want the four-day Self-Check gone now that the Rating replaces it,
So that there's one feedback loop, not two.

**Acceptance Criteria:**

**Given** the codebase
**When** this story ships
**Then** the `self-check` subcommand and its deps, `rituals/self-check.ts`, `app/answer-self-check.ts`, the open-item question and answer kinds, the escalation and error-copy entries, and the web handling are removed. Known references at planning time: `shell/ritual-cli.ts` + its self-check deps, `rituals/self-check.ts`, `rituals/morning-ritual.ts`, `rituals/ritual-shared.ts`, `app/answer-self-check.ts`, `adapters/memory-store.ts`, `adapters/logger.ts`, `core/error-copy.ts`, `web/src/components/ChatPanel.tsx`. `grep -ri self-check src web/src` is empty (AD-31).
**And** Escalate-Under-Strain no longer reads Self-Check scores

**Given** stored open self-check interaction requests
**When** the server starts after deploy
**Then** a one-time cleanup removes them

**Given** the Pi host timer for self-check
**When** this ships
**Then** the deploy notes name the systemd timer to disable. The coordinator disables it at deploy; the story never touches the host.

### Story 13.13: Pattern Proposals With Evidence

As Spencer,
I want Yoh to notice things like "History essays run 30 minutes over" and ask me once,
So that the Plan adapts to how I actually work, with my yes.

**Acceptance Criteria:**

**Given** the pure `core/pattern-detect.ts` run by `rituals/night-ritual.ts` after close-out
**When** `slip_events` or same-day check-offs with `planned_end` show a `PatternKind` (`area-slips`, `area-overrun`) at least `PATTERN_MIN_OCCURRENCES` (4) times spanning ≥14 days within 42
**Then** it creates a `Proposal<PatternProposal>` with evidence ("5 times since Sep 3: …") and the padding (median overrun rounded to 5 min), unless `pattern_state` for (kind, Area) is pending or declined within 30 days (FR-58, AD-30)
**And** close-out completions and rows without `planned_start` are ignored

**Given** a pending Pattern proposal
**When** Spencer runs `/morning`, or opens the Chat panel for the first time that day
**Then** at most one is shown per day across both surfaces (`/morning` emits it as the turn's `proposal` event; the panel fetches `GET /api/memory/pattern-offer`, which records `last_offered_on`; AD-30): "Yoh noticed History essays run about 30 min over. 5 times since Sep 3: … Plan for that?" Yes/No. It is never a push or In-App Notification.

**Given** Yes
**When** it is confirmed
**Then** a Patterns item is filed with a receipt. For `area-overrun`, an `areaDurationPadding` override is written through AD-29, and `plan-reasoning` cites the pattern whenever the padding affects a placement.

**Given** No
**When** it is answered
**Then** nothing is filed, and `pattern_state.declined_at` is set

**Given** a Pattern proposal unanswered for 7 days, or confirmed after its `pattern_state` moved on
**When** it expires or is confirmed
**Then** it is withdrawn and treated as declined; a stale confirm returns `stale-proposal` and writes nothing (AD-30)

**Given** a single day of overruns
**When** detection runs
**Then** nothing is proposed
