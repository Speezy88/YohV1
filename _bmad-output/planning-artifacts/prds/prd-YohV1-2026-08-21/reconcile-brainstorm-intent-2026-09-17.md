---
title: Reconciliation — brainstorm-intent.md vs prd.md/addendum.md (Phase 1.5)
created: 2026-09-17
status: final
---

# Reconciliation: Source Intent vs Updated PRD/Addendum

Source: `_bmad-output/brainstorming/brainstorm-chat-cli-live-integrations-2026-09-17/brainstorm-intent.md`
Targets: `prd.md` (§1, §4, §5.7–§5.8/FR-25–FR-28, §6, §7, §8, §9.2/§9.3, §11 item 7), `addendum.md` (Phase 1.5: Live Integrations — Technical Notes)

Legend: ✅ reflected · ⚠️ partial/weakened · ❌ missing · 🔒 confirmed-correct scoping decision (per task brief, not a gap)

## Context

> Live write access to Notion (page/DB creation), Calendar (ad hoc time-blocking on the real calendar), web search — so Yoh becomes a genuinely *active* assistant, acting in one chat turn instead of requiring manual app-switches.

⚠️ **Partial.** The capability list is fully reflected (PRD §1 Vision, para 3: "page/database creation, confirm-gated time-block editing beyond Yoh-owned events... first slice of Research Vault... chat-triggered web-search"). The qualitative *why* — active-vs-passive assistant, one chat turn instead of app-switching — is not restated anywhere. PRD's Vision section frames Phase 1.5 purely as a capability/scope extension, not as a resolution to a "passive assistant" problem. Minor loss of rationale framing; doesn't affect any testable requirement.

## Current State

| Source bullet | Status | Where |
|---|---|---|
| Notion adapter narrow (`readNotionTasks`/`setTaskStatus`/`updateTaskField`) | ✅ implicit | FR-20/FR-23/FR-24 describe the same narrow scope at capability level; FR-25 Notes explicitly contrasts "beyond Status" |
| Calendar adapter: only Yoh Plan calendar, not main calendar | ✅ | FR-22 (existing, Yoh-owned-only) vs FR-26 ("beyond Yoh-owned events") |
| chat-cli.ts is a deterministic parser, not an LLM tool-calling loop | ✅ | addendum "Architecture direction: extend, don't rebuild" — near-verbatim restatement, including that the tool-calling-loop alternative was considered and rejected |
| Web search: wholly new surface | ✅ | §7 Cost: "introduces the first ongoing external API cost"; Glossary Research Vault entry |
| Precedent: FR-24 already writes missing fields live | ✅ | §6 Data integrity NFR explicitly: "FR-24 and FR-25 both widen the Notion write surface... both satisfy this guarantee the same way FR-24 established it" |
| Reusable machinery: Research Vault DB, block-ID tracking, propose-don't-impose | ✅/⚠️ | Research Vault DB → FR-28; block-ID tracking → addendum FR-26 confirmation flow (`PLAN_BLOCK_ID_EXTENDED_PROPERTY`); propose-don't-impose → FR-25/26 use confirm-gated language but the *term* "Propose-Don't-Impose" is only explicitly cross-referenced for FR-27/28 (§8 Non-Goals), not FR-25/26. Minor inconsistency in cross-referencing, not a behavioral gap. |

## Chosen Direction / Design Principles (1–8)

**1. Safety-tier system (read-only / propose+confirm / auto-write+receipt) as the single most load-bearing, shared-primitive decision.**
⚠️ **Gap.** The three behaviors all exist and are correctly applied per-FR (FR-20/21/27 read-only; FR-25/26/28 propose+confirm; FR-22/23/24 auto-write+receipt), and "never silent" is stated as a blanket rule in §6 Data integrity NFR. But the tiering itself is never named or presented as a unified, deliberately-designed shared primitive anywhere in `prd.md` or `addendum.md` — it reads as four independent FRs rather than one system with three modes. Since the source calls this "the single most load-bearing decision," its absence as an explicit concept is the most notable gap in this reconciliation, even though no individual behavior contradicts it.

**2. Safety tier coupled to scope (auto-write only when Yoh-owned; anything touching the real calendar/full workspace needs propose+confirm regardless of trigger mode).**
✅ Reflected — FR-22 (auto, Yoh-owned) vs FR-26 (confirm-gated, non-Yoh-owned) is exactly this coupling, and §6 states it explicitly ("boundary moves from 'never' to 'never without naming the event and being told yes'").

**3. Provenance never silent (chat receipt and/or memlog log) — fixes silent writes, swallowed failures, unlabeled search facts.**
⚠️ **Partial.** Chat receipts are fully specified (FR-25/26/28 each require a one-line receipt; §6 makes it blanket for all Phase 1.5 writes). Unlabeled-search-fact fix is covered (FR-27 citation requirement, FR-28 source+date tagging). But the "and/or memlog log" half of provenance is dropped — addendum's own "Provenance/receipt mechanism" note narrows this to "a chat-cli output concern only — no new storage," which is more restrictive than the source's stated intent of two independent provenance channels (chat receipt *and/or* memlog). Also, "swallowed API failures" is explicitly addressed for search (FR-27) but not for Notion/Calendar writes (FR-25/26) beyond the generic Reliability NFR (§6) — no FR-25/26 consequence mirrors FR-27's "search failure... surfaced honestly... never presented as a confident answer."

**4. Architecture: extend, don't rebuild (adapter pattern + scoped tool registry, not a general agent).**
✅ Strongly reflected — addendum's "Architecture direction: extend, don't rebuild" section is essentially a direct expansion of this principle, including naming the rejected alternative and why.

**5. Composability — "research X and file the results" (search → draft → confirm → create), the most novel/highest-value direction, more valuable than either capability alone.**
⚠️ **Gap (the one flagged for special attention).** The *mechanics* are present: §5.8 groups FR-27 (search) and FR-28 (file on request) under one feature, and FR-28's own consequence ("nothing is written... as a side effect of FR-27 alone — filing is always a separate, explicit request") describes exactly the two-step chained flow. What's missing is the source's explicit framing that this chaining is the single most novel and highest-value idea in the whole update — that framing/rationale doesn't appear anywhere in `prd.md` or `addendum.md`. Additionally, the addendum's own technical shape (`searchWeb(query)` and `saveToResearchVault(result)` as two separate named functions, rather than `saveToResearchVault` explicitly built on/reusing `createNotionPage` from FR-25) doesn't surface the composability angle at the implementation-note level either — a reader would not infer "these two capabilities were designed to chain" from the addendum's function list alone.

**6. Reuse over invention: Research Vault DB, block-ID tracking, propose-don't-impose, data-completeness gate extended to propose inferred values (not just ask).**
- Research Vault DB → ✅ FR-28.
- Block-ID tracking → ✅ addendum FR-26 confirmation flow.
- Propose-don't-impose → ✅/⚠️ present in substance (confirm-before-write throughout FR-25/26/28), explicitly named only for FR-27/28 in §8 Non-Goals.
- **Data-completeness gate extended to propose inferred values, not just ask → ❌ missing.** This is a concrete, specific design idea from the source (the Gate should evolve from *asking* for a missing value to *proposing an inferred one* for confirmation) that does not appear anywhere in FR-24, FR-25, or the Data integrity NFR. What the PRD actually specifies is narrower: fuzzy-matching an already-given answer to the nearest real select option, and failing/re-prompting when no match exists (FR-24, FR-25 Consequences; §6). There is no mechanism described for Yoh to *propose* a value Spencer hasn't supplied. This is the clearest concrete gap found in this reconciliation.

**7. Schema-validate Notion page/DB creation against real property names before writing.**
✅ Fully reflected — FR-25 Consequences and addendum's "FR-25 schema validation" section (fetch schema via `NotionSchemaClient`, validate before drafting, fail closed) match the source closely, including the generalization of FR-24's existing fuzzy-match pattern.

**8. New credentials follow the existing adapter pattern (env/config), never hardcoded or handed raw to the model.**
✅/⚠️ The "never handed raw to the model" half is strongly reflected (Glossary Live Write Registry entry, §8 Non-Goals, addendum: "No component holds a raw Notion integration token or Google API client Yoh can call arbitrarily"). The "env/config, not hardcoded" half is not explicitly restated for the *new* credential Phase 1.5 introduces (a web-search provider key) — minor, implementation-level omission.

## Explicitly Rejected Approaches

1. No raw tokens to the model → ✅ (Glossary, §8, addendum).
2. No zero-confirmation auto-scheduling; no moving/deleting non-Yoh events without confirmation; additive-only by default → 🔒 **Confirmed correct, and intentionally stricter than the source.** Source only rejects *unconfirmed* move/delete of non-Yoh events (implying confirmed move/delete would be acceptable). FR-26 and §8 Non-Goals go further, permanently banning deletion of non-Yoh events even with confirmation ("never delete... confirmed or not"). FR-26's own Notes are self-aware about this: "a deliberate Phase 1.5 restraint, not an oversight." This doesn't contradict the source — it's a stricter, conservative extension consistent with the source's overall caution (asymmetric-downside language matches the source's tone even though the source didn't state this exact rule) — matches the task brief's description of this as the PRD author's own considered call.
3. No unlabeled search facts; source+timestamp tagged → ✅ FR-27 (citations), FR-28 (source+date tag).
4. No universal "do_anything" tool; keep typed named commands → ✅ addendum Live Write Registry (four named functions only).
5. No silent false success on API failure; failures surfaced with retry/undo path → ⚠️ **Partial.** Failure-surfacing is present (FR-27 explicitly; §6 Reliability generically for the rest). A **retry/undo path** specifically is not described anywhere for Phase 1.5 writes — neither retry semantics nor any undo mechanism for a partially-completed or erroneously-confirmed live write.
6. No search-on-every-turn "just in case" → ✅ FR-27 Consequences, explicit and tied to the Cost guardrail (§7).
7. No proactive/unprompted workspace reorganization → ✅ by omission — no reorganization capability exists in Phase 1.5 scope at all (FR-25 is item *creation* only), so the rejection is trivially satisfied; not worth flagging as a gap.
8. No big-bang rollout — capabilities ship independently, each behind its own safety tier, so a bug in one can't block another → ❌ **Missing.** Neither §9.2 nor Non-Goals nor the addendum states that FR-25/26/27/28 are independently shippable/toggleable, or that a failure in one (e.g., web search) is isolated from the others (e.g., task creation). This is a specific rollout/risk-management commitment from the source that isn't carried into the PRD.
9. **Flagged-against configuration** (Calendar write × explicit command × auto-write-silent × Yoh-owned scope) — explicitly named to prevent it being added later as a "convenience shortcut."
   ❌ **Missing as a forward-looking guard.** This specific *future* temptation (an explicit chat command to move a Yoh-owned block, done silently because the scope is "safe") isn't currently buildable under Phase 1.5 (FR-26 only covers *non*-Yoh-owned events), so there's no present contradiction. But the source's point was to pre-emptively flag it so nobody adds it later without a receipt. Nothing in §8 Non-Goals or §11 Open Questions carries this specific guardrail forward — a future implementer extending chat-triggered editing to Yoh-owned blocks has no PRD-level warning against making that write silent.

## Proposed Build Sequence

1. Notion task/page writes (smallest gap from current state).
2. Calendar time-block editing, reconciled via block-ID tracking.
3. Web search last (highest uncertainty) — ship read-only-with-citation before enabling write-back to Notion.

✅ **Top-level ordering matches.** §9.2 lists the three capability groups in the same order: Notion creation (FR-25) → Calendar editing (FR-26) → Web search + filing (FR-27/FR-28).

⚠️ **Sub-sequencing detail is dropped.** The source's specific staging instruction — ship FR-27 (read-only search) fully *before* enabling FR-28 (write-back to Research Vault) — isn't stated anywhere. §9.2 and §5.8 present FR-27/FR-28 as one grouped feature without a build-order note. This would naturally belong in the addendum's "Phase 1.5: Live Integrations — Technical Notes" section (which already carries comparable implementation sequencing detail for FR-26) but isn't there.

## Explicit Scoping-Decision Checks (resolved after the source doc, verify correctly reflected)

1. **FR-22 stays for unconfirmed/automatic writes; FR-26 carves an explicit propose+confirm exception scoped to move/resize/create only, deletion permanently excluded.**
   🔒 Correct and consistent. FR-26 Consequences, §6 Data integrity NFR, and §8 Non-Goals all state this identically and don't contradict one another. As analyzed above (Rejected Approaches #2), this goes further than the source explicitly said but doesn't contradict its intent — it's a defensible, self-documented conservative extension.

2. **Web search = the already-roadmapped Research Vault (Phase 5), pulled forward to Phase 1.5, not a separate feature.**
   🔒 Correct and consistent throughout — Glossary Research Vault entry, §5.8 title ("Web Search (Research Vault, Phase 1.5 slice)"), §7 Cost, and §11 item 7 all use identical "brought forward from Phase 5" language. No drift.

3. **Whole scope is "Phase 1.5" (CLI-only, before Phase 2's web app), not a renumbered "Phase 2."**
   🔒 Correct and consistent — §1 Vision, §9.2 header, §9.3 ("Phase 1.5 does not touch or accelerate this — it stays CLI-only"), and the addendum section title all use "Phase 1.5" uniformly. No renumbering confusion anywhere.

## Summary of Findings

**Real/moderate gaps (concrete, worth a PM decision):**
- The three-tier safety system (read-only / propose+confirm / auto-write+receipt), which the source calls the single most load-bearing decision, is never named as a unified design primitive in the PRD or addendum — only its per-FR instances exist.
- "Data-completeness gate extended to propose inferred values, not just ask" — a specific reuse-over-invention idea from the source — has no counterpart anywhere in FR-24/FR-25; the PRD only ever fuzzy-matches a *given* answer, never proposes an *inferred* one.
- "No big-bang rollout / independent shippability per capability" is not stated in §9.2 or Non-Goals.
- The "flagged-against configuration" forward-looking guardrail (never let a future chat-triggered edit to a Yoh-owned block become silent) isn't carried into Non-Goals or Open Questions.
- The composability narrative ("research X and file the results" as the most novel, highest-value direction) is mechanically present (FR-27→FR-28 chaining) but never articulated as a design rationale anywhere.

**Minor gaps (low severity, mostly rationale/framing, not behavior):**
- Vision-level "active vs. passive assistant / one chat turn instead of app-switching" framing dropped in favor of pure capability listing.
- "Memlog log" as a second provenance channel narrowed to chat-receipt-only in the addendum's Provenance note.
- No retry/undo path specified for failed Phase 1.5 writes (Notion/Calendar side); only search failure-surfacing is explicit.
- New web-search credential's env/config storage pattern not explicitly restated (implied by the broader "never raw token" rule but not spelled out).
- Build sub-sequencing (ship FR-27 before FR-28) not carried into the addendum's technical notes.

**No contradictions found.** All three explicitly-resolved scoping decisions (FR-26 deletion exclusion, Research-Vault-not-separate-feature, Phase-1.5-not-Phase-2) are consistently and correctly reflected across every section checked.
