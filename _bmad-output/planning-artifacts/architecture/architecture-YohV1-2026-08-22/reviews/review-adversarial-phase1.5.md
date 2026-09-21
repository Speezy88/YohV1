---
name: review-adversarial-phase1.5
type: review
target: architecture-YohV1-2026-08-22/ARCHITECTURE-SPINE.md
lens: adversarial (construct two AD-compliant units that build incompatibly)
scope: Phase 1.5 Update pass — AD-3 (extended), AD-4 (cross-ref note), AD-11 (revised), AD-12 (revised), AD-13 (new), AD-14 (new), new types (FieldValueSuggestion, NotionPageDraft, CalendarEditChange)
note: AD-1–AD-12's original 6 incompatible pairs (see review-adversarial.md) are resolved and out of scope here. This pass targets only the new/changed material and its seams with the unchanged spine.
created: '2026-09-18'
---

# Adversarial Review — Phase 1.5 Update Pass

## Method

For each pair below: two units, one level down from the spine (a file or a
function inside a named file), each written by a builder who read only the
relevant AD text and the Structural Seed — never each other's code — and who
followed their AD to the letter. Each pair shows the two units still fail to
compose: a signature mismatch, two owners of one decision, or a state shape
neither AD actually pins down.

---

## Pair A — `CalendarEditChange`'s `create` variant has no signature to attach to

**Units:** `calendar-adapter.ts`'s `proposeCalendarEdit` (AD-13) vs. whichever
caller constructs a `create`-variant `CalendarEditChange` (chat-cli.ts's FR-27
free-text handling, or a future mid-day-reflow caller).

**The gap:** AD-13's Rule gives exactly one entry-point signature —
`proposeCalendarEdit(eventId, change)` — and says it's reached when an
*existing, untagged* event is the target ("An untagged event routes to a new
`proposeCalendarEdit(eventId, change)` / `applyCalendarEdit(proposal)`
pair"). But `CalendarEditChange`'s three variants are `move`, `resize`, and
`create` (Structural Seed, `types/domain.ts` comment). `move`/`resize`
obviously presuppose a pre-existing `eventId` to move/resize. `create` does
not — by definition there is no event yet to name. Nothing in AD-13 or the
Structural Seed says how a `create`-variant proposal is initiated, since the
one named entry point requires an `eventId` as its first argument.

Two builders resolve this two different, incompatible ways:
- **Builder 1** (owns `calendar-adapter.ts`) reads `proposeCalendarEdit(eventId, change)`
  literally and implements `eventId: string` as required/non-nullable — a
  `create` change is simply never constructible through this function; some
  *other*, unnamed function must exist for it, which Builder 1 has no reason
  to write since AD-13 names only one entry point.
- **Builder 2** (owns chat-cli.ts's FR-27 handling — "Spencer wants to add a
  new primary-calendar block") reads the same AD-13 text plus AD-4's
  Phase 1.5 note (the primary calendar's OAuth grant is now read/write) and
  concludes `create` *must* route through `proposeCalendarEdit` too, since
  that's the only confirm-gated Calendar entry point the spine names — and
  calls it with a synthetic/empty `eventId` (`''`, or the not-yet-existent
  event's client-generated placeholder id) to signal "no target."

Builder 1's implementation throws or type-errors on Builder 2's call
(`eventId` is treated as a real id to re-read via `proposeCalendarEdit`'s
"reads the live event" step — AD-13 says `proposeCalendarEdit` "reads the
live event and returns a `Proposal<CalendarEditChange>`", which is undefined
behavior for an event that doesn't exist). Both builders followed AD-13 to
the letter; the union type and the one named entry point are simply
inconsistent with each other.

**Fix:** Either (a) split the entry point — keep `proposeCalendarEdit(eventId, change)` for `move`/`resize` only, and add a separately-named
`proposeNewCalendarEvent(change: CalendarEditChange & {kind: 'create'})` with
no `eventId` parameter, moving `create` out of the shared union; or (b) if
`create` is meant to stay on the shared union, make `eventId` explicitly
optional/nullable in the type (`eventId: string | null`) and add one Rule
sentence to AD-13 stating what a null `eventId` means for the "reads the live
event" step (skip it entirely for `create`).

---

## Pair B — AD-3's generic `apply(proposal)` vs. three actually-divergent write signatures

**Units:** chat-cli.ts's interaction-request/Proposal resolution dispatcher
(built strictly from AD-3's Rule) vs. `notion-adapter.ts`'s `createPage`/
`updateTaskFields` (built strictly from AD-12/AD-11's Rules).

**The gap:** AD-3's Rule states the uniform mechanism: "Only `chat-cli.ts`,
after an explicit yes/no from Spencer, may call the matching `apply(proposal)`
function." Read literally, this promises one calling convention — pass the
whole `Proposal<T>` — for every Phase 1.5 write. But the three concrete
functions the spine actually names have three different shapes:
- `applyCalendarEdit(proposal)` (AD-13) — takes the `Proposal` object. Matches
  AD-3 literally.
- `createPage(database, properties)` (AD-12) — takes two *unwrapped* raw
  arguments, not a `Proposal`, and isn't named `apply*` at all.
- `updateTaskFields(...)` (AD-11, "the confirmed value flows through the
  existing `updateTaskFields` write path... FR-24 already established") —
  also takes raw field values directly, pre-dates the `apply(proposal)`
  framing entirely, and isn't named `apply*`.

A builder implementing chat-cli.ts's confirmation-resolution loop strictly
from AD-3's text has every reason to build one generic dispatch table —
`Record<ProposalKind, (p: Proposal<unknown>) => Result<...>>` — expecting
every write function to accept the whole `Proposal`. That code compiles and
type-checks against `applyCalendarEdit` but not against `createPage` or
`updateTaskFields`, which the `notion-adapter.ts` builder wrote to AD-12/
AD-11's literal (different) signatures. Neither builder violated their AD;
AD-3's generic framing and AD-12/AD-11's concrete signatures simply aren't
the same shape.

This also creates a second-order risk for FR-29: a builder who generalizes
FR-26's "draft → `Proposal<NotionPageDraft>` → confirm → `apply`" pattern
into a shared helper could easily route FR-29's `createPage` call through
that same confirm-gated helper — even though AD-3 explicitly carves FR-29 out
("Also does not bind: FR-29... FR-29 is modeled as direct-write, the same
shape as FR-24, not a Proposal"). Nothing besides careful reading distinguishes,
at the `createPage` call site, a FR-26 call (must be confirm-gated) from a
FR-29 call (must not be) — both call the identical function.

**Fix:** Add one line to AD-3 (or AD-12) stating explicitly that `apply(proposal)`
is a *pattern name*, not a literal shared signature — each concrete write
function unwraps its own `Proposal<T>`'s payload before calling the adapter's
enumerated write function, and only `applyCalendarEdit` happens to take the
`Proposal` itself because it needs the snapshot for its own internal
version-check (see Pair F). State the calling convention for `createPage`
under FR-26 explicitly: `chat-cli.ts` extracts `NotionPageDraft`'s `database`/
`properties` fields from the confirmed `Proposal` and calls
`createPage(database, properties)` — it does not pass the `Proposal` through.
Separately, mark the FR-29 call site (or add a type-level guard, e.g. a
`ResearchVaultDirectWrite` wrapper that isn't a `Proposal`) so a shared
propose-confirm helper can't accidentally swallow it.

---

## Pair C — AD-13's ownership-routing decision point is named nowhere

**Units:** `calendar-adapter.ts`'s AD-4 automatic update/delete path vs.
chat-cli.ts's FR-27 confirm-gated path.

**The gap:** AD-13's Rule: "`calendar-adapter.ts`'s existing ownership check
— the `PLAN_BLOCK_ID_EXTENDED_PROPERTY` tag AD-4 already uses to recognize a
Yoh-created event — now routes two ways instead of one. A tagged event stays
on AD-4's existing automatic path, unchanged. An untagged event routes to
[proposeCalendarEdit/applyCalendarEdit]." This describes *that* routing
happens but never names the function or module boundary where the branch is
evaluated, nor which caller is responsible for evaluating it.

Two builders make different, individually-AD-compliant calls:
- **Builder 1** (owns `calendar-adapter.ts`'s AD-4 update/delete functions)
  reads "the existing ownership check... routes two ways" as meaning the
  check lives *inside* the existing update/delete functions themselves — they
  now internally verify the tag and, if absent, return/throw a
  `not-yoh-owned` error instead of writing, on the theory that any caller who
  reaches them should already believe the event is tagged (mid-day-reflow.ts
  and night-ritual.ts only ever operate on known `PlanBlock`-linked, hence
  tagged, events — they have no reason to call `proposeCalendarEdit`
  themselves).
- **Builder 2** (owns chat-cli.ts's FR-27 handling — Spencer names an
  arbitrary event by description, tag status unknown a priori) assumes a
  single exported router/predicate — e.g. `resolveCalendarEditRoute(eventId)`
  — that calendar-adapter.ts exposes, returning which path applies, so
  chat-cli.ts never has to special-case "tagged vs. untagged" itself; it just
  calls one function and gets back either an applied result or a `Proposal`.

If Builder 1 is right, chat-cli.ts must itself read the event and check the
tag before deciding whether to call an AD-4 function or `proposeCalendarEdit`
— logic chat-cli.ts, per AD-1, isn't even supposed to own (ownership-check
logic belongs in the adapter). If Builder 2 is right, `calendar-adapter.ts`
needs one more exported function AD-13's Rule never names, and the AD-4
update/delete functions stay unaware of Phase 1.5 entirely — a materially
different shape of `calendar-adapter.ts`'s public surface. Both readings are
faithful to AD-13's prose; they can't both be what got built.

**Fix:** Name the routing function in AD-13's Rule explicitly, e.g.: "a single
exported `resolveCalendarEditRoute(eventId): {kind: 'owned'} | {kind:
'external'}` (or equivalent) is the one place this check happens; every
caller — AD-4's update/delete path included — goes through it rather than
re-deriving tag status inline." Pin which file calls it first (chat-cli.ts,
per AD-5's single-entry-point-for-confirmation rule).

---

## Pair D — The chat-intent router's return shape is never pinned anywhere

**Units:** `llm-adapter.ts`'s intent-classification function (built from
AD-5 + AD-14) vs. `chat-cli.ts`'s dispatch on that function's result (built
from AD-5).

**The gap:** AD-14: "Trigger classification... is not new infrastructure —
it is one more intent category in `llm-adapter.ts`'s existing
chat-intent-routing responsibility (AD-5), alongside its current
Mid-Day-Reflow / Blocker / open-prompt-answer / general-question categories."
AD-5 itself never defines a type or names a function for this router — it
only describes what chat-cli.ts *does* with free text ("routed and answered
via `llm-adapter.ts`"). Critically, the Structural Seed's `types/domain.ts`
inventory (the file AD-9 requires be locked before any dependent is
dispatched) lists exactly what's exported: `Task, CompleteTask, Plan,
PlanBlock, TimeBudget, Proposal<T>, EscalationCurve, EscalationLevel,
Result<T,E>, YohError`, plus Phase 1.5's `FieldValueSuggestion,
NotionPageDraft, CalendarEditChange`. **There is no intent-category type in
that list at all.** AD-9's own "single prerequisite file, authored first"
mitigation — the mechanism that closes exactly this kind of shape-drift for
every other shared type in this spine — doesn't cover this one, because
nobody put it in `domain.ts` to begin with.

Two builders, working from AD-5/AD-14's prose alone, produce genuinely
different shapes:
- **Builder 1** (llm-adapter.ts) implements a flat string-literal return type:
  `'mid-day-reflow' | 'blocker' | 'open-prompt-answer' | 'general-question' |
  'search-trigger'` — five categories, `search-trigger` newly appended per
  AD-14, each carrying its own differently-shaped payload the caller must
  know out-of-band.
- **Builder 2** (chat-cli.ts) — reading AD-14's phrase "an explicit ask, or an
  unambiguous factual question, versus an ordinary planning/status message"
  — assumes search classification is a *confidence-scored sub-field* of the
  existing `general-question` category (`{kind: 'general-question', isSearchTrigger: boolean, confidence: number}`) rather than its own top-level
  category, on the theory that a "factual question" is a kind of general
  question, not a disjoint one.

Builder 1's `switch` over five flat strings and Builder 2's `switch` over four
categories with a nested boolean are not the same discriminated union;
whichever one didn't write `llm-adapter.ts` will fail to compile against it,
or worse — if both sides use `any`/loose typing to paper over it — silently
never fire FR-28's search path or silently fire it on ordinary chat.

A related, narrower instance of the same gap: AD-11 says FR-25's field-value
suggestion is generated "when `llm-adapter.ts` can confidently derive one
from recent chat context" — it's ambiguous whether that derivation is itself
routed through this same intent-classification function (a sixth category,
e.g. `'missing-field-context'`) or is a wholly separate, uncategorized
internal call `data-completeness-gate.ts`'s caller makes directly. Nothing
resolves which.

**Fix:** Add the router's return type to `types/domain.ts`'s locked
inventory — e.g. `ChatIntent = {kind: 'mid-day-reflow', ...} | {kind:
'blocker', ...} | {kind: 'open-prompt-answer', ...} | {kind:
'general-question', ...} | {kind: 'search-trigger', query: string}` — as a
discriminated union, explicitly enumerating all categories including
`search-trigger`, and state in AD-5 or AD-14 whether FR-25's suggestion
generation is a routed category or a separate call path.

---

## Pair E — FR-25 suggestion generation: eager (ritual-time) vs. lazy (display-time), and who's allowed to make the call

**Units:** `rituals/morning-ritual.ts`'s Gate-check orchestration (built from
AD-11 + AD-1/AD-2) vs. `chat-cli.ts`'s open-interaction-request surfacing
(built from AD-5).

**The gap:** AD-11's Rule: a Task with a missing field "can only ever produce
an open interaction request (AD-5) asking for the missing field — or, per
FR-25, an open interaction request that carries an inferred candidate value
as a `Proposal` (AD-3) instead of a blind ask, when `llm-adapter.ts` can
confidently derive one from recent chat context." `data-completeness-gate.ts`
is a `core/*` file (AD-1: "may import only from `types/`... never from
`adapters/`"; AD-2: pure functions, no internal fetching of prior state). It
therefore *cannot* call `llm-adapter.ts` itself — an adapter — to get the
inferred value. AD-11's Rule never says which layer calls `llm-adapter.ts`
or when, only that the interaction request ends up "carrying" the suggestion.

Two builders fill that gap differently:
- **Builder 1** (morning-ritual.ts) reads "the gate... produce[s] an open
  interaction request that carries an inferred candidate value" as meaning
  the *ritual* orchestration calls `llm-adapter.ts` right after the gate
  flags a missing field, eagerly, during the morning Plan-generation run —
  and persists the interaction request to `memory-store.ts` already carrying
  a fully-formed `Proposal<FieldValueSuggestion>`.
- **Builder 2** (chat-cli.ts) reads AD-5's "`chat-cli.ts`... is the only
  place an open interaction request or open `Proposal` gets resolved" plus
  "confidently derive one from recent chat context" (context that may not
  even exist yet at 6am ritual time, before Spencer has said anything) as
  meaning the suggestion is generated lazily: `memory-store.ts` holds a bare
  `{kind: 'missing-field', taskId, field}` placeholder, and chat-cli.ts calls
  `llm-adapter.ts` itself, on demand, the moment it's about to surface that
  request to Spencer — only then constructing the `Proposal`.

These two builders persist two different shapes of "open interaction request
carrying a missing field" into `memory-store.ts` — one with a `Proposal`
attached at write time, one without. Whichever one didn't write
`memory-store.ts`'s schema/`chat-cli.ts`'s read path breaks: Builder 2's
chat-cli.ts, expecting a placeholder it must enrich, receives an
already-Proposal-wrapped record from Builder 1's ritual and double-generates
or mishandles it; or conversely Builder 1's downstream reader expects a
Proposal that was never attached because generation was deferred.

**Fix:** State explicitly in AD-11 (or AD-5) which layer calls
`llm-adapter.ts` for FR-25 and when — e.g.: "the calling `rituals/*.ts` file
(not the gate itself, per AD-1) invokes `llm-adapter.ts` synchronously right
after the gate flags a missing field, before persisting; the interaction
request `memory-store.ts` stores always already carries the `Proposal` if one
was confidently derivable, never a placeholder to be enriched later." Or the
opposite, if lazy generation at chat-cli.ts display-time is preferred — either
is fine, but pin one.

---

## Pair F — AD-3's uniform "re-read the live entity, check its version" staleness check doesn't apply to `createPage`

**Units:** a generic `applyProposal<T>` staleness-check helper (built from
AD-3's Rule literally) vs. `notion-adapter.ts`'s `createPage` (AD-12).

**The gap:** AD-3's Rule describes one staleness mechanism for *every*
`Proposal<T>`: "which first re-reads the live entity and rejects with
`YohError.kind: 'stale-proposal'` if its version no longer matches the
snapshot." This presupposes a live, already-existing, versioned entity to
re-read. For `Proposal<NotionPageDraft>` (FR-26/FR-29's `T`), the whole point
is that the target page **does not exist yet** — there is no entity to
re-read or version-compare before creating it.

AD-12 in fact already builds a *different* integrity mechanism for exactly
this function — "this same schema resolution runs twice: once at
draft-construction time... and again, authoritatively, at write time" — a
schema-drift check, not an entity-version check. But nothing says this
schema double-check *replaces* AD-3's generic staleness step for this `T`
specifically, rather than running in addition to it.

A builder who implements AD-3's staleness check as one shared, generic
`applyProposal(proposal)` wrapper — invoked uniformly before delegating to
whichever concrete write function matches the proposal's kind — will try to
"re-read the live entity" for a `NotionPageDraft` and either (a) crash on a
null/undefined entity id, or (b) silently skip the check with a
type-specific `if` the AD never authorized, guessing at the right behavior.
Meanwhile the `notion-adapter.ts` builder, following AD-12's Rule to the
letter, built `createPage` to be self-sufficient — its own double
schema-check is its complete integrity guarantee, expecting to be called
directly, never wrapped in a generic re-read-and-version-compare step it has
no live entity to satisfy.

**Fix:** Add one clause to AD-3 (next to the existing sentence): "For a
`Proposal<T>` whose write creates a new entity rather than modifying an
existing one (currently: `NotionPageDraft` via `createPage`), there is no
live entity to re-read — the `stale-proposal` check does not apply, and
AD-12's draft-time/write-time schema re-resolution is the sole integrity
guarantee for this `T` instead." This also resolves the ambiguity in Pair B
about whether `createPage` is called through a generic `apply(proposal)`
wrapper at all (answer: no — it's called directly with unwrapped arguments,
by design, because it has no staleness check to run).

---

## Summary

| Pair | New/changed AD(s) in tension | One-line description | Proposed tightening |
|---|---|---|---|
| A | AD-13 | `CalendarEditChange`'s `create` variant has no compatible entry-point signature — `proposeCalendarEdit(eventId, change)` requires an `eventId` that a not-yet-existing event can't supply | Split the entry point (separate `proposeNewCalendarEvent`) or make `eventId` nullable and define what null means |
| B | AD-3, AD-11, AD-12, AD-13 | AD-3's generic "call `apply(proposal)`" promises one calling convention; `createPage`/`updateTaskFields` take unwrapped raw args while only `applyCalendarEdit` takes the `Proposal` itself | State `apply(proposal)` is a pattern name not a literal shared signature; specify each function's actual unwrap-then-call convention; guard the FR-26/FR-29 `createPage` call sites so a shared confirm-helper can't swallow FR-29 |
| C | AD-4, AD-13 | The tagged/untagged routing decision point is described but never named as a function or pinned to a module — two builders assume different owners (AD-4's functions self-guarding vs. a shared router chat-cli.ts calls) | Name the routing function explicitly in AD-13 and state every caller, AD-4's included, goes through it |
| D | AD-5, AD-14 | The chat-intent router's return shape (categories incl. FR-28's search trigger) is never defined in `types/domain.ts`'s locked inventory, unlike every other shared type in this spine | Add a `ChatIntent` discriminated union to `types/domain.ts`'s locked list, enumerating all categories including `search-trigger`; state whether FR-25's suggestion generation is a routed category |
| E | AD-11 (FR-25) | AD-1 bars `data-completeness-gate.ts` (core) from calling `llm-adapter.ts` (adapter) itself, but AD-11 never says which layer does, or whether generation is eager (ritual-time) or lazy (chat-cli.ts display-time) — two incompatible `memory-store.ts` record shapes result | Pin the calling layer and timing explicitly in AD-11; state whether the persisted interaction request always carries the Proposal or is enriched later |
| F | AD-3, AD-12 | AD-3's uniform "re-read live entity, check version" staleness check has no entity to re-read for `NotionPageDraft` (`createPage` creates something new) — AD-12's double schema-check is a different, unstated substitute | Add a clause to AD-3 exempting entity-creating `Proposal<T>` instantiations from the stale-proposal re-read, naming AD-12's schema re-resolution as the substitute guarantee |

**Verdict:** 6 concrete incompatible pairs found in the new/changed material
(AD-3's extension, AD-11's revision, AD-12's revision, AD-13, AD-14, and the
three new types). All six share one root cause: AD-3's original text was
written when `Proposal<T>` had at most two instantiations in mind (learned
pattern, Time Budget change) that both cleanly fit "re-read an existing
entity, call `apply(proposal)`." Phase 1.5 bolted three structurally
different write targets — an in-place field update, a brand-new page, and a
calendar edit with its own move/resize/create sub-shape — onto that same
one-sentence generic description without re-deriving whether the generic
description still holds for all three. It doesn't, for at least one of them
(`createPage`), and the other two (`updateTaskFields`, `applyCalendarEdit`)
only "obviously" work because each one's Rule text happens to spell out its
own real signature elsewhere in the document — a reader who trusted AD-3
alone would still get it wrong.
