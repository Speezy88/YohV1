---
title: "Reconciliation Check: PRD vs Brief"
created: 2026-08-22
---

# Reconciliation Check: PRD vs Brief (Yoh)

**Inputs compared:**
- PRD: `_bmad-output/planning-artifacts/prds/prd-YohV1-2026-08-21/prd.md`
- PRD addendum: **not found** — the PRD folder contains only `.memlog.md` and `prd.md`; no `addendum.md` exists despite the PRD repeatedly citing one (see Gap 1 below).
- Source brief: `_bmad-output/planning-artifacts/briefs/brief-YohV1-2026-08-21/brief.md`

## Overall Verdict

The PRD is a faithful, unusually thorough conversion of the brief. Every concrete mechanic in the brief's Solution section (Morning/Night ritual, Derived Priority, Slip-Bump, Data-Completeness Gate, Time Budget, Work/Break rhythm, Mid-Day Re-Flow, Dual/Hot-Cold Memory, Self-Check, Escalate-Under-Strain, Propose-Don't-Impose) is captured with a matching FR, correct numeric values (70/15, capped-at-two escalation, ~4-day Self-Check), and no contradictions found. Phase-1 scope and the explicit Phase-1 exclusions (hardware, iOS, web app, Research Vault + Perplexity, voice packs, self-calibrating estimates) are carried forward intact and correctly re-sequenced into named phases (2–6). The PRD's own Open Questions/Assumptions Index is honest about where it added inference beyond the brief (FR-2 weighting formula, FR-11 cap curve, FR-13's home-speaker mechanism — the last a genuinely sharp catch, since the brief asserts this Phase-1 escalation channel while its own mechanism belongs to deferred Phase-3 hardware).

That said, a few things from the brief did not survive the FR-structured conversion cleanly:

## Gaps Found

1. **Referenced `addendum.md` does not exist, so the brief's Technical Foundations content has no home in the PRD deliverables.** The PRD's own Document Purpose (§0), §5.7, and §9.2 all state that technical-how detail — Notion's internal-integration-token auth model, the "Query a data source" endpoint, explicit timezone handling, Google Calendar's OAuth 2.0 user-consent requirement (service accounts explicitly ruled out), and the private-extended-property tagging mechanism that keeps Yoh from touching non-Yoh calendar events — "lives in `addendum.md`, not here." No such file was created. The brief's entire "Technical Foundations" section (its most concrete, decision-bearing technical content) is consequently absent from the PRD artifact set, not merely deferred to a companion doc.

2. **"Architected for the roadmap it names" — one of the brief's four explicit differentiators from v1 — has no enforceable counterpart in the PRD.** The brief states this as a first-class design discipline: the codebase must be built modularly enough that voice, hardware, a web app, and the Research Vault bolt on later without a rewrite, "a stance made explicit now so early implementation choices don't foreclose it." The PRD's §1 Vision mentions modularity narratively ("treats the phases past it as constraints on *how* Phase 1 is built (modularly)"), but §6 Cross-Cutting NFRs enumerates only Reliability, Data integrity, Latency, and Observability — no Extensibility/Modularity NFR or FR gives this teeth. As written, nothing in the PRD's testable requirements would catch an architecture decision that quietly forecloses Phase 2+.

3. **The brief's named two-part failure taxonomy ("Friction" and "Bad plans") is dropped as an explicit structure.** The brief calls out that these are the two specific, named risks version one failed on, and states every subsequent design decision is chosen to address one or the other "not left as vague aspirations." The PRD's Why Now / Vision sections reference the v1 failure narratively but never carry forward this two-part taxonomy, so a downstream reader (architecture, epics/stories) can't trace which FRs address "Friction" vs which address "Bad plans" the way the brief intended as its organizing diagnostic.

4. **Minor — persona framing narrowed.** Brief: "Default is a casual, peer-level *secretary*." PRD (§5.6, Glossary): "casual, peer-level *register*." The relational framing ("secretary") is dropped in favor of a purely stylistic description. Likely inconsequential, but it's a qualitative nuance the FR structure silently flattened.

5. **Minor — a brief recommendation vanished rather than being deferred on record.** The brief's Known Risks section recommends "a short real-world spike test... before committing further to the hardware build" to de-risk Pi voice reliability. Since this is Phase 3, its absence from the PRD is defensible, but unlike the other Phase-3-adjacent risk (hardware shopping list, carried into §9.2 and Open Question §11.5), this specific recommended action isn't logged anywhere in the PRD for later pickup.

## Non-Gaps (checked, confirmed consistent)
- Single-user/permanent-constraint framing — consistent (Brief "Who This Serves" ↔ PRD §3.2, §8).
- Numeric parameters (70/15 default, weekend persistence, ~4-day Self-Check with score+reason, two-attempt escalation cap) — all match, no contradictions.
- Phase-1 in/out scope lists — match brief's Scope section field-for-field, with two additions (Recurring Calendar events, Room-cleanliness camera) that trace to the brief's own referenced addendum rather than being fabricated.
- OAuth "Testing mode" 7-day silent-expiry trap — explicitly carried into §6 Observability NFR.
- "It's not just X, it's Y" tone ban — explicitly carried into FR-18.
- Escalate-Under-Strain as the unifying mechanic across retries/bumps/tone/check-in frequency — preserved as a first-class Glossary term and threaded through FR-11, FR-13, FR-17, FR-19.
