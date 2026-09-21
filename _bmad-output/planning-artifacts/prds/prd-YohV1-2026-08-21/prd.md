---
title: PRD: Yoh
created: 2026-08-21
updated: 2026-09-18
status: final
---

# PRD: Yoh

## 0. Document Purpose

This PRD is written for one reader wearing three hats — Spencer as PM, architect, and developer of Yoh — and for the downstream BMad workflows (architecture, epics/stories) that will consume it next. It builds directly on `../../briefs/brief-YohV1-2026-08-21/brief.md` and its `addendum.md`; nothing here duplicates that brief's narrative; it converts its decisions into implementable requirements. Vocabulary is Glossary-anchored (§4) — every FR and journey uses those terms verbatim. Features are grouped by behavior with Functional Requirements (FRs) nested underneath, numbered globally (FR-1…FR-N) so later artifacts can reference them by stable ID. Inline `[ASSUMPTION: …]` tags mark places this PRD inferred beyond what the brief stated; all are indexed in §12 for confirmation. Technical-how (API endpoints, auth mechanics, hardware stack) lives in `addendum.md`, not here — this document specifies capability and behavior, not implementation.

## 1. Vision

Yoh is a personal daily-planning system built for exactly one user. It reads a Notion Tasks database and a Google Calendar and runs a single daily loop — a Morning Ritual that generates one specific, trustworthy Plan for the day, and a Night Ritual that closes it out and adjusts for what actually happened. It exists to solve one problem: Spencer needs a Plan that is realistic enough, and transparent enough, to actually be followed — not a to-do list he has to interpret and re-prioritize by hand every morning.

This is Yoh's second attempt. The first was abandoned not for bugs or lost motivation but for an efficacy failure — what shipped wasn't useful enough to keep using. This PRD exists to convert the lessons of that failure into enforceable requirements: a narrow, working Morning/Night loop before anything else, a strict **Propose-Don't-Impose** boundary on anything Yoh infers about Spencer's behavior, and an **Escalate-Under-Strain** discipline that keeps the system's insistence proportional to how much it's actually being ignored — never more, never a flat nag.

Everything past the MVP loop — a web app, physical voice hardware, an iOS app, self-calibrating estimates, a Canvas LMS assignment sync — is real roadmap, not scope creep, and is explicitly Phase 2 and later. Phase 1 shipped September 2, 2026 (all epics done). This PRD now also specifies **Phase 1.5**: a narrow, CLI-scoped extension of Phase 1's Notion/Calendar write surface (page/database creation, confirm-gated time-block editing beyond Yoh-owned events) plus a first slice of Research Vault brought forward as a chat-triggered web-search capability — without retiring the CLI or starting Phase 2's web app. Phases past Phase 1.5 remain constraints on *how* this is built (modularly), not requirements to satisfy now.

## 2. Why Now

Timing here isn't external — it's self-imposed, and load-bearing anyway. This rebuild's entire discipline is a direct response to naming that efficacy failure precisely rather than repeating it under a new coat of paint. The **September 2, 2026** target isn't arbitrary scope-padding insurance — it's the forcing function that keeps Phase 1 narrow: anything that doesn't serve "does the Morning/Night loop actually get used" is explicitly deferred (§9.3), not squeezed in because it's easy. If this PRD lets Phase 1 scope drift, it has failed at the one thing it exists to prevent.

Phase 1.5 (§5.7 FR-25–FR-27, §5.8) is roadmap-driven, not usage-driven — it was not prompted by a specific friction Spencer hit running Phase 1 day-to-day (only about two weeks of real use had elapsed when this update was made). It came out of a dedicated brainstorm on where Yoh's write/search surface should go next, and was pulled forward deliberately rather than discovered as a gap. Named here plainly so a future reader doesn't infer usage evidence that doesn't exist.

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

## 4. Glossary

- **Task** — A Notion Tasks DB item. Nine fields exist (Task name, Area, Chunk Size, Due Date, Energy, Estimated Duration, Linked Project, Priority, Status); Yoh's planning reads only Estimated Duration, Area, Due Date, Status, and Energy.
- **Project** — A Notion Projects DB item. Organizational grouping only — not a planning input.
- **Research Vault** — A Notion store for on-demand research output. Output-only; not a planning input. A first slice — live web search plus filing a result on request (§5.8) — is in scope as of Phase 1.5, brought forward from its original Phase 5 placement.
- **Live Write Registry** — The fixed, named set of actions Yoh may perform from chat as of Phase 1.5: create Task (existing), create Page (FR-26), edit Calendar time-block (FR-27), search the web (FR-28, read-only — writes nothing), file a search result to Research Vault (FR-29). Yoh is never given raw Notion/Calendar API or token access to route from freeform chat text — only these named actions.
- **Chat** — The CLI's interactive text interaction surface (the terminal session run via `chat-cli`), as distinct from the non-interactive Morning/Night Ritual runs. FR-24–FR-29 all gate on a request arriving through Chat; no new interface surface is introduced by Phase 1.5 (§9.2).
- **Plan** — The ordered set of Plan Blocks Yoh generates for a single day.
- **Plan Block** — A single scheduled unit within a Plan: either a Task fitted into a work/break slot, or a fixed Calendar event the Plan is built around.
- **Morning Ritual** — The daily process that generates the Plan and sends it as one notification, then disengages.
- **Night Ritual** — The daily process that closes out the Plan: records what was done/slipped, escalates if unacknowledged (capped), and rolls unresolved mandatory Blockers into tomorrow.
- **Derived Priority** — Task ordering computed automatically from size/difficulty and proximity to Due Date — never manually set by Spencer.
- **Slip-Bump** — A small, capped priority increase applied to a Task that slipped, larger (but still capped) if it slips on consecutive days.
- **Data-Completeness Gate** — The check that prompts Spencer to fill required-but-missing Task fields before planning around that Task, rather than defaulting or letting it rot unplanned.
- **Time Budget** — Spencer's self-declared available hours for a given day; persists day-to-day (including weekends) until explicitly changed.
- **Work/Break Block** — A clock-based scheduling unit, default 70 minutes work / 15 minutes break, that a Task is fitted into (a Task may span multiple blocks).
- **Mid-Day Re-Flow** — A user-initiated, real-time adjustment of the remaining day's Plan. Never triggered by Yoh proactively.
- **Blocker** — A logistical obstacle to a Plan Block. Yoh reschedules around Blockers; it does not attempt to resolve or problem-solve them.
- **Escalate-Under-Strain** — The shared pattern governing Night Ritual retries, Slip-Bump magnitude, Tone escalation, and Self-Check frequency: each intensifies only in proportion to how much it's being ignored or slipping, never on a flat schedule.
- **Propose-Don't-Impose** — The trust boundary requiring explicit Spencer confirmation before Yoh acts on a learned pattern, a Time Budget change it suggests, or a Blocker resolution.
- **Self-Check** — A periodic (~every 4 days, randomized time) prompt asking Spencer to score how well Yoh is working, with a short written reason; frequency increases immediately after any single low score, not only after a trend.
- **Hot Memory** — Yoh's fast-access memory of recent days, patterns, and preferences.
- **Cold Memory** — Yoh's full history, queried on demand and distilled into pattern-statements over time, rather than kept hot.
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

The system orders Tasks in the Plan by an automatically computed priority. The primary ordering axis is Due Date proximity adjusted by Estimated Duration — urgency scaled by how much time the Task actually needs — which dominates the ranking; a weighted score across the remaining factors (Area, Energy fit, difficulty) breaks ties and refines ordering beneath that primary axis. Never set by manual Spencer input.

**Consequences (testable):**
- No UI or interaction path exists for Spencer to manually set a Task's position in the Plan directly; only the inputs that feed Derived Priority (e.g., Estimated Duration, Due Date) can be edited.
- Two Tasks with identical Estimated Duration and Area but different Due Dates are ordered with the closer Due Date first, all else equal.
- A Task with a closer Due Date but a much larger Estimated Duration is not automatically ranked behind a smaller, later-due Task — proximity is weighted by duration, not proximity alone.

**Implementation note:** Exact numeric weights for the secondary scoring factors are an implementation decision, not specified here — see `addendum.md`.

#### FR-3: Plan reasoning line

Every generated Plan includes a one-line, human-readable reason for what leads it.

**Consequences (testable):**
- The reasoning line references the actual Derived Priority factors that produced the ordering (e.g., "due soonest," "biggest chunk"), not a generic or static string.

#### FR-4: Data-Completeness Gate

Before including a Task in a Plan, the system verifies its required planning fields (Estimated Duration, Area, Due Date, Status, Energy) are set, and prompts Spencer to fill any that are missing rather than defaulting them or silently omitting the Task.

**Consequences (testable):**
- A Task missing a required field never silently appears in a Plan with a defaulted/assumed value for that field.
- A Task missing a required field never silently disappears from planning consideration without Spencer being prompted at least once.

**Notes:** Projects (organizational grouping only) and Research Vault (output-only) are explicitly excluded as planning inputs — confirmed in the brief, not open for reinterpretation without revisiting the brief. Spencer's answer to a missing-field prompt is also written back to Notion, not just stored locally — see FR-24.

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
- Close-out data (completed/slipped status per Plan Block) feeds Derived Priority (FR-2), Slip-Bump (FR-11), and memory (FR-17) for subsequent days.

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

### 5.5 Memory, Learning & Self-Check

**Description:** Yoh maintains a fast "hot" memory of recent patterns and a full "cold" history queried on demand, and periodically asks Spencer to score how well it's working — using that signal to adjust its own check-in frequency. Every learned pattern requires confirmation before Yoh acts on it.

**Functional Requirements:**

#### FR-15: Hot/Cold memory model

The system maintains a fast-access "hot" memory of recent days, patterns, and preferences, and a "cold" full-history store queried on demand and distilled into pattern-statements over time.

**Consequences (testable):**
- Recent-day context (e.g., yesterday's slip, this week's Time Budget) is available to plan generation without a full-history query.
- Older history remains queryable (not deleted) but does not need to be loaded for routine daily operation.

#### FR-16: Propose-Don't-Impose confirmation gate

Any learned behavioral pattern, suggested Time Budget change, or Blocker-handling decision requires Spencer's explicit confirmation before Yoh acts on it.

**Consequences (testable):**
- No learned pattern silently changes Yoh's behavior (e.g., auto-adjusting a default) without a prior explicit confirmation from Spencer for that specific change.

#### FR-17: Periodic Self-Check

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

The system's Tone becomes more urgent/authoritative only as a function of the Slip-Bump mechanic (§5.3) — never on a schedule, at random, or independent of actual slip/strain signals.

**Consequences (testable):**
- Two days with identical slip history produce the same Tone escalation level, regardless of what day of the week or how much time has passed.

**Out of Scope:** Manual Voice Packs (character voices) — Phase 5, tracked in §9.3, not part of this feature's MVP surface. `[NON-GOAL for MVP]`

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

#### FR-24: Write missing planning fields back to Notion via the CLI

When Spencer answers the Data-Completeness Gate's (FR-4) prompt via the CLI for a Task's missing Estimated Duration, Area, Due Date, Energy, or Status, the answer is written to that Task's corresponding property in Notion, not just stored locally.

**Consequences (testable):**
- A Task's field answered via the CLI's Data-Completeness prompt shows that same value when viewed directly in Notion, without Spencer manually updating it.
- This write path is reachable only through the CLI's interactive answer flow — never from an automated Morning Ritual, Night Ritual, or Self-Check run, which stay one-shot and non-interactive.
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

## 6. Cross-Cutting NFRs

- **Reliability.** The Morning and Night Rituals must run daily without manual intervention. A failure to run — a crash, an expired auth token, an unreachable API — must be surfaced to Spencer, not fail silently. There is no support team and no other user to notice; if Yoh goes quiet, Spencer is the only signal, so the system must not rely on him noticing an *absence*.
- **Data integrity.** Writes to Calendar or Notion must never corrupt or lose Task/Calendar data. This is a harder guarantee than most personal tools need, because the data being written into is Spencer's real calendar and real task list, not a sandbox. Every write capability sits at exactly one of three tiers, chosen per capability and never defaulted: **automatic**, Ritual-triggered and scoped to Yoh-owned records only (FR-22, FR-23); **direct-write**, where Spencer's own explicit instruction is validated and written immediately with no separate draft-and-confirm step — the instruction itself is the confirmation (FR-24, an explicit answer to a direct question; FR-29, an explicit "save that" request); or **confirm-then-write**, where Yoh proposes or drafts something and nothing is written until Spencer explicitly confirms it (FR-25, FR-26, FR-27). FR-28's search is read-only and writes nothing at any tier. The guarantee that Yoh never touches a record it doesn't own has exactly one explicit exception, FR-27: the boundary moves from "never" to "never without naming the event and being told yes," trading ownership for an explicit per-action confirmation. FR-24 and FR-26 both widen the Notion write surface beyond Status; both satisfy this guarantee the way FR-24 established it — a select-backed or schema-bound property is only ever written as one of its real, currently-existing options (fuzzy-matched, never invented), and a write that can't confidently resolve fails and re-prompts instead of guessing. All Phase 1.5 write capabilities (FR-26–FR-29; FR-25 reuses FR-24's existing write path rather than adding a new one) route through the fixed, named Live Write Registry (§4) — Yoh is never given raw Notion/Calendar API access to route from freeform chat text. Every write triggered from Chat (FR-24–FR-29) is echoed back to Spencer as a one-line receipt in that same chat, so nothing changes silently mid-conversation. Ritual-triggered writes (FR-22, FR-23) run outside any chat session and keep their own existing channel — the Ritual's notification (Observability, below); this NFR does not add a new chat-receipt requirement to those already-shipped Phase 1 paths.
- **Latency.** Plan generation must complete comfortably before the Morning Ritual notification is due — no hard SLA, but "fast enough to not feel broken" (low seconds, not minutes) is a real requirement, since a slow or hung Morning Ritual is functionally the same failure as one that doesn't run at all.
- **Observability.** Because there's no one else to catch a silent failure, Yoh must be able to tell Spencer when something has gone wrong with its own operation (auth expired, an integration is unreachable, a scheduled ritual didn't fire) rather than simply going dark. This directly counters the OAuth "Testing mode" 7-day silent-expiry trap named in the brief's Known Risks.

## 7. Constraints and Guardrails

- **Privacy.** All Task and Calendar data is personal and single-user. No data leaves Spencer's own Notion workspace and Google account except as required by the Notion and Calendar integrations themselves (§5.7). No third-party analytics, telemetry, or data sharing.
- **Cost.** Yoh must run on infrastructure Spencer already owns — laptop, Raspberry Pi, or existing cloud/server setup. No new recurring paid service was required for Phase 1. Web search (FR-28, §5.8) introduces the first ongoing external API cost, brought forward from its original Phase 5 placement — single-user, on-demand search volume; provider choice and pricing tier are implementation detail (`addendum.md`), not a PRD requirement.
- **Safety.** Not a meaningful concern for Phase 1's software-only surface. Becomes relevant once Phase 3 introduces physical hardware (speaker placement/volume near water, an always-on device) — deferred to that phase's own scoping, not applicable now.

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

## 9. MVP Scope

### 9.1 In Scope (Phase 1 — hard deadline September 2, 2026) — shipped, all 5 epics done

- Morning Ritual: Plan generation, single notification, Data-Completeness Gate, Derived Priority, one-line reasoning (FR-1–FR-4).
- Time Budget declaration/persistence and Work/Break Block fitting (FR-5–FR-8).
- Mid-Day Re-Flow (user-initiated), logistics-only Blocker handling, Slip-Bump (FR-9–FR-11).
- Night Ritual close-out, capped escalating retry, unchecked-day handling (FR-12–FR-14).
- Hot/Cold memory, Propose-Don't-Impose confirmation gate, periodic Self-Check (FR-15–FR-17).
- Default/contextual Tone with Escalate-Under-Strain-driven escalation (FR-18–FR-19).
- Notion Tasks/Projects read, Task Status write-back, CLI-driven missing-planning-field write-back; Google Calendar read/write with strict Yoh-owned-event isolation (FR-20–FR-24).
- Terminal/CLI interface — the only surface for Phase 1.

### 9.2 In Scope (Phase 1.5 — Live Integrations)

- Proposing inferred values for the Data-Completeness Gate instead of only asking blind (FR-25).
- Notion page/database item creation via chat, schema-validated against the target database (FR-26).
- Confirm-gated Calendar time-block editing beyond Yoh-owned events — move/resize/create only, never delete (FR-27).
- Web search lookup via chat with source citations (FR-28), and filing a result to the Research Vault on explicit request (FR-29).
- FR-26–FR-29 routed through the Live Write Registry (§4); no new interface surface — still terminal/CLI only, same as Phase 1.

### 9.3 Out of Scope

- **Physical hardware device** (Pi 5, wake-word/STT/TTS voice pipeline, bedroom/bathroom build) — Phase 3. Architecture direction already researched (see brief `addendum.md`), but no product-level parts (mic/speaker/display) chosen yet. The Phase-1 Night Ritual's second escalation attempt (FR-13) no longer depends on this — it uses email for Phase 1, with the home-speaker call-out remaining a Phase 3 upgrade once the hardware exists, not a blocking dependency.
- **Web app** — Phase 2, would retire the CLI as primary interface. Phase 1.5 (§9.2) does not touch or accelerate this — it stays CLI-only.
- **iOS app** — Phase 4.
- **Manual Voice Packs** — Phase 5, and permanently decoupled from Tone escalation (§5.6 Out of Scope).
- **Self-calibrating task-duration estimates** — Phase 6; Estimated Duration remains a manually-entered Task field.
- **Recurring Calendar events** — not part of MVP or Phase 1.5; several Google Calendar recurring-event gotchas are noted in the brief's addendum but are explicitly out of scope until recurrence is added.
- **Room-cleanliness camera** — long-term/aspirational, not committed to any numbered phase.
- **Canvas LMS assignment sync** — reads assignment due dates from Spencer's school Canvas LMS and creates/updates corresponding Notion Task records (course → Area, due date, name) so Canvas assignments flow through the existing Notion Tasks pipeline unchanged; Estimated Duration and Energy still get filled by Spencer via the existing Data-Completeness Gate (FR-4), since Canvas can't supply either. Blocked on the school's Canvas admin approving API access (a Canvas Developer Key); not assigned to a numbered phase yet — revisit once access is granted (§11).

## 10. Success Metrics

**Primary**
- **SM-1**: Plan-follow rate — the declared Time Budget and generated Plan are actually used to structure the day on most days (self-assessed via Self-Check, FR-17), not abandoned partway through. Validates FR-1, FR-2, FR-8.
- **SM-2**: MVP shipped and in daily use by September 2, 2026. Validates the full Phase-1 scope (§9.1).

**Secondary**
- **SM-3**: Data-Completeness Gate prompts and Slip-Bump adjustments are followed rather than dismissed — a sign the Plan stays realistic enough to trust. Validates FR-4, FR-11.
- **SM-4**: Self-Check scores stay stable or trend upward over time, since Escalate-Under-Strain is designed to intensify only when they trend down. Validates FR-17, FR-19.

**Counter-metrics (do not optimize)**
- **SM-C1**: Night Ritual escalation frequency (how often FR-13's second attempt fires) — this is a symptom of the Plan or the day going wrong, not a target to increase or feature-tune toward. Counterbalances SM-1.
- **SM-C2**: Self-Check prompt frequency — a system that checks in more often because scores are trending low is doing what it's designed to do (Escalate-Under-Strain), not something to be proud of; the frequency itself is not a success signal. Counterbalances SM-4.

**Phase 1.5 (FR-25–FR-29): intentionally unmetered.** No SM extends to Phase 1.5 yet — a decision, not an oversight. These capabilities were added roadmap-driven (§2), not in response to observed Phase 1 usage, so there's no real baseline yet to set a meaningful target against. Whether chat-driven Notion writes, calendar edits, and web search actually get used (vs. sitting unused) is exactly the kind of signal Self-Check (FR-17) and ordinary usage observation should surface within a few weeks — a Phase 1.5 SM belongs in a near-future PRD update once that evidence exists, not guessed at here.

## 11. Open Questions

The four questions that blocked Phase 1 in the first draft are resolved below; seven non-blocking items remain, including two surfaced during finalization's reconciliation pass against source documents and one surfaced during the Phase 1.5 update.

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
6. **Canvas API access approval** — a Canvas Developer Key (OAuth2 app registration) requires the school's Canvas admin to approve API access before the Canvas Sync (§9.3) can be built at all; also unresolved once approved: course→Area mapping convention and the re-sync/dedup strategy for previously-synced assignments. See `addendum.md` § Canvas API Integration for the research and § "Next step once Canvas API access is granted — BMad path" for the implementation sequence. Owner: Spencer. Revisit: once school approval is granted.
7. **Perplexity API pricing/terms verification** — FR-28/FR-29's search-provider assumption, carried forward from when Research Vault was Phase 5-scoped, hasn't been re-confirmed against current terms. See `addendum.md` § Phase 1.5: Live Integrations — Technical Notes. Owner: Spencer. Revisit: before FR-28/FR-29 implementation starts.

## 12. Assumptions Index

No open assumptions remain in the FR text itself. Three of §11's four newly-resolved Phase 1 questions started as inline `[ASSUMPTION]` tags in the first draft — FR-2's weighting approach, FR-11's cap/growth curve, and FR-13's escalation channel — all now resolved and removed from the FR text. FR-17's threshold was an Open Question only; it never carried an inline tag. One Phase 1.5 assumption exists outside the FR text: the working choice of Perplexity as FR-28/FR-29's search provider carries forward from Research Vault's original Phase 5 scoping without reconfirmation. It's capability-level-irrelevant (§7 deliberately keeps provider choice out of the FR text as implementation detail) and tracked as Open Question §11 item 7 rather than an inline tag.
