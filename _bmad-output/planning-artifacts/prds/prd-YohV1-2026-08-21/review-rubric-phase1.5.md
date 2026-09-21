# PRD Quality Review — Yoh (Phase 1.5 update pass)

Scope note: Phase 1 (FR-1–FR-24, §§1–12 pre-update) was already reviewed and finalized in an earlier pass and is not re-litigated here. This review weights the new/changed material — FR-25–FR-28, new §5.8, and the Phase 1.5 edits across §1, §4, §6, §7, §8, §9, §11, plus the addendum's new "Phase 1.5: Live Integrations — Technical Notes" section — while checking that the changes didn't break consistency with unchanged material (FR-22 in particular).

## Overall verdict

FR-25–FR-28 are individually well-built: testable consequences, correctly reconciled with FR-22's ownership rule (FR-26 is explicitly framed as the sole, narrow exception), and consistent Non-Goal/NFR treatment. But the update doesn't earn its strategic footing the way Phase 1 did — there's no stated reason *why* this scope is being added now (two weeks after Phase 1 shipped), and no Success Metric extends to cover whether any of it gets used. A few mechanical items also drifted: the Glossary's Live Write Registry entry (§4) no longer matches the addendum's actual four-function registry, and the addendum's own `updated` date is stale relative to content it just added. Nothing here is broken, but a reader can't yet tell whether Phase 1.5 reflects a validated need or convenient scope expansion.

## Decision-readiness — adequate

Where Phase 1.5 makes a real trade-off, it says so plainly: FR-26's Notes explain *why* delete is excluded even under confirmation ("deleting a record Spencer didn't ask Yoh to manage carries asymmetric downside for a single confirmation prompt to fully protect against"), and §6's Data-integrity NFR is honest about FR-26 moving the ownership guarantee "from 'never' to 'never without naming the event and being told yes'" rather than smoothing over the exception. That's the kind of trade-off surfacing the rubric wants.

What's missing is the higher-level decision: *why add this scope now.* See the Strategic coherence finding below — this is the more consequential expression of the same gap, so it's not duplicated here as a separate finding.

### Findings
- **medium** No Phase 1.5 Success Metric (§10) — see Strategic coherence finding for detail; cross-referenced here because it's also a decision-readiness gap (a decision-maker can't tell what "Phase 1.5 worked" would even look like).

## Substance over theater — strong

FR-25–FR-28 read as earned, not templated. Each has a specific mechanism (schema validation reusing FR-24's fuzzy-match guard, the `PLAN_BLOCK_ID_EXTENDED_PROPERTY` tag distinguishing owned vs. non-owned events, explicit confirmation semantics), not boilerplate. §5.8 doesn't feel like a section added because Research Vault needed *a* slice — it specifies exactly what the slice is and isn't (§4 Glossary: "Output-only; not a planning input," reaffirmed in FR-28's third consequence). No new persona, innovation, or NFR theater was introduced.

### Findings
None.

## Strategic coherence — thin

Phase 1's §2 "Why Now" ties the Sept 2, 2026 deadline to the efficacy-failure lesson and explains why scope stayed narrow. Phase 1.5 gets no equivalent. §1's update states *what* Phase 1.5 is and its boundaries ("a narrow, CLI-scoped extension... without retiring the CLI or starting Phase 2's web app") but never states *why these three capabilities, why now* — no cited pain point from actual Phase-1 usage (Phase 1 shipped Sept 2, 2026; this update is dated Sept 17, 2026 — about two weeks of real use), no reference to a specific friction Spencer hit. §2 itself was not touched by the update. The addendum's Phase 1.5 Technical Notes section traces the *design* to a brainstorm (`brainstorm-chat-cli-live-integrations-2026-09-17`) but that explains *how* the scope was shaped, not *why* it exists.

Compounding this, §10 Success Metrics was not extended for Phase 1.5 — SM-1 through SM-4 and both counter-metrics are all Phase-1-loop metrics (Plan-follow rate, Self-Check trend, escalation frequency). There is no metric — primary, secondary, or counter — that would tell Spencer whether page-creation-via-chat, calendar editing beyond owned events, or web search are actually being used or are worth their added surface area and cost. Per the rubric's own red flag language, this is the shape of "a backlog with section headings" risk: individually well-specified capabilities without a stated thesis tying them together or a way to validate that thesis after shipping.

### Findings
- **high** No "Why Now" for Phase 1.5 (§1, §2) — §1's Vision paragraph states what Phase 1.5 is and its boundaries but not why it's happening now, two weeks after Phase 1 shipped, rather than staying at its original phase placement (Research Vault was Phase 5; write-surface extension wasn't previously phased at all). §2 Why Now was not updated and still speaks only to the Sept 2, 2026 Phase-1 deadline. *Fix:* Add 1–2 sentences to §1 or a short addition to §2 naming the concrete trigger — a specific friction Spencer hit during Phase-1 usage, or state plainly that this is anticipatory/roadmap-driven rather than usage-driven, so the reader isn't left to infer it.
- **medium** No Success Metric covers Phase 1.5 (§10) — SM-1–SM-4 and SM-C1–SM-C2 all validate Phase-1 FRs (FR-1, FR-2, FR-4, FR-8, FR-11, FR-17, FR-19); none references FR-25–FR-28. *Fix:* Add at least one SM (e.g., "chat-driven writes/search used at least N times/week without being reverted or corrected") or explicitly note in §10 that Phase 1.5 is intentionally unmetered pending real usage, so the omission reads as a decision rather than an oversight.

## Done-ness clarity — adequate

Most Phase 1.5 FRs meet the bar Phase 1 set. FR-25's consequences (schema validation against "real, currently-existing options," fail-closed on unresolved properties, no auto-create path, one-line receipt) are concretely testable. FR-26 and FR-28 are similarly precise. Two gaps stand out against that same bar:

FR-27's trigger condition — "Search is triggered only by an explicit ask or a clearly-recognized factual question — never run automatically on every chat turn" — leaves "clearly-recognized factual question" undefined. This is exactly the adjective-without-a-bound pattern the rubric flags ("system handles X gracefully"): there's no way to verify from the FR text alone whether a given ambiguous chat message should or shouldn't trigger a paid search call, which matters here because over-triggering directly violates the Cost guardrail this FR itself cites.

Related: the Cost guardrail (§7) says web search "introduces the first ongoing external API cost" and must stay "low for single-user, on-demand volume" (addendum, Phase 1.5 Technical Notes), but unlike FR-2, FR-11, and FR-17 — which each carry an explicit "Implementation note: ... see addendum.md" pointing at a deferred numeric parameter, and the addendum in turn gives a concrete starting point for each — FR-27 has no such note, and the addendum gives no starting cost ceiling, rate limit, or even a placeholder number to tune later. It's the one guardrail in this update named as load-bearing ("the cost guardrail (§7) depends on it staying low") with nothing concrete deferred against it.

### Findings
- **medium** FR-27's trigger condition is untestable as written (§5.8) — "a clearly-recognized factual question" has no definition or example boundary distinguishing it from an ordinary chat message. *Fix:* Either give 2–3 example patterns that do/don't qualify, or add an "Implementation note" deferring the exact classification rule to the addendum the same way FR-2/FR-11/FR-17 defer their numeric parameters.
- **medium** Cost guardrail for web search has no threshold, deferred or otherwise (§7, addendum "Deferred Implementation Parameters") — every other Phase-1.5-adjacent numeric unknown (weights, bump curve, threshold) got an explicit deferred-parameter entry; API cost/rate did not, despite §7 and the addendum both calling it a real constraint. *Fix:* Add a fourth bullet to the addendum's "Deferred Implementation Parameters" section naming a starting cost ceiling or call-rate cap to tune later, mirroring the FR-2/FR-11/FR-17 treatment.

## Scope honesty — adequate

The new Non-Goals in §8 (no auto-delete of non-owned events, no automatic search, no unconfirmed Research Vault writes, no raw API/token access "at any phase") are explicit and correctly scoped to what FR-25–FR-28 actually forbid — not vague hedging. Open Question #7 (Perplexity pricing/terms) is a reasonable way to track the one clearly-unconfirmed technical dependency.

Two smaller honesty gaps:

FR-25 permits creating an item "in a Notion database Yoh has access to" without saying what that access boundary is — every other database Yoh touches (Tasks, Projects, Research Vault) is named explicitly elsewhere in the PRD, but FR-25's scope is defined by integration-token reach rather than a stated allowlist. That's plausibly an intentional implementation-layer delegation, but as written it's the one place in Phase 1.5 where the boundary of "what Yoh can touch" isn't named at the capability level the rest of the PRD holds to.

Separately, the working assumption that Perplexity remains the search provider (§7, addendum) is exactly the kind of unconfirmed inference §0 says gets an inline `[ASSUMPTION: ...]` tag — it's carried forward from Phase 5 without reconfirmation, per the addendum's own admission ("no new research contradicts that choice ... confirm current API pricing/terms before build"). It's tracked as Open Question #7 instead, which is defensible, but §12's blanket "No open assumptions remain" reads as slightly overstated next to it — technically true only because no inline tag exists, not because the assumption itself was resolved.

### Findings
- **medium** FR-25's database-access boundary is unstated (§5.7, FR-25) — "a Notion database Yoh has access to" doesn't say which databases that is, unlike the rest of the PRD's named-database precision (Tasks, Projects, Research Vault). *Fix:* Either name the allowed databases explicitly (even "whatever the Notion integration token is scoped to, currently: Tasks, Projects, Research Vault") or add a one-line Non-Goal capping it, so a future reader can't read this as "any database in the workspace."
- **low** Perplexity-as-provider is an unconfirmed inference tracked only as an Open Question, not tagged `[ASSUMPTION: ...]` per §0's own convention (§7, addendum "Phase 1.5... Technical Notes"). *Fix:* Either add the inline tag and index it in §12, or soften §12's "No open assumptions remain" to acknowledge this one is tracked via Open Question #7 instead.

## Downstream usability — adequate

FR IDs are contiguous (FR-25–FR-28 follow FR-24 cleanly) and cross-references resolve correctly — FR-26 ↔ FR-22, §6 ↔ FR-22/23/24/26, §9.2 ↔ FR-25–28 all check out.

The one real drift: §4's Glossary entry for **Live Write Registry** lists "(create Task, create Page, edit Calendar time-block, web search)" as the registry's named actions. The addendum's own "concrete shape" for the same registry lists four functions — `createNotionPage` (FR-25), `editCalendarBlock` (FR-26), `searchWeb` (FR-27), and `saveToResearchVault` (FR-28). The Glossary's list has no equivalent for FR-28's save-to-Research-Vault action — a genuine write — while including "web search" as one of the registry's "write actions," even though FR-27 explicitly states it writes "nothing to Notion or Calendar as a side effect." An architect or story-writer sourcing "what can Yoh write" from §4 alone would both miss a real write path and mislabel a read as a write.

### Findings
- **medium** Live Write Registry glossary entry (§4) doesn't match the addendum's actual registry — missing `saveToResearchVault` (FR-28), and lists "web search" (FR-27) as a "write action" despite FR-27 itself disclaiming any write side-effect. *Fix:* Update the §4 entry to "(create Task, create Page, edit Calendar time-block, file to Research Vault)" and either drop "web search" from the write-actions list or reframe the Glossary line as "named actions" rather than strictly "write actions" to accommodate FR-27's read-only search.

## Shape fit — strong

Phase 1.5 correctly follows the shape Phase 1 already established for integration-style FRs: FR-20–FR-24 never got dedicated UJs (they're cross-cutting capabilities, not journeys), and FR-25–FR-28 follow the same pattern without forcing a UJ-4 that would be overhead for a single-operator tool. That's the right call per the rubric's "Internal tool, single-operator role → capability spec shape; UJs may be overhead" guidance, applied consistently.

### Findings
None.

## Mechanical notes

- **Stale addendum frontmatter date.** `addendum.md` line 4 states `updated: 2026-09-16`, but the file's own "Phase 1.5: Live Integrations — Technical Notes" section (added as part of this pass) cites a source dated `2026-09-17` and `prd.md`'s frontmatter is `updated: 2026-09-17`. The addendum's `updated` field wasn't bumped when this section was added. *Fix:* set `addendum.md`'s `updated` to `2026-09-17`.
- **Live Write Registry glossary drift** — covered above under Downstream usability; the fix is the same one action.
- **"Chat" as a channel is used but not Glossary-anchored.** FR-25–FR-28 all gate on "in chat," and §9.2 clarifies this means "no new interface surface — still terminal/CLI only," but §4's Glossary has no entry tying "chat" to the CLI's chat-cli interaction surface — the clarification lives only in the scope section, not where §0 promises Glossary-anchored vocabulary. Low impact since §9.2's clarification is unambiguous, but worth a one-line Glossary addition for consistency with §0's stated method.
- No ID gaps, no duplicate IDs, no unresolved cross-references found in the new material beyond the Registry item above.

---

**Finding counts:** critical: 0 · high: 1 · medium: 5 · low: 2 (total 8)
