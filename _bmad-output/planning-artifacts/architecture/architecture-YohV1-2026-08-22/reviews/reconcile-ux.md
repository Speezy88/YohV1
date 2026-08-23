---
name: Yoh
type: review
purpose: reconcile ARCHITECTURE-SPINE.md against EXPERIENCE.md + DESIGN.md
created: '2026-08-22'
sources:
  - _bmad-output/planning-artifacts/architecture/architecture-YohV1-2026-08-22/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/EXPERIENCE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-YohV1-2026-08-21/DESIGN.md
---

# Reconciliation Review — Architecture Spine vs. UX Spine (Yoh)

## Verdict: Real gaps

Most of the spine tracks the UX documents well (Propose-Don't-Impose ↔ AD-3, Escalate-Under-Strain shared curve ↔ AD-6, Pushover resolving the UX's open notification-transport question). But there is one structural mismatch — the shell/ split's treatment of interactive prompts that the UX says are triggered *during* an unattended ritual run — plus a missing architectural home for free-text intent handling, and one UX-flagged open assumption (cold start) that the spine dropped instead of carrying forward. These are addressable without re-architecting, but they are real, not cosmetic.

---

## 1. Does the ritual-cli.ts / chat-cli.ts split preserve "always-available chat" + "silence is a feature"?

**Mostly yes, with one significant hole.**

- AD-5's chat-cli.ts description ("on-demand persistent REPL... opens a persistent session for Mid-Day Re-Flow, Blocker reports, Time Budget changes, and Propose-Don't-Impose confirmations") and the Structural Seed's `yoh chat` command directly answer EXPERIENCE.md's own flagged open assumption ("exact CLI invocation syntax... is not specified anywhere in the sources... Confirm before this becomes an interaction contract for architecture," EXPERIENCE.md IA section, and the matching note under Interaction Primitives). Because neither shell entry point is a long-running daemon, there's no architectural vector for "ambient still-there" messages — the "silence is a feature" principle (EXPERIENCE.md Voice and Tone) is naturally satisfied by construction, not just by convention.

- **The hole:** EXPERIENCE.md's Information Architecture table lists three touchpoints as "**auto-triggered**" *during* a ritual run — the Data-Completeness prompt ("auto-triggered mid-Morning-Ritual when a Task is missing a required field"), the Night close-out prompt ("auto-triggered at day's end"), and the Self-Check prompt ("auto-triggered ~every 4 days"). The Accessibility Floor section is explicit that these "wait indefinitely for Spencer's response." But AD-5 defines `ritual-cli.ts` as running "Morning/Night Ritual orchestration **unattended**" (invoked by cron/systemd-timer/launchd) — a one-shot process with no one watching it and, per the deployment diagram, no interactive terminal attached. An unattended cron process cannot literally block and "wait indefinitely" for Spencer to type an answer to a missing field at 6am.
  - This is sharpest for FR-4 (Data-Completeness): the UX flow implies the gate is resolved *inside* the Morning Ritual, before the Plan is finalized/delivered — yet the only interactive surface (chat-cli.ts) is a separate process Spencer must manually open later. Nothing in the spine says whether the Morning Ritual (a) blocks Plan delivery until Spencer answers via a later chat-cli.ts session (risking the UJ-1 promise that "phone buzzes... before Spencer's even out of bed"), or (b) proceeds with a partial/default Plan and defers the missing-field question to whenever chat-cli.ts is next opened. Both are plausible, but the spine picks neither.
  - The same ownership question applies to the Night close-out prompt's confirmation and the Self-Check prompt's response: AD-5's rule text is written as an exhaustive list of what `chat-cli.ts` is "the only path" for, and that list does **not** include responding to a Data-Completeness prompt, a Night close-out confirmation, or a Self-Check score/reason. Only Mid-Day Re-Flow, Blocker reports, Time Budget changes, and Propose-Don't-Impose confirmations are named.
  - Separately, `rituals/self-check.ts` exists in the Structural Seed, but no `shell/` file is named as its trigger — AD-5's two enumerated jobs for `ritual-cli.ts` ("Morning/Night Ritual orchestration") and `chat-cli.ts` (the four items above) leave Self-Check's invocation path unassigned.

**Recommendation for the spine:** add an explicit rule (or extend AD-5) stating how a ritual-generated prompt that needs Spencer's answer is persisted (likely via `storage-adapter.ts`, as a pending-prompt record parallel to `Proposal<T>`) and picked up the next time `chat-cli.ts` opens, and confirm whether Plan delivery blocks on Data-Completeness or proceeds without it.

---

## 2. Is the state model (Day states, Slip-Bump lineage, confirmation-pending) representable under AD-3 + storage/adapter boundaries?

**Substantially yes, with two gaps worth naming.**

- **Day states / Task states / Slip-Bump lineage:** EXPERIENCE.md's State Patterns section (day is exactly `planned → in-progress → closed` or `unchecked`; a slipped Task carries its Slip-Bump until it clears) maps reasonably onto the spine's ERD (`TASK ||--o{ SLIP_RECORD : "accrues on slip"`) and the AD-2 pattern of passing prior state in as a parameter rather than fetching it internally — `slip-bump.ts` computing forward from a passed-in slip history, with the actual "clear on completion" transition owned by whichever ritual (`mid-day-reflow.ts` or `night-ritual.ts`) does the fetch-compute-write cycle through `storage-adapter.ts`. This is workable.
  - **Gap:** the spine's ERD and `types/domain.ts` list (Task, Plan, PlanBlock, TimeBudget, Proposal<T>, Result<T,E>, YohError) never names a `Day`/day-status entity or enum. It's plausible this state lives as a field on `Plan`, but the spine doesn't say so, and a day-state that is neither `Task` nor `Plan`-scoped-only (it needs to know about mandatory Blockers rolling forward, per FR-14) has no explicit owner in the type list. Minor, but worth confirming before build rather than leaving implicit.

- **Confirmation-pending state:** AD-3 covers *who may call* `apply(proposal)` (only `chat-cli.ts`, after explicit yes/no, in the same session) — this matches the Propose-Don't-Impose shape well. But EXPERIENCE.md's State Patterns section asks for something slightly different and additional: that while a PDI prompt is open, Yoh "doesn't queue silently in the background waiting for a reply while also accepting unrelated commands." AD-3 constrains the call site, not the REPL's turn-taking/blocking behavior — nothing in the spine states that `chat-cli.ts` must refuse or defer unrelated input while a `Proposal<T>` is outstanding. This is likely intended and easy to build correctly, but it's a distinct invariant from AD-3's and isn't currently written down anywhere in the spine (not even as a Consistency Convention).
  - **Related unaddressed hand-off:** the IA table says a PDI confirmation can be "auto-triggered whenever Yoh has a learned pattern, budget suggestion, **or Blocker-handling decision** to surface" — some of these (e.g., a pattern noticed during the unattended Night Ritual) could originate inside `ritual-cli.ts`'s run, yet AD-3 requires the yes/no and the `apply()` call to happen "in that same session" of `chat-cli.ts`. That implies a `Proposal<T>` generated in one process must be persisted and resurface for confirmation in a later, separate `chat-cli.ts` invocation — the same unaddressed persistence/hand-off pattern flagged in section 1.

---

## 3. UX-flagged open assumptions: resolved, carried forward, or silently dropped?

| UX open item | Where flagged | Spine disposition |
|---|---|---|
| Notification delivery mechanism (Pushover/ntfy/Shortcut) | EXPERIENCE.md Foundation | **Resolved.** Stack table names Pushover explicitly (`adapters/notification-adapter.ts`), and AD-7 builds on it. Good — this is the one open item the spine cleanly closed. |
| Exact CLI invocation syntax (persistent chat vs. discrete commands) | EXPERIENCE.md IA + Interaction Primitives | **Resolved, but only implicitly.** The Structural Seed's `yoh ritual morning\|night` / `yoh chat` naming and AD-5's "persistent session" language settle it in favor of the UX's own assumption (persistent chat-style session), but the spine never states that it is doing so, and doesn't touch **how** free text gets interpreted (see below). A reader cross-referencing only the spine wouldn't know this UX question was addressed. |
| Free-text NLU / intent routing ("it's running behind" → Mid-Day Re-Flow vs. a Blocker report vs. a general question) | EXPERIENCE.md Interaction Primitives ("free-text typed chat, not a fixed command grammar") | **Not addressed at all.** The Stack table has no NLU/LLM dependency, and no `core/`, `adapters/`, or `rituals/` file in the Structural Seed is responsible for classifying free-text input into one of Mid-Day Re-Flow / Blocker report / Time Budget change / general question / PDI-response. Given the entire chat interaction model the UX commits to depends on this, its complete absence from the spine (not even flagged as Deferred) is a real gap, not a minor one. |
| Cold-start / first-run behavior | EXPERIENCE.md State Patterns | **Silently dropped.** EXPERIENCE.md explicitly flags this as unresolved ("treated as an open item, not invented... Flagged for confirmation"). The spine's Deferred section has 11 entries and none of them is cold start / first run. This should have been either resolved (e.g., "Morning Ritual runs identically on day one; no special-cased copy") or explicitly carried into Deferred with an owner — it was neither. |
| DESIGN.md notification rendering depending on "the still-open delivery mechanism" | DESIGN.md Components | Moot / effectively resolved as a side effect of the transport being settled (Pushover), though the spine doesn't say so explicitly. Not a concern. |
| DESIGN.md visual-philosophy / typography / box-drawing assumptions | DESIGN.md Brand & Style, Typography, Layout | Out of the architecture spine's stated scope (presentation-layer detail, not planning/ritual logic or module boundaries) — reasonable to leave for `chat-cli.ts`'s own output-formatting implementation. Not flagged as a gap. |

---

## 4. Do the module boundaries deliver every IA touchpoint without crossing a forbidden ownership line?

Checked each of EXPERIENCE.md's six IA touchpoints against AD-1/AD-2/AD-5/AD-9:

| Touchpoint | Trigger-side owner | Response/interactive-side owner | Verdict |
|---|---|---|---|
| Morning Plan (push + on-demand `yoh` chat view) | `ritual-cli.ts` → `rituals/morning-ritual.ts` (clear) | "Viewable on demand via a `yoh` chat query" — **not named** in AD-5's enumerated `chat-cli.ts` scope | Gap: plausible chat-cli.ts handles it, but AD-5's rule text doesn't say so |
| Data-Completeness prompt | `ritual-cli.ts` (mid-Morning-Ritual) | No named owner for collecting the answer; conflicts with `ritual-cli.ts` being unattended (see §1) | Gap |
| Chat / command interaction (Mid-Day Re-Flow, Blocker, Time Budget, general Qs) | — | `chat-cli.ts`, explicitly named in AD-5 | Clean |
| Night close-out prompt | `ritual-cli.ts` (day's end + escalation) | No named owner for the confirmation reply; same unattended-process conflict as Data-Completeness | Gap |
| Self-Check prompt | No shell file named at all for `rituals/self-check.ts`'s trigger | No named owner for the score+reason reply | Gap (double: neither trigger nor response side is assigned by AD-5) |
| Propose-Don't-Impose confirmation | Can originate in either ritual | `chat-cli.ts`, explicitly named in AD-5 | Clean on the response side; origin-in-`ritual-cli.ts` hand-off unaddressed (see §2) |

No touchpoint's *plausible* implementation actually requires literally shared mutable state across `core/*` files (AD-2 is not at risk), and nothing requires a third shell entry point (AD-5's "two entry points" count itself isn't violated). The issue is narrower than a forbidden crossing: it's that **AD-5's rule text is written as an exhaustive list, and four of the six IA touchpoints' interactive/response halves fall outside that list**, leaving their ownership technically unassigned rather than technically forbidden. Since AD-9 requires every behavior to have exactly one file as its home, this ambiguity should be closed rather than left to whoever implements it to guess.

---

## Summary of recommended follow-ups (not applied — spine left untouched per instructions)

1. Resolve how Data-Completeness (FR-4), Night close-out (FR-12–14), and Self-Check (FR-17) prompts get their answers when triggered by the unattended `ritual-cli.ts` — likely via a pending-prompt record in `storage-adapter.ts` picked up by the next `chat-cli.ts` session — and say so in AD-5 or a new AD.
2. Name an owner (or explicitly scope out of Phase 1's architecture concerns) for free-text intent classification within `chat-cli.ts` — currently absent from both the Stack and the Structural Seed despite being load-bearing for the entire chat interaction model.
3. Either resolve or explicitly carry "cold-start / first-run behavior" into the Deferred section — currently dropped.
4. Extend AD-5's enumerated `chat-cli.ts` scope to explicitly cover on-demand Plan viewing and the three prompt-response flows above, and name `rituals/self-check.ts`'s trigger path.
5. Optional/minor: name the Day-state enum's home in `types/domain.ts`, and state explicitly (as a Consistency Convention or AD-3 addendum) that `chat-cli.ts` must treat an open Proposal/prompt as blocking rather than accepting unrelated input concurrently.
