---
title: Rubric Review — Yoh Architecture Spine
reviewed: ARCHITECTURE-SPINE.md + .memlog.md (architecture-YohV1-2026-08-22)
against: PRD prd-YohV1-2026-08-21 (prd.md + addendum.md), UX EXPERIENCE.md/DESIGN.md (not independently re-litigated — spine's own sources list checked)
reviewer: rubric-walker pass
date: 2026-08-22
---

# Verdict

**Conditional pass with one critical gap.** The spine is genuinely terse, well-formed (no placeholders, no duplicate AD ids, real mermaid diagrams), and its ADs are mostly concrete and enforceable — but it silently fails to give the level below a scheduling/triggering contract for two named FRs (FR-13's timed escalation retry and FR-17's periodic Self-Check), which its own "two shell entry points, cron twice daily" model actively appears to contradict rather than merely omit.

---

## Findings, tiered by severity

### CRITICAL

**F1 — No scheduling/triggering contract for FR-13's timed retry or FR-17's periodic Self-Check; AD-5's model actively conflicts with both.**

- AD-5 states: "`ritual-cli.ts` ... is the only path that runs Morning/Night Ritual orchestration unattended," and the deployment mermaid diagram labels the cron edge `-->|"twice daily"| ritualcli`. This is presented as the complete unattended-scheduling story.
- FR-13 requires a **first** close-out attempt (push) and, only **if unacknowledged**, a **second**, later attempt via a different channel (email) — this necessarily requires a real time gap and a re-check, not one atomic invocation. Nothing in the spine says how that second, delayed check happens: a third cron-triggered invocation with persisted state ("already sent attempt 1, N minutes elapsed, escalate")? A sleep inside the one-shot process (which would make it not one-shot, and would sit oddly with "cron twice daily")? This is undecided.
- FR-17 (Self-Check) needs an *entirely independent* trigger — "approximately every 4 days, at a randomized time" — that is neither the morning nor the night ritual. `rituals/self-check.ts` exists in the Structural Seed and is bound to AD-6/AD-10 in the Capability Map, but AD-5's enumeration of the two entry points' responsibilities never mentions it, and the only CLI usage shown (`yoh ritual morning|night`) has no self-check subcommand or independent cron entry.
- Why this matters at this altitude: this is exactly the kind of divergence point the spine exists to close before build. Two independently-built pieces (`rituals/night-ritual.ts` and `rituals/self-check.ts`) would each have to *invent* a triggering assumption with no shared contract to check against — the textbook Superpowers failure mode (file-independent tasks silently disagreeing about an interface, here the "who invokes me and when" interface) that this spine's whole paradigm choice was supposed to prevent via explicit signatures.
- Fix shape (not prescribing, just noting it's answerable): either (a) add a third cron-invoked subcommand/timer for escalation-check and for self-check scheduling, each with an explicit signature, or (b) name the persisted state each ritual reads to decide "am I due," and update AD-5 and the deployment diagram to reflect however many actual triggers exist. Currently "twice daily" is stated as fact and is wrong for the feature set as specified.

### HIGH

**F2 — NFR-Latency is bound in frontmatter but never appears again anywhere in the document.**

- Frontmatter `binds` explicitly lists `NFR-Latency` alongside Reliability/DataIntegrity/Observability. The other three each have at least one AD and a Capability-Map row. `NFR-Latency` has zero: no AD references it, it's absent from the Capability → Architecture Map, and it is not listed under Deferred or as an open question either.
- The rubric's operative rule is explicit: "a whole dimension left silent is a finding" — and this one is doubly notable because it's a dimension the document itself claims to bind, not one it merely didn't think to bind. The PRD's own Latency NFR ("fast enough to not feel broken... low seconds, not minutes") is a real, checkable requirement (e.g., it constrains `plan-reasoning.ts`/`derived-priority.ts`/`work-break-fit.ts` computation, and possibly bounds how much can be done inside `morning-ritual.ts` before the notification fires) — it deserved at minimum a one-line "satisfied by design because X, no dedicated AD needed" note, or a Deferred entry.

**F3 — FR-4's Data-Completeness Gate human-interaction path isn't assigned to either shell entry point.**

- FR-4 requires Yoh to *prompt Spencer* to fill a missing required field before planning around that Task — a genuine human-in-the-loop step, not just a pure-function check. `core/data-completeness-gate.ts` (correctly) holds only the pure check.
- But AD-5 enumerates chat-cli.ts's responsibilities as an apparently exhaustive list — "Mid-Day Re-Flow, Blocker reports, Time Budget changes, and Propose-Don't-Impose confirmations" — and Data-Completeness Gate answers are not in that list. Nor does `ritual-cli.ts` (one-shot, unattended, unable to block for interactive input) have an obvious way to collect the answer itself.
- A plausible resolution is inferable (ritual-cli sends a notification and excludes the task from today's Plan; Spencer answers later via chat-cli, which then triggers a Mid-Day Re-Flow) — but it is inferable, not decided, and AD-5's wording as written would lead an implementer to conclude chat-cli does *not* own this. Worth an explicit line either in AD-5 or the Capability Map row for FR-1–4.

### MEDIUM

**F4 — `storage-adapter.ts` bundles two logically distinct capabilities into one file, in tension with AD-9.**

- The Structural Seed's own comment on the file reads: `storage-adapter.ts # better-sqlite3: hot/cold memory (FR-15), OAuth token persistence`. Hot/cold memory (a domain/product capability) and OAuth-refresh-token persistence (a security/config capability, separately called out by AD-10) are unrelated concerns sharing one file purely because both happen to use SQLite.
- AD-9 ("File-level task ownership") says "every behavior... has exactly one file as its home. A new capability that doesn't fit an existing file gets a new file." By that same rule, OAuth-token persistence arguably deserved its own file (e.g. `token-store.ts`) rather than being folded into the memory adapter — as written, a future task touching Self-Check memory writes and a future task touching OAuth refresh-token rotation would both need to open the same file, which is precisely the "shared file becomes a bottleneck" failure AD-9 exists to prevent.
- Not necessarily wrong (the adapters/ convention is "one file per external system," and SQLite is one system) — but the tension with AD-9's own stated rule is real and undiscussed.

**F5 — The deferred Notion auth-pattern verification is more load-bearing than the Deferred section treats it.**

- Deferred item: "Notion internal-integration-token auth pattern — medium-confidence... confirm against current Notion docs before build." But AD-10 has already *decided* the shape this must take: "static secrets (Notion token, ...) load once from environment variables at process start" with no persistence path analogous to the Google refresh-token handling.
- If the medium-confidence claim turns out wrong (e.g., Notion's integration auth actually needs a refresh/rotation step under some configuration), AD-10 as written breaks, and whichever adapter file was already built against the "static, no persistence" assumption would need rework that could ripple into `storage-adapter.ts`'s scope (see F4). This makes the deferred item quietly load-bearing on AD-10 rather than a pure verify-and-proceed item — worth flagging AD-10's Notion-token clause as contingent on that verification rather than presenting it as settled.

### LOW

**F6 — Minor stack-version drift, non-blocking.**

- Cross-checked the Stack table against live search today (2026-08-22): `Node.js` 24.12+ type-stripping-stable, `better-sqlite3` 13.0.3, `google-auth-library` 11.0.2, `nodemailer` 9.0.5, and `@googleapis/calendar` 16.0.0 all matched exactly — strong evidence the memlog's "(version) Verified 2026-08-22 via web search" entries reflect real lookups, not training-data recall (my own training cutoff predates all of these releases, so an asserted-not-verified number could not plausibly land this close).
- One discrepancy: `@notionhq/client` is pinned at `^5.22.0`; current npm latest is ~5.25.x. Functionally harmless given the caret range, but suggests the verification snapshot was already a few point-releases behind even on the day it was written — worth a mental note, not a blocking issue.
- TypeScript 7.0 GA is corroborated as a real July 2026 event (search: GA July 8, 2026; the spine's "7.0.2... released 2026-08-05" is plausibly just a later patch release, not a contradiction).

---

## Rubric items checked clean (no findings)

- **AD enforceability/vagueness:** all 10 ADs have a concrete, checkable Rule (import-direction constraints, a single named function signature, a file-ownership constraint, a Result-type contract, etc.). AD-4 in particular is strong — enforced at the OAuth-scope/API layer, not just by review. None merely restate their own Binds line.
- **Deferred list vs. incompatible-divergence risk:** the three deferred *numeric* parameters (FR-2 weights, FR-11 curve/cap, FR-17 threshold) are all single-file constants inside pure functions, not cross-file contracts — safe to defer. (Exception: F5 above, re: Notion auth pattern.)
- **Capability → Architecture Map:** FR-1 through FR-23 are all traceable to a file and governing AD; no FR is silently missing from the map. (NFR-Latency is the one bound item missing — see F2.)
- **Operational/environmental envelope:** deployment target, host model, no-staging/prod stance, and cost constraint are explicitly decided in the "Deployment & environments" paragraph; backup/durability for the SQLite file is explicitly named under Deferred (weak resolution, but not silent).
- **Terseness:** the document reads as a build substrate, not prose rationale — the "why" lives in `.memlog.md`, matching the intended split. No template placeholders, no empty/fake mermaid diagrams (all three diagrams carry real, specific content), no duplicate AD ids.
- **Structural Seed vs. Superpowers file-independence, otherwise:** aside from F4 (`storage-adapter.ts`), the remaining `core/`, `rituals/`, and `adapters/` files each map to a single, nameable behavior with a plausible one-TDD-unit scope.
