# PRD Quality Review — PRD: Yoh (prd-YohV1-2026-08-21)

## Overall verdict

This is a disciplined, honest PRD: the Vision is specific to Yoh's own history rather than swappable boilerplate, trade-offs are named rather than smoothed over, and nearly every FR carries genuinely testable consequences. The one real defect is mechanical but consequential — every "Capability → FR" mapping in the three Key User Journeys (§3.3) points to the wrong FR, a stale artifact from before the FRs were renumbered, even though the FR section itself and every other cross-reference in the document (Non-Goals, Success Metrics, NFRs, MVP Scope) are internally consistent and correct. Fix that one section and this PRD is ready to drive architecture and story creation.

## Decision-readiness — strong

Decisions are stated as decisions, not hedged into "considerations." §11 cleanly separates four **Resolved** items (each with the actual resolution, e.g. "push notification first, email on the second (escalated) attempt") from five **Deferred** items, each with an owner (Spencer) and a revisit trigger — this does the work `[NOTE FOR PM]` callouts would otherwise do, just via the Open Questions section instead of inline tags. Trade-offs are named with what was given up: FR-13's note that "email fills the same 'meaningfully more attention-getting, different channel' role for Phase 1" explicitly concedes the home-speaker version is deferred rather than pretending email is equivalent. §11 item 3 (primary calendar + tagging vs. dedicated secondary calendar) is a genuinely open architectural tension, not a rhetorical question with the answer already given. No instance found of the "everything balances" red flag language the rubric warns about.

### Findings
- **low** No `[NOTE FOR PM]` tags used anywhere in the document (§0 implies this convention alongside `[ASSUMPTION]`) — the Open Questions section (§11) substitutes adequately, so this is a stylistic gap rather than a substantive one. *Fix:* none required; optionally tag §11 item 3 and item 5 inline at point of tension for readers who don't reach §11.

## Substance over theater — strong

The Vision (§1) is anchored in a specific, documented prior failure ("Yoh's second attempt... abandoned not for bugs or lost motivation but for an efficacy failure") and names the two mechanisms (propose-don't-impose, escalate-under-strain) invented in direct response — this could not be swapped into another PRD unchanged. There is exactly one persona (Spencer), which is correct for a declared single-user product (§3.2), not persona theater. NFRs are product-specific rather than boilerplate: "Reliability" (§6) is grounded in "there is no support team and no other user to notice," and "Safety" (§7) honestly states it's "not a meaningful concern for Phase 1" rather than padding in a generic safety clause. No differentiation-for-its-own-sake section exists.

### Findings
None — no theater found worth flagging.

## Strategic coherence — strong

The thesis is explicit: a Plan that's "realistic enough, and transparent enough, to actually be followed" (§1), and feature order follows from it — the MVP is exactly the Morning/Night loop plus the mechanics that make it trustworthy (Data-Completeness Gate, Slip-Bump, Propose-Don't-Impose), with the web app, hardware, iOS, and Research Vault explicitly pushed to later phases (§9.2) rather than cherry-picked for ease. Success Metrics validate the thesis directly — SM-1 (Plan-follow rate) measures whether the Plan is trusted enough to use, not an activity proxy like DAU. Counter-metrics are named and reasoned (SM-C1, SM-C2), which is rarer and a good sign of real strategic thinking rather than backlog-with-headings.

### Findings
None.

## Done-ness clarity — strong

Nearly every FR (FR-1 through FR-23) carries a "Consequences (testable)" block with concrete, falsifiable conditions — e.g. FR-4: "A Task missing a required field never silently appears in a Plan with a defaulted/assumed value," FR-22: "No update or delete operation is ever issued against a Calendar event not created by Yoh, verified by an ownership check before every write." None of the rubric's red-flag phrases ("handles X gracefully," "user-friendly," "reasonable performance") appear. Where exact numbers are genuinely undetermined (FR-2 weights, FR-11 cap/curve, FR-17 threshold), the PRD is honest about it via explicit "Implementation note" callouts pointing to `addendum.md`, rather than papering over with vague language — and the addendum supplies concrete starting values (e.g. FR-11: "small bump on slip 1, roughly double on slip 2, cap reached by slip 3-4"), so the deferral isn't a hand-wave.

### Findings
- **low** The Latency NFR (§6) is intentionally soft — "no hard SLA, but 'fast enough to not feel broken' (low seconds, not minutes)" — which is defensible for a single-user tool but is the one bound in the document that isn't crisply testable. *Fix:* optional; could state a concrete ceiling (e.g. "Plan generation completes in under 30 seconds") if it ever becomes a support issue.

## Scope honesty — strong

§8 Non-Goals is substantive, not perfunctory — each bullet states a *permanent* stance ("not a v1 limitation to relax later") distinguished from the Phase-2+ items in §9.2 that are deferred-not-rejected. The `[NON-GOAL for MVP]` tag is used precisely once, at FR-19's Voice Pack exclusion (§5.6), where it does real work distinguishing a permanent decoupling from a temporary omission. The Assumptions Index (§12) reports zero remaining open assumptions, with an explicit note that the three inline `[ASSUMPTION]` tags from the first draft were resolved and removed — a clean closure loop rather than assumptions quietly vanishing. Open-items density (4 resolved + 5 deferred against a hard Sept-2 deadline) is proportionate, not alarming for the stakes.

### Findings
None.

## Downstream usability — thin

The PRD's own stated design (§0) is that FRs are "numbered globally... so later artifacts can reference them by stable ID." That promise holds everywhere **except** the "Capability → FR" annotations closing each of the three Key User Journeys in §3.3, which are systematically wrong — they read as leftover from a pre-finalization FR numbering that was never updated after the FRs were renumbered:

- **UJ-1** (§3.3): "Time Budget / work-break fit → FR-8, FR-9" — FR-9 is actually *User-initiated Mid-Day Re-Flow*; Time Budget/work-break fit is FR-5–FR-8.
- **UJ-2** (§3.3): "Mid-Day Re-Flow (user-initiated only) → FR-10" — FR-10 is actually *Logistics-only Blocker handling*; Mid-Day Re-Flow is FR-9. And "logistics-only blocker handling → FR-12" — FR-12 is actually *Night Ritual close-out prompt*, an unrelated feature; Blocker handling is FR-10.
- **UJ-3** (§3.3): "Night Ritual close-out → FR-13" (actually FR-12), "capped escalating retry → FR-14" (actually FR-13), "unchecked-day handling → FR-15" (actually FR-14 — and FR-15 is *Hot/Cold memory model*, a completely different feature).

This is confined to §3.3 specifically — I checked every other FR cross-reference in the document (§8 Non-Goals, §9.1 MVP Scope, §10 Success Metrics, §6 Cross-Cutting NFRs, and in-FR references like FR-8's "subject to Slip-Bump, FR-11") and all of them resolve correctly against the actual FR headers. The Glossary is otherwise well-anchored and used identically across FRs and UJs, FR IDs are contiguous and unique (FR-1–FR-23, no gaps or dupes), and all three UJs have a named protagonist (Spencer) with real entry/path/climax/resolution structure. This is why the dimension is "thin" rather than "broken": the primary traceability spine (FR section + headers) is sound, but the exact place a reader is most likely to enter the document (a UJ, to understand *why* a feature exists) hands them the wrong pointer every time.

### Findings
- **high** UJ-1/UJ-2/UJ-3 "Capability → FR" mappings in §3.3 are all stale/incorrect (see quotes above) — anyone tracing a journey to its implementing FR via these annotations will land on the wrong requirement. *Fix:* recompute all §3.3 Capability→FR lines against the current FR headers (§9.1's FR ranges are the correct source of truth and can be copied from directly).

## Shape fit — strong

This is a single-operator personal tool with real emotional stakes (JTBD explicitly names "trust," "not be fought with," §3.1), so the light UJ treatment (three journeys, one protagonist, no persona proliferation) is load-bearing rather than overhead — it's what lets the FRs' behavioral guardrails (propose-don't-impose, escalate-under-strain) read as motivated rather than arbitrary. The FR/Consequences structure otherwise reads as capability-spec shape, appropriate for single-operator scope. Nothing here is over-formalized (no UJ density inflation) or under-formalized (a personal daily-use product without any UJ would have lost the "why" of the trust/tone requirements).

### Findings
None.

## Mechanical notes

- **Glossary drift:** None found. Domain nouns (Task, Plan, Plan Block, Time Budget, Work/Break Block, Blocker, Derived Priority, Slip-Bump) are capitalized and used identically across §4, the Features section, and the UJs.
- **ID continuity:** FR-1–FR-23 contiguous and unique; UJ-1–UJ-3 and SM-1–SM-4 (+ SM-C1/C2) contiguous and unique. The one continuity failure is the cross-reference *content* in §3.3's Capability→FR annotations (see Downstream usability finding above) — not a numbering gap, but a stale-pointer problem, most likely from FRs being renumbered during finalization without a pass back through §3.3.
- **Assumptions Index roundtrip:** Clean — §12 confirms zero inline `[ASSUMPTION]` tags remain in the body, matching the index's own claim that all three original tags were resolved and removed. No orphaned inline tags or index entries found.
- **UJ protagonist naming:** All three UJs name Spencer explicitly with concrete entry-state context; no floating UJs.
- **Required sections:** All sections a chain-top PRD of this stakes level would need are present (Vision, Why Now, Target User/JTBD/UJs, Glossary, Features/FRs, NFRs, Constraints, Non-Goals, MVP Scope, Success Metrics, Open Questions, Assumptions Index), plus a well-scoped `addendum.md` that correctly keeps implementation-adjacent detail (numeric parameters, dependency verification, architecture guidance) out of the capability-level FR text.
