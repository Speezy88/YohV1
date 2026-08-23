---
title: Reconciliation — ARCHITECTURE-SPINE.md vs. prd.md + addendum.md
created: 2026-08-22
scope: PRD (FR-1..FR-23, NFRs, §8 Non-Goals) and PRD Addendum vs. ARCHITECTURE-SPINE.md
verdict: minor-to-real gaps (see findings; nothing invalidates the paradigm)
---

# Reconciliation: Architecture Spine vs. PRD + Addendum

Method: every FR-1..FR-23 and the four bound NFRs were checked against the spine's ADs, Conventions, Structural Seed, and Capability→Architecture Map for behavioral-contract coverage; §8 Non-Goals and Glossary "permanent" language were checked against the AD set for silent contradiction or omission; the addendum's three sections (Deferred Implementation Parameters, Technical Dependency Verification, Architecture Guidance) were checked line-by-line against the spine's Deferred section and Design Paradigm claim.

## A. FR/NFR behavioral-contract coverage

| Req | Covered by | Gap? |
|---|---|---|
| FR-1 | `rituals/morning-ritual.ts`; AD-1/2/8, AD-7 | Partial — see Finding 2 (the "exactly one notification per day" / no-silent-non-run guarantee isn't structurally enforced) |
| FR-2 | `core/derived-priority.ts`; weights deferred | OK |
| FR-3 | `core/plan-reasoning.ts` | OK |
| FR-4 | `core/data-completeness-gate.ts`; AD-1/2/8 | **Gap** — see Finding 1 |
| FR-5–FR-8 | `core/{time-budget,work-break-fit}.ts`; AD-3 for suggestions | OK |
| FR-9 | `rituals/mid-day-reflow.ts`; AD-5 (chat-cli only) | OK |
| FR-10 | `rituals/mid-day-reflow.ts`; AD-3 | **Ambiguous/contradictory** — see Finding 3 |
| FR-11 | `core/slip-bump.ts`; AD-6; curve deferred | OK |
| FR-12–FR-13 | `rituals/night-ritual.ts`, `adapters/email-adapter.ts`; AD-5/7 | OK |
| FR-14 | `rituals/night-ritual.ts` | **Gap** — "unchecked" as a distinguishable persisted state isn't in the domain model (see Finding 6) |
| FR-15 | `adapters/storage-adapter.ts` | OK |
| FR-16 | AD-3 | OK — well covered, this is the AD-3 case done right |
| FR-17 | `rituals/self-check.ts`; AD-6; threshold deferred | OK |
| FR-18–FR-19 | `core/tone.ts`; AD-6 | OK (prompt-content specifics like the "it's not just X, it's Y" ban are appropriately below architecture altitude) |
| FR-20 | `adapters/notion-adapter.ts` | OK |
| FR-21 | `adapters/calendar-adapter.ts`; freshness target deferred | OK |
| FR-22 | `adapters/calendar-adapter.ts`; AD-4 | Partial — AD-4 covers *which calendar* gets written, not the "prior Plan Block events aren't silently deleted on regeneration" clause (see Finding 7) |
| FR-23 | `adapters/notion-adapter.ts`; AD-4/8/10 | **Gap** — no ownership-by-construction analog for "only Status field written" (see Finding 5) |
| NFR-Reliability | AD-7 | **Gap** — see Finding 2 |
| NFR-DataIntegrity | AD-4 (Calendar only) | **Gap** — see Finding 5 |
| NFR-Latency | — | **Gap, most severe** — see Finding 4 |
| NFR-Observability | AD-7, Capability Map last row | OK |

## Findings

### Finding 1 — FR-4 / §8 Non-Goal 2: Data-Completeness Gate has no protective AD (unlike Propose-Don't-Impose)

The PRD gives FR-4 the same "permanent design stance, not an MVP shortcut" weight §8 gives Propose-Don't-Impose. The spine responds to Propose-Don't-Impose with AD-3, which structurally prevents violation ("modeled as data," only `chat-cli.ts` may call `apply()`). Data-Completeness Gate gets no equivalent: `data-completeness-gate.ts` is just another pure function in the Capability Map, governed by AD-1/AD-2/AD-8 (layering + no-shared-state + Result-typing) — none of which stop `morning-ritual.ts` from receiving a `missing-field` `Result` failure and defaulting or dropping the Task anyway. Nothing in the spine makes "silently default or silently drop" structurally impossible the way AD-3 makes "apply without confirmation" impossible. This is the clearest instance of a "quiet requirement" (permanent trust boundary) not landing as an architectural invariant.

### Finding 2 — NFR-Reliability's "must not rely on him noticing an absence" isn't addressed by AD-7

NFR-Reliability's operative clause is explicit: because there's no other user, Yoh "must not rely on [Spencer] noticing an *absence*." AD-7 only fires when `ritual-cli.ts` actually starts and something inside it throws or returns a `Result` failure — it is an in-process handler. It cannot detect or alert on the case the NFR is actually worried about: cron/systemd-timer/launchd never invoking the process at all (host down, misconfigured timer, permissions), which produces exactly the silent absence the NFR names. No AD, convention, or deployment note describes an external heartbeat/dead-man's-switch (e.g., "if no Pushover success ping arrives by 9am, something upstream of the process itself failed"). This is a real gap, not a nitpick — it's the specific failure mode the NFR text was written to rule out.

### Finding 3 — AD-3's framing of FR-10 as "Blocker resolution" risks contradicting FR-10/§8's ban on Blocker problem-solving

AD-3 binds "FR-10 (Blocker resolution)" and treats it as another case where "a function that would suggest a behavior... returns a `Proposal<T>`." But FR-10 and §8 Non-Goal 5 are unambiguous that Yoh "does not generate suggestions for resolving the underlying obstacle" at all — not even as a confirmable proposal. The only Blocker-related confirmation the PRD actually specifies is FR-16's "Blocker-handling decision requires explicit confirmation" (i.e., confirming the reschedule itself), which is a narrower thing than "resolution." AD-3's shorthand label ("Blocker resolution") could mislead an implementer into building a `proposeBlockerResolution()`-style function that violates the non-goal. Compounding this, the Capability→Architecture Map row for FR-9–FR-11 lists only AD-1 and AD-6 as governing — it does not list AD-3 at all — so the spine is internally inconsistent about whether AD-3 actually governs this capability. Recommend the spine (not this review) disambiguate: AD-3 should bind FR-16's Blocker-handling *confirmation*, not be labeled "FR-10 (Blocker resolution)."

### Finding 4 — NFR-Latency has no architectural representation anywhere in the spine

NFR-Latency appears exactly once in the entire document: in the frontmatter `binds:` list. There is no AD, no convention row, no Capability→Architecture Map entry, and no Deferred item addressing "fast enough to not feel broken (low seconds, not minutes)" for Plan generation. The Capability Map's cross-cutting NFR row ("Reliability / Observability") only maps two of the four bound NFRs (Reliability, Observability) to AD-7; Latency and Data integrity have no row at all. This is the single cleanest miss in the reconciliation: one of the four NFRs the spine's own frontmatter claims to bind is entirely unaddressed in the body.

### Finding 5 — NFR-DataIntegrity and FR-23's "only Status field, nothing else" have no Notion-side analog to AD-4's calendar ownership-by-construction

AD-4 gives Calendar writes a structural guarantee (separate OAuth scopes; a coding mistake fails at the API layer). FR-23 makes an equally load-bearing claim for Notion — "no other Task field ... is modified by Yoh as a side effect of close-out" — and NFR-DataIntegrity generalizes this to "must never corrupt or lose Task/Calendar data." Neither is backed by anything comparable on the Notion side: `notion-adapter.ts` is governed by AD-4 (which is Calendar-specific in its rule text), AD-8 (Result typing), and AD-10 (secrets) — none of which constrain *which fields* a Notion write call is allowed to touch. A future `notion-adapter.ts` write function could technically PATCH an entire Task page and this would violate FR-23 without tripping any AD.

### Finding 6 — FR-14's "unchecked day visibly distinguishable from closed day" isn't in the domain model

FR-14 requires an unchecked day be persistently distinguishable from a normally-closed day ("not silently treated as equivalent to a completed close-out"), and UJ-3's edge case additionally flags that *repeated* unchecked nights should themselves become visible to Spencer (also called out in PRD §11 Open Question territory). The spine's ER diagram (TASK, PLAN_BLOCK, CALENDAR_EVENT, PLAN, PROPOSAL, SLIP_RECORD) has no entity or field carrying a day/ritual-close-out status, so there's nothing in the Structural Seed that would obviously hold "unchecked" as a first-class state, let alone a consecutive-unchecked-nights counter. This is lower severity than Findings 1–4 (it's a data-modeling omission the build phase could still catch), but it is a behavioral contract the spine doesn't visibly carry forward.

### Finding 7 — FR-22's "prior day's events aren't silently deleted on regeneration" isn't covered by AD-4

AD-4 constrains *which calendar* Yoh may write/update/delete against (ownership by construction) but says nothing about *when* deletes may happen. FR-22's second consequence — "a prior day's Plan Block events remain as passive history unless explicitly cleaned up ... not silently deleted as a side effect of generating a new Plan" — has no corresponding rule anywhere; a same-calendar "clear yesterday's events before writing today's" implementation would satisfy AD-4 while violating FR-22.

### Finding 8 — Addendum's three-item "medium-confidence claims" group is only two-thirds captured in the spine's Deferred section

The addendum's Technical Dependency Verification section groups three claims under one bullet: "UTC-default timezone filtering, formula-property read-only status, **service-account/personal-calendar constraint** — all medium-confidence claims from the brief's addendum underpinning FR-20–FR-23." The spine's Deferred section carries forward only two of the three: "Notion UTC-default timezone-filter behavior and formula-property read-only status ... direct-docs check recommended before relying on either." The **service-account/personal-calendar constraint** — a real technical-risk item for FR-21/FR-22 (whether a service account can even read/write a personal Google Calendar) — is dropped entirely, not merely deferred elsewhere.

## B. Addendum guidance vs. spine paradigm — "keep planning/ritual logic decoupled from the CLI presentation layer"

Genuinely honored, with one caveat worth naming (not a rewrite request). The dependency direction (`shell → rituals → {core, adapters}`, `core` importable only from `types`) does keep Derived Priority, Slip-Bump, Escalate-Under-Strain, and the Proposal-generation half of Propose-Don't-Impose entirely out of `shell/*`, which is what the addendum asked for — a Phase 2 web surface really could call `rituals/*` without forking logic.

The caveat: AD-3's *enforcement* mechanism for Propose-Don't-Impose ("Only `chat-cli.ts` ... may call the matching `apply(proposal)` function") is a file-identity rule that currently names the CLI file specifically, not a rule expressed against an abstract "confirmed-by-user" concept. That's defensible today (adapters are swapped per phase, not at runtime, per the Design Paradigm's own stated reasoning for skipping a ports/DI layer) — but the spine's Deferred section, when it discusses Phase 2+ surfaces becoming "a new `shell/*` entry point calling the same `rituals/`/`core/`," cites only AD-1 as the invariant that continues to hold. It doesn't flag that AD-3's allow-list ("No other file calls an `apply*` function directly") will itself need editing to admit the new Phase 2 entry point. Minor, self-correcting at Phase 2 planning time, but worth naming since the question was asked directly.

## Overall verdict

**Minor-to-real gaps.** The paradigm itself (Functional Core / Imperative Shell) is sound and the addendum's explicit decoupling guidance is genuinely honored. But two of the four bound NFRs have incomplete or entirely absent architectural backing (Latency: absent; Reliability: addresses in-process failure but not the "silent absence" case the NFR text specifically names), one permanent trust boundary (Data-Completeness Gate) lacks the same by-construction protection given to its sibling boundary (Propose-Don't-Impose), and one AD's shorthand (AD-3 labeling FR-10 "Blocker resolution") is written in a way that could license exactly the behavior §8 forbids.
