---
title: Input Reconciliation — PRD vs. Brainstorm
created: 2026-08-22
scope: prd-YohV1-2026-08-21 vs brainstorm-yoh-notion-daily-assistant-2026-08-21
---

# Reconciliation: PRD vs. Brainstorm Intent

**Inputs compared:**
- `/Users/spencerhatch/Documents/GitHub/YohV1/_bmad-output/planning-artifacts/prds/prd-YohV1-2026-08-21/prd.md`
- `addendum.md` in the same PRD folder — **does not exist** (only `prd.md` and `.memlog.md` are present). No addendum content to reconcile.
- `/Users/spencerhatch/Documents/GitHub/YohV1/_bmad-output/brainstorming/brainstorm-yoh-notion-daily-assistant-2026-08-21/brainstorm-intent.md`

**Overall:** The PRD is a largely faithful, well-structured conversion of the brainstorm — vocabulary, the escalate-under-strain/propose-don't-impose framing, the phase roadmap, the six-item risk table, and most decided rules carry through cleanly and are traceable via the Glossary and FR consequences. The gaps below are the specific places where fidelity slips: one direct contradiction, two silently-dropped decided items, one softened absolute rule, and one unresolved brainstorm question that didn't make it into the PRD's Open Questions.

---

## Gap 1 — Contradiction: what Phase 2's web app "retires"

**Brainstorm (Roadmap item 2):** "Web app — polished, intuitive web app; **retires Google Calendar as the primary interface**."

This only makes sense in light of Phase 1's framing of Calendar as *"a temporary bridge"* — i.e., in the brainstorm's model, Calendar-as-written-plan is functioning as Spencer's de facto viewing surface during Phase 1, and the web app is what replaces that role in Phase 2.

**PRD (§9.2):** "**Web app** — Phase 2, would retire **the CLI** as primary interface."

This says the opposite thing retires: not Calendar, but the CLI. The PRD's own §9.1 does establish "Terminal/CLI interface — the only surface for Phase 1," which is a plausible read, but it silently overwrites the brainstorm's explicit, decided phrasing without a note, an `[ASSUMPTION: …]` tag, or an Open Question entry. A downstream reader (architecture, epics) would reasonably plan Phase 2 around "retire the CLI" without knowing the source material said something different about Calendar's role.

**Recommendation:** Either tag this as an explicit assumption/reinterpretation in §12, or resolve which reading is correct with Spencer before it propagates into architecture.

---

## Gap 2 — Dropped qualitative tone guardrail (Future Autopsy failure mode)

**Brainstorm (Tone / Persona):** "**Concrete failure mode to avoid** (from Future Autopsy): verbose, generically 'AI-ey,' too professional/corporate instead of cool. This reinforces the casual-peer-secretary default." This is also named directly in the Risks table: "friction: personality/quality mismatch... Casual peer-secretary default tone; explicit avoidance of verbose/generic-AI/corporate voice (Future Autopsy failure mode)."

This is exactly the kind of qualitative, hard-to-FR-ify style rule the reconciliation was asked to watch for. It's stated as a specific, named failure mode (not a vague aspiration) that directly justifies the tone default.

**PRD (§5.6, FR-18/FR-19):** Carries forward the casual/peer-level default, the concise/educational shift for factual questions, and — good fidelity — the specific "it's not just X, it's Y" framing rule as an FR-18 consequence. But the broader "avoid verbose/generically AI-ey/corporate — be cool instead" guardrail is absent: not in the Feature description, not as an FR consequence, not in Cross-Cutting NFRs, not in Non-Goals (§8), and not in Open Questions.

One specific, testable style rule survived (the "it's not just X, it's Y" ban); the broader qualitative standard it was one example of did not. Since this failure mode was explicitly named as the thing that killed the *tone* dimension of trust in the brainstorm's own risk analysis, its absence is a real fidelity gap, not just missing color.

**Recommendation:** Add it either as an FR-18 consequence ("Responses avoid generically 'AI-ey,' over-formal, or corporate phrasing") or as an explicit Non-Goal/NFR, so it's testable/reviewable rather than tacit.

---

## Gap 3 — "Feedback-into-memory" decided MVP capability not represented as its own FR

**Brainstorm (Memory Model):** "When the user gives feedback that a plan was bad, Yoh updates/learns from that feedback in memory so future plans improve." This is listed separately from the periodic Self-Check throughout the brainstorm:
- Risks table, "Bad plans" row: safeguards are "One-line 'why' reasoning... **feedback-updates-memory loop**; periodic scored check-in" — three distinct things.
- Risks table, "Plans needing too much manual revision" row: "Confirmed covered by existing safeguards — why-reasoning, **feedback-updates-memory**, periodic scoring."
- Phase-1 MVP In-scope list: "...one-line plan reasoning; **feedback-into-memory**; periodic scored check-in; default casual tone with escalation" — listed as its own decided, in-scope MVP item, separate from Self-Check.

**PRD (§5.5, FR-15–FR-17; §9.1):** Specifies Hot/Cold memory (FR-15), the Propose-Don't-Impose confirmation gate (FR-16, which governs the *opposite* direction — Yoh acting on what it learned, not capturing what Spencer told it), and the periodic ~4-day Self-Check (FR-17). There is no FR for an ad hoc "Spencer flags this plan/day as bad → that specific feedback is captured into memory" mechanic outside of the periodic Self-Check cycle. Since the brainstorm treats this as a distinct, separately-named, explicitly in-scope capability, its disappearance (or silent folding into FR-17, which runs on a ~4-day cadence rather than being feedback-triggered) is a real scope gap, not just a documentation nit.

**Recommendation:** Either add an explicit FR under §5.5 for ad hoc feedback capture, or add a PRD note/assumption stating it was intentionally merged into Self-Check (FR-17) and explain why the immediate/ad hoc channel was dropped.

---

## Gap 4 — Softened absolute rule: "never deleted" → "unless explicitly cleaned up"

**Brainstorm (Roadmap item 1):** "old plan-block events are left as passive history, **never deleted**." Stated as an absolute, unqualified rule.

**PRD (FR-22 consequence):** "A prior day's Plan Block events remain as passive history **unless explicitly cleaned up** — they are not silently deleted as a side effect of generating a new Plan."

The PRD only guarantees deletion won't happen *silently as a side effect*; it opens the door to explicit/manual cleanup, which the brainstorm's "never deleted" language doesn't contemplate at all. This may be a reasonable, minor engineering allowance, but it's an unflagged softening of a decided, absolute rule — no `[ASSUMPTION: …]` tag, no note explaining the change.

**Recommendation:** Tag as an assumption if intentional, or tighten FR-22 back to match "never deleted" if not.

---

## Gap 5 — Unresolved brainstorm question missing from PRD's Open Questions

**Brainstorm (Parked/Deferred Open Questions):** "**Personality/voice tuning** beyond the decided tone rules — deliberately left to be refined iteratively through real usage rather than fully specified now." This is explicitly flagged in the brainstorm as parked/unresolved — a deliberate decision to leave it open, not a decision that was made.

**PRD (§11 Open Questions, §12 Assumptions Index):** Neither section mentions this. The PRD's Open Questions cover FR-13's hardware dependency, FR-2's weighting formula, FR-11's cap/growth curve, FR-17's "trending low" threshold, the Phase 3 hardware shopping list, and Notion/Calendar technical claims — all real, but the explicitly-parked personality/voice-tuning question from the brainstorm isn't carried forward anywhere, even as a one-line "deferred, to be refined through usage" note.

This is low-stakes (it doesn't block Phase 1 build), but per the reconciliation brief, an item the brainstorm explicitly left open should be traceable somewhere in the PRD's own open-items tracking rather than silently absorbed into the general Tone FRs as if fully specified.

**Recommendation:** Add a brief §11 entry: "Personality/voice tuning beyond the decided Tone rules (FR-18/19) is intentionally left open, to be refined iteratively through real usage — not blocking Phase 1."

---

## Minor / lower-priority observations (not counted above)

- **FR-5's "big push" trigger genericized:** Brainstorm specifically ties Yoh's proactive Time Budget suggestion to "ahead of a known big push"; PRD FR-5 generalizes to "Yoh may suggest raising the Time Budget" with no trigger condition. Low-impact rewording, likely fine as abstraction, but worth a glance since it removes a specific decided scenario.
- **Room-cleanliness camera cadence dropped:** Brainstorm pre-decides its trigger cadence ("every 3 days, folded into an existing ritual") if/when built; PRD §9.2 drops this detail entirely ("long-term/aspirational, not committed to any numbered phase"). Since it's not committed to a phase yet, low stakes, but the specific decided fact is lost rather than carried as a parked detail.
- **Voice Pack examples dropped:** Brainstorm names specific packs (robot, Hulk, Rick and Morty's Morty); PRD Glossary abstracts to "an optional, manually-selected character voice." Cosmetic only — the manual-only/decoupled-from-Tone rule (the actual decision) is preserved correctly.
- **PRD's own `addendum.md` does not yet exist**, though the PRD body repeatedly defers technical-mechanism content to it (§0, §5.7, and implicitly FR-13's open dependency gap). Not a brainstorm-fidelity issue per se, but worth flagging since some of the Open Questions above (e.g., FR-13's speaker mechanism) have nowhere to land until that file is created.
