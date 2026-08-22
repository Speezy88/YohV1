---
title: Input-Reconciliation Check — PRD vs. Technical Research
created: 2026-08-22
input_prd: prd.md (updated 2026-08-21)
input_research: ../../research/technical-yoh-voice-pipeline-and-notion-calendar-a-2026-08-21/research.md
input_addendum: none found in prd folder (checked; brief's addendum.md read as secondary context)
---

# Input-Reconciliation: PRD vs. Technical Research

## Method

Read `prd.md` in full (no `addendum.md` exists in the PRD folder — only `.memlog.md` and `prd.md` are present). Read the technical research report in full. Cross-checked every research claim that bears on product-level requirements (FRs, NFRs, Constraints, Open Questions) against the PRD's actual text, and separately verified the brief's own `addendum.md` (which the PRD's Open Question §11.6 cites) since it is itself a distillation of `research.md`.

## Overall Assessment

The PRD does a genuinely good job of porting research findings forward — FR-22's Calendar write-isolation design matches the research's `extendedProperties` tagging recommendation exactly, the NFR-Observability bullet explicitly names the OAuth "Testing mode" 7-day silent-expiry trap, §9.2's Recurring-Calendar-events exclusion matches the research's RRULE gotchas, and Open Question §11.1 (FR-13's "home speaker call-out" gap) is an accurate, well-reasoned read of what the research did and didn't resolve. This is not a PRD that ignored its research input.

That said, five gaps are worth flagging before finalize.

## Gaps Found

### Gap 1 — The single highest-risk item the research identified isn't captured as an explicit action item

The research's Executive Summary and Cross-Dimension Insights both single out one thing: the OAuth consent screen must be moved to **"In production"** status, because leaving it in "Testing" silently expires all refresh tokens after exactly 7 days — described verbatim as *"the single highest-risk item for the Sept 2 MVP"* and *"Recommend explicitly checking this before considering the MVP 'done.'"* (research.md, Cross-Dimension Insights + Recommendation #2).

The PRD's NFR-Observability bullet (§6) references the *symptom* — "This directly counters the OAuth 'Testing mode' 7-day silent-expiry trap named in the brief's Known Risks" — as a reason Yoh must surface auth failures rather than go quiet. But that's a detection requirement, not the actual preventive fix. Nowhere in the PRD (Constraints §7, Open Questions §11, or MVP Scope §9.1) is there an explicit, checkable item requiring the consent screen be set to Production before Yoh is considered shipped — even though SM-2 ("MVP shipped and in daily use by September 2, 2026") would silently fail exactly 7 days after a Testing-mode launch if this is missed. Given the research calls this out this emphatically, it deserves a line of its own — e.g., as a Constraint, an Open-Questions checklist item, or a precondition on SM-2 — rather than being folded entirely into a general observability requirement.

### Gap 2 — Open Question §11.6 omits the one medium-confidence claim that underlies FR-20 entirely

PRD Open Question §11.6 reads: *"Several technical claims underpinning Notion/Calendar integration (UTC-default timezone filtering, formula-property read-only status, the service-account/personal-calendar constraint) are sourced at medium confidence... worth a direct-docs check before FR-20–FR-22 are implemented."*

That's an accurate list of three of the research's flagged medium-confidence items — but it omits a fourth, arguably more foundational one: the **Notion internal-integration-token auth pattern itself** is explicitly flagged in the research as medium confidence ("sourced via search snippet, never independently fetched... worth a 2-minute direct check" — Recommendations §1; also listed in the Staleness Map's "due for recheck" auth row is the Calendar pattern, while the Notion internal-integration auth pattern is separately called out at Recommendations §1). This is the mechanism FR-20 (Read Notion Tasks and Projects) depends on entirely — if the auth pattern recommendation were wrong, FR-20 wouldn't work at all, which is a higher-stakes gap than the three narrower field-behavior caveats currently listed. Worth adding to §11.6 or as its own line.

### Gap 3 — An NFR references writing to Notion, but no FR governs it

NFR §6 (Data integrity) states: *"Writes to Calendar or Notion must never corrupt or lose Task/Calendar data, and must never touch a record Yoh doesn't own (FR-22)."* This explicitly assumes Yoh writes to Notion.

But §5.7 (Notion & Calendar Integration) only defines FR-20 (read Notion Tasks/Projects), FR-21 (read Calendar), and FR-22 (write Calendar, with ownership isolation) — there is no FR for writing to Notion at all. The research report, by contrast, explicitly discusses the Notion write path (`PATCH /pages/{id}` for "marking a task's Status, bumping its priority signal," with the caveat that rollup properties are documented as non-updatable and formula properties should be treated the same way — research.md, Notion API, Integration & interoperability). That constraint is only relevant if Yoh actually writes Task Status (or anything else) back to Notion after a Night Ritual close-out — and the PRD never establishes whether it does. FR-12's consequence only says close-out data "feeds Derived Priority, Slip-Bump, and memory" — all internal to Yoh — leaving genuinely ambiguous whether Spencer's Notion Tasks DB ever reflects "Done" status, or whether Spencer must still update Notion by hand. This is either an internal PRD inconsistency (the NFR references a write surface with no corresponding FR) or a real unaddressed requirement; either way, the research's Notion-write caveat is currently a dangling reference with nothing in the PRD to attach to.

### Gap 4 — Research's own unresolved calendar-pattern question isn't carried into the PRD's Open Questions

The research's Open Questions section states plainly: *"Whether 'primary calendar + extendedProperties tagging' or 'dedicated secondary calendar' is more common in practice for personal Calendar automations was not resolved — both are mechanically valid... no practitioner consensus was found either way."*

The PRD (via the brief) already committed to the primary-calendar + tagging approach, and FR-22 reflects that choice correctly — so this isn't a contradiction. But it is a live, named unresolved question in the research that has product-visible consequences (whether Yoh's Plan Block events show up mixed into Spencer's real calendar view vs. a separate one he'd have to explicitly check) that the PRD's Open Questions section — which otherwise carries forward nearly every other research caveat faithfully — doesn't mention at all. Worth at least a one-line Open Question noting the decision was made without practitioner-consensus backing, even if it's not being revisited.

### Gap 5 (minor) — FR-13's Open Question may understate the size of the gap it names

Open Question §11.1 and the FR-13 `[ASSUMPTION]` both correctly state the mechanism is unspecified and call it something that "needs its own small technical decision before implementation." Given the research treats the *entire* audio-output pipeline (wake-word engine, TTS, Bluetooth speaker bridging) as Phase 3, undelivered hardware/software — not just an unpicked product SKU — a "home speaker call-out" in Phase 1 may not be a small technical decision so much as a question of whether it's achievable at all without pulling forward Phase 3 work. This doesn't contradict the PRD's flag (which is directionally correct and already the most thorough part of the reconciliation), but "small" may be undercalibrated language worth revisiting when this Open Question is actually resolved.

## What the PRD Gets Right (no gap)

- **FR-13 / Open Question §11.1 / Assumptions Index / §9.2 `[NOTE FOR PM]`**: This is an accurate reflection of what the research did and didn't resolve. The research genuinely says nothing about a Phase-1, hardware-independent mechanism for a "home speaker call-out" — it treats the full voice/speaker stack as Phase 3-only. The PRD's characterization of this as a real dependency gap needing resolution before FR-13 implementation is correct and not overstated (see Gap 5 above for the one nuance).
- **FR-22 / NFR Data integrity (Calendar half)**: Matches the research's `calendar.events` + `extendedProperties` tagging recommendation and the "no scope restricts to only-my-events on primary calendar" finding precisely.
- **§9.2 Recurring Calendar events exclusion**: Matches the research's RRULE/silent-no-op gotchas, correctly deferred.
- **NFR Reliability/Observability**: Correctly ties the "surface failures, don't go silent" requirement to the OAuth 7-day expiry trap (see Gap 1 for the one piece still missing — the preventive action itself).
- **§7 Cost constraint**: Consistent with research's finding that Notion/Calendar quotas are generous and free at personal scale — no contradiction.

## Contradictions Found

None. No case was found where the PRD assumes something the research found infeasible, or vice versa.
