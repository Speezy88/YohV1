---
title: "Product Brief: Yoh"
status: draft
created: 2026-08-21
updated: 2026-08-21
---

# Product Brief: Yoh

## Executive Summary

Yoh is a personal daily-planning assistant, built for one user and no one else. It reads a Notion Tasks database and a Google Calendar, and runs a single daily loop: a morning ritual that generates one specific, trustworthy plan for the day, and a night ritual that closes it out and adjusts for what actually happened. Everything else — voice, hardware, a mobile app, a research vault — is a later phase bolted onto that loop, not the starting point.

This is a second attempt. The first Yoh was abandoned not because it was buggy or because the builder lost interest, but because what shipped simply wasn't useful in practice — plans that weren't followed are worth nothing. This brief exists to name that failure mode precisely and design against it: the MVP is scoped tightly around *one loop that works*, with a hard target of September 2, 2026, and a governing design principle — **propose, don't impose** — that keeps Yoh from becoming the kind of overreaching, untrustworthy assistant that made version one easy to abandon.

## The Problem

The builder needs one thing a to-do app and a calendar don't give them together: a single daily plan that is both realistic and trustworthy enough to actually follow. Tasks live in Notion with real metadata (duration, area, due date, energy, status); calendar events live in Google Calendar. Neither, on its own, produces "here is what to do today, in what order, and why." Building that plan by hand every morning is the tax being paid today.

Version one of Yoh tried to solve this and failed — not on execution, but on efficacy. The specific failure mode this brief is designed against has two named risks:

- **Friction**: re-explaining context, instability, a mismatched personality, or Yoh overstepping its role, all of which make the assistant something to fight rather than lean on.
- **Bad plans**: a schedule that's unrealistic or low-quality, which breaks trust the moment it's followed once and fails.

Both failure modes are addressed directly in the design decisions below, not left as vague aspirations.

## The Solution

Yoh runs one core loop, governed by two design principles:

- **Morning ritual** — generates the day's plan from Notion Tasks (using only Estimated Duration, Area, Due Date, Status, and Energy — Projects is organizational grouping only, Research Vault is output-only), sends one push notification, then disengages. No nagging during the day.
- **Night ritual** — closes out the day, with escalating retries capped at two attempts (notification, then a home-speaker call-out) before flagging an unchecked day and rolling mandatory blockers into the next morning rather than continuing to chase.
- **Derived priority, not manual** — larger/harder tasks and closer due dates are weighted automatically; a slipped task gets a small, capped priority bump the next day (bigger if it keeps slipping, still capped).
- **Transparency** — every plan carries a one-line reason ("leading with X — due soonest, biggest chunk").
- **Data-completeness gate** — Yoh asks for missing required fields rather than silently defaulting or letting incomplete tasks rot.
- **User-declared time budget** — set by voice/chat, persists day to day including weekends, changeable but never silently overridden.
- **Work/break rhythm** — clock-based, default 70/15, user-overridable.
- **Mid-day re-flow** — real-time adjustment exists, but is strictly user-initiated; Yoh never proactively pings mid-block.
- **Dual memory** — factual recall plus a slower-changing behavioral-pattern layer (recent days "hot," full history "cold," queried on demand), feeding a periodic self-check (~every 4 days, a score plus a short reason, with check-in frequency rising if scores trend low).

One pattern ties the escalation behavior together end to end — retries, priority bumps, tone shift, and check-in frequency all tighten under the same **escalate-under-strain** logic, so the system gets more insistent only in proportion to how much it's actually being ignored or slipping.

## What's Different From Version One

The previous Yoh's failure was a design failure, not a build failure — so the fix is design discipline, not more features:

- **Propose, don't impose.** Learned patterns, budget overrides, and blocker handling all require explicit user confirmation before Yoh acts on them. This is the direct countermeasure to "Yoh overstepping its role."
- **One loop, not a feature list.** The MVP is deliberately narrow — a working morning/night cycle — because the lesson from v1 was that shipped features that don't get *used* are worse than no features.
- **Tone discipline.** Default is a casual, peer-level secretary; it goes concise/educational for factual questions and escalates in urgency only via the slip-bump mechanic — never randomly, and fun character voice packs are manual-only, fully decoupled from escalation, so Yoh doesn't get erratic or grating over time.
- **Architected for the roadmap it names.** The codebase is meant to be built modularly enough that voice, hardware, a web app, and the research vault bolt on later without a rewrite — a stance made explicit now so early implementation choices don't foreclose it.

## Who This Serves

Yoh has exactly one user: its builder. This is a **permanent** constraint, not a v1-only scoping choice — there is no roadmap phase, now or later, aimed at other users. Every design decision (auth model, single-tenant assumptions, no multi-user data model) should be made accordingly rather than hedged for a hypothetical audience that doesn't exist.

## Success Criteria

Success is behavioral, not a feature count: **the plan gets followed.** Concretely —

- A morning plan is generated and actually used to structure the day, most days, without the builder abandoning it partway through.
- Night close-out happens (or is honestly flagged unchecked) without needing more than the capped two-touch escalation.
- Missing-data prompts and slip-bumps are followed instead of dismissed — a sign the plan is realistic enough to trust.
- Periodic self-check scores stay stable or trend up over time, since the mechanism itself is designed to intensify only when scores trend down.
- The MVP is shipped and in daily use by **September 2, 2026**.

## Scope

**Phase 1 — MVP (hard deadline: September 2, 2026):** Morning plan generation; night close/adjust with capped escalating retry; terminal/CLI interface; Google Calendar read (existing events) and write (plan blocks, tagged so Yoh never touches events it doesn't own — see Technical Foundations); data-completeness gating; derived priority and slip-bump; user-initiated mid-day re-flow; one-line plan reasoning; periodic scored check-in; default tone with escalation.

**Explicitly out of Phase 1** (deferred, not abandoned — see Vision): the physical hardware device, the iOS app, the polished web app, the Research Vault + Perplexity integration, manual voice packs, and self-calibrating task-duration estimates. Full phase-by-phase detail is in `addendum.md`.

## Technical Foundations

Two integrations carry Phase 1, and both are already de-risked by prior research (full detail and sourcing in `addendum.md`):

- **Notion**: internal integration token (not OAuth — appropriate for single-workspace personal use), current "Query a data source" endpoint, explicit timezone handling on date filters.
- **Google Calendar**: OAuth 2.0 user-consent flow (service accounts don't work for personal Gmail calendars); write to the primary calendar with every Yoh-created event tagged via a private extended property, always filtered on before update/delete, so Yoh only ever touches its own events.
- **Phase 3 voice stack** (settled direction, not urgent for Sept 2): Raspberry Pi 5 specifically (not 4/3), openWakeWord, whisper.cpp, Piper, over PipeWire's Bluetooth path.

## Known Risks

- **Silent OAuth token expiry (Phase 1, highest-priority trap).** If the Google OAuth consent screen is left in "Testing" mode instead of moved to "In production," refresh tokens auto-expire after exactly 7 days — the daily automation would look fine at setup and then quietly break about a week in with no obvious error. This must be a required setup step, not an afterthought.
- **Pi voice reliability is unproven (Phase 3, not urgent).** No real long-term data exists on false-wake rate, thermal behavior, or Bluetooth dropout under sustained daily use on a Pi 5. A short real-world spike test is warranted before committing further to the hardware build.
- **Phase 3 hardware shopping list is genuinely open.** [ASSUMPTION — flagged, not resolved: checked directly against the research and brainstorm material at the user's request.] The *architecture* is decided (Pi 5, openWakeWord/whisper.cpp/Piper, PipeWire Bluetooth, bedroom screen, waterproof bathroom speaker, 3D-printed case), but no specific mic, speaker, or display product has been chosen, and the bathroom-side mic/input solution is explicitly parked. This doesn't block the Sept 2 MVP, but it's a real gap to close before Phase 3 starts, not a solved problem being under-documented.

## Vision

Beyond the Sept 2 loop, the roadmap runs: a web app (retiring the CLI as primary interface) → the physical hardware build (Pi 5 in a 3D-printed bedroom case, waterproof Bluetooth speaker in the bathroom, a small sleep-friendly idle display) → an iOS app → the Research Vault with Perplexity integration and manual voice packs → self-calibrating task-duration estimates that learn from actual completion times. None of that is Phase 1's problem to solve, but Phase 1's codebase is meant to be built so none of it requires a rewrite to bolt on.
