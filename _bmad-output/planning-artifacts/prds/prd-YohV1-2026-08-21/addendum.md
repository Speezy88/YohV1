---
title: PRD Addendum: Yoh
created: 2026-08-22
updated: 2026-08-22
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

## Notes

Nothing in this addendum overrides `prd.md`. Where this file states rationale or a starting point, `prd.md`'s FR text is still the binding contract; this is supporting detail for whoever (Spencer, wearing the architect/dev hat) picks up implementation next.
