---
title: Reconciliation Check — PRD vs Brief addendum.md
created: 2026-08-22
---

# Reconciliation: PRD (prd.md) vs Brief `addendum.md`

**Inputs compared:**
- `prds/prd-YohV1-2026-08-21/prd.md`
- `prds/prd-YohV1-2026-08-21/addendum.md` — **does not exist** (checked; only `.memlog.md` and `prd.md` are present in that folder). No PRD-side addendum to reconcile against.
- `briefs/brief-YohV1-2026-08-21/addendum.md` — the source technical-how document under test.

**Framing:** the brief's `addendum.md` is explicitly technical-how (API endpoints, auth mechanics, hardware stack) and is *not* supposed to be duplicated in the PRD. The bar here is not "is every line mirrored" — it's whether (a) any technical constraint should have shaped a requirement/NFR but didn't, (b) any dependency/gap the addendum calls out is properly flagged as an Open Question / `[NOTE FOR PM]`, and (c) anything is contradicted.

## Overall verdict

Strong reconciliation. The PRD correctly keeps implementation mechanics out of its body, and the one dependency gap the brief addendum most clearly implies — the Phase-1 "home speaker call-out" escalation channel (FR-13) depending on Phase-3 hardware that doesn't exist yet — is unusually well handled: it's flagged in three separate places (§5.4 FR-13 inline `[ASSUMPTION]`, §9.2 `[NOTE FOR PM]`, §11 Open Question #1, and §12 Assumptions Index). No outright contradictions were found between the two documents.

Three smaller items are worth the PM's attention, ranked by significance.

## Findings

### 1. (Moderate) OAuth "In production" status — named the addendum's highest-confidence, highest-severity Sept-2 risk, but the PRD only cites it as narrative, not as an actionable item

Brief `addendum.md` states, at its highest confidence tier ("critical, high-confidence, primary-source-verified"): if the Google OAuth consent screen is left in "Testing" status, refresh tokens auto-expire after exactly 7 days regardless of use — "the single highest silent-failure risk to the Sept 2 MVP specifically."

PRD §6 Cross-Cutting NFRs (Observability) references this: "This directly counters the OAuth 'Testing mode' 7-day silent-expiry trap named in the brief's Known Risks." But that's the NFR's *justification* for building failure-surfacing (detect-after-the-fact), not a requirement to actually move the consent screen to "In production" (prevent-up-front) before launch. As written, a build could satisfy every FR/NFR in this PRD, ship with the consent screen still in "Testing," and hit exactly the failure mode the addendum calls out as the top risk to the hard deadline.

**Suggestion:** add a line to §7 Constraints and Guardrails or §11 Open Questions (or a pre-launch checklist item) making "OAuth consent screen verified as 'In production' before Sept 2" an explicit, checkable pre-launch condition — not just implicit motivation for an NFR.

### 2. (Minor) Live-API-vs-ICS constraint isn't reflected as a Calendar-read freshness NFR

Brief `addendum.md` explains that ICS/iCal subscribe-by-URL was evaluated and rejected as the Calendar read mechanism specifically because refresh latency (8–24h, sometimes up to 48h, no SLA) is "unacceptable for same-day plan generation" — live API reads are required.

PRD §6 Latency NFR covers only *generation compute time* ("Plan generation must complete comfortably before the Morning Ritual notification is due"), not *source-data freshness* for the Calendar read itself. FR-21's consequence ("A fixed Calendar event added or changed before Morning Ritual runs is reflected in that day's Plan") comes close but is framed as a functional guarantee, not an explicit NFR ruling out a cached/batched feed. The underlying technical reason (why live API access is architecturally required, not optional) doesn't surface anywhere in the PRD as a stated constraint.

**Suggestion:** low priority, since FR-21 already functionally implies live/near-real-time reads. Could tighten by adding a clause to the Latency NFR or FR-21's consequences making the "no stale/batched Calendar feed" requirement explicit, so a future implementer isn't tempted toward ICS for simplicity.

### 3. (Minor/cosmetic) Phase 5 roadmap detail dropped

Brief `addendum.md`'s Full Phase Roadmap bundles "browser-access search surfaced on the hardware device screen" into Phase 5 alongside Research Vault + Perplexity integration and manual voice packs. PRD §9.2 Out of Scope lists "Research Vault + Perplexity integration — Phase 5" and "Manual Voice Packs — Phase 5" but omits the browser-access-search item entirely.

This is explicitly a loosely-bundled, low-specificity aside in the source ("loosely bundled") describing a Phase 5+ feature with no bearing on Phase 1 scope, NFRs, or Open Questions — flagging it mainly for completeness of the phase-roadmap mirror, not because it should change any requirement.

## Non-findings (checked, no issue)

- **No contradictions found.** Numeric/behavioral details that appear in both documents align: 70/15 Work/Break default, single-user/single-workspace scope, Sept 2 2026 deadline, recurring-events explicitly out of scope with the addendum's RRULE gotchas correctly deferred (PRD §9.2 cites this near-verbatim), Phase numbering (1–6 plus long-term camera) matches exactly between the two roadmaps.
- **Notion technical details** (internal integration token, Query-a-data-source endpoint, rate limits, PATCH semantics, rollup/formula read-only status, UTC-default timezone filter, API version, SDK choice) are correctly excluded from the PRD body and correctly summarized at capability level in FR-20, with the two medium-confidence claims (UTC timezone default, formula read-only) explicitly carried into PRD §11 Open Question #6 for a pre-implementation docs check.
- **Google Calendar write-isolation mechanism** (extended-property tagging, since no `calendar.app.created`-equivalent scope exists for the primary calendar) is correctly kept out of the PRD body; FR-22 captures the *behavioral* guarantee (never touch a non-Yoh-owned event, ownership check before every write) without leaking the tagging implementation, which is the right altitude for a PRD.
- **Wake-word/STT/TTS stack and hardware shopping-list status** (Phase 3) are correctly deferred; PRD §9.2 notes "Architecture direction already researched... but no product-level parts chosen yet," matching the addendum's own hedging, and Open Question #5 carries the unchosen hardware forward without pretending it blocks Phase 1.
- **Options Considered and Rejected** section of the addendum (clock-based breaks over task-aligned, no silent-defaulting, no proactive mid-block pings, no auto-switching voice packs, `calendar.app.created` scope rejected) all map cleanly onto PRD FRs/Non-Goals (FR-6, FR-4, FR-9, §5.6 Out of Scope, FR-22) with no loss of intent.
- **PRD-side addendum.md**: does not exist in the PRD's folder, so there is no second document to check for internal PRD/PRD-addendum contradiction — only the brief's addendum was in scope, per the brief-addendum-vs-PRD comparison requested.
