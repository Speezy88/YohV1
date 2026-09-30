---
title: PRD: Yoh
created: 2026-08-21
updated: 2026-09-29
status: final
---

# PRD: Yoh

## 0. Document Purpose

This PRD is written for one reader wearing three hats — Spencer as PM, architect, and developer of Yoh — and for the downstream BMad workflows (architecture, epics/stories) that will consume it next. It builds directly on `../../briefs/brief-YohV1-2026-08-21/brief.md` and its `addendum.md`; nothing here duplicates that brief's narrative; it converts its decisions into implementable requirements. Vocabulary is Glossary-anchored (§4) — every FR and journey uses those terms verbatim. Features are grouped by behavior with Functional Requirements (FRs) nested underneath, numbered globally (FR-1…FR-N) so later artifacts can reference them by stable ID. Inline `[ASSUMPTION: …]` tags mark places this PRD inferred beyond what the brief stated; all are indexed in §12 for confirmation. Technical-how (API endpoints, auth mechanics, hardware stack) lives in `addendum.md`, not here — this document specifies capability and behavior, not implementation.

## 1. Vision

Yoh is a personal daily-planning system built for exactly one user. It reads a Notion Tasks database and a Google Calendar and runs a single daily loop — a Morning Ritual that generates one specific, trustworthy Plan for the day, and a Night Ritual that closes it out and adjusts for what actually happened. It exists to solve one problem: Spencer needs a Plan that is realistic enough, and transparent enough, to actually be followed — not a to-do list he has to interpret and re-prioritize by hand every morning.

This is Yoh's second attempt. The first was abandoned not for bugs or lost motivation but for an efficacy failure — what shipped wasn't useful enough to keep using. This PRD exists to convert the lessons of that failure into enforceable requirements: a narrow, working Morning/Night loop before anything else, a strict **Propose-Don't-Impose** boundary on anything Yoh infers about Spencer's behavior, and an **Escalate-Under-Strain** discipline that keeps the system's insistence proportional to how much it's actually being ignored — never more, never a flat nag.

Everything past the MVP loop — a web app, physical voice hardware, an iOS app, self-calibrating estimates, a Canvas LMS assignment sync — is real roadmap, not scope creep, and is explicitly Phase 2 and later. Phase 1 shipped September 2, 2026 (all epics done). This PRD now also specifies **Phase 1.5**: a narrow, CLI-scoped extension of Phase 1's Notion/Calendar write surface (page/database creation, confirm-gated time-block editing beyond Yoh-owned events) plus a first slice of Research Vault brought forward as a chat-triggered web-search capability — without retiring the CLI or starting Phase 2's Web App. As of the 2026-09-24 update it also specifies **Phase 2**: the Yoh Web App, which retires the CLI and becomes the only interactive surface (§5.9–§5.13). Phase 2's headline is direct manipulation with the same trust boundary — drag a block, see Yoh's proposed day, approve it in one click — backed by a guided data-entry flow (/sandbox) that gives the planner what it needs. Phases past Phase 2 remain constraints on *how* this is built (modularly), not requirements to satisfy now.

## 2. Why Now

Timing here isn't external — it's self-imposed, and load-bearing anyway. This rebuild's entire discipline is a direct response to naming that efficacy failure precisely rather than repeating it under a new coat of paint. The **September 2, 2026** target isn't arbitrary scope-padding insurance — it's the forcing function that keeps Phase 1 narrow: anything that doesn't serve "does the Morning/Night loop actually get used" is explicitly deferred (§9.4), not squeezed in because it's easy. If this PRD lets Phase 1 scope drift, it has failed at the one thing it exists to prevent.

Phase 1.5 (§5.7 FR-25–FR-27, §5.8) is roadmap-driven, not usage-driven — it was not prompted by a specific friction Spencer hit running Phase 1 day-to-day (only about two weeks of real use had elapsed when this update was made). It came out of a dedicated brainstorm on where Yoh's write/search surface should go next, and was pulled forward deliberately rather than discovered as a gap. Named here plainly so a future reader doesn't infer usage evidence that doesn't exist.

Phase 2 (§5.9–§5.13) is the roadmap's next numbered phase, scoped in a dedicated brainstorm on 2026-09-24 (`brainstorm-phase2-web-app-ui-2026-09-24/`) about three weeks into daily Phase 1 use. Its grounding is Spencer's real daily contexts — home in the morning, 30-second captures in class, a longer desk session after school — and the CLI's fit to none of them. Its one named usage lesson is the "stupid plan" failure: a Plan that ignores transition time (homework scheduled the minute school ends) is the fastest way to lose trust, which is why Routines (FR-35) ship alongside the drag interaction rather than after it.

## 3. Target User

### 3.1 Jobs To Be Done

- **Functional:** Turn a Notion Tasks database and a Google Calendar into one ordered, realistic Plan for today — without Spencer manually reconciling them each morning.
- **Functional:** Close out the day honestly — know what got done, what slipped, and have that slip handled automatically instead of silently vanishing or nagging forever.
- **Emotional:** Trust the Plan enough to actually follow it, rather than mentally overriding it the way an unreliable planner gets ignored.
- **Emotional:** Not be fought with. A system that re-explains itself, misreads tone, or oversteps its role is worse than no system — this job is as much about *absence* of friction as presence of help.
- **Contextual:** Recover cleanly from a day that didn't go as planned (a slip, an unchecked night, a missed field) without the system either giving up on it or hounding Spencer about it.

### 3.2 Non-Users (v1)

Yoh has exactly one user, permanently — not a v1 scoping choice (see §8 Non-Goals).

### 3.3 Key User Journeys

- **UJ-1. Spencer starts his day with a Plan he didn't have to build.**
  - **Persona + context:** Spencer, first thing in the morning, phone in hand.
  - **Entry state:** Notion Tasks DB has current tasks with their fields set (or partially set); Google Calendar has today's fixed events.
  - **Path:** Yoh reads Tasks (Estimated Duration, Area, Due Date, Status, Energy) and today's Calendar events → if a Task in play is missing a required field, Yoh asks Spencer to fill in that field before planning around the Task → Yoh computes Derived Priority, fits Tasks into the day's Time Budget in 70/15 Work/Break Blocks around fixed Calendar events → Yoh sends one push notification showing the day's ordered Plan with a one-line reason for what leads it ("leading with X — due soonest, biggest chunk") → Yoh disengages for the day, no further prompts unless Spencer initiates a Mid-Day Re-Flow.
  - **Edge case:** A Task is missing a required field Yoh needs to plan around it — Yoh prompts for just that field rather than silently guessing or dropping the Task.
  - *Capability → FR:* generate Plan from Tasks + Calendar → FR-1; Data-Completeness Gate → FR-4; Derived Priority → FR-2; Time Budget / work-break fit → FR-5–FR-8; one-line reasoning → FR-3; single notification → FR-1.

- **UJ-2. A Task slips, and Spencer adjusts mid-day without a fight.**
  - **Persona + context:** Spencer, partway through the day, a Task ran long or got skipped.
  - **Entry state:** A Morning Plan already exists and is in progress.
  - **Path:** Spencer self-reports the slip (Yoh does not proactively check in mid-block) → Spencer triggers a Mid-Day Re-Flow → Yoh re-fits the remainder of the day's Blocks around the change, reflecting reality without Spencer manually rebuilding the rest of the day → the slipped Task receives a small, capped Slip-Bump toward tomorrow's priority, guaranteed even if nothing else changes.
  - **Edge case:** A Blocker is purely logistical (e.g., a meeting ran over) — Yoh reschedules around it without attempting to solve or judge the Blocker itself.
  - *Capability → FR:* Mid-Day Re-Flow (user-initiated only) → FR-9; Slip-Bump → FR-11; logistics-only blocker handling → FR-10.

- **UJ-3. Spencer closes the day, or Yoh notices he didn't.**
  - **Persona + context:** Spencer, evening, day's Plan has run its course.
  - **Entry state:** Morning Plan exists; day is over or nearly over.
  - **Path:** Yoh prompts a Night Ritual close-out → if unacknowledged, one retry via email (capped at two total attempts) → if still unacknowledged, Yoh stops chasing, flags the day as unchecked, and rolls any mandatory Blockers into tomorrow morning's Plan instead of continuing to escalate. Either the day closes cleanly (done/slipped Tasks recorded, feeding Derived Priority and memory) or Yoh visibly backs off after the cap instead of nagging indefinitely — tomorrow's Morning Ritual starts from an honest state either way, nothing silently lost, nothing endlessly chased.
  - **Edge case:** Every night this cap is hit in a row without resolution is itself a signal — repeated unchecked nights should be visible to Spencer, not just silently repeating (see FR-14, Open Questions §11).
  - *Capability → FR:* Night Ritual close-out → FR-12; capped escalating retry → FR-13; unchecked-day handling → FR-14.

*Phase 2 journeys (UJ-4–UJ-6) are drawn from the three usage contexts named in the Phase 2 brainstorm.*

- **UJ-4. Spencer moves his study block, and Yoh rearranges the rest of the afternoon.**
  - **Persona + context:** Spencer, at home in the morning, looking at Home; the day has a 2pm study block he wants at 4pm.
  - **Entry state:** Today's Plan exists on the Yoh-owned calendar, with Routine Blocks (commute, dinner) and fixed non-Yoh events.
  - **Path:** Spencer drags the study block to 4pm → the calendar animates a Reshuffle Preview: the later Tasks slide into the freed time, dinner shifts 15 minutes, one small Task moves to tomorrow, and the preview says so → Spencer clicks Approve once → Google Calendar updates. Later he drags just one Task (a Chem problem set) to 7pm; it becomes a Pin for today and everything else reflows around it.
  - **Edge case:** One Task has no Estimated Duration — it isn't placed, and a needs-data In-App Notification links him to /sandbox instead of the whole reshuffle refusing to run.
  - *Capability → FR:* block drag → FR-30; task Pin → FR-31; preview + one-click Approve → FR-32; reshuffle rules → FR-33; needs-data → FR-34; Routines → FR-35.

- **UJ-5. Spencer fills in missing data in two minutes in class.**
  - **Persona + context:** Spencer, in class with a couple of minutes free, laptop open.
  - **Entry state:** Several Tasks are missing a Due Date or Estimated Duration; Yoh has flagged them with a needs-data In-App Notification.
  - **Path:** Open laptop → click the Yoh icon (splash fades straight into Home) → type a new Task into the ~~chat bubble~~ **Ask Yoh pill** *(amended 2026-09-27)* → type `/sandbox` → Yoh walks the flagged Tasks one card at a time; the counter drops with each card and a small ping confirms it; he skips one he's unsure about → the finale loading bar runs and, once Notion confirms every write, a completion In-App Notification appears. He fires off `/research when is the AP Bio registration deadline` before closing the laptop; the answer arrives later as an In-App Notification that jumps to the doc ~~on Tasks~~ *(amended 2026-09-27: on Research Hub)*.
  - **Edge case:** A Notion write fails — the completion In-App Notification names the failed Task instead of claiming the session succeeded.
  - *Capability → FR:* capture flow → FR-39; launch splash → FR-45; /sandbox → FR-36–FR-38; /research → FR-51; notifications → FR-49.

- **UJ-6. Spencer reflects on the day at his desk.**
  - **Persona + context:** Spencer, at his desk after school, a longer session.
  - **Entry state:** Several Tasks were checked off today; the Completion Log has weeks of history.
  - **Path:** Spencer opens Desk → sees the Task Completed list, minutes worked, on-time rate, streak, and the usage heatmap, next to BTC/SOL/ETH tickers, weather, and top business and AI news → runs `/night` in Chat when ready to close out the day.
  - **Edge case:** The news feed is down — that one widget says so; the rest of Desk is unaffected.
  - *Capability → FR:* Desk widgets → FR-44; Completion/Activity Log → FR-47; `/night` → FR-42, FR-12.

## 4. Glossary

- **Task** — A Notion Tasks DB item. Nine fields exist (Task name, Area, Chunk Size, Due Date, Energy, Estimated Duration, Linked Project, Priority, Status); Yoh's planning reads only Estimated Duration, Area, Due Date, Status, and Energy.
- **Project** — A Notion Projects DB item. Organizational grouping only — not a planning input.
- **Research Vault** — A Notion store for on-demand research output. Output-only; not a planning input. A first slice — live web search plus filing a result on request (§5.8) — is in scope as of Phase 1.5, brought forward from its original Phase 5 placement.
- **Live Write Registry** — The fixed, named set of write and search actions Yoh may perform — from Chat, or (from Phase 2) from Web App controls such as a checkbox or Approve. As of Phase 1.5: create Task (existing), create Page (FR-26), edit Calendar time-block (FR-27), search the web (FR-28, read-only — writes nothing), file a search result to Research Vault (FR-29). Phase 2 adds: mark Task complete (FR-41, Status-only), apply a Reshuffle Preview to Yoh-owned blocks (FR-32), and queue a /research question that searches and files (FR-51). Yoh is never given raw Notion/Calendar API or token access to route from freeform chat text — only these named actions.
- **Chat** — Yoh's interactive conversation surface, as distinct from the non-interactive Morning/Night Ritual runs. Through Phase 1.5 this was the CLI's terminal session; from Phase 2 it is ~~the Web App's Chat page (FR-42)~~ *(amended 2026-09-27, Spencer: the Web App's Chat panel, FR-42 — there is no Chat page)*, and the CLI is retired (FR-50). FR-24–FR-29 gate on a request arriving through Chat, whichever surface hosts it.
- **Web App** — Yoh's Phase 2 interface: five pages, in order — ~~Home, Chat, Tasks, Desk~~ *(amended 2026-09-27: Home, Tasks, Desk, Research Hub; §5.11)* *(amended 2026-09-29, Spencer: Home, Tasks, Desk, Research Hub, Memory; §5.11, FR-59)* — plus a Screensaver and the Chat panel available over every page. The only interactive surface once the CLI is retired.
- **Slash Command** — A `/`-prefixed command typed in Chat (`/morning`, `/plan`, `/night`, `/sandbox`, `/research`, `/remember`, `/forget`; FR-42). Typing `/` opens the **Command Palette**, a filterable list of every command with a description and example.
- **Reshuffle Preview** — The animated proposed day Yoh shows after a drag (FR-32). Nothing is written until Spencer clicks Approve.
- **Pin** — A Task Spencer has dragged to a specific time; fixed there for today only. Changes placement, never Derived Priority (FR-31).
- **Routine** / **Routine Block** — Recurring life-context time (commute, meals) that Spencer declares once; Yoh stores it and places it daily as a movable Yoh-owned block (FR-35).
- **Required Field** / **Refining Field** — The two tiers of planning fields (FR-4). Required: Due Date, Estimated Duration — without them a Task can't be placed. Refining: Area, Energy — they only break ties.
- **Completion Log** — Yoh's own durable record of completed Tasks and daily usage, independent of Notion (FR-47).
- **In-App Notification** — A Web App notification that appears on whatever page Spencer is on and can deep-link to a page or document (FR-49). Distinct from the Morning Ritual's push notification.
- **Plan** — The ordered set of Plan Blocks Yoh generates for a single day.
- **Plan Block** — A single scheduled unit within a Plan: either a Task fitted into a work/break slot, or a fixed Calendar event the Plan is built around.
- **Morning Ritual** — The daily process that generates the Plan and sends it as one notification, then disengages.
- **Night Ritual** — The daily process that closes out the Plan: records what was done/slipped, escalates if unacknowledged (capped), and rolls unresolved mandatory Blockers into tomorrow.
- **Derived Priority** — Task ordering computed automatically from size/difficulty and proximity to Due Date — never manually set by Spencer.
- **Slip-Bump** — A small, capped priority increase applied to a Task that slipped, larger (but still capped) if it slips on consecutive days.
- **Data-Completeness Gate** — The check that prompts Spencer to fill required-but-missing Task fields before planning around that Task, rather than defaulting or letting it rot unplanned. From Phase 2 it distinguishes Required from Refining Fields (FR-4).
- **Time Budget** — Spencer's self-declared available hours for a given day; persists day-to-day (including weekends) until explicitly changed.
- **Work/Break Block** — A clock-based scheduling unit, default 70 minutes work / 15 minutes break, that a Task is fitted into (a Task may span multiple blocks).
- **Mid-Day Re-Flow** — A user-initiated, real-time adjustment of the remaining day's Plan. Never triggered by Yoh proactively.
- **Blocker** — A logistical obstacle to a Plan Block. Yoh reschedules around Blockers; it does not attempt to resolve or problem-solve them.
- **Escalate-Under-Strain** — The shared pattern governing Night Ritual retries, Slip-Bump magnitude, Tone escalation, and Rating frequency (FR-60; it replaced Self-Check frequency): each intensifies only in proportion to how much it's being ignored or slipping, never on a flat schedule.
- **Propose-Don't-Impose** — The trust boundary requiring explicit Spencer confirmation before Yoh acts on a learned pattern, a Time Budget change it suggests, or a Blocker resolution.
- **Self-Check** — *(Superseded by Rating, FR-60, 2026-09-29.)* A periodic (~every 4 days, randomized time) prompt asking Spencer to score how well Yoh is working, with a short written reason; frequency increases immediately after any single low score, not only after a trend.
- **Hot Memory** — Yoh's fast-access memory of recent days, patterns, and preferences. *(Amended 2026-09-29: this is Yoh's own planning history, not Memory, which is what Spencer tells Yoh; §5.14.)*
- **Cold Memory** — Yoh's full history, queried on demand and distilled into pattern-statements over time, rather than kept hot. *(Amended 2026-09-29: distinct from Memory, §5.14, as with Hot Memory.)*
- **Memory** / **Memory Item** — What Yoh remembers about Spencer from chat (§5.14). Each item is one fact in one Memory Folder, marked stated or inferred, dated, and optionally set to expire.
- **Memory Folder** — One of eight fixed folders (FR-53). Always loaded: Feedback, Planning preferences, Corrections, About you, Patterns. Loaded when relevant: Goals & projects, Decisions & commitments. Loaded only when asked: Ideas & notes.
- **Conversation** — One continuous chat thread in the Chat panel, from its first turn until Spencer starts a new one. The unit of "delete one conversation" (FR-52).
- **Chat History** — The stored transcripts of all Conversations (FR-52). Not Memory: deleting it does not delete Memory Items.
- **Stated / Inferred** — A Memory Item is stated when Spencer said it outright (including via "remember that …"), and inferred when Yoh concluded it from context. Editing an inferred item makes it stated (FR-59).
- **Always-loaded** — A Memory Folder whose items go into every model call that answers, captures, or writes Plan reasoning (FR-53, FR-56). Never into routing or classification calls.
- **Superseded** — A Memory Item replaced by a newer one that contradicts it. It stays viewable as history under the current item (FR-54).
- **Needs review** — The Memory page list of expired items, items not loaded because an always-loaded folder is over its cap, always-loaded items not used or confirmed in 120 days, items that conflict with live Notion, Calendar or Plan data, and items awaiting a renew/edit/delete/keep-as-history decision (FR-53, FR-56, FR-59).
- **Ratings log** — The store of Rating scores (FR-60). Never loaded into a model call and never part of Memory.
- **Remembered Receipt** — The one-line "Remembered: …" chat line, with Undo, shown whenever Yoh files a Memory Item (FR-54).
- **Rating** — The occasional "How is Yoh doing?" 1–3 prompt that replaces the Self-Check (FR-60). Scores go to a ratings log, never into Memory.
- **Tone** — Yoh's default communication register (casual, peer-level), which shifts to concise/educational for factual questions and escalates in urgency only via Slip-Bump — never randomly or via manual Voice Packs.
- **Voice Pack** — An optional, manually-selected character voice (Phase 5). Fully decoupled from Tone escalation.
- **Canvas** — Spencer's school Canvas LMS (Instructure), the source of school assignment due dates. Read-only; not a planning input Yoh reads directly — see Canvas Sync. Blocked on school API access approval as of this PRD's last update.
- **Canvas Sync** — The planned (currently blocked) process that reads assignment due dates from Canvas and creates/updates corresponding Notion Task records, so Canvas assignments flow through Yoh's existing Notion Tasks pipeline (Data-Completeness Gate, Derived Priority, etc.) unchanged rather than becoming a second Task-input path Yoh reads directly.

## 5. Features

### 5.1 Morning Ritual — Plan Generation

**Description:** Once per day, Yoh reads the current Task set and today's fixed Calendar events, applies the Data-Completeness Gate, computes Derived Priority, fits everything into the declared Time Budget as Work/Break Blocks, and sends Spencer a single notification containing the Plan with a one-line reason for its ordering. Realizes UJ-1.

**Functional Requirements:**

#### FR-1: Generate and deliver the Morning Plan

The system generates one ordered Plan per day from current Tasks (Estimated Duration, Area, Due Date, Status, Energy) and today's fixed Calendar events, and delivers it as a single notification.

**Consequences (testable):**
- Exactly one Plan-generation notification is sent per day under normal operation.
- The Plan includes every eligible Task that passed the Data-Completeness Gate (FR-4) and fits within the declared Time Budget (FR-8).
- Fixed Calendar events are treated as immovable anchors the Plan is built around, not as Plan Blocks Yoh can reschedule.

#### FR-2: Derived Priority ordering

The system orders Tasks in the Plan by an automatically computed priority. The primary ordering axis is Due Date proximity adjusted by Estimated Duration — urgency scaled by how much time the Task actually needs — and it dominates the ranking. A weighted score across the remaining factors (Area, Energy fit, difficulty) breaks ties and refines ordering beneath that primary axis. Never set by manual Spencer input.

**Consequences (testable):**
- No UI or interaction path exists for Spencer to manually set a Task's Derived Priority; only the inputs that feed it (e.g., Estimated Duration, Due Date) can be edited. A Pin (FR-31, Phase 2) fixes a Task's *time* for today only and never changes its Derived Priority.
- Two Tasks with identical Estimated Duration and Area but different Due Dates are ordered with the closer Due Date first, all else equal.
- A Task with a closer Due Date but a much larger Estimated Duration is not automatically ranked behind a smaller, later-due Task — proximity is weighted by duration, not proximity alone.

**Implementation note:** Exact numeric weights for the secondary scoring factors are an implementation decision, not specified here — see `addendum.md`.

#### FR-3: Plan reasoning line

Every generated Plan includes a one-line, human-readable reason for what leads it.

**Consequences (testable):**
- The reasoning line references the actual Derived Priority factors that produced the ordering (e.g., "due soonest," "biggest chunk"), not a generic or static string.

#### FR-4: Data-Completeness Gate

Before including a Task in a Plan, the system checks its planning fields and prompts Spencer to fill any that are missing rather than defaulting them or silently omitting the Task. As of Phase 2 the fields fall into two tiers, so missing data degrades the Plan gracefully instead of blocking it:

- **Required Fields — Due Date, Estimated Duration.** Derived Priority's primary axis (FR-2). A Task missing either is not placed; Spencer is notified that it needs data (FR-34).
- **Refining Fields — Area, Energy.** They only break ties. A Task missing one is planned anyway with a neutral value on that factor — one that neither favors nor penalizes it — and is visibly marked as incomplete.

Status is read to decide which Tasks are eligible at all; it is not a gate field. `[ASSUMPTION: a Task with empty Status is treated as not-started/eligible rather than gated — confirm]`

**Consequences (testable):**
- A Task missing a Required Field never appears in a Plan with a defaulted/assumed value for that field.
- A Task missing any field never silently disappears from planning consideration — Spencer is prompted or notified at least once.
- A Task missing only Refining Fields is placed, and the Plan (or Reshuffle Preview) visibly marks it; the neutral value is never written to Notion.

**Notes:** Projects (organizational grouping only) and Research Vault (output-only) are explicitly excluded as planning inputs — confirmed in the brief, not open for reinterpretation without revisiting the brief. Spencer's answer to a missing-field prompt is also written back to Notion, not just stored locally — see FR-24. /sandbox (§5.10) is the Phase 2 fast path for filling Required Fields. *Changed 2026-09-24:* through Phase 1.5 all five fields (Estimated Duration, Area, Due Date, Status, Energy) were gating; the two-tier split replaces that so one missing Energy value no longer keeps a Task off the Plan.

---

### 5.2 Time Budget & Work/Break Rhythm

**Description:** Spencer declares how much time he has available each day; Yoh fits Plan Blocks into that budget using a clock-based work/break rhythm, defaulting to 70/15. Realizes UJ-1.

**Functional Requirements:**

#### FR-5: Time Budget declaration and persistence

Spencer can declare or change his Time Budget for a given day via voice or chat; the declared value persists day-to-day, including weekends, until explicitly changed again.

**Consequences (testable):**
- No day silently reverts to a default Time Budget different from the last one Spencer set, including across a weekend boundary.
- Yoh may suggest raising the Time Budget but never applies a suggested change without explicit confirmation (Propose-Don't-Impose, FR-16).

#### FR-6: Work/Break Block fitting

The system fits Tasks into clock-based Work/Break Blocks, default 70 minutes work / 15 minutes break, splitting a Task across blocks if needed.

**Consequences (testable):**
- Block boundaries are strictly clock-based (elapsed time), not task-completion-based — a Task in progress at the 70-minute mark is split, not extended.
- The default 70/15 ratio is overridable by Spencer.

#### FR-7: Break count scales with Time Budget

The number of Work/Break Blocks (and therefore breaks) in a Plan scales with the declared Time Budget for that day.

**Consequences (testable):**
- A day with a larger declared Time Budget produces proportionally more Work/Break Blocks than a shorter day, using the same 70/15 (or overridden) ratio.

#### FR-8: Fit Plan within Time Budget

The system fits the day's Plan Blocks (Tasks in Derived Priority order, around fixed Calendar events) within the declared Time Budget, deferring anything that doesn't fit.

**Consequences (testable):**
- A Task that cannot fit in the remaining Time Budget for the day is not force-fit; it remains eligible for the next day's Plan (subject to Slip-Bump, FR-11, if it had already been committed to today's Plan and slipped, rather than never having been scheduled at all).

---

### 5.3 Mid-Day Re-Flow & Slip Handling

**Description:** When something in the day changes — a Task runs long, gets skipped, or a logistical Blocker appears — Spencer can trigger a re-flow of the remaining day, and any slipped Task is guaranteed a small, capped priority boost tomorrow. Realizes UJ-2.

**Functional Requirements:**

#### FR-9: User-initiated Mid-Day Re-Flow

Spencer can trigger a real-time re-flow of the remaining day's Plan Blocks; the system never initiates this proactively.

**Consequences (testable):**
- No code path exists where Yoh interrupts Spencer mid-block to ask about progress or suggest a re-flow — the trigger is always Spencer-initiated.
- A Mid-Day Re-Flow only recomputes remaining (not-yet-completed) Plan Blocks for the current day.

#### FR-10: Logistics-only Blocker handling

When Spencer reports a Blocker, the system reschedules affected Plan Blocks around it without attempting to resolve, judge, or problem-solve the Blocker itself.

**Consequences (testable):**
- Yoh's response to a reported Blocker is limited to schedule adjustment (moving/deferring affected Plan Blocks); it does not generate suggestions for resolving the underlying obstacle.

#### FR-11: Slip-Bump

A Task that slips (doesn't complete as planned) receives a priority increase toward the next day's Plan. The bump escalates with each additional consecutive slip — each further slip adds a bigger increment than the last — leveling off at a defined maximum after several consecutive slips, directly mirroring Escalate-Under-Strain.

**Consequences (testable):**
- A Task's Slip-Bump never exceeds a defined maximum regardless of how many consecutive days it has slipped.
- A Task slipping for a third consecutive day receives a larger bump than it did after its first or second slip, up to that maximum.
- A Task that slipped once and then completes the next day has its Slip-Bump cleared (does not persist indefinitely once resolved).

**Implementation note:** Exact numeric increments and the cap value are an implementation decision, not specified here — see `addendum.md`.

---

### 5.4 Night Ritual — Close-Out & Escalation

**Description:** Once the day's Plan has run its course, Yoh prompts Spencer to close it out; if unacknowledged, it escalates once (capped at two total attempts) before backing off and rolling unresolved mandatory Blockers into tomorrow rather than continuing to chase. Realizes UJ-3.

**Functional Requirements:**

#### FR-12: Night Ritual close-out prompt

The system prompts Spencer once per day to close out the day's Plan (confirm what completed, what slipped).

**Consequences (testable):**
- Close-out data (completed/slipped status per Plan Block) feeds Derived Priority (FR-2), Slip-Bump (FR-11), and memory (FR-15) for subsequent days.

#### FR-13: Capped escalating retry

If the close-out prompt is unacknowledged, the system escalates through at most one additional attempt before stopping — two total attempts, never more. The first attempt is a push notification; the second (escalated) attempt is delivered via email, a deliberately different channel from the first rather than a repeat. The Phase 3 home-speaker call-out described in the brief is deferred until that hardware exists — email fills the same "meaningfully more attention-getting, different channel" role for Phase 1.

**Consequences (testable):**
- No third attempt occurs on any given night regardless of continued non-response.
- The second attempt is delivered via a channel (email) distinct from the first (push notification) — not a repeat of the identical notification.

#### FR-14: Unchecked-day handling

If both close-out attempts go unacknowledged, the system stops escalating for that night, marks the day as unchecked, and carries any mandatory Blockers forward into the next Morning Ritual instead of continuing to prompt.

**Consequences (testable):**
- No escalation attempt for that night occurs after the cap (FR-13) is reached, even if Spencer becomes active again later that night.
- An unchecked day is visibly distinguishable (in the Plan or its history) from a day that was actually closed out — it is not silently treated as equivalent to a completed close-out.

---

### 5.5 Memory & Learning

*Amended 2026-09-29 (Spencer): retitled from "Memory, Learning & Self-Check". The Self-Check is retired; the Rating (FR-60) replaces it.*

**Description:** Yoh maintains a fast "hot" memory of recent patterns and a full "cold" history queried on demand, and, *(amended 2026-09-29: the Self-Check is retired)* occasionally asks Spencer for a one-tap Rating of how well it's working (FR-60). Every learned pattern requires confirmation before Yoh acts on it.

**Functional Requirements:**

#### FR-15: Hot/Cold memory model

*Extended 2026-09-29 (Spencer): §5.14 adds what Spencer tells Yoh. That is persistent chat history (FR-52) and eight memory folders (FR-53–FR-59). The hot/cold model below still covers Yoh's own planning history.*

The system maintains a fast-access "hot" memory of recent days, patterns, and preferences, and a "cold" full-history store queried on demand and distilled into pattern-statements over time.

**Consequences (testable):**
- Recent-day context (e.g., yesterday's slip, this week's Time Budget) is available to plan generation without a full-history query.
- Older history remains queryable (not deleted) but does not need to be loaded for routine daily operation.

#### FR-16: Propose-Don't-Impose confirmation gate

Any learned behavioral pattern, suggested Time Budget change, or Blocker-handling decision requires Spencer's explicit confirmation before Yoh acts on it.

**Consequences (testable):**
- No learned pattern silently changes Yoh's behavior (e.g., auto-adjusting a default) without a prior explicit confirmation from Spencer for that specific change.
- *Amended 2026-09-29 (Spencer):* a Feedback or Planning-preferences item that Spencer stated is his explicit instruction and so satisfies this gate (FR-56). A preference Yoh infers is never filed there; it becomes a Pattern proposal (FR-58) that needs his yes.

#### FR-17: Periodic Self-Check

*Superseded 2026-09-29 (Spencer) by FR-60, the "How is Yoh doing?" rating. The four-day prompt is retired. Its low-score rule carries over to FR-60. The text below is kept as history.*

Approximately every 4 days, at a randomized time, the system prompts Spencer for a numeric score and a short written reason evaluating how well Yoh is working. A single low score shortens the interval until the next check-in — Yoh reacts to one bad signal immediately rather than waiting for a pattern to emerge.

**Consequences (testable):**
- A Self-Check score below the defined low threshold shortens the interval before the next prompt, even from a single isolated data point rather than a trend.
- The interval between Self-Check prompts is not fixed at exactly 4 days regardless of score history.
- A Self-Check response without both a number and a written reason is not accepted as complete (matches "requiring a number + short written reason" from the brief).

**Implementation note:** The exact numeric score threshold that counts as "low" is an implementation decision, not specified here — see `addendum.md`.

---

### 5.6 Tone & Communication

**Description:** Yoh communicates in a default casual, peer-level register that shifts for factual questions and escalates in urgency only through the Slip-Bump mechanic — never at random, and never via the (later, manual-only) Voice Packs.

**Functional Requirements:**

#### FR-18: Default and contextual Tone

The system communicates in a casual, peer-level register by default, switching to a concise/educational register for factual or intellectual questions. This is a direct guard against the brainstorm's named failure mode for a rebuilt Yoh: output that reads verbose, generically "AI-ey," and too professional/corporate instead of like a competent peer.

**Consequences (testable):**
- Responses to factual questions avoid the "it's not just X, it's Y" rhetorical framing (explicit brainstorm decision).
- Responses read like a peer's summary, not corporate or assistant-boilerplate phrasing — no unearned enthusiasm, no filler preamble before the actual content.

#### FR-19: Tone escalation tied to Escalate-Under-Strain only

*Amended 2026-09-29 (Spencer): Escalate-Under-Strain no longer covers Self-Check frequency; the Self-Check is retired (FR-60). The Rating's pull-forward after a 1 is the one Rating rule that follows it.*

The system's Tone becomes more urgent/authoritative only as a function of the Slip-Bump mechanic (§5.3) — never on a schedule, at random, or independent of actual slip/strain signals.

**Consequences (testable):**
- Two days with identical slip history produce the same Tone escalation level, regardless of what day of the week or how much time has passed.

**Out of Scope:** Manual Voice Packs (character voices) — Phase 5, tracked in §9.4, not part of this feature's MVP surface. `[NON-GOAL for MVP]`

---

### 5.7 Notion & Calendar Integration

**Description:** Yoh reads Task and Project data from Notion, and reads/writes Plan-related events on Google Calendar without ever modifying a Calendar event it doesn't own. It writes back to Notion in two cases: Task Status on Night Ritual close-out, and a Task's other missing planning fields when Spencer answers the Data-Completeness Gate's prompt via the CLI. Phase 1.5 extends this three ways: a smarter path into the existing Data-Completeness write (FR-25, no new write mechanism), and two further write capabilities routed through the Live Write Registry (§4) rather than raw API access — creating new Notion pages/database items (FR-26), and confirm-gated Calendar time-block editing beyond events Yoh created (FR-27, a narrow exception to FR-22). Capability-level only — see `addendum.md` for the technical mechanism (auth, endpoints, tagging implementation).

**Functional Requirements:**

#### FR-20: Read Notion Tasks and Projects

The system reads current Task records (all planning-relevant fields) and Project groupings from Notion.

**Consequences (testable):**
- A change to a Task's planning-relevant fields in Notion is reflected in the next Plan generation without manual re-sync.

#### FR-21: Read Google Calendar events

The system reads Spencer's Google Calendar events for the current day to treat as fixed Plan anchors.

**Consequences (testable):**
- A fixed Calendar event added or changed before Morning Ritual runs is reflected in that day's Plan.

#### FR-22: Write Plan Blocks to Calendar without touching non-Yoh events

The system writes its own Plan Block events to Google Calendar, and updates or deletes only events it created — never an event it did not create.

**Consequences (testable):**
- No update or delete operation is ever issued against a Calendar event not created by Yoh — an ownership check runs before every write.
- A prior day's Plan Block events remain as passive history unless explicitly cleaned up — they are not silently deleted as a side effect of generating a new Plan.

#### FR-23: Write Task Status back to Notion

On Night Ritual close-out, the system writes each Plan Block's resulting status (completed or slipped) back to the corresponding Task's Status field in Notion, so Notion stays in sync with what Yoh knows happened.

**Consequences (testable):**
- A Task marked completed or slipped during Night Ritual close-out shows that same Status when viewed directly in Notion, without Spencer manually updating it.
- Only the Status field is written by this requirement — no other Task field (Area, Due Date, Estimated Duration, etc.) is modified by Yoh as a side effect of close-out.

**Notes:** Phase 2 adds a second trigger for this same Status-only write: checking a Task off on Home (FR-41). Close-out does not re-ask about a Task already checked off.

#### FR-24: Write missing planning fields back to Notion via Chat

When Spencer answers the Data-Completeness Gate's (FR-4) prompt in Chat (the CLI through Phase 1.5; the Web App, including /sandbox, from Phase 2) for a Task's missing Estimated Duration, Area, Due Date, Energy, or Status, the answer is written to that Task's corresponding property in Notion, not just stored locally.

**Consequences (testable):**
- A Task's field answered via a Data-Completeness prompt in Chat shows that same value when viewed directly in Notion, without Spencer manually updating it.
- This write path is reachable only through an interactive answer flow in Chat (including /sandbox, FR-38) — never from an automated Morning Ritual, Night Ritual, or Self-Check run, which stay one-shot and non-interactive.
- For any select-backed Notion property (Area if modeled as a select, Energy, Status), the written value is always one of that property's real, currently-existing Notion options — a close-but-imperfect answer is matched to the nearest real option rather than written as raw text or used to create a new option. If no existing option is a close enough match, the write fails and Spencer is re-prompted rather than Yoh guessing.
- Free-typed fields (Due Date, Estimated Duration) keep their existing strict validation (ISO date, positive integer) before any write is attempted.

**Notes:** This is a distinct capability from FR-23 — a different trigger (an explicit answer to a direct question, not a Night Ritual outcome) writing a different field set. FR-23's own scope (Status-only, close-out-triggered) is unchanged by this requirement.

#### FR-25: Propose inferred values for the Data-Completeness Gate

When the Data-Completeness Gate (FR-4) would otherwise ask Spencer to fill a Task's missing field, and Yoh can infer a likely value from the current chat context (e.g. Spencer just mentioned the task's scope or deadline in conversation), the system proposes that value instead of asking blind — Spencer confirms or corrects it rather than typing an answer from scratch.

**Consequences (testable):**
- A proposed value is never written without Spencer's explicit confirmation — this is a Propose-Don't-Impose (FR-16) instance, not an auto-fill.
- Once confirmed, the value is written back to Notion via FR-24's existing write path — no new write mechanism, only a new way of arriving at the answer.
- When Yoh has no confident inference for a field, the Gate falls back to today's plain ask (FR-4 unchanged) — this requirement only ever adds an option, never removes the baseline path.

**Notes:** This is the "reuse over invention" instance the Phase 1.5 brainstorm named directly — no new gate, no new write path, just a smarter way of answering the one that already exists.

#### FR-26: Create Notion pages and database items via chat

When Spencer asks Yoh, in chat, to create a new item in Tasks, Projects, or Research Vault — the same three Notion databases already named elsewhere in this PRD (§4) — the system drafts the item, shows the draft, and creates it only on Spencer's explicit confirmation. No other Notion database is a valid target, regardless of what the integration token can technically reach.

**Consequences (testable):**
- Every created item's properties are validated against the target database's real schema before the write is attempted — a select-backed property is written only as one of its real, currently-existing options (fuzzy-matched, same guard as FR-24), and a property that can't resolve fails and re-prompts rather than guessing or inventing a new option.
- No item is created without an explicit chat confirmation of the shown draft — there is no auto-create path.
- A successful creation is echoed back in chat as a one-line receipt naming the item and its database.

**Notes:** This is the Notion side of the Phase 1.5 Live Write Registry (§4) — schema validation is what keeps a created item visible to Yoh's existing planning pipeline (FR-1, FR-20) instead of becoming an orphaned page the Data-Completeness Gate and Derived Priority never see.

#### FR-27: Confirm-gated Calendar time-block editing beyond Yoh-owned events

When Spencer asks Yoh, in chat, to move, resize, or create a time block on his real Google Calendar — including an event Yoh did not create — the system shows what would change and edits the Calendar only on an explicit confirmation naming that specific event.

**Consequences (testable):**
- This is the sole exception to FR-22's ownership check: editing a non-Yoh event requires an explicit per-action confirmation naming that event. FR-22's own unconfirmed, automatic writes remain scoped to Yoh-owned events only — this requirement does not loosen FR-22 itself.
- Deleting an event Yoh did not create is never performed by this requirement, confirmed or not — only move, resize, and create actions are in scope for Phase 1.5 (see §8 Non-Goals).
- A successful edit is echoed back in chat as a one-line receipt naming the event and the change made.

**Notes:** Scoping this to move/resize/create (never delete) is a deliberate Phase 1.5 restraint, not an oversight — deleting a record Spencer didn't ask Yoh to manage carries asymmetric downside for a single confirmation prompt to fully protect against.

### 5.8 Web Search (Research Vault, Phase 1.5 slice)

**Description:** A first slice of the Research Vault (§4) roadmap item, brought forward from Phase 5 to Phase 1.5: Yoh can perform a live web search when Spencer asks a question in chat that needs external or current information, and can file a useful result into the Research Vault Notion database on request. FR-28 and FR-29 are deliberately kept as two small, composable steps rather than one combined FR — "research X and file the results" is one chat exchange chaining them (search, answer, "save that," file), but each also stands alone: a lookup that's answered and forgotten never touches Notion, and nothing is filed without having first been searched and shown. Capability-level only — see `addendum.md` for the technical mechanism (search provider, API cost).

**Functional Requirements:**

#### FR-28: Web search lookup via chat

When Spencer asks a factual or research question in chat, or explicitly asks Yoh to search, the system performs a live web search and returns a synthesized answer with source citations — writing nothing to Notion or Calendar as a side effect.

**Consequences (testable):**
- Search is triggered only by an explicit ask (e.g. "look up X," "search for X") or an unambiguous factual question with a clear external answer (e.g. "when is X's deadline," "what's the current price of X") — never run automatically on every chat turn (ties to the Cost guardrail, §7). Implementation note: the exact classification boundary for "unambiguous factual question" is deferred to `addendum.md` § Deferred Implementation Parameters, the same treatment FR-2/FR-11/FR-17 give their own deferred specifics — an ordinary planning or status message (e.g. "I finished the report") must never trigger a search call.
- Every search-derived answer includes at least one citation or link Spencer can verify.
- A search failure (no results, provider error) is surfaced honestly in chat — never presented as a confident answer.

#### FR-29: File a search result to the Research Vault on request

When Spencer asks Yoh to save or file a search result (e.g. "save that"), the system creates a new page in the Research Vault Notion database containing the result, tagged with its source and the date of the search.

**Consequences (testable):**
- Nothing is written to the Research Vault as a side effect of FR-28 alone — filing is always a separate, explicit request.
- The created page is source-tagged and dated, so a later reader can tell it came from a Yoh-run search rather than Spencer's own notes.
- The Research Vault otherwise remains output-only, not a planning input (§5.1 Notes, §4) — this requirement does not change that.

---

**Phase 2 — Web App (§5.9–§5.13).** Everything below retires the CLI and moves Yoh onto the Web App (§4). Sections are ordered by Spencer's stated priority: Drag-to-Reshuffle first, /sandbox second, pages and design system third, then the groundwork the first three depend on. Drag-to-Reshuffle and /sandbox are one system — /sandbox is the input that makes the reshuffle smart, and the reshuffle degrades gracefully (FR-4) when that input is missing.

### 5.9 Drag-to-Reshuffle (Phase 2, priority 1)

**Description:** On Home (§5.11), Spencer drags a Yoh-owned block to a new time in one move. Yoh recomputes the rest of the day around that move and shows the result as an animated Reshuffle Preview on the calendar; one Approve click applies it, one Discard click leaves the Calendar untouched. This is Propose-Don't-Impose (FR-16) rendered as direct manipulation — the web equivalent of the CLI's confirm gates. It is also a new trigger for Mid-Day Re-Flow (FR-9): still always Spencer-initiated, now by drag instead of by typed request. Realizes UJ-4.

**Functional Requirements:**

#### FR-30: Drag a work block to a new time

Spencer can drag a Yoh-owned Work/Break Block (with every Task inside it) to a new start time on today's calendar in a single drag gesture, and Yoh produces a Reshuffle Preview (FR-32) for the rest of the day.

**Consequences (testable):**
- One drag-and-release is the entire input — no follow-up dialog, form, or typed instruction is required before the Reshuffle Preview appears.
- Only Yoh-owned blocks are draggable. Calendar events Yoh did not create render as fixed anchors and cannot be picked up (see FR-33).
- A Task split across several Work/Break Blocks (FR-6) moves as a whole: dragging any one of its segments pins or moves the entire Task, and the reshuffle re-splits it around the new time. `[ASSUMPTION: whole-Task drag, not per-segment]`
- Only not-yet-completed blocks on today's day view are draggable; completed blocks and past days are read-only in this interaction. `[ASSUMPTION: today-only scope, matching Home's single-day calendar view]`

#### FR-31: Drag an individual Task (Pin)

Spencer can drag a single Task out of its block to a specific time. The dragged Task becomes a Pin — fixed at that time for today only — and Yoh produces a Reshuffle Preview (FR-32) that places everything else around it.

**Consequences (testable):**
- A Pin changes placement only, never priority: the pinned Task's Derived Priority (FR-2) is unchanged, and every unpinned Task keeps its Derived Priority order in the reshuffled day.
- A Pin expires at the end of the day. It does not carry into tomorrow's Plan, and it does not feed Slip-Bump (FR-11), memory (FR-15), or any learned pattern (FR-16).
- A Pin can be removed by dragging the Task back into the flow (or an equivalent unpin gesture), which produces a fresh Reshuffle Preview. `[ASSUMPTION: unpin interaction shape left to bmad-ux]`

**Notes:** Pin-as-priority-feedback (Yoh noticing that Spencer keeps pulling a certain kind of Task earlier) is deliberately out of scope — it belongs with self-calibration (Phase 6, §9.4) and would require its own Propose-Don't-Impose gate.

#### FR-32: Animated Reshuffle Preview with one-click Approve

Every drag (FR-30, FR-31) produces a Reshuffle Preview: the proposed new day, animated from the current layout to the proposed one on the calendar, with a single Approve and a single Discard control. Nothing is written to Google Calendar until Approve.

**Consequences (testable):**
- No Calendar write occurs between drag-release and Approve. Discard (or navigating away) leaves Google Calendar exactly as it was before the drag.
- One Approve click applies the whole Reshuffle Preview — every moved block in it — with no per-block confirmation. This is sufficient because every block a reshuffle can move is Yoh-owned (FR-33); FR-27's per-event naming rule never triggers here.
- The preview visibly distinguishes moved blocks from unchanged ones, and names anything the reshuffle pushed out of today (deferred per FR-8).
- If the Calendar changed between preview and Approve (e.g. a new event appeared), Approve does not apply a stale preview — Yoh recomputes and shows a fresh preview instead.
- A successful apply is acknowledged in-page (the calendar settles into the new layout); a failed or partial apply is surfaced honestly via an In-App Notification (FR-49), never shown as success.

#### FR-33: Reshuffle scope and rules

A reshuffle recomputes only the remaining, not-yet-completed, Yoh-owned blocks of today — Task blocks and Routine Blocks (FR-35) — around fixed anchors, using the same planning rules as the Morning Plan.

**Consequences (testable):**
- A reshuffle never moves, resizes, or deletes a Calendar event Yoh did not create. Those events are fixed anchors, exactly as in FR-1. (Editing a non-Yoh event remains possible only through FR-27's Chat path.)
- The reshuffled day respects the Time Budget (FR-8), the Work/Break rhythm (FR-6, FR-7), Derived Priority order for unpinned Tasks (FR-2), every active Pin (FR-31), and Routine Blocks (FR-35).
- A Task that no longer fits today is deferred per FR-8, not force-fit, and the preview says so.
- Routine Blocks are movable by the reshuffle (they are Yoh-owned), but the reshuffle never deletes one to make room. `[ASSUMPTION: routines can shift but not disappear during a reshuffle]`

#### FR-34: Needs-data notification for unplaceable Tasks

When a Morning Plan (FR-1) or a reshuffle (FR-33) would include a Task that is missing a Required Field (FR-4), the Task is not placed on the calendar; instead Yoh raises an In-App Notification (FR-49) saying which Tasks need data, deep-linking into /sandbox (§5.10).

**Consequences (testable):**
- A Task missing a Required Field never appears on the calendar with a guessed Due Date or Estimated Duration.
- The same Task never disappears without a visible needs-data In-App Notification — FR-4's "never silently omitted" guarantee holds on the web surface.
- The reshuffle still runs for every other Task. A missing field on one Task never blocks planning the rest of the day.

#### FR-35: Routines (life-context blocks)

Spencer can declare recurring life-context time — commute, meals — once, and Yoh stores each as a Routine and places it into every applicable day's Plan as a Yoh-owned Routine Block, so the Plan never ignores transition time (e.g. homework scheduled the minute school ends).

**Consequences (testable):**
- Routines are stored by Yoh, not as Google Calendar recurring events. Each day's Routine Blocks are ordinary Yoh-owned events (FR-22), so §9.4's recurring-events exclusion stays intact.
- Routine Blocks count against the day and are planned around like fixed time, but they are draggable (FR-30) and movable by a reshuffle (FR-33).
- Spencer can add, change, or remove a Routine from Chat. `[ASSUMPTION: declaring routines via chat; a /sandbox step is a bmad-ux option]`
- Not every minute is blocked — only declared Routines become blocks.

---

### 5.10 /sandbox — Guided Data Entry (Phase 2, priority 2)

**Description:** A slash command in Chat that walks Spencer through Tasks missing data, one at a time, so the Morning Plan and Drag-to-Reshuffle have what they need. It is the fast path through the Data-Completeness Gate (FR-4), built to feel quick and rewarding rather than like a form. Realizes UJ-5.

**Functional Requirements:**

#### FR-36: /sandbox walks Tasks missing Required Fields

Typing `/sandbox` in Chat starts a guided session that presents Tasks missing a Required Field (Due Date or Estimated Duration), one card at a time, down the line.

**Consequences (testable):**
- The card shows the Task's name and its Required Fields (Due Date, Estimated Duration). A card cannot be completed with a Required Field left empty.
- Refining Fields (Area, Energy) and any other Task field are available on the card as optional additions — never required to advance.
- Tasks are presented in a stable order that surfaces the highest-impact gaps first (e.g. soonest-due). `[ASSUMPTION: ordering rule; exact order is a bmad-ux/architecture call]`
- A Task with no missing Required Field is not presented, even if Refining Fields are empty. `[ASSUMPTION: Refining-only gaps don't enter the /sandbox queue; revisit if Spencer wants a "fill optional too" mode]`

#### FR-37: Skip, live counter, and per-card reward

During a /sandbox session Spencer can skip any card, sees a live count of Tasks still missing Required Fields, and gets a small reward cue after each completed card.

**Consequences (testable):**
- Skipping a card writes nothing for that Task and moves to the next; a skipped Task remains in the count and is eligible for the next /sandbox session.
- The counter decrements when a card is completed and updates without a page reload.
- Each completed card triggers a short confirmation cue (a ping sound or haptic, where the device supports it). The cue is never shown for a skipped card.

#### FR-38: /sandbox write-back and proof-of-action finale

Each completed card's values are written back to Notion through FR-24's write path. When the session ends, a loading-bar finale plays while writes finish, and a completion In-App Notification (FR-49) appears only once every Notion write has actually succeeded.

**Consequences (testable):**
- /sandbox writes are direct-write tier (§6): filling in a card is Spencer's explicit answer, so no second confirmation is required — the same shape as FR-24.
- Select-backed fields obey FR-24's existing guard (real options only, fuzzy-matched, never invented); a value that can't resolve re-prompts on that card rather than being written.
- The completion In-App Notification is the proof-of-action: it never appears before the writes succeed. If any write fails, the notification names which Tasks failed instead of claiming completion.
- The finale animation never adds a required click to finish the session.

---

### 5.11 Pages and App Shell (Phase 2, priority 3)

**Description:** The Web App has ~~four~~ **five** *(amended 2026-09-29, Spencer)* pages, each with one job, in order — Home answers *what, in what order, and when*; Tasks is for finding things; Desk is for reflecting at the end of the day; Research Hub holds saved research; Memory shows what Yoh remembers (FR-59) — plus a launch/idle Screensaver. **There is no Chat page** *(amended 2026-09-27, Spencer)*: Chat is a panel available on every page, opened from a small "Ask Yoh" pill fixed bottom-center (or ⌘K), covering the content area right of the sidebar while the page behind stays dimmed. Commands are slash commands, not buttons, to keep every page uncluttered. Three usage contexts drive every choice: a home-morning start, a 30-second-to-two-minute classroom capture, and a longer desk session after school. Realizes UJ-4, UJ-5, UJ-6.

**Functional Requirements:**

#### FR-39: Three-action capture flow

From a closed laptop, Spencer can capture a Task in at most three actions: open laptop → click the Yoh app icon → type the Task in the ~~chat bubble~~ **Ask Yoh pill** *(amended 2026-09-27)* and press Enter.

**Consequences (testable):**
- The app icon opens the Web App directly on Home (or the launch splash that fades into Home, FR-45) with no login, picker, or intermediate screen under normal operation. `[ASSUMPTION: session persists across launches; auth mechanics are architecture's call]`
- No Phase 2 feature — including the Screensaver — may add a required click to this flow. This is a regression gate on every future page change.
- Every page is reachable from every other page in one gesture or click. **Swipe navigation retired 2026-09-27 (Spencer):** pages sit in a vertical stack, moved between with smooth up/down arrow buttons, the ↑/↓ keys (and Page Up/Page Down) when no text field has focus, an edge-aware mouse wheel, and a left nav sidebar that jumps directly to any page (five pages as of 2026-09-29, with Memory after Research Hub, FR-59). No swipe gesture is a requirement anywhere in this document; every prior swipe reference is superseded by this line.

#### FR-40: Home page

Home shows today's ordered Plan as a checklist on the left, today's Google Calendar day view on the right, and ~~a small chat bubble at the bottom~~ **the Ask Yoh pill fixed bottom-center** *(amended 2026-09-27)*.

**Consequences (testable):**
- The Plan list is ordered exactly as the Plan orders it (FR-2) and reflects any approved reshuffle (FR-32) without a reload.
- The calendar is where Drag-to-Reshuffle (§5.9) happens; non-Yoh events are visible but visibly fixed.
- ~~The chat bubble starts small and expands wide on hover or focus;~~ *(amended 2026-09-27: the Ask Yoh pill is a fixed-size pill — compact, raised, never covering content, not an expand-on-hover bubble)* pressing Enter opens the Chat panel (Chat is a panel, not a page — see §5.11) with that message as the first turn of the conversation.
- *Amended 2026-09-27 (Spencer):* Home also always shows today's Time Budget (the declared budget, how much of it the Plan uses, and time done so far), editable in place, plus a mini month alongside the Google-Calendar-style day view.

#### FR-41: Check off a Task

Checking a Task on Home marks it completed: the row fades out, the Task's Status is written to Notion as completed, and a record is written to the Completion Log (FR-47).

**Consequences (testable):**
- Checking a Task does not delete it from Notion — it writes the same Status-only change FR-23 already writes at Night Ritual close-out, from a new trigger. No other Task field is modified.
- The Completion Log entry is written even though Notion keeps the Task, so Desk's metrics (FR-44) never depend on reading Notion history.
- The Night Ritual (FR-12) treats a Task already checked off during the day as completed and does not ask about it again.
- An accidental check can be undone for a short window before it's final. `[ASSUMPTION: undo window; length and form are a bmad-ux call]`

#### FR-42: Chat panel and slash commands

*Amended 2026-09-27 (Spencer):* Chat is not a page — it is a panel available over every page (§5.11), opened from the "Ask Yoh" pill or ⌘K. Everywhere below that says "Chat" names that panel, not a page.

Chat is a dedicated conversation with Yoh that replaces the CLI as the Chat surface (§4). It supports ~~five~~ seven *(amended 2026-09-29, Spencer)* slash commands — `/morning` (Morning Ritual), `/plan` (build today's Plan on demand — added 2026-09-27; `/morning` never generates one, FR-1 stands), `/night` (Night Ritual), `/sandbox` (§5.10), `/research` (FR-51), `/remember` and `/forget` (FR-55; the plain-word forms still work) — and typing `/` opens a filterable Command Palette.

**Consequences (testable):**
- The Command Palette lists every available slash command with a one-line description and an example, filters as Spencer types, and is the app-wide way to discover and run commands. No separate help page is required for command discovery.
- While Yoh is working, the page shows a loading indicator and status text naming what it's doing; responses stream in as they generate rather than appearing all at once.
- Every capability the CLI offered through Chat — Time Budget changes (FR-5), Mid-Day Re-Flow (FR-9), Blocker reports (FR-10), answering open interaction requests and Proposals (FR-16, FR-25), FR-24–FR-29, and Self-Check responses (FR-17; from Epic 13, FR-60 ratings) — is reachable from Chat before the CLI is retired.
- Yoh never claims or offers a capability it doesn't have, and it closes out a conversation when it naturally ends rather than prompting for more. *Amended 2026-09-29 (Spencer): the one exception is the Rating prompt (FR-60), which may follow a substantive turn.*
- `/morning` opens today's Morning Ritual in Chat: the Plan, its reasoning line (FR-3), and any pending questions or Proposals. It never sends a second push notification (FR-1's one-per-day holds) and never regenerates the Plan on its own — regenerating remains a Mid-Day Re-Flow (FR-9).
- `/night` runs the Night Ritual close-out (FR-12) interactively in Chat. A close-out completed this way before the scheduled prompt counts as that night's close-out: the scheduled prompt and its escalation (FR-13) are cancelled for that night, and the day is never marked unchecked (FR-14).
- The left vertical menu bar ships empty as a placeholder ~~(its contents are out of scope, §9.4)~~. *Amended 2026-09-27 (Spencer):* it is the left nav sidebar (§5.11) — Yoh wordmark, then Home/Tasks/Desk/Research Hub, then the theme toggle. No longer a placeholder. *Amended 2026-09-29 (Spencer): the sidebar list is Home/Tasks/Desk/Research Hub/Memory, then the theme toggle.*

#### FR-43: Tasks page

Tasks shows the full Notion Tasks database, organized by Area and by field, with a quick-add row and Notion-speed inline editing.

**Consequences (testable):**
- Every Task in the Notion Tasks database is findable from Tasks, grouped by Area, with the ability to organize by other fields. `[ASSUMPTION: exact grouping/sort controls are a bmad-ux call]`
- A Task Spencer types himself on the Tasks page is a **direct write** (the same tier as FR-24), not a Yoh-drafted Proposal — amends AD-3/AD-12. Yoh-drafted items (from Chat, FR-26) still go through Proposal/confirm.

*Amended 2026-09-27 (Spencer):* Tasks is pulled forward from Epic 11 into the 2026-09-27 fixes + UI plan and delivered early. The single research box described here through 2026-09-24 moves to its own **Research Hub** page (§5.11's fourth page): recent Research Vault items (title, date, source count) linking to their Notion page, plus an "ask a research question" box that sends the question into the Chat panel. A research-ready In-App Notification (FR-49, FR-51) deep-links straight to the new document there. The asynchronous `/research` job queue and the research offer stay Epic 11; only the page shell ships now.

#### FR-44: Desk dashboard

Desk visualizes everything Yoh knows about Spencer's work for the after-school desk session, as a set of widgets:

- **From Yoh's own data (Completion Log, FR-47):** Task Completed list (scrollable; Task name with a checked, struck-through checkbox); total minutes worked (sum of Estimated Duration across completed Tasks); on-time completion rate; streak of consecutive days using Yoh; total hours worked with Yoh; Yoh usage-frequency heatmap (GitHub-style, week columns × 7 days); *(added 2026-09-27, Spencer)* a "Claude API spend this month" tile, computed locally from per-call usage records × one price table (Task 9's usage store) — no Admin API key needed.
- **From public feeds (§7):** crypto tickers for Bitcoin, Ethereum, and Solana; weather for Seattle, WA *(location confirmed 2026-09-27, Spencer — resolves Open Question 11)*; a news hub of the biggest business stories, with an AI emphasis *(confirmed 2026-09-27, Spencer)*.

**Consequences (testable):**
- Every Yoh-data widget reads from the Completion Log / Activity Log (FR-47), never from Notion history — the numbers stay correct regardless of what happens to the Task in Notion afterward.
- On-time completion rate counts a completed Task as on-time when its completion time is on or before its Due Date. `[ASSUMPTION: definition not specified in the brainstorm]`
- Each public-feed widget fails independently: an unreachable or rate-limited feed shows "unavailable" or its last value with a timestamp, and never breaks or blanks the rest of Desk.
- No Task or Calendar data is sent to any public-feed provider (§7).

#### FR-45: Screensaver

The Web App shows an animated Screensaver — a field of gradient dots with varying transparency moving fluidly, with the "Yoh Meeseek" wordmark centered — briefly as a launch splash and again after a period of inactivity.

**Consequences (testable):**
- The launch splash fades into Home automatically with no click (FR-39).
- The idle Screensaver dismisses on any input and returns Spencer to the page he was on, with any unsent chat text intact.
- The Screensaver is decorative only; it never shows data or notifications.

---

### 5.12 Design System (Phase 2, priority 3)

**Description:** The Web App should feel high-tech but minimalistic, and every capability should show at its highest level — the brainstorm's bar is that the effort invested pays off as miles better than any other AI product Spencer uses, not merely "a nicer CLI." One visual language across all four pages: ~~off-white and black~~ *(amended 2026-09-27, Spencer: a brighter cool-white base, `#EEF2F8` family, no warm off-white)*, soft neumorphic surfaces *(strengthened 2026-09-27: white highlight top-left, `#a3b1c6`-family shadow bottom-right)*, more Sky→Azure blue gradient use *(2026-09-27: the earlier two-moment gradient limit is lifted)*, a bigger scale *(2026-09-27)*, a bold Montserrat "Yoh Meeseek" wordmark, and motion that shows what Yoh is doing (thinking, streaming, reshuffling) rather than decorating. The anti-clutter strategy is structural: one job per page (§5.11) and slash commands instead of buttons. Specific libraries and the animation set live in `addendum.md` § Phase 2 — Technical Notes; the full visual spec is bmad-ux's.

**Functional Requirements:**

#### FR-46: Consistent design system

Every page uses one shared set of design tokens (color, surface/shadow, type, motion) implementing the direction above.

**Consequences (testable):**
- Color is ~~off-white and black~~ *(amended 2026-09-27: cool white `#EEF2F8` family and black)*; surfaces use neumorphic (soft extruded/inset) shadows, strengthened 2026-09-27; the wordmark is "Yoh Meeseek" in bold Montserrat.
- Motion accompanies state: task check-off (fade/dissolve), reshuffle (animated preview), Yoh thinking (loader + status text), streaming responses, page transitions. No page ships with a static loading state where one of these applies.
- Contrast meets the Accessibility NFR (§6) — neumorphism's low-contrast default does not ship unchecked.
- No page adds a persistent action button for something a slash command already does.

---

### 5.13 Groundwork (Phase 2, required by §5.9–§5.12)

**Description:** Three capabilities the priority features cannot work without, specified as requirements rather than left implicit. Each is also groundwork for later phases (self-calibration, iOS, hardware).

**Functional Requirements:**

#### FR-47: Yoh-owned Completion and Activity Log

Yoh keeps its own durable record of every completed Task and every day Spencer used Yoh, independent of Notion.

**Consequences (testable):**
- Every completion (FR-41 check-off or Night Ritual close-out, FR-12) records at least: Task identity and name, Area, Due Date, Estimated Duration, and completion time.
- Every day Spencer interacts with the Web App is recorded, enough to compute the streak, the usage heatmap, and hours worked with Yoh (FR-44). `[ASSUMPTION: "hours worked with Yoh" definition — see §11]`
- Log entries survive any later change to or deletion of the Task in Notion.
- The log keeps both Estimated Duration and completion time per Task, so a future self-calibration phase (Phase 6) can compare estimates with reality without a data migration.

#### FR-48: Surface-agnostic confirmation

Any confirm-then-write capability (§6) can be confirmed from any Yoh interactive surface — a Web App control such as Approve counts as an explicit confirmation exactly as a typed "yes" did in the CLI.

**Consequences (testable):**
- The Reshuffle Preview's Approve (FR-32) and Chat confirmations for FR-16, FR-25, FR-26, and FR-27 all go through the same confirmation rules: a proposal is applied only after an explicit confirmation, and a stale proposal is rejected rather than applied.
- No write path accepts a confirmation from a non-interactive run (Morning/Night Ritual jobs) — that boundary is unchanged from Phase 1.
- A proposal left open when the CLI is retired is still visible and resolvable in the Web App.

**Notes:** The architecture spine currently names the CLI chat entry point as the only place a proposal may be applied (AD-3, AD-5). This FR is the product requirement that retires that single-surface rule; how it's generalized is bmad-architecture's call.

#### FR-49: In-app notifications

The Web App has one reusable In-App Notification capability: a notification appears on whatever page Spencer is on and can deep-link to the relevant page or document.

**Consequences (testable):**
- Phase 2 consumers: research ready (FR-51), /sandbox complete or failed (FR-38), needs data (FR-34), reshuffle apply failed (FR-32), and Yoh operational problems (Observability NFR, §6).
- Clicking a notification takes Spencer to its target (e.g. the new research document ~~on Tasks~~ *(amended 2026-09-27: on Research Hub)*, or /sandbox) in one click.
- Notifications fire only as the result of something Spencer started (a command, a drag, a planning run) or a system failure — never as a proactive mid-block check-in (FR-9, §8).
- In-App Notifications do not replace the Night Ritual's push/email escalation (FR-13), which is unchanged. ~~or the Morning Ritual's single push notification (FR-1)~~ *Amended 2026-09-27 (Spencer): the Morning Plan now arrives in the app only — no Pushover push for it (FR-1 stands; only its delivery channel changes here). Pushover is kept for FR-13's escalation and for AD-7 failure/operational alerts.*

#### FR-50: Retire the CLI

Once the Web App covers every Chat capability (FR-42), the CLI is retired as an interactive surface; the Web App is the only place Spencer talks to Yoh.

**Consequences (testable):**
- The Morning and Night Rituals keep running unattended on schedule; retiring the interactive CLI does not stop them.
- No capability that existed in the CLI is lost in the move — FR-42's parity list is the checklist.
- After retirement, open interaction requests and Proposals created by Rituals surface in the Web App (FR-48) instead of waiting for a CLI session.

#### FR-51: /research — asynchronous research questions

Typing `/research <question>` in Chat queues a research question; Yoh searches, files the result to the Research Vault, and raises a research-ready In-App Notification when it's done — so Spencer can fire off a question in class and read the answer later.

**Consequences (testable):**
- The `/research` command is itself the explicit save request, so filing is direct-write tier (§6) — the same boundary as FR-29, reached by a command instead of "save that."
- Spencer can leave the page or close Chat after sending; the result still arrives.
- The filed page follows FR-29's provenance rule (source-tagged, dated) and FR-28's citation and honest-failure rules. A failed search raises an In-App Notification saying so, not a research-ready one.
- `/research` never runs without the command; FR-28's no-automatic-search boundary is unchanged.

### 5.14 Memory — "Yoh remembers you" (Epic 13)

*Added 2026-09-29 (Spencer). Supersedes the client-memory-only chat transcript (UX OQ 13), extends FR-15, and replaces FR-17.*

**Description:** Yoh keeps a persistent, visible memory of Spencer, much as Claude's memory works. It holds his goals, the context around his projects, how he likes to plan, what Yoh got wrong, and what he liked or disliked about Yoh itself. Memory has two jobs: Yoh gets to know Spencer without being told twice, and Yoh corrects its own behavior over time from what Spencer tells it. Every memory is one short item in one of eight folders. Spencer can see, edit, and delete every item, and nothing is remembered silently.

**Out of scope here:** embeddings or vector search (§9.4), memory shared with any other person or service, and memory changing a hard planning rule without confirmation (FR-57).

#### FR-52: Persistent chat history

Chat transcripts are stored on Spencer's host and survive a reload, a new session, and a switch of device. They are kept indefinitely, until Spencer deletes them.

**Consequences (testable):**
- Reloading the Web App, or opening it on another device, shows the same conversation history.
- Spencer can delete one Conversation or clear all history. Deleting one Conversation is a direct write. Clearing all history asks for a confirmation step first, because it cannot be undone.
- Deleting history does not delete memories filed from it (FR-54). Those have their own delete (FR-59). An item whose source Conversation was deleted stays and shows "source deleted" in place of the link.
- History is searchable from the Memory page (FR-59).
- Chat stays one-shot per turn: Yoh reads recent history for context, but a stored transcript never re-runs an action or re-applies a Proposal.
- If the chat store is unavailable, Chat still answers, the Memory page shows an error state for history, and nothing is shown as saved.

#### FR-53: Memory folders and memory items

Memories live in eight fixed folders. Each item holds one fact.

| Folder | Holds | Loaded |
|---|---|---|
| **Feedback** | What Spencer liked or disliked about Yoh's behavior, and changes he asked for, with the reason and when it applies. Stated items only | Always |
| **Planning preferences** | How Spencer likes his day planned: block length, buffers, how packed a day is, when to nudge. Stated items only. A preference that maps to a real scheduler setting becomes a rule-change Proposal (FR-57); a soft preference affects only AI-written text (FR-56) | Always |
| **Corrections** | Facts Yoh got wrong, and the fix ("that's a club, not a class") | Always |
| **About you** | Routines, energy, people and their roles | Always |
| **Patterns** | Confirmed patterns Yoh noticed in Spencer's check-off history (FR-58) | Always |
| **Goals & projects** | Goals with target dates, and project context Notion doesn't hold (why, what done looks like, current state) | When relevant |
| **Decisions & commitments** | Decisions and their reasons; commitments with dates | When relevant |
| **Ideas & notes** | Things to come back to | Only when asked |

**Consequences (testable):**
- Every memory item records its folder, its text, whether Spencer **stated** it or Yoh **inferred** it, when it was created and last changed, the chat turn it came from (if any), and an optional expiry date. Every Feedback item also stores its scope: which situations it applies to. When Spencer's words don't say, Yoh files the narrowest reading (P2).
- Feedback and Planning preferences only ever hold items Spencer stated. A preference Yoh infers (for example, that he seems to dislike long answers) is never filed there; it becomes a Pattern proposal under FR-58 and needs his yes. Inferred items in other folders (About you, Goals & projects, and so on) are recallable facts and never change Yoh's behavior.
- Time-bound items (this semester's schedule, an exam, a project deadline) carry an expiry. Yoh sets the expiry at filing and shows it in the receipt; Spencer can change or clear it (FR-59). An expired item is no longer loaded, and the Memory page lists it under Needs review (FR-59) rather than deleting it. The review actions are renew, edit, delete, or keep as history.
- "When relevant" means the item's text keyword-matches the request. "Only when asked" (Ideas & notes) means an explicit "what do you remember about …" or a Memory page query. Architecture picks the matching method.
- Nothing already held in Notion, Google Calendar, or Yoh's own stores (Tasks, events, Plans, Routines, the Time Budget, the Completion Log) is duplicated into memory. Memory holds context about those records, not the records themselves.

#### FR-54: Automatic filing with a visible receipt

After each chat turn, Yoh checks whether the turn contained something worth remembering. If it did, Yoh files it and shows a one-line "Remembered: …" receipt with Undo in the chat.

**Filing bar and source:** Yoh files only facts that would still be true next week, and at most 2 items per turn. Memory is filed only from Spencer's own typed words, never from search results, Research Vault pages, Notion content, or model output.

**Consequences (testable):**
- Filing runs after the reply finishes. It never delays or blocks the reply, and the receipt appears when filing is done.
- The receipt is a single line. Several filings from one turn share that one line, and it shows each Feedback item's scope.
- A turn with nothing worth keeping files nothing and shows no receipt; this includes trivial turns. `[ASSUMPTION: the filter for trivial turns is an architecture decision]`
- Undo removes the item completely, and the receipt then says so. If the item superseded or updated an earlier one, Undo restores the prior item or version. Undo is available until Spencer's next message.
- The duplicate check compares a new item against the whole always-loaded set, not only keyword matches.
- A new item that restates an existing one updates that item instead of creating a duplicate. A new item that contradicts an existing one supersedes it: the newer one is current, and the older one stays viewable as history on the Memory page.
- Yoh never files anything it has inferred about Spencer's health, emotions, or finances. It files these only when Spencer states them outright, and they are marked stated. The ban also applies to answers given to the FR-60 "What was off?" follow-up.
- Filing is a Yoh-owned local write at the direct-write tier (§6). It never touches Notion or Calendar.
- If filing fails, or the Memory store or search is unavailable, the chat reply is not affected, and no success receipt is shown.

#### FR-55: Memory commands in chat

Spencer can manage memory in plain words. Yoh recognizes these deterministically, never through an LLM routing guess:
- "remember that …", "remember: …", and `/remember` file the item immediately as stated. "remember to …" and "remind me to …" are not memory commands: they create Tasks exactly as they do today.
- "forget …" or "forget that" deletes the matching item, or the last one filed. Forgetting an item deletes its history (superseded versions) too.
- "what do you remember about …" lists matching items with their folder.

**Consequences (testable):**
- "remember that …", "remember: …", and `/remember` always file, even when auto-filing would have skipped the turn.
- "forget …" that matches more than one item asks which one, and deletes nothing until Spencer answers. "forget …" that matches nothing says so and deletes nothing.
- `/remember` and `/forget` are slash-command forms of the same commands and appear in the Command Palette (FR-42). The plain-word forms keep working.
- A memory command shows the same receipt shape as FR-54.

#### FR-56: Recall in answers and planning

Yoh uses memory whenever it answers, captures, or explains a Plan. The deterministic scheduler never reads memory text.

**Consequences (testable):**
- Every model call that answers Spencer, captures, or writes Plan reasoning includes the always-loaded folders (FR-53), subject to the cap below. Items from the when-relevant folders are included only when they match the request. Memory never goes into routing or classification calls.
- Planning preferences affect only AI-written parts: the Plan reasoning line, answers, and chat moves. A preference that maps to a real scheduler setting goes through FR-57.
- Live Notion, Calendar and Plan data always win over memory. When they conflict with a memory item, that item goes to Needs review.
- No memory item can weaken or skip a confirmation step. Proposals still need an explicit yes.
- An always-loaded item not used or confirmed in 120 days goes to Needs review. It is a list on the Memory page, not a notification.
- The always-loaded set has a fixed size cap. Past the cap, the newest items are loaded and the oldest spill to Needs review: they are not loaded and never deleted. The Memory page marks which items are not loaded, so nothing is dropped silently. `[ASSUMPTION: the cap value is set in architecture]`
- Yoh uses a memory only when it changes the answer. It never brings up an old personal detail unprompted just to show that it remembers. Checkable proxy: no memory content appears in a reply unless the item was among the request's matched or always-loaded items.
- A Feedback item changes Yoh's behavior from the next turn onward, with no confirmation step. Spencer stating it is the instruction. Conflicts with built-in rules are handled by FR-57.
- Trade-off: with no confirmation, a misheard Feedback item shifts behavior until Spencer notices. The mitigation is the Remembered Receipt with Undo (FR-54) and edit or delete on the Memory page (FR-59). Inferred items never reach Feedback (FR-53).
- If the Memory store is unavailable, Yoh still answers and plans without it, and shows nothing as remembered.

#### FR-57: Memory never silently overrides a built-in rule

A Feedback or Planning-preferences item can conflict with a built-in planning rule. The built-in rules are: work-start times, protected windows (Lunch, Community time), the Time Budget, and Derived Priority weights. In that case Yoh raises a Proposal to change the rule. The item alone does not change it.

**Consequences (testable):**
- "Start work at 2:30 on school days" files the preference and raises a Proposal, e.g. "Change school-day work start from 3:15 PM to 2:30 PM? Yes/No". Only a yes changes planning, and it applies through the normal confirm path (FR-16, FR-48).
- A preference whose Proposal is pending does not affect planning.
- A confirmed change becomes a stored setting that Spencer can see and revert on the Memory page (FR-59).
- A declined Proposal leaves the rule unchanged and does not affect planning. The preference stays filed, marked declined, and is not proposed again unless Spencer raises it again.
- Split: a preference that maps to a real scheduler setting (block length, buffers, work start, and so on) becomes a Yes/No proposal to change that setting, as above. A soft preference ("I like hard tasks first") is not a rule change and affects only AI-written parts under FR-56.
- Preferences that don't conflict with a built-in rule (tone, wording, how much detail Yoh gives) take effect directly under FR-56.

#### FR-58: Patterns are proposed, never assumed

Yoh looks for patterns in the Completion Log (FR-47) and slip history, for example Tasks of one Area that routinely run over their Estimated Duration. It proposes each pattern once. Only a yes files it to Patterns.

**Consequences (testable):**
- A pattern Yoh infers about how Spencer likes to be served (for example, that he seems to dislike long answers) is proposed here as a Pattern, never filed to Feedback or Planning preferences (FR-53).
- Each Pattern proposal shows its evidence, for example "5 times since Sep 3: …".
- A pattern needs repeated evidence before it is proposed: several occurrences over at least two weeks, never a single day. `[ASSUMPTION: thresholds set in architecture]`
- Proposals follow FR-16 (Propose-Don't-Impose): "Yoh noticed History essays run about 30 minutes over. Plan for that? Yes/No." A no files nothing, and the same pattern is not proposed again for at least 30 days. `[ASSUMPTION: 30-day quiet period]`
- A confirmed pattern that changes planning (a duration padding, for example) is shown in the Plan's reasoning line (FR-3) whenever it affects a placement.

#### FR-59: Memory page

The Web App gains a fifth page, Memory, after Research Hub (§5.11 lists all five). It shows the eight folders, a search box, and chat history.

**Consequences (testable):**
- Every item can be viewed, edited, moved between folders, and deleted. Edits, moves, and deletes are direct writes with a visible result (§6). Deleting an item deletes its history too.
- Editing an inferred item makes it stated. An edit that duplicates another item offers to merge the two. Spencer can change or clear an item's expiry.
- One search covers memories and chat history. It matches by keyword, and each result shows its folder or conversation date.
- Each item shows stated or inferred, its dates, and a link to the chat turn it came from (or "source deleted" when that Conversation was deleted, FR-52).
- Superseded items appear as history under the current item. Expired items, and items not loaded because an always-loaded folder is over its cap (FR-56), appear in a "Needs review" list, as do always-loaded items unused or unconfirmed for 120 days and items that conflict with live data (FR-56), with the actions renew, edit, delete, or keep as history. Items not loaded are marked as such.
- Confirmed rule changes (FR-57) are listed as settings with a revert action.
- If the Memory store or search is unavailable, the page shows an error state and never shows unsaved changes as saved.
- The page follows the design system (FR-46), the page order in §5.11, and the Accessibility NFR (§6).

#### FR-60: "How is Yoh doing?" rating (replaces FR-17)

Occasionally, right after a substantive turn, Yoh asks "How is Yoh doing?" with three choices: 1 (poor), 2 (okay), and 3 (good). A substantive turn is a plan change, a re-fit, a researched answer, or a Morning or Night Ritual.

**Consequences (testable):**
- At most one prompt per calendar day (in `YOH_TIMEZONE`), at a randomized turn, with one exception for a 1 (see below). It never appears mid-block unprompted (FR-9). Spencer can dismiss it with no effect; a dismissal counts toward the day's one prompt. After 3 dismissals in a row, prompts pause for a week.
- The Rating appears only in the app, never in a push notification and not on the Morning Ritual.
- Scores go to a ratings log, never into memory. The log feeds trends (§10) and is not loaded into any model call.
- A 2 or a 3 stores nothing beyond the score. A 1 asks one optional follow-up, "What was off?". Spencer's answer is filed to Feedback under FR-54's rules (dedupe, supersede, and the sensitive-inference ban). It is Spencer's own words, so it is stated.
- A 1 brings the next prompt forward: it may come on the next substantive turn, even the same day, instead of waiting for the daily random slot. At most one such extra prompt per day. This carries FR-17's rule that a single low score shortens the interval (Escalate-Under-Strain, §4).
- FR-17's four-day Self-Check prompt is retired. Its "number + written reason" requirement is replaced by this rule: a score alone is complete, and a reason is asked for only after a 1. This prompt is the one exception to FR-42's "closes out … rather than prompting for more".

## 6. Cross-Cutting NFRs

- **Reliability.** The Morning and Night Rituals must run daily without manual intervention. A failure to run — a crash, an expired auth token, an unreachable API — must be surfaced to Spencer, not fail silently. There is no support team and no other user to notice; if Yoh goes quiet, Spencer is the only signal, so the system must not rely on him noticing an *absence*.
- **Data integrity.** Writes to Calendar or Notion must never corrupt or lose Task/Calendar data. This is a harder guarantee than most personal tools need, because the data being written into is Spencer's real calendar and real task list, not a sandbox. Every write capability sits at exactly one of three tiers, chosen per capability and never defaulted: **automatic**, Ritual-triggered and scoped to Yoh-owned records only (FR-22, FR-23); **direct-write**, where Spencer's own explicit instruction is validated and written immediately with no separate draft-and-confirm step — the instruction itself is the confirmation (FR-24, an explicit answer to a direct question; FR-29, an explicit "save that" request); or **confirm-then-write**, where Yoh proposes or drafts something and nothing is written until Spencer explicitly confirms it (FR-25, FR-26, FR-27). FR-28's search is read-only and writes nothing at any tier. The guarantee that Yoh never touches a record it doesn't own has exactly one explicit exception, FR-27: the boundary moves from "never" to "never without naming the event and being told yes," trading ownership for an explicit per-action confirmation. FR-24 and FR-26 both widen the Notion write surface beyond Status; both satisfy this guarantee the way FR-24 established it — a select-backed or schema-bound property is only ever written as one of its real, currently-existing options (fuzzy-matched, never invented), and a write that can't confidently resolve fails and re-prompts instead of guessing. All Phase 1.5 write capabilities (FR-26–FR-29; FR-25 reuses FR-24's existing write path rather than adding a new one) route through the fixed, named Live Write Registry (§4) — Yoh is never given raw Notion/Calendar API access to route from freeform chat text. Every write triggered from Chat (FR-24–FR-29) is echoed back to Spencer as a one-line receipt in that same chat, so nothing changes silently mid-conversation. Ritual-triggered writes (FR-22, FR-23) run outside any chat session and keep their own existing channel — the Ritual's notification (Observability, below); this NFR does not add a new chat-receipt requirement to those already-shipped Phase 1 paths.
- **Data integrity — Phase 2 writes.** Phase 2's new writes each sit at one of the three existing tiers: checking a Task off (FR-41) is **direct-write** — the check is the instruction, and it writes Status only; /sandbox answers (FR-38) and `/research` filing (FR-51) are **direct-write**, the same shape as FR-24 and FR-29; applying a Reshuffle Preview (FR-32) is **confirm-then-write**, with Approve as the confirmation, and it only ever touches Yoh-owned events. No Phase 2 capability deletes anything from Notion. On the Web App, the chat-receipt requirement above is met in-page: a write triggered in Chat is acknowledged in Chat; a write triggered elsewhere (check-off, Approve, /sandbox finale) is acknowledged by its visible result or an In-App Notification (FR-49), and a failed write is always surfaced — never shown as success.
- **Data integrity — Memory (Epic 13).** Filing a Memory Item (FR-54), a memory command (FR-55), and edits or deletes on the Memory page (FR-59) are **direct-write** to Yoh-owned local records only. None of them touches Notion or Calendar, and each shows a receipt or a visible result. Confirming a Pattern (FR-58), and a preference that changes a built-in planning rule (FR-57), are **confirm-then-write**. Chat history and memory are never lost to a reload or a restart, and they are included in Yoh's backups. Backups retain deleted items until they rotate out.
- **Latency.** Plan generation must complete comfortably before the Morning Ritual notification is due — no hard SLA, but "fast enough to not feel broken" (low seconds, not minutes) is a real requirement, since a slow or hung Morning Ritual is functionally the same failure as one that doesn't run at all. Phase 2 adds interactive targets, since the Web App is judged by feel: the Reshuffle Preview begins animating within about 2 seconds of drag-release, a check-off fades immediately (the Notion write can finish in the background), and Chat shows a thinking state within a fraction of a second of sending. `[ASSUMPTION: numeric targets are starting points for bmad-ux/architecture to confirm]`
- **Accessibility.** The off-white/black neumorphic style must still meet WCAG 2.2 AA `[ASSUMPTION: standard chosen at drafting]` contrast for text and for the boundaries of interactive controls (checkboxes, Approve/Discard, chat input). Soft-shadow surfaces alone may not be the only cue that something is clickable or checked. Motion respects the OS reduced-motion setting: animations shorten or become simple fades, and no information is conveyed by motion alone. The contrast check itself happens in bmad-ux.
- **Capture speed.** The three-action capture flow (FR-39) is a standing requirement, not a launch-day target: any change that adds a required step to it is a regression.
- **Observability.** Because there's no one else to catch a silent failure, Yoh must be able to tell Spencer when something has gone wrong with its own operation (auth expired, an integration is unreachable, a scheduled ritual didn't fire) rather than simply going dark. This directly counters the OAuth "Testing mode" 7-day silent-expiry trap named in the brief's Known Risks. From Phase 2, operational problems also surface as an In-App Notification (FR-49) when Spencer has the Web App open, in addition to the existing channels.

## 7. Constraints and Guardrails

- **Privacy.** All Task and Calendar data is personal and single-user. No data leaves Spencer's own Notion workspace and Google account except as required by the Notion and Calendar integrations themselves (§5.7). No third-party analytics, telemetry, or data sharing. **Phase 2 exception — public feeds:** Desk's crypto tickers (Bitcoin, Solana, Ethereum), weather, and business/AI news (FR-44) call public data providers. Only the query itself leaves Yoh (ticker symbols, a location for weather, news categories); no Task, Calendar, or usage data is ever sent. The Web App's own assets and data stay on Spencer's host — no third-party analytics script ships in it. **Memory (Epic 13):** chat history, Memory Items, and ratings are stored only on Spencer's host. Memory text is sent only to the LLM provider inside Yoh's own model calls (answers, capture, filing, Plan builds). It is never sent to the web-search provider or included in any search query, and is never sent anywhere else.
- **Cost.** Yoh must run on infrastructure Spencer already owns — laptop, Raspberry Pi, or existing cloud/server setup. No new recurring paid service was required for Phase 1. Web search (FR-28, §5.8) introduces the first ongoing external API cost, brought forward from its original Phase 5 placement — single-user, on-demand search volume; provider choice and pricing tier are implementation detail (`addendum.md`), not a PRD requirement. Memory filing (Epic 13) costs at most one Haiku call per non-trivial chat turn. Phase 2's public feeds (§7 Privacy exception) must run on **free tiers only** — no new paid feed subscription; a feed whose free tier disappears is dropped or replaced, not upgraded. The Web App is hosted on infrastructure Spencer already owns. `[ASSUMPTION: hosting shape — local, Pi, or existing server — is architecture's call; it must be reachable from the laptop in class]`
- **Safety.** Not a meaningful concern for Phase 1–2's software-only surface. Becomes relevant once Phase 3 introduces physical hardware (speaker placement/volume near water, an always-on device) — deferred to that phase's own scoping, not applicable now.

## 8. Non-Goals (Explicit)

- Yoh is not, and will never become, a multi-user product — no account system, sharing, or multi-tenant data model at any phase; assume single-user, single-workspace, single-calendar for the life of the product.
- Yoh will not silently default or drop Tasks with missing required fields — the Data-Completeness Gate (FR-4) is a permanent design stance, not an MVP shortcut.
- Yoh will not proactively interrupt Spencer mid-block to check progress; all mid-day interaction is Spencer-initiated (FR-9).
- Yoh will not act on a learned pattern or suggested change without explicit confirmation (FR-16) — this is a permanent trust boundary, not a v1 limitation to relax later.
- Yoh will not attempt to resolve, judge, or problem-solve reported Blockers — only reschedule around them (FR-10).
- Yoh will not auto-switch character Voice Packs based on Tone or escalation state, at any phase — Voice Packs (Phase 5) are manual-only by permanent design, not a temporary MVP restriction.
- Yoh will never delete a Calendar event it did not create, confirmed or not — FR-27's confirm-gated exception covers move/resize/create only; deletion of non-Yoh events is permanently out of scope, not a Phase 1.5 gap to close later.
- Yoh will never run a web search automatically on every chat turn, and will never write a search result to the Research Vault without an explicit save request (FR-28, FR-29) — a permanent trust boundary, consistent with Propose-Don't-Impose (FR-16).
- Yoh is never given raw Notion or Calendar API/token access to route from freeform natural language, at any phase — every write goes through the fixed, named Live Write Registry (§4).
- Drag-to-Reshuffle will never move, resize, or delete a Calendar event Yoh did not create (FR-33); non-Yoh events are always fixed anchors in a reshuffle.
- Dragging or pinning a Task will never change its Derived Priority (FR-2, FR-31) — manual placement is today-only and does not become a priority input.
- In-App Notifications will never be used to check in on progress mid-block or nudge Spencer unprompted (FR-49, FR-9).
- Memory will never silently change a built-in planning rule (FR-57), and Yoh will never act on a pattern it noticed without Spencer's yes (FR-58).
- Yoh will never store an inference about Spencer's health, emotions, or finances (FR-54). Every Memory Item is visible and deletable. There is no hidden memory.

## 9. MVP Scope

### 9.1 In Scope (Phase 1 — hard deadline September 2, 2026) — shipped, all 5 epics done

- Morning Ritual: Plan generation, single notification, Data-Completeness Gate, Derived Priority, one-line reasoning (FR-1–FR-4).
- Time Budget declaration/persistence and Work/Break Block fitting (FR-5–FR-8).
- Mid-Day Re-Flow (user-initiated), logistics-only Blocker handling, Slip-Bump (FR-9–FR-11).
- Night Ritual close-out, capped escalating retry, unchecked-day handling (FR-12–FR-14).
- Hot/Cold memory, Propose-Don't-Impose confirmation gate, periodic Self-Check (FR-15–FR-17). *(Amended 2026-09-29: the Self-Check is retired; the Rating, FR-60, replaces it.)*
- Default/contextual Tone with Escalate-Under-Strain-driven escalation (FR-18–FR-19).
- Notion Tasks/Projects read, Task Status write-back, CLI-driven missing-planning-field write-back; Google Calendar read/write with strict Yoh-owned-event isolation (FR-20–FR-24).
- Terminal/CLI interface — the only surface for Phase 1.

### 9.2 In Scope (Phase 1.5 — Live Integrations)

- Proposing inferred values for the Data-Completeness Gate instead of only asking blind (FR-25).
- Notion page/database item creation via chat, schema-validated against the target database (FR-26).
- Confirm-gated Calendar time-block editing beyond Yoh-owned events — move/resize/create only, never delete (FR-27).
- Web search lookup via chat with source citations (FR-28), and filing a result to the Research Vault on explicit request (FR-29).
- FR-26–FR-29 routed through the Live Write Registry (§4); no new interface surface — still terminal/CLI only, same as Phase 1.

### 9.3 In Scope (Phase 2 — Web App)

Ordered by Spencer's priority:

1. **Drag-to-Reshuffle** — drag a Yoh-owned block or pin a single Task; animated Reshuffle Preview; one-click Approve; needs-data In-App Notification; Routines (FR-30–FR-35).
2. **/sandbox** — guided Required-Field entry with skip, live counter, reward cue, and a proof-of-action finale (FR-36–FR-38).
3. **Pages and design system** — three-action capture, Home, Chat with slash commands and Command Palette, Tasks, Desk, Screensaver; shared design tokens (FR-39–FR-46).
4. **Groundwork** — Completion/Activity Log, surface-agnostic confirmation, In-App Notifications, CLI retirement, async `/research` (FR-47–FR-51).
5. **Changes to existing requirements** — FR-2 (Pin doesn't touch priority), FR-4 (Required/Refining tiers), FR-23 (check-off trigger), FR-24 (Chat on any surface); FR-1 and FR-12–FR-14 gain on-demand `/morning` and `/night` entry points (FR-42) without changing their once-per-day and escalation-cap guarantees.

### 9.3a In Scope (Epic 13 — Yoh remembers you, added 2026-09-29)

Persistent chat history, eight Memory Folders with automatic filing, a receipt and Undo, memory commands, recall in answers and planning, rule-change Proposals, confirm-gated Patterns, the Memory page, and the "How is Yoh doing?" Rating (FR-52–FR-60). It replaces FR-17 and extends FR-15 and FR-42.

### 9.4 Out of Scope

- **Physical hardware device** (Pi 5, wake-word/STT/TTS voice pipeline, bedroom/bathroom build) — Phase 3. Architecture direction already researched (see brief `addendum.md`), but no product-level parts (mic/speaker/display) chosen yet. The Phase-1 Night Ritual's second escalation attempt (FR-13) no longer depends on this — it uses email for Phase 1, with the home-speaker call-out remaining a Phase 3 upgrade once the hardware exists, not a blocking dependency.
- **Goals hub** — raised in the Phase 2 brainstorm; deferred to a later phase.
- **Receipts folder** (an inbox of everything Yoh did) — dropped, not deferred. Proof-of-action lives inside each action instead: the /sandbox ping fires only after the real write (FR-38), and a reshuffle is previewed before it's applied (FR-32).
- ~~Chat page left-menu contents — the menu bar ships empty (FR-42); what goes in it is deferred.~~ *Resolved 2026-09-27: there is no Chat page; the left menu is the nav sidebar (§5.11), no longer empty.*
- **Estimated-vs-actual time bar** on completed-Task rows — an unconfirmed idea; the Completion Log (FR-47) keeps the data so it can be added later.
- **Deleting Tasks from Notion on check-off** — considered and rejected for Phase 2; check-off writes Status instead (FR-41).
- **Pin as priority feedback** — learning from where Spencer drags Tasks; belongs with self-calibration (Phase 6).
- **Multi-day drag** — Drag-to-Reshuffle works on today's calendar only (FR-30).
- **iOS app** — Phase 4.
- **Manual Voice Packs** — Phase 5, and permanently decoupled from Tone escalation (§5.6 Out of Scope).
- **Self-calibrating task-duration estimates** — Phase 6; Estimated Duration remains a manually-entered Task field. The Completion Log (FR-47) is the Phase 2 groundwork that makes this possible later.
- **Recurring Calendar events** — not part of MVP, Phase 1.5, or Phase 2 (Routines, FR-35, are Yoh-stored and don't use Google recurrence); several Google Calendar recurring-event gotchas are noted in the brief's addendum but are explicitly out of scope until recurrence is added.
- **Embeddings / vector search for memory** — keyword search covers Spencer's scale (hundreds of items). Revisit if Memory passes about 10,000 items (§11).
- **Room-cleanliness camera** — long-term/aspirational, not committed to any numbered phase.
- **Canvas LMS assignment sync** — reads assignment due dates from Spencer's school Canvas LMS and creates/updates corresponding Notion Task records (course → Area, due date, name) so Canvas assignments flow through the existing Notion Tasks pipeline unchanged; Estimated Duration and Energy still get filled by Spencer via the existing Data-Completeness Gate (FR-4), since Canvas can't supply either. Blocked on the school's Canvas admin approving API access (a Canvas Developer Key); not assigned to a numbered phase yet — revisit once access is granted (§11).

## 10. Success Metrics

**Primary**
- **SM-1**: Plan-follow rate — the declared Time Budget and generated Plan are actually used to structure the day on most days (self-assessed via Self-Check, FR-17; from Epic 13, the Rating trend, FR-60), not abandoned partway through. Validates FR-1, FR-2, FR-8.
- **SM-2**: MVP shipped and in daily use by September 2, 2026. Validates the full Phase-1 scope (§9.1).

**Secondary**
- **SM-3**: Data-Completeness Gate prompts and Slip-Bump adjustments are followed rather than dismissed — a sign the Plan stays realistic enough to trust. Validates FR-4, FR-11.
- **SM-4**: *(Amended 2026-09-29: measured by the Rating trend, FR-60, not the retired Self-Check.)* Rating scores stay stable or trend upward over time, since Escalate-Under-Strain is designed to intensify only when they trend down. Validates FR-60, FR-19.

**Counter-metrics (do not optimize)**
- **SM-C1**: Night Ritual escalation frequency (how often FR-13's second attempt fires) — this is a symptom of the Plan or the day going wrong, not a target to increase or feature-tune toward. Counterbalances SM-1.
- **SM-C2**: *(Amended 2026-09-29: Rating prompt frequency, FR-60.)* Rating prompt frequency — a system that checks in more often because scores are trending low is doing what it's designed to do (Escalate-Under-Strain), not something to be proud of; the frequency itself is not a success signal. Counterbalances SM-4.

**Phase 1.5 (FR-25–FR-29): intentionally unmetered.** No SM extends to Phase 1.5 yet — a decision, not an oversight. These capabilities were added roadmap-driven (§2), not in response to observed Phase 1 usage, so there's no real baseline yet to set a meaningful target against. Whether chat-driven Notion writes, calendar edits, and web search actually get used (vs. sitting unused) is exactly the kind of signal the Rating (FR-60, which replaced the Self-Check) and ordinary usage observation should surface within a few weeks — a Phase 1.5 SM belongs in a near-future PRD update once that evidence exists, not guessed at here.

**Phase 2 (FR-30–FR-51)** `[ASSUMPTION: Phase 2 metrics proposed at drafting — confirm or cut]`
- **SM-5**: The Web App is the only way Spencer uses Yoh — used on most school days, including in-class captures — and the CLI is retired with nothing lost (FR-42 parity list complete). Validates FR-39–FR-42, FR-50.
- **SM-6**: Reshuffle Previews are approved as shown far more often than they are discarded or immediately re-dragged. A discard means Yoh's re-plan was wrong — this is the direct signal of whether the reshuffle is "smart." Validates FR-30–FR-35.
- **SM-7**: The number of Tasks missing a Required Field (the /sandbox counter) stays low week over week rather than accumulating. Validates FR-34, FR-36–FR-38.

**Phase 2 counter-metrics (do not optimize)**
- **SM-C3**: Time spent in the Web App, or Desk visits per day — not a target. The one-job-per-page design aims to get Spencer in and out; more time in the app isn't success. Counterbalances SM-5.
- **SM-C4**: In-App Notification count — not a target. More notifications is noise, not engagement. Counterbalances SM-7.

**Epic 13 (added 2026-09-29)** `[ASSUMPTION: proposed, confirm after a few weeks of use]`
- **SM-8**: Spencer rarely repeats himself. A fact or instruction he has already given does not have to be given again. Measured as the count of restatement-updates per month (FR-54 events where a new item updated an existing one because Spencer restated it); a legitimate refinement counts too, so read the trend, not one month. Validates FR-53–FR-56.
- **SM-9**: Measured as the monthly mean Rating plus the count of repeated Feedback on an already-filed behavior (a Feedback item that supersedes or restates an existing one within 30 days). With at most one Rating per day the monthly n is small, so read trends loosely. Validates FR-56, FR-60.
- **SM-C5**: Memory Item count is not a target. More memories is bloat, not learning. Counterbalances SM-8.
- **SM-C6**: Rating prompt frequency is not a target. A higher frequency after low scores is the design working, not success. Counterbalances SM-9.

## 11. Open Questions

The four questions that blocked Phase 1 in the first draft are resolved below; thirteen non-blocking items remain — seven from Phase 1 and Phase 1.5, and six added with Phase 2.

**Resolved (Phase 1, no longer blocking):**
- ~~FR-13 escalation channel~~ — resolved, see FR-13.
- ~~FR-2 weighting formula~~ — resolved, see FR-2.
- ~~FR-11 Slip-Bump cap/curve~~ — resolved, see FR-11.
- ~~FR-17 Self-Check threshold~~ — resolved, see FR-17.

**Deferred (non-blocking for Phase 1):**
1. **Phase 3 hardware shopping list** (carried from the brief): mic, speaker, and display products for the eventual physical build are unchosen; the bathroom-side mic/input solution is explicitly parked. Owner: Spencer. Revisit: Phase 3 planning kickoff.
2. **Medium-confidence Notion/Calendar technical claims** underpinning FR-20–FR-23 — see `addendum.md` § Technical Dependency Verification for the specific claims and what to check. Owner: Spencer. Revisit: before FR-20–FR-23 implementation starts.
3. **Primary calendar + tagging vs. dedicated secondary calendar**: the technical research found no practitioner consensus on whether Yoh should write Plan Blocks to Spencer's primary Google Calendar (tagged) or a dedicated secondary calendar. Affects FR-22's implementation, not its behavior contract. Owner: Spencer. Revisit: architecture phase.
4. **Personality/voice tuning cadence**: the brainstorm parked how Yoh's personality/voice gets refined iteratively through usage post-launch — not addressed by this PRD's Tone requirements (FR-18–FR-19), which cover only the default/escalation contract. Owner: Spencer. Revisit: post-launch, once real usage data exists.
5. **OAuth production-mode verification** — launch-blocking failure mode, ties to SM-2; see `addendum.md` § Technical Dependency Verification for what it is and why. Owner: Spencer. Revisit: verify before September 2, 2026.
6. **Canvas API access approval** — a Canvas Developer Key (OAuth2 app registration) requires the school's Canvas admin to approve API access before the Canvas Sync (§9.4) can be built at all; also unresolved once approved: course→Area mapping convention and the re-sync/dedup strategy for previously-synced assignments. See `addendum.md` § Canvas API Integration for the research and § "Next step once Canvas API access is granted — BMad path" for the implementation sequence. Owner: Spencer. Revisit: once school approval is granted.
7. **Perplexity API pricing/terms verification** — FR-28/FR-29's search-provider assumption, carried forward from when Research Vault was Phase 5-scoped, hasn't been re-confirmed against current terms. See `addendum.md` § Phase 1.5: Live Integrations — Technical Notes. Owner: Spencer. Revisit: before FR-28/FR-29 implementation starts.

**Phase 2 (non-blocking for drafting; added 2026-09-24):**
8. **Architecture spine is stale for Phase 2** — AD-3/AD-5 name the CLI chat entry point as the only place a Proposal is applied, and AD-12 is titled "CLI-only." FR-48 and FR-50 retire that rule at the product level; the spine is updated by `bmad-architecture`, not this PRD. Separately, `epics.md` describes shipped Epic 1's FR-4 as all-five-fields gating; the Required/Refining split is a behavior change to a done epic and needs a story in the Phase 2 epics. Owner: Spencer. Revisit: `bmad-architecture` run after `bmad-ux`.
9. **Neumorphism contrast check** — the Accessibility NFR (§6) sets the bar; whether off-white + neumorphism clears it (and what changes if it doesn't) is a design task. Owner: Spencer. Revisit: `bmad-ux`.
10. **"Hours worked with Yoh" definition** (FR-44) — distinct from "total minutes worked" (sum of Estimated Duration of completed Tasks), but what it measures (time in the Web App? sum of approved Plan time? completed Work Blocks?) wasn't settled in the brainstorm. Owner: Spencer. Revisit: `bmad-ux`, before Desk is built.
11. **Public-feed providers** — free-tier crypto, weather, and news sources. ~~plus the weather location~~ *(resolved 2026-09-27, Spencer: weather is Seattle, WA; crypto is BTC/ETH/SOL; news is the biggest business stories with an AI emphasis — see FR-44)*; provider selection and terms-check remain open. Owner: Spencer. Revisit: architecture / before FR-44's feed widgets are built.
12. **Hosting and app icon** — how the Web App is hosted on owned infrastructure and launched from an icon in one click (FR-39), including reachability from the school network. Owner: Spencer. Revisit: `bmad-architecture`.
13. **Design details deferred to UX** — Command Palette depth (settled as sufficient for discovery; details to UX), check-off undo window (FR-41), unpin gesture (FR-31), Tasks page grouping controls (FR-43), whether needs-data also shows a tray alongside the In-App Notification (FR-34). Owner: Spencer. Revisit: `bmad-ux`.

**Epic 13 (added 2026-09-29):**
14. **Memory design details** — the always-loaded size cap (FR-56), the trivial-turn filter (FR-54), pattern evidence thresholds (FR-58), the Memory page layout, and where Remembered Receipts sit in the Chat panel. Owner: Spencer. Revisit: `bmad-ux` (page, receipt) and `bmad-architecture` (cap, filter, thresholds, storage).
15. **Embeddings** — not needed at current scale (keyword search). Owner: Spencer. Revisit: if Memory passes about 10,000 items, or keyword search visibly misses.

## 12. Assumptions Index

No Phase 1 or Phase 1.5 assumptions remain in the FR text; Phase 2's inline tags are listed at the end of this section. Three of §11's four newly-resolved Phase 1 questions started as inline `[ASSUMPTION]` tags in the first draft — FR-2's weighting approach, FR-11's cap/growth curve, and FR-13's escalation channel — all now resolved and removed from the FR text. FR-17's threshold was an Open Question only; it never carried an inline tag. One Phase 1.5 assumption exists outside the FR text: the working choice of Perplexity as FR-28/FR-29's search provider carries forward from Research Vault's original Phase 5 scoping without reconfirmation. It's capability-level-irrelevant (§7 deliberately keeps provider choice out of the FR text as implementation detail) and tracked as Open Question §11 item 7 rather than an inline tag.

**Phase 2 inline assumptions (2026-09-24), to confirm:**
- FR-4 — a Task with empty Status is treated as eligible, not gated.
- FR-30 — drag is today-only.
- FR-30 — a multi-block Task moves as a whole when any segment is dragged.
- ~~FR-39 — page order and non-swipe navigation fallback (→ bmad-ux).~~ *Resolved 2026-09-27 (Spencer): page order is Home, Tasks, Desk, Research Hub; navigation is a vertical stack (arrow buttons, ↑/↓ keys, edge-aware wheel, sidebar); swipe is retired, not a fallback-needing case.*
- FR-44 — on-time completion rate definition.
- §6 Accessibility — WCAG 2.2 AA as the contrast standard.
- FR-31 — unpin interaction shape (→ bmad-ux).
- FR-33 — Routine Blocks can shift but are never deleted by a reshuffle.
- FR-35 — Routines are declared via Chat.
- FR-36 — /sandbox ordering rule, and Refining-only gaps are excluded from the /sandbox queue.
- FR-39 — sessions persist across launches (no login step).
- FR-41 — check-off has a short undo window.
- FR-43 — Tasks page grouping/sort controls (→ bmad-ux).
- FR-47 — "hours worked with Yoh" definition (§11 item 10).
- §6 Latency — Phase 2 interactive latency targets.
- §7 Cost — hosting shape (§11 item 12).
- §10 — SM-5–SM-7 and SM-C3–SM-C4 as proposed.

**Epic 13 inline assumptions (2026-09-29), to confirm:**
- FR-54 — the filter that decides which turns are trivial is an architecture decision.
- FR-56 — the always-loaded size cap is set in architecture.
- FR-58 — pattern evidence thresholds, and the 30-day quiet period after a no.
- §10 — SM-8, SM-9, SM-C5, and SM-C6 as proposed.
