---
title: PRD Addendum: Yoh
created: 2026-08-22
updated: 2026-09-16
status: final
---

# PRD Addendum: Yoh

Companion to `prd.md`. Holds implementation-adjacent detail that came up while finalizing the PRD but doesn't belong in the capability-level FR text — deferred numeric parameters, technical dependency-verification items, and rationale that's useful context for architecture without being a behavioral requirement itself. Not a substitute for the brief's own `../../briefs/brief-YohV1-2026-08-21/addendum.md`, which covers the deeper technical-how (API endpoints, auth mechanics, hardware stack) — this file is PRD-scoped only.

## Deferred Implementation Parameters

These FRs specify direction and behavior in `prd.md`; the exact numbers are intentionally left for architecture/build, where they can be tuned against real data rather than guessed here.

- **FR-2 (Derived Priority) — secondary-factor weights.** Primary axis (Due Date proximity adjusted by Estimated Duration) is fixed by the PRD. The weighted score across Area, Energy fit, and difficulty that breaks ties beneath it needs real weight values — start with an even split across the three and tune after a few weeks of real Plans, rather than trying to guess correct weights up front.
- **FR-11 (Slip-Bump) — increment curve and cap.** Escalating-then-capped shape is fixed. A reasonable starting curve: small bump on slip 1, roughly double on slip 2, cap reached by slip 3-4. Needs to feel "escalating but never punishing" in practice — revisit after real slip data exists.
- **FR-17 (Self-Check) — low-score threshold.** A single low score shortens the check-in interval; what counts as "low" on whatever scale the score uses (assume 1-10 unless decided otherwise at build time) needs a concrete cutoff. Bias toward a threshold that under-triggers rather than over-triggers initially — Self-Check firing too often is itself an Escalate-Under-Strain violation.

## Technical Dependency Verification (pre-implementation)

Carried forward from reconciliation against the brief's addendum and the technical research — action items to verify before or during the relevant FR's implementation, not open design questions:

- **OAuth production-mode status** — Google's OAuth consent screen must be in "In production" mode before/at launch, or refresh tokens silently expire after 7 days (Testing-mode default). Highest-severity September 2, 2026 risk named in both the brief's addendum and the technical research. Verify and flip before FR-20/FR-21/FR-23 go live.
- **Notion internal-integration-token auth pattern** (medium confidence) — FR-20 (read Tasks/Projects) and FR-23 (write Task Status) both depend on this pattern working as the research described. Confirm against Notion's current docs before build.
- **UTC-default timezone filtering, formula-property read-only status, service-account/personal-calendar constraint** — all medium-confidence claims from the brief's addendum underpinning FR-20–FR-23. Direct-docs check recommended before implementation.
- **Calendar-read freshness** — the brief's addendum rejected ICS-based reads in favor of live Calendar API reads specifically for freshness/latency reasons; FR-21 assumes near-real-time reads. No explicit NFR number attached (the PRD's Latency NFR covers plan-generation compute time only) — worth a stated freshness target (e.g., "reflects changes made in the last N minutes") at architecture time if it turns out to matter in practice.
- **Primary calendar + tagging vs. dedicated secondary calendar** — open per PRD §11 item 3; affects FR-22's implementation approach, not its behavior contract.

## Architecture Guidance (non-binding)

- **Modularity for the roadmap.** The brief's differentiator that Yoh is "architected for the roadmap" (Phase 2 web app, Phase 3 hardware, Phase 4 iOS, Phase 5 Research Vault) isn't a testable FR — it's a constraint on *how* Phase 1 is built, not what it does. Concretely: keep the planning/ritual logic (Derived Priority, Slip-Bump, Escalate-Under-Strain, Propose-Don't-Impose) decoupled from the CLI presentation layer, so Phase 2+ surfaces can call the same core logic instead of forking it.
- **Pi voice-reliability spike.** The brief recommends an early spike test of voice reliability on Raspberry Pi hardware before committing to the Phase 3 architecture direction. Not Phase 1 work, but worth scheduling before Phase 3 planning locks in a hardware approach.

## Canvas API Integration (parked, pending access)

Captured 2026-09-16 while parking the Canvas LMS assignment sync in `prd.md` §9.2/§11 — quick research done up front so this is ready to pick up once school API access is granted, not a specified design yet.

- **What the API offers.** Canvas's REST API exposes assignment data two ways: an `assignments` endpoint, and a `calendar_events` endpoint that can return assignments as calendar-style events with due dates in an `all_day_date` field. Either is usable for "read assignment due dates"; the calendar_events shape also carries assignment-override data (which students/sections an assignment applies to) that Spencer's personal-use case doesn't need.
- **Auth is the actual blocker.** Canvas uses OAuth2 (RFC-6749) via a Developer Key (client ID/secret pair) that must be registered in the school's Canvas instance — for a hosted school instance, that requires the school's Canvas admin to issue it. That approval step, not any technical complexity, is what's currently pending. Once issued, tokens expire in ~1 hour and require the standard refresh-token flow — the same maintenance class as the Google OAuth integration already in Yoh (§6 Observability's "auth expired" failure mode applies here too, once built).
- **Design direction chosen (not yet built).** Canvas assignments sync into Notion Tasks rather than becoming a second Task-input path Yoh reads directly at plan-time. This means FR-20's existing Notion read, FR-4's Data-Completeness Gate, and FR-2's Derived Priority all apply to Canvas-sourced Tasks with zero new code — the sync only needs to create/update the Task's name, Due Date, and Area (mapped from the Canvas course); Estimated Duration and Energy are left blank for Spencer to fill via the existing Gate, exactly as any other incomplete Task today.
- **Left undecided (revisit when unblocked):** the course → Area mapping convention (one Canvas course per Area, or several courses folded into one Area); the dedup/update strategy when a previously-synced assignment's due date changes or the sync runs again (avoid duplicate Notion Tasks); and whether the sync runs as part of the Morning Ritual's existing read step or as its own separate scheduled job.
- **Next step once Canvas API access is granted — BMad path.** All 5 of Yoh's epics are `done` (`sprint-status.yaml`) and the architecture spine (`architecture-YohV1-2026-08-22/`) is finalized, so this isn't a fresh planning cycle — it's a small scoped addition on top of a shipped system:
  1. **Resolve the three undecided items above first** (course→Area mapping, dedup/update strategy, sync trigger point) — either talk them through with `bmad-prd` (update intent, quick) or just decide inline with whoever picks this up; they're small enough not to need a dedicated session.
  2. **`bmad-architecture`** — only if the sync ends up needing new architectural surface (e.g., a new scheduled-job pattern distinct from the existing Morning/Night Ritual cron, or a new credential-storage shape for the Canvas token). Skip it if the sync just reuses the existing Notion-write path and OAuth-token-storage pattern already in place for Google/Notion — check the spine before assuming a new pattern is needed.
  3. **`bmad-create-epics-and-stories`** — add a new epic (e.g. Epic 6) for the Canvas Sync to `epics.md`, sized as its own epic rather than folded into an existing done one.
  4. **`bmad-sprint-planning`** — re-run to fold the new epic's stories into `sprint-status.yaml` alongside the existing (done) epics.
  5. **`bmad-build`** per story, same as every other epic in this project.
  Skip straight to step 3 if the three undecided items turn out trivial in practice — don't let this ceremony gate a genuinely small addition.

## Notes

Nothing in this addendum overrides `prd.md`. Where this file states rationale or a starting point, `prd.md`'s FR text is still the binding contract; this is supporting detail for whoever (Spencer, wearing the architect/dev hat) picks up implementation next.
