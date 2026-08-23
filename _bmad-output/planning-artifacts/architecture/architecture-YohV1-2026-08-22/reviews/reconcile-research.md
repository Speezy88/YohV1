---
title: Reconciliation review — ARCHITECTURE-SPINE.md vs. technical research (voice pipeline / Notion / Calendar)
type: review
reviewed:
  - _bmad-output/planning-artifacts/architecture/architecture-YohV1-2026-08-22/ARCHITECTURE-SPINE.md
against:
  - _bmad-output/planning-artifacts/research/technical-yoh-voice-pipeline-and-notion-calendar-a-2026-08-21/research.md
also-checked:
  - _bmad-output/planning-artifacts/prds/prd-YohV1-2026-08-21/prd.md
  - _bmad-output/planning-artifacts/prds/prd-YohV1-2026-08-21/addendum.md
created: '2026-08-22'
verdict: minor gaps
---

# Reconciliation review: spine vs. research

## Overall verdict: **minor gaps** (one item borders on a real gap — a fabricated factual detail in the spine's Deferred section)

None of the issues below invalidate AD-4 or AD-10 as design decisions. The concerns are about (a) one specific fabricated claim, (b) how visibly the highest-severity research risk is surfaced, and (c) a couple of things the research flagged that didn't make it into the spine at all.

---

## 1. AD-4 (dedicated "Yoh Plan" secondary calendar) — legitimate architecture call, but not framed honestly against what research verified

**What research actually established:** the research's *verified, Google-documented, "practical" pattern* is **primary calendar + `extendedProperties.private` tagging**, with `calendar.events` scope (full read/write) — see research.md lines 82–83, 102. It explicitly states the `calendar.app.created` scope guarantee ("only touches what the app created") **only applies to a separate, app-owned secondary calendar**, and that "no comparative practitioner writeup was found weighing this against the dedicated-secondary-calendar alternative." The Open Questions section (line 109) is explicit: *"Whether 'primary calendar + extendedProperties tagging' or 'dedicated secondary calendar' is more common in practice ... was not resolved ... no practitioner consensus was found either way."*

**What the PRD did with that:** the PRD (§11 item 3) and its addendum both correctly routed this exact unresolved question to "architecture phase" — so the spine choosing the dedicated-secondary-calendar approach in AD-4 is *within its remit*, not a violation of a locked product decision. That part is fine.

**Where the framing falls short:** AD-4's rule text presents the dedicated-secondary-calendar + separate-scopes design as simply correct engineering ("a coding mistake that tried to write the primary fails at the API layer, not just at review") with no acknowledgment that:
- this is the *less-verified* of the two mechanically-valid options research found (the primary+tagging pattern is the one research calls "the practical, verified pattern" and "mechanically correct and Google-documented"; the secondary-calendar path is asserted by research only as theoretically sound, never checked against real-world practice), and
- the underlying `calendar.app.created` scope semantics (per research) restrict access to calendars **the app itself created via the API** — not necessarily any calendar whose ID is simply dropped into config. AD-4 says the "Yoh Plan" calendar's "calendar ID lives in config," which reads as if the calendar might be manually created by Spencer and its ID pasted into config, not necessarily created programmatically by the app. If that's the intended setup, `calendar.app.created` may not actually grant write access to it — this nuance isn't addressed anywhere in AD-4 or its Deferred follow-up.

Net: AD-4 is a legitimate architecture decision the PRD asked for, but it's stated with more confidence than the research supports, and doesn't flag that it's choosing the *less-validated* of two options, or the app-created-calendar mechanics that could undermine the scope-separation guarantee it leans on.

## 2. Fabricated detail in AD-4's Deferred item — no such claim exists in the research

The spine's Deferred section states:

> "Exact 2026 Google Calendar OAuth scope names for the primary-read / 'Yoh Plan'-write split (AD-4) — **Google added four new finer-grained Calendar scopes in 2026** whose exact names this run didn't resolve; verify against current docs before implementing FR-21/FR-22."

I searched research.md, prd.md, and addendum.md for any mention of "four new," "finer-grained," or new 2026 Calendar scopes — **there is none**. The research only discusses the pre-existing `calendar.events` and `calendar.app.created` scopes (source [28], a 2026-07-22-dated Google auth docs page, cited only for the tagging pattern, not for any scope additions). This specific "four new scopes added in 2026" claim appears to be invented by the spine, not carried forward from research. It should either be removed or re-derived from an actual source before build — as written it risks sending whoever implements FR-21/FR-22 looking for scopes that were never reported to exist.

## 3. Highest-severity research finding (OAuth "In production" / 7-day token expiry) — present, but under-weighted relative to its severity

The research is unambiguous that this is *the* single highest-risk item for the Sept 2 MVP (Executive Summary, Cross-Dimension Insights, and Recommendation #2 all call it out; Recommendation #2 explicitly says "should be treated as a required setup step, not an afterthought"). The spine does capture it, verbatim in substance, as a Deferred bullet:

> "OAuth production-mode verification — the Google OAuth consent screen must be flipped to 'In production' before/at launch or refresh tokens silently expire after 7 days. Highest-severity Sept 2 risk; verify before FR-20/FR-21/FR-23 go live. Owner: Spencer."

That's accurate and correctly labeled "highest-severity." The gap is structural, not factual: it sits as one bullet among ten in a flat Deferred list, alongside much lower-stakes items (e.g., FR-2's tie-break weighting). There's no AD, no NFR, and no line in "Deployment & environments" or the Capability→Architecture Map that would surface this at the moment FR-20/21/23 are actually being built or before the system is declared "done" — nothing that functions as a build-time gate rather than a to-do note. Given research explicitly frames this as the kind of failure that "looks fine at first and quietly breaks later," a spine whose whole purpose is to keep build-time work consistent arguably should give this more structural weight than a bullet indistinguishable from a tuning parameter.

## 4. AD-10 (refresh-token persistence) — correctly captured

This one lands well. Research (line 89): "developers building unattended scheduled scripts commonly report needing to manually persist the refreshed token back to storage (the client library's automatic refresh doesn't do this on its own)." AD-10's rule — "the Google OAuth refresh token — is persisted exclusively by `storage-adapter.ts`, rewritten immediately after every refresh; no other adapter caches or persists it" — directly and correctly addresses this gotcha, and AD-10's own "Prevents" line names the research finding explicitly. No issue.

One thing not carried forward (minor, optional): research also flags that some tokens "go stale after ~6 months of disuse even in production mode," suggesting a periodic keep-alive job. Since Yoh's ritual-cli runs twice daily, this risk is likely moot in practice — but it's not mentioned anywhere (not even in Deferred), so it's worth a one-line note if it's judged truly a non-issue, rather than silently dropped.

## 5. Notion guidance — mostly correctly carried forward, two things dropped

Correctly carried into Deferred:
- Internal-integration-token auth pattern flagged as medium-confidence, needing a docs check before build — matches research exactly (line 68/135, [18]).
- Formula-property read-only status and UTC-default timezone-filter behavior flagged as "search-snippet-level confidence" needing a direct-docs check — matches research (Open Questions, line 110).

Not carried forward (both minor, both defensible to omit at architecture altitude, but worth flagging since the task asked specifically):
- **Rollup properties are explicitly documented as not updatable** (research line 64, high confidence — not just a "check later" item, a settled fact). The spine never states this constraint anywhere (not in AD-10's config/secrets scope, not in the notion-adapter.ts capability description, not in Deferred). Given FR-23 only writes Task Status (typically a status/select property), this is low current risk, but it's a settled finding research handed over cleanly and the spine simply doesn't mention it.
- **Recheck the current Notion API version before build.** The research's own Staleness Map flags the Notion API version (`2026-03-11`) as "due for recheck" specifically because the Sept 2 build window falls inside that claim's 1-month freshness window (research line 176: "worth a 2-minute live-docs recheck on the Notion API version ... at build time, not just trusting this report's snapshot"). This is a time-sensitive, research-flagged action item and doesn't appear anywhere in the spine's Deferred section, even though it's exactly the kind of "verify before build" item the Deferred section otherwise collects (cf. the Notion internal-integration-token item, which is analogous and was kept).

The ~3 req/s rate limit is correctly *not* elevated to an architectural concern — research itself calls it "trivially within budget," and the spine doesn't over-engineer around it. That's the right call, not a gap.

## 6. Stack table versions — no misattribution found, but worth confirming explicitly

Checked whether the spine's Stack table (Node.js 24.12+, TypeScript 7.0.2, @notionhq/client ^5.22.0, @googleapis/calendar ^16.0.0, google-auth-library ^11.0.2, better-sqlite3 ^13.0.3, nodemailer ^9.0.5) claims or implies these came from the research. It does not — the Stack table carries no citations and no "per research" language, and the surrounding prose never attributes these specific package versions to the research document. This is correct: the research document never mentions Node.js, TypeScript, better-sqlite3, or nodemailer at all, and while it does discuss the Notion API version (`2026-03-11`, a versioned HTTP header, not an npm package version) and Google Calendar's `calendar.events`/`calendar.app.created` scopes, it never mentions npm package version numbers for `@notionhq/client`, `@googleapis/calendar`, or `google-auth-library` either. So there's no misattribution — but it's also true none of these specific version pins (including the Notion/Calendar client library versions) are research-verified; they're architecture-team choices made independently, which is fine as long as no one later assumes the research checked them. Recommend treating all Stack-table version numbers as "verify current at implementation time" regardless of source, same as the Notion API version issue in §5 above.

## 7. Phase-3 voice pipeline scope — correctly excluded, correctly preserved

The spine's frontmatter scope line explicitly excludes "hardware voice pipeline" from Phase 1, and the Deferred section's final bullet correctly preserves the research's Phase-3 recommendation set (openWakeWord, whisper.cpp, Piper, Raspberry Pi 5, PipeWire) verbatim, labeling it "settled direction per the technical research but out of this spine's scope." This matches research's own framing (Cross-Dimension Insights: "the roadmap already correctly deferred [Phase 3] past the MVP — this research validates that sequencing decision"). No issue — this is the cleanest area of the reconciliation.

---

## Summary table

| Check | Verdict |
| --- | --- |
| AD-4 dedicated-secondary-calendar vs. research's verified primary+tagging pattern | Legitimate (PRD explicitly deferred this to architecture) but stated more confidently than research supports; doesn't flag it chose the less-validated option or the app-created-calendar mechanics risk |
| AD-4's Deferred item ("four new finer-grained Calendar scopes in 2026") | **Fabricated** — no such claim exists anywhere in the research, PRD, or addendum |
| OAuth "In production" / 7-day expiry | Captured accurately, but as a flat Deferred bullet with no structural build-time gate despite being research's #1-severity finding |
| AD-10 refresh-token persistence | Correctly captured, matches research precisely |
| Notion internal-integration-token, timezone/formula uncertainty | Correctly carried forward |
| Notion rollup-property read-only fact; Notion API version recheck-before-build | Both dropped — settled/flagged findings that didn't make it into the spine at all |
| Stack table package versions | Not misattributed to research (research doesn't cover these); but also not research-verified — worth a build-time check like everything else version-related |
| Phase-3 voice pipeline scope exclusion | Clean — correctly excluded from Phase 1, correctly preserved in Deferred |
