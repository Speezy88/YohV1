---
title: PRD: Yoh
created: 2026-08-21
updated: 2026-09-16
status: final
---

# PRD: Yoh

## 0. Document Purpose

This PRD is written for one reader wearing three hats — Spencer as PM, architect, and developer of Yoh — and for the downstream BMad workflows (architecture, epics/stories) that will consume it next. It builds directly on `../../briefs/brief-YohV1-2026-08-21/brief.md` and its `addendum.md`; nothing here duplicates that brief's narrative; it converts its decisions into implementable requirements. Vocabulary is Glossary-anchored (§4) — every FR and journey uses those terms verbatim. Features are grouped by behavior with Functional Requirements (FRs) nested underneath, numbered globally (FR-1…FR-N) so later artifacts can reference them by stable ID. Inline `[ASSUMPTION: …]` tags mark places this PRD inferred beyond what the brief stated; all are indexed in §12 for confirmation. Technical-how (API endpoints, auth mechanics, hardware stack) lives in `addendum.md`, not here — this document specifies capability and behavior, not implementation.

## 1. Vision

Yoh is a personal daily-planning system built for exactly one user. It reads a Notion Tasks database and a Google Calendar and runs a single daily loop — a Morning Ritual that generates one specific, trustworthy Plan for the day, and a Night Ritual that closes it out and adjusts for what actually happened. It exists to solve one problem: Spencer needs a Plan that is realistic enough, and transparent enough, to actually be followed — not a to-do list he has to interpret and re-prioritize by hand every morning.

This is Yoh's second attempt. The first was abandoned not for bugs or lost motivation but for an efficacy failure — what shipped wasn't useful enough to keep using. This PRD exists to convert the lessons of that failure into enforceable requirements: a narrow, working Morning/Night loop before anything else, a strict **Propose-Don't-Impose** boundary on anything Yoh infers about Spencer's behavior, and an **Escalate-Under-Strain** discipline that keeps the system's insistence proportional to how much it's actually being ignored — never more, never a flat nag.

Everything past the MVP loop — a web app, physical voice hardware, an iOS app, a Research Vault, self-calibrating estimates, a Canvas LMS assignment sync — is real roadmap, not scope creep, but it is explicitly Phase 2 and later. This PRD specifies Phase 1 only, and treats the phases past it as constraints on *how* Phase 1 is built (modularly), not as requirements to satisfy now.

## 2. Why Now

Timing here isn't external — it's self-imposed, and load-bearing anyway. This rebuild's entire discipline is a direct response to naming that efficacy failure precisely rather than repeating it under a new coat of paint. The **September 2, 2026** target isn't arbitrary scope-padding insurance — it's the forcing function that keeps Phase 1 narrow: anything that doesn't serve "does the Morning/Night loop actually get used" is explicitly deferred (§9.2), not squeezed in because it's easy. If this PRD lets Phase 1 scope drift, it has failed at the one thing it exists to prevent.

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
- **Research Vault** — A Notion store for on-demand research output. Output-only; not a planning input. Out of scope until Phase 5.
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

**Notes:** Projects (organizational grouping only) and Research Vault (output-only) are explicitly excluded as planning inputs — confirmed in the brief, not open for reinterpretation without revisiting the brief.

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

**Out of Scope:** Manual Voice Packs (character voices) — Phase 5, tracked in §9.2, not part of this feature's MVP surface. `[NON-GOAL for MVP]`

---

### 5.7 Notion & Calendar Integration

**Description:** Yoh reads Task and Project data from Notion, writes Task Status back to Notion on Night Ritual close-out, and reads/writes Plan-related events on Google Calendar, without ever modifying a Calendar event it doesn't own. Capability-level only — see `addendum.md` for the technical mechanism (auth, endpoints, tagging implementation).

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

## 6. Cross-Cutting NFRs

- **Reliability.** The Morning and Night Rituals must run daily without manual intervention. A failure to run — a crash, an expired auth token, an unreachable API — must be surfaced to Spencer, not fail silently. There is no support team and no other user to notice; if Yoh goes quiet, Spencer is the only signal, so the system must not rely on him noticing an *absence*.
- **Data integrity.** Writes to Calendar or Notion must never corrupt or lose Task/Calendar data, and must never touch a record Yoh doesn't own (FR-22, FR-23). This is a harder guarantee than most personal tools need, because the data being written into is Spencer's real calendar and real task list, not a sandbox.
- **Latency.** Plan generation must complete comfortably before the Morning Ritual notification is due — no hard SLA, but "fast enough to not feel broken" (low seconds, not minutes) is a real requirement, since a slow or hung Morning Ritual is functionally the same failure as one that doesn't run at all.
- **Observability.** Because there's no one else to catch a silent failure, Yoh must be able to tell Spencer when something has gone wrong with its own operation (auth expired, an integration is unreachable, a scheduled ritual didn't fire) rather than simply going dark. This directly counters the OAuth "Testing mode" 7-day silent-expiry trap named in the brief's Known Risks.

## 7. Constraints and Guardrails

- **Privacy.** All Task and Calendar data is personal and single-user. No data leaves Spencer's own Notion workspace and Google account except as required by the Notion and Calendar integrations themselves (§5.7). No third-party analytics, telemetry, or data sharing.
- **Cost.** Yoh must run on infrastructure Spencer already owns — laptop, Raspberry Pi, or existing cloud/server setup. No new recurring paid service is required for Phase 1. (Any Perplexity API cost is scoped to Phase 5's Research Vault integration and is out of scope here.)
- **Safety.** Not a meaningful concern for Phase 1's software-only surface. Becomes relevant once Phase 3 introduces physical hardware (speaker placement/volume near water, an always-on device) — deferred to that phase's own scoping, not applicable now.

## 8. Non-Goals (Explicit)

- Yoh is not, and will never become, a multi-user product — no account system, sharing, or multi-tenant data model at any phase; assume single-user, single-workspace, single-calendar for the life of the product.
- Yoh will not silently default or drop Tasks with missing required fields — the Data-Completeness Gate (FR-4) is a permanent design stance, not an MVP shortcut.
- Yoh will not proactively interrupt Spencer mid-block to check progress; all mid-day interaction is Spencer-initiated (FR-9).
- Yoh will not act on a learned pattern or suggested change without explicit confirmation (FR-16) — this is a permanent trust boundary, not a v1 limitation to relax later.
- Yoh will not attempt to resolve, judge, or problem-solve reported Blockers — only reschedule around them (FR-10).
- Yoh will not auto-switch character Voice Packs based on Tone or escalation state, at any phase — Voice Packs (Phase 5) are manual-only by permanent design, not a temporary MVP restriction.

## 9. MVP Scope

### 9.1 In Scope (Phase 1 — hard deadline September 2, 2026)

- Morning Ritual: Plan generation, single notification, Data-Completeness Gate, Derived Priority, one-line reasoning (FR-1–FR-4).
- Time Budget declaration/persistence and Work/Break Block fitting (FR-5–FR-8).
- Mid-Day Re-Flow (user-initiated), logistics-only Blocker handling, Slip-Bump (FR-9–FR-11).
- Night Ritual close-out, capped escalating retry, unchecked-day handling (FR-12–FR-14).
- Hot/Cold memory, Propose-Don't-Impose confirmation gate, periodic Self-Check (FR-15–FR-17).
- Default/contextual Tone with Escalate-Under-Strain-driven escalation (FR-18–FR-19).
- Notion Tasks/Projects read, Task Status write-back; Google Calendar read/write with strict Yoh-owned-event isolation (FR-20–FR-23).
- Terminal/CLI interface — the only surface for Phase 1.

### 9.2 Out of Scope for MVP

- **Physical hardware device** (Pi 5, wake-word/STT/TTS voice pipeline, bedroom/bathroom build) — Phase 3. Architecture direction already researched (see brief `addendum.md`), but no product-level parts (mic/speaker/display) chosen yet. The Phase-1 Night Ritual's second escalation attempt (FR-13) no longer depends on this — it uses email for Phase 1, with the home-speaker call-out remaining a Phase 3 upgrade once the hardware exists, not a blocking dependency.
- **Web app** — Phase 2, would retire the CLI as primary interface.
- **iOS app** — Phase 4.
- **Research Vault + Perplexity integration** — Phase 5. Notion Research Vault remains output-only until then (§4 Glossary).
- **Manual Voice Packs** — Phase 5, and permanently decoupled from Tone escalation (§5.6 Out of Scope).
- **Self-calibrating task-duration estimates** — Phase 6; Estimated Duration remains a manually-entered Task field through Phase 1.
- **Recurring Calendar events** — not part of MVP; several Google Calendar recurring-event gotchas are noted in the brief's addendum but are explicitly out of scope until recurrence is added.
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

## 11. Open Questions

The four questions that blocked Phase 1 in the first draft are resolved below; five non-blocking items remain, including two surfaced during finalization's reconciliation pass against source documents.

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
6. **Canvas API access approval** — a Canvas Developer Key (OAuth2 app registration) requires the school's Canvas admin to approve API access before the Canvas Sync (§9.2) can be built at all; also unresolved once approved: course→Area mapping convention and the re-sync/dedup strategy for previously-synced assignments. See `addendum.md` § Canvas API Integration for the research and § "Next step once Canvas API access is granted — BMad path" for the implementation sequence. Owner: Spencer. Revisit: once school approval is granted.

## 12. Assumptions Index

No open assumptions remain. Three of §11's four newly-resolved questions started as inline `[ASSUMPTION]` tags in the first draft — FR-2's weighting approach, FR-11's cap/growth curve, and FR-13's escalation channel — all now resolved and removed from the FR text. FR-17's threshold was an Open Question only; it never carried an inline tag.
