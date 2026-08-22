---
source: brainstorm-yoh-notion-daily-assistant-2026-08-21
status: decided (ready for product brief / PRD)
---

# Yoh — Notion-Powered Daily Assistant: Brainstorm Intent

## Concept Summary

Yoh is a personal daily-planning assistant, built solo for the author's own use only (no other end users), that turns an existing Notion Tasks database into a trustworthy, changing daily action plan via a morning-generate / night-close ritual, with voice and app access planned for later phases. This is a **second attempt** at Yoh — the first attempt did not fail on build quality, technical execution, or motivation; it failed on **efficacy**: the features that got built simply weren't useful in practice, so the project was abandoned. That root cause directly shapes this rebuild: the core bet is one specific, trustworthy plan that, if followed, makes all tasks and goals completable — success is measured by whether the plan is followed, not by feature count — and the design includes a built-in, recurring self-check (periodic scored feedback) specifically to catch an efficacy failure early this time rather than discover it 18 months in. Target: something useful shipped by **September 2, 2026**.

## Core Design (Decided Rules)

### Data Scope / Notion Schema Use
- Daily plan generation is driven **solely by the Tasks DB**. Fields actually used: Estimated Duration, Area, Due Date, Status, Energy.
- **Projects DB**: organizational grouping only (sorts tasks/notes by project) — not a planning input.
- **Research Vault DB**: on-demand output store for research requests only — not a planning input (v1). Wiring it to a Perplexity research agent is a later-phase feature.
- **Data completeness gate**: Yoh proactively asks the user to fill in missing required task fields (due date, duration, energy) rather than silently defaulting or letting incomplete tasks rot.

### Plan Generation Logic
- **Priority is derived, not manually set**: larger/harder tasks and tasks with closer due dates are prioritized first.
- **Daily time budget** is user-declared, changeable anytime via voice/chat (e.g., 2.5 hrs one week, 4 hrs another). Yoh may proactively suggest raising the week's workload ahead of a known big push, but never silently overrides the stated budget.
- Budget **persists** as whatever was last stated and applies every day including weekends — no automatic weekend default. Rest days must be explicit user declarations, never inferred.
- **Work/break rhythm**: default 70 minutes work / 15 minutes break, repeating, user-overridable. Break count scales with total budget (e.g., 3 hrs = 2 breaks). Hard rule: no work push exceeds 70 minutes without a 15-minute break — breaks are **strictly clock-based**, even if that splits a single task mid-task (not aligned to task boundaries).
- **Transparency rule**: every daily plan shows a one-line "why" next to it (e.g., "leading with X — due soonest, biggest chunk") so a bad task-selection call is visible and correctable up front.

### Morning / Night Ritual Behavior
- **Morning ritual**: generates the day's plan; delivers a single push notification, then leaves the user alone for the rest of the day (no further nagging).
- **Night ritual**: closes out the day and checks completion, with **escalating retries capped at 2**: retry 1 = phone notification, retry 2 = home speaker call-out. No retries beyond that.
- If the night check-in is never completed, Yoh flags "you never checked in" and resolves any mandatory blockers during the next morning ritual instead of continuing to chase it.
- Ritual fallback is intentionally **asymmetric**: morning = single push and disengage; night = escalating 2-step retry.

### Adjustment / Escalation Logic
- A task that slips (not completed) gets an automatic small priority bump the next day, capped so a low-priority task can't jump straight to high priority from slipping alone.
- The bump **stacks**: each consecutive slip day adds another bump (escalating urgency over time), still bounded by the cap.
- **Blocker handling is logistics-only**: Yoh reschedules/rearranges the plan around a blocker; it does not try to problem-solve the underlying blocker itself.
- **Mid-day re-flow**: adjustment can happen in real time (task finishes early or runs long), not just at night check-in — but it is strictly **user-initiated** (self-reported progress). Yoh never proactively pings/checks in mid-block.
- Underlying mechanism across the system: a single **"escalate under strain"** pattern ties together slip-bump, tone shift, retry escalation, and score-check frequency.

### Memory Model
- **Dual memory**: (1) factual recall of what's been said/entered (notes, reminders, conversations), and (2) constantly-learning behavioral pattern recognition — an assistant that gets to know the user over time.
- **Hybrid architecture**: a small "active" memory (recent days, current patterns, standing preferences) is front-and-center for every planning decision; full raw history lives in a "cold" store, queried on demand (not loaded by default), and gets distilled into short pattern-statements over time rather than replayed in full.
- **Trust boundary — "propose, don't impose"**: learned patterns are surfaced to the user for confirmation before Yoh acts on them. This is the same rule that governs budget overrides and blocker handling, and is the direct guard against scope-creep/annoyance risk.
- When the user gives feedback that a plan was bad, Yoh updates/learns from that feedback in memory so future plans improve.

### Self-Check / Quality Loop
- Yoh randomly asks the user to score its outputs roughly once every 4 days at a random time.
- Score prompts require a **number plus a short written reason**, not just a number.
- If scores trend low, check-in frequency increases beyond the ~4-day baseline until quality recovers.

### Tone / Persona
- **Default**: casual, peer-level secretary — organizes tasks and hands over a plan to execute; not formal, not corporate.
- **Intellectual/academic questions**: switches to a concise, educational tone; explicitly avoid "it's not just X, it's Y" contrast framing as a structural crutch.
- **Escalation tone**: becomes more authoritative/urging when the user is slipping/procrastinating — tied directly to the slip-bump mechanic.
- **Concrete failure mode to avoid** (from Future Autopsy): verbose, generically "AI-ey," too professional/corporate instead of cool. This reinforces the casual-peer-secretary default.
- **Voice packs**: selectable fun voices (robot, Hulk, Rick-and-Morty's Morty, etc.) are strictly a manual/on-demand toggle, fully decoupled from tone-escalation logic. The authoritative/casual tone shift always uses the default voice — it never auto-switches character voices.
- Personality/voice tuning beyond these rules is deliberately deferred to be refined iteratively through real usage, not fully specified now.

## Named Risks and Built-In Safeguards

| Risk | Safeguard |
|---|---|
| Too much friction to interact with Yoh | "Propose, don't impose" trust boundary on budget, learned patterns, and blockers; asymmetric ritual fallback (morning disengages, night escalates only to a hard cap of 2) |
| — friction: repeating/re-explaining context Yoh should remember | Dual memory model (factual + behavioral pattern learning), hybrid active/cold architecture |
| — friction: technical instability/bugs | (Addressed via phased build approach — MVP kept intentionally small/terminal-based before adding surfaces) |
| — friction: personality/quality mismatch (not liking interacting with it) | Casual peer-secretary default tone; explicit avoidance of verbose/generic-AI/corporate voice (Future Autopsy failure mode); manual-only fun voice packs so default stays stable |
| — friction: Yoh overstepping its defined role | "Propose, don't impose" rule; blockers handled as logistics-only, not problem-solving |
| Bad plans (low-quality/unrealistic schedule) | One-line "why" reasoning shown next to every plan; feedback-updates-memory loop; periodic scored check-in (~every 4 days, escalating in frequency if scores trend low) |
| Efficacy failure repeat (root cause of prior Yoh's death) | Scored check-in loop is the specific, purpose-built safeguard to surface an efficacy problem early rather than after prolonged disuse |
| Plans needing too much manual revision (Future Autopsy failure mode #2) | Confirmed covered by existing safeguards — why-reasoning, feedback-updates-memory, periodic scoring — no new gap/mechanism identified |

## Finalized 6-Phase Roadmap

1. **Must — Sept 2, 2026 MVP**: morning-generate + night-close loop, delivered via terminal/CLI chat interface, with Google Calendar as a temporary bridge (read existing calendar events once daily as fixed blocks to plan around; write the full generated daily plan into Calendar as new events; Yoh never edits/deletes events it doesn't own — only its own plan-block events; old plan-block events are left as passive history, never deleted).
2. **Web app** — polished, intuitive web app; retires Google Calendar as the primary interface.
3. **Physical hardware** — Raspberry Pi (already owned) + 3D-printed case + screen displaying the web app, kept in the bedroom away from water; Bluetooth audio to a waterproof bathroom speaker; idle state is a passive, sleep-friendly small red-light/clock display; voice mute/resume commands ("Yoh, headphones" / "Yoh, headphones off"); eventual browser-access search (pull up a relevant video/page on the device screen on request).
4. **iOS app** — with an iOS Control-Center-style swipe-down shortcut into the app, and push notifications enabled from both web app and iOS app.
5. **Research Vault + Perplexity integration, and manual voice packs** — wire Research Vault DB to a Perplexity research agent (topic in, written result out to Notion); selectable fun voice packs (robot, Hulk, Morty, etc.), manual/on-demand only.
6. **Task timer + self-calibrating duration estimates** — manual per-task start/stop timer; Yoh learns actual time-per-task over time and uses it to improve future duration estimates.

### Phase-1 MVP: In vs. Out
- **In**: morning plan generation; night close/adjust with escalating retry (notification → speaker call-out, capped at 2); terminal/CLI chat interface; Google Calendar read (fixed events) + write (plan blocks) as a temporary bridge; data-completeness gating; derived priority; slip-bump; mid-day user-initiated re-flow; one-line plan reasoning; feedback-into-memory; periodic scored check-in; default casual tone with escalation.
- **Out (deferred to later phases)**: physical hardware device (Pi/speaker/screen build) and iOS app — explicitly cut from v1; polished web app; Research Vault + Perplexity wiring; manual voice packs; task timer/self-calibrating estimates; room-cleanliness camera feature (long-term aspirational hardware add, auto-runs every 3 days folded into an existing ritual once built — not immediate scope).

## Cross-Cutting Requirement

The system and codebase architecture must be built **modularly and extensibly** so later-phase features (hardware, iOS, Research Vault/Perplexity, voice packs, task timer) bolt on later without rework. This applies to the actual architecture/codebase design, not just the roadmap sequencing.

## Parked / Deferred Open Questions

- **Bathroom-side mic/input solution** for the Bluetooth speaker setup — parked; to be revisited after the bedroom device design is settled (Phase 3).
- **Personality/voice tuning** beyond the decided tone rules — deliberately left to be refined iteratively through real usage rather than fully specified now.
- **Room-cleanliness camera feature** — explicitly flagged as a future/aspirational hardware add (not immediate scope), with only its trigger cadence pre-decided (every 3 days, folded into an existing ritual) if/when built.
