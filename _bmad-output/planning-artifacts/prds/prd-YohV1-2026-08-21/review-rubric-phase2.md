# PRD Quality Review — Yoh (Phase 2 update pass)

Scope note: Phase 1 (FR-1–FR-24) and Phase 1.5 (FR-25–FR-29, §5.8) were already reviewed and finalized in earlier passes (`review-rubric.md`, `review-rubric-phase1.5.md`) and are not re-litigated here, except to note where this update fixed or interacts with prior findings. This review weights the Phase 2 material — §5.9–§5.13 (FR-30–FR-51), UJ-4–UJ-6, the Phase 2 Glossary terms, the amendments to FR-2/FR-4/FR-23/FR-24, the Phase 2 NFR bullets in §6, §7's Phase 2 clauses, the new §8 Non-Goals, §9.3/§9.4, SM-5–SM-7/SM-C3–C4, §11 items 8–13, and §12's Phase 2 list — and checks whether Phase 2 integrates consistently with unchanged Phase 1/1.5 material.

Housekeeping first: this update resolved both medium findings from the Phase 1.5 review. FR-28's trigger condition (formerly FR-27) now carries an explicit "Implementation note" pointing to the addendum, matching the FR-2/FR-11/FR-17 pattern, with concrete example phrasings. The addendum's Deferred Implementation Parameters section now has a cost-ceiling bullet for web search. The Live Write Registry Glossary entry now correctly lists `saveToResearchVault` (FR-29) and no longer mislabels search as a write action. The addendum's stale-date issue is also gone (`prd.md` and `addendum.md` both read `updated: 2026-09-24`). None of this is re-scored below, but it's worth naming since it shows the prior review's findings were acted on rather than ignored.

## Overall verdict

Phase 2 is the strongest section of this PRD to date: it has the "Why Now" that Phase 1.5 lacked (the named "stupid plan" / transition-time failure in §2), a full assumption-index roundtrip with zero drift, and FR text that mostly meets the same testable-consequence bar Phase 1 set. Two things hold it back from "strong" overall. First, `/morning` and `/night` are introduced as Chat slash commands (FR-42) with no stated semantics for how a manual invocation relates to the automatic, capped-frequency Rituals those same names already govern (FR-1's "exactly one notification," FR-12's "once per day," FR-13's escalation cap) — a real, unaddressed interaction between old and new FR text, not just a documentation gap. Second, the Live Write Registry's Glossary definition ("actions Yoh may perform from chat") no longer matches its own Phase 2 additions (FR-41 and FR-32 are both triggered from Home, not Chat), which now also contradicts the Glossary's own newly-tightened "Chat" entry. Both are fixable in a sentence or two; neither undermines the FRs' individual quality.

## Decision-readiness — strong

Phase 2 states its priority ordering as a decision, not a suggestion: "Sections are ordered by Spencer's stated priority: Drag-to-Reshuffle first, /sandbox second, pages and design system third, then the groundwork the first three depend on" (§5, pre-§5.9). §2's third paragraph gives Phase 2 the concrete "why now" Phase 1.5 was criticized for lacking — it names the specific trigger (three real daily contexts the CLI doesn't fit) and the one named usage lesson ("the 'stupid plan' failure: a Plan that ignores transition time... is the fastest way to lose trust, which is why Routines (FR-35) ship alongside the drag interaction rather than after it"). That's a trade-off stated with what would have been lost (Routines could have shipped later; they didn't, and the PRD says why).

Individual trade-offs are also surfaced honestly rather than smoothed: FR-31's Notes explain why Pin-as-priority-feedback is deliberately excluded ("would require its own Propose-Don't-Impose gate"); FR-32's Notes explain why one Approve click for a whole reshuffle is safe (every moved block is Yoh-owned, so FR-27's per-event rule can't apply). §11 items 8–13 are genuinely open — item 8 in particular ("Architecture spine is stale for Phase 2... the spine is updated by `bmad-architecture`, not this PRD") names a real gap rather than resolving it in the next sentence.

### Findings
None.

## Substance over theater — strong

UJ-4–UJ-6 are grounded in three specific, named usage contexts (home morning, in-class capture, after-school desk session) sourced from a dated brainstorm, not generic personas — each journey drives specific FRs rather than existing for coverage's sake. FR-46's design system is similarly non-generic: it names exact colors, exact treatment (neumorphic), an exact wordmark, and ties every stated motion cue to a specific interaction (check-off fade, reshuffle preview, thinking state) rather than asserting "polished UI" as boilerplate. Nothing in §5.9–§5.13 reads as filled-in-because-the-template-had-it.

### Findings
None.

## Strategic coherence — strong

Phase 2 has the thesis Phase 1.5 was missing: "Phase 2's headline is direct manipulation with the same trust boundary — drag a block, see Yoh's proposed day, approve it in one click" (§1), cashed out consistently through FR-30–FR-32 (Propose-Don't-Impose rendered as drag-preview-approve) and FR-48 (surface-agnostic confirmation generalizes the same rule beyond Chat). SM-6 and SM-7 validate that thesis directly — approval-vs-discard rate is literally a measure of whether the reshuffle's proposal was trustworthy, and the /sandbox backlog metric measures whether the data-quality prerequisite is being met — not just activity counts. SM-C3/SM-C4 correctly counterbalance against optimizing raw engagement (time in app, notification count), consistent with the rubric's DAU/MAU red flag guidance.

### Findings
None.

## Done-ness clarity — adequate

Most Phase 2 FRs meet the bar: FR-30–FR-35's consequences are concretely testable (ownership checks, stale-preview re-computation, Pin priority-immutability), and FR-38/FR-41/FR-51's write-tier framing is precise and cross-checked against §6's tier taxonomy. Three gaps stand out against that same bar.

**`/morning` and `/night` as manual Chat commands are functionally unspecified against the FRs that already govern those names.** FR-42 lists `/morning (Morning Ritual)` and `/night (Night Ritual)` as two of Chat's four slash commands, and UJ-6's Path shows Spencer actively choosing to "run `/night` in Chat when ready to close out the day" — a self-initiated close-out, not a response to Yoh's push notification. But FR-1 ("Exactly one Plan-generation notification is sent per day under normal operation"), FR-12 ("prompts Spencer once per day"), and FR-13 (capped two-attempt escalation) all describe these Rituals as system-initiated and frequency-bounded. Nothing in FR-42, FR-1, or FR-12 says what a manual `/morning`/`/night` invocation actually does: does it re-display an already-generated Plan, force a fresh generation (and does that count against FR-1's "exactly one" guarantee), or short-circuit FR-13's escalation clock if Spencer runs `/night` before Yoh's prompt fires? §9.3 item 5 ("Changes to existing requirements") lists FR-2, FR-4, FR-23, and FR-24 as amended by Phase 2, but not FR-1, FR-9, FR-12, or FR-13 — so a reader has no signal that this interaction needs resolving at all.

**Multi-block Task drag/pin interaction is undefined.** The Glossary states "a Task may span multiple blocks," but FR-30 lets Spencer drag "a Yoh-owned Work/Break Block (with every Task inside it)" and FR-31 lets Spencer "drag a single Task out of its block." Neither FR nor its consequences say what happens when the block being dragged, or the Task being pinned, is only part of a Task that spans multiple Work/Break Blocks — does the whole multi-block Task move/pin together, or just the touched segment?

**Phase 2's deferred parameters get thinner treatment than the precedent Phase 1/1.5 set.** FR-2, FR-11, FR-17, and FR-28 each carry an inline "Implementation note: ... see addendum.md," and the addendum gives each a full paragraph with a concrete starting value or curve (e.g., FR-11: "small bump on slip 1, roughly double on slip 2, cap reached by slip 3-4"). Phase 2's equivalents — FR-41's undo window, FR-45's idle timeout, FR-44's feed refresh interval — get only `[ASSUMPTION]` tags routed to bmad-ux, and the addendum's "Deferred implementation parameters (Phase 2)" bullet lists them with no starting number at all (contrast the Reshuffle animation budget in the same bullet, which does get "start ≤ ~2s," because that number already exists in §6 Latency).

### Findings
- **high** `/morning`/`/night` slash commands (FR-42) have no defined relationship to the Rituals they name (FR-1, FR-12, FR-13) — Manually invoking `/night` per UJ-6 could mean re-displaying, re-generating, or pre-empting the automatic close-out and its escalation cap, and the PRD doesn't say which; §9.3 item 5's "Changes to existing requirements" list doesn't flag FR-1/FR-9/FR-12/FR-13 as touched, so the gap is invisible to a reader scanning for what Phase 2 changed. *Fix:* Add a consequence to FR-42 (or a Note on FR-1/FR-12) stating what a manual invocation does — e.g., "`/morning` re-displays the current day's Plan without regenerating it; `/night` opens the same close-out flow FR-12 would prompt, and if completed this way, no further escalation (FR-13) fires for that night."
- **medium** Multi-block Task drag/pin is unaddressed (FR-30, FR-31) — the Glossary's "a Task may span multiple blocks" isn't reconciled with FR-30's "block... with every Task inside it" or FR-31's "drag a single Task out of its block." *Fix:* Add a consequence stating whether a multi-block Task moves/pins as a whole or only the dragged segment.
- **medium** Phase 2 deferred parameters lack starting values (FR-41, FR-44, FR-45; addendum "Deferred implementation parameters (Phase 2)") — unlike FR-2/FR-11/FR-17/FR-28, no concrete starting number is offered for the undo window, idle timeout, or feed refresh interval, so bmad-ux has less to react to (agree/disagree) than downstream consumers got from Phase 1/1.5's equivalents. *Fix:* Give each a placeholder starting value in the addendum bullet, the same way FR-11 and FR-28 did, even if provisional.

## Scope honesty — strong

The new §8 Non-Goals are specific and load-bearing, not hedges: "Drag-to-Reshuffle will never move, resize, or delete a Calendar event Yoh did not create (FR-33)" and "Dragging or pinning a Task will never change its Derived Priority (FR-2, FR-31)" both restate real FR guarantees as permanent boundaries. §9.4's Phase 2 entries distinguish deferred from dropped explicitly and correctly — "Receipts folder... dropped, not deferred" versus "Goals hub... deferred to a later phase" is exactly the honest de-scoping the rubric asks for. §10's Phase 2 metrics block is itself flagged `[ASSUMPTION: Phase 2 metrics proposed at drafting — confirm or cut]`, which is the right way to present a not-yet-validated SM set rather than presenting it as settled. §12's Phase 2 assumption list has full roundtrip with the inline tags (verified below) — every inline `[ASSUMPTION]` in the Phase 2 FR text is indexed, and every indexed item has a matching inline tag.

### Findings
None.

## Downstream usability — adequate

FR IDs are contiguous (FR-30–FR-51, 22 IDs, no gaps or duplicates against the five subsections' stated ranges), UJ IDs are contiguous (UJ-4–UJ-6), and SM IDs are contiguous (SM-5–SM-7, SM-C3–SM-C4). The Assumptions Index roundtrip is clean — all 13 Phase 2 inline `[ASSUMPTION]` tags (FR-4, FR-30, FR-31, FR-33, FR-35, FR-36 ×2, FR-39, FR-41, FR-43, FR-47, §6 Latency, §7 Cost, §10) are listed in §12, and nothing in §12's Phase 2 list lacks a corresponding inline tag.

One real drift: §4's **Live Write Registry** entry defines itself as "the fixed, named set of actions Yoh may perform from chat," then lists Phase 2 additions including "mark Task complete (FR-41, Status-only)" and "apply a Reshuffle Preview to Yoh-owned blocks (FR-32)." Neither is a chat action — FR-41 is triggered by checking a box on Home, and FR-32 is triggered by clicking Approve on Home's calendar. This isn't just loose wording: §4's own **Chat** entry was tightened in this same update to mean specifically "the Web App's Chat page (FR-42)," so the Live Write Registry entry now directly contradicts a Glossary term it sits three lines away from. An architect sourcing "what's in the Live Write Registry and where does it get triggered from" out of §4 alone would misread FR-41 and FR-32 as chat-triggered.

Two smaller traceability gaps: UJ-4's capability→FR list cites "check-off → FR-41," but nothing in UJ-4's Path or Edge case narrates a check-off — the journey only shows dragging and pinning. Conversely, UJ-5's Path narrates the launch splash ("click the Yoh icon (splash fades straight into Home)") but the capability→FR list doesn't cite FR-45 (Screensaver), only FR-39/FR-36–38/FR-51/FR-49.

### Findings
- **medium** Live Write Registry Glossary entry contradicts its own Phase 2 additions and the tightened "Chat" entry (§4) — "actions Yoh may perform from chat" is used to introduce FR-41 (Home checkbox) and FR-32 (Home Approve click), neither of which is a Chat-surface action per §4's own Chat definition. *Fix:* Reword the entry's framing from "actions Yoh may perform from chat" to something like "the fixed, named set of write actions Yoh may perform, reachable from Chat and/or Home as of Phase 2" — the underlying constraint (no raw API access, only named functions, per §8) doesn't require the "from chat" framing at all.
- **low** UJ-4 cites FR-41 (check-off) with no corresponding beat in its Path or Edge case. *Fix:* Either add a one-clause check-off beat to UJ-4's Path, or drop FR-41 from its capability→FR list (it's already covered narratively by UJ-6).
- **low** UJ-5 narrates the launch splash but omits FR-45 from its capability→FR list. *Fix:* Add "launch splash → FR-45" to UJ-5's mapping.

## Shape fit — strong

Phase 2 correctly shifts shape from Phase 1/1.5's capability-spec treatment (no UJs for FR-20–FR-29) to UJ-anchored treatment for FR-30–FR-51, matching the rubric's own guidance ("Consumer product / multi-stakeholder B2B / meaningful UX → UJs with named protagonists are load-bearing") — direct manipulation and a real four-page app are exactly the kind of meaningful-UX shift that justifies adding UJs where Phase 1 didn't need them. All three Phase 2 UJs carry Spencer as a named protagonist with concrete context (time of day, device, what he's looking at), avoiding the "floating UJ" pattern. The brownfield distinction is also handled well: every Phase 2 FR that touches existing Phase 1/1.5 behavior (FR-2, FR-4, FR-23, FR-24) is explicitly marked as amended with a "Changed" note or a "Notes" cross-reference, rather than silently rewritten.

### Findings
None.

## Mechanical notes

- Live Write Registry Glossary drift — covered above under Downstream usability.
- No ID gaps or duplicates found in FR-30–FR-51, UJ-4–UJ-6, or SM-5–SM-7/SM-C3–C4.
- Assumptions Index roundtrip is clean for Phase 2 (13 inline tags, 13 indexed entries, full match) — notably better than Phase 1.5's Live Write Registry drift, which this update also fixed.
- addendum.md and prd.md frontmatter dates are now in sync (`updated: 2026-09-24` both), resolving the staleness flagged in the Phase 1.5 review.

---

**Finding counts:** critical: 0 · high: 1 · medium: 3 · low: 2 (total 6)
