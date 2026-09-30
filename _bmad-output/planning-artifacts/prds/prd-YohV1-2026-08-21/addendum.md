---
title: PRD Addendum: Yoh
created: 2026-08-22
updated: 2026-09-25
status: final
---

# PRD Addendum: Yoh

Companion to `prd.md`. Holds implementation-adjacent detail that came up while finalizing the PRD but doesn't belong in the capability-level FR text — deferred numeric parameters, technical dependency-verification items, and rationale that's useful context for architecture without being a behavioral requirement itself. Not a substitute for the brief's own `../../briefs/brief-YohV1-2026-08-21/addendum.md`, which covers the deeper technical-how (API endpoints, auth mechanics, hardware stack) — this file is PRD-scoped only.

## Deferred Implementation Parameters

These FRs specify direction and behavior in `prd.md`; the exact numbers are intentionally left for architecture/build, where they can be tuned against real data rather than guessed here.

- **FR-2 (Derived Priority) — secondary-factor weights.** Primary axis (Due Date proximity adjusted by Estimated Duration) is fixed by the PRD. The weighted score across Area, Energy fit, and difficulty that breaks ties beneath it needs real weight values — start with an even split across the three and tune after a few weeks of real Plans, rather than trying to guess correct weights up front.
- **FR-11 (Slip-Bump) — increment curve and cap.** Escalating-then-capped shape is fixed. A reasonable starting curve: small bump on slip 1, roughly double on slip 2, cap reached by slip 3-4. Needs to feel "escalating but never punishing" in practice — revisit after real slip data exists.
- **FR-17 (Self-Check) — low-score threshold.** A single low score shortens the check-in interval; what counts as "low" on whatever scale the score uses (assume 1-10 unless decided otherwise at build time) needs a concrete cutoff. Bias toward a threshold that under-triggers rather than over-triggers initially — Self-Check firing too often is itself an Escalate-Under-Strain violation.
- **FR-28 (Web search) — trigger classification and cost ceiling.** "Explicit ask or unambiguous factual question" (prd.md §5.8) needs a concrete classification rule at build time — start narrow (a short allowlist of trigger phrasings like "look up," "search for," "what is," plus direct questions ending in "?" that reference something outside Yoh's own data) and widen only if under-triggering turns out to be the actual problem in practice, never the reverse. Pair with a starting cost ceiling — e.g. a low daily call cap Spencer is warned about, not silently throttled by — to tune against real usage once FR-28 ships, since §7's Cost guardrail has nothing else bounding this call today.

## Technical Dependency Verification (pre-implementation)

Carried forward from reconciliation against the brief's addendum and the technical research — action items to verify before or during the relevant FR's implementation, not open design questions:

- **OAuth production-mode status** — Google's OAuth consent screen must be in "In production" mode before/at launch, or refresh tokens silently expire after 7 days (Testing-mode default). Highest-severity September 2, 2026 risk named in both the brief's addendum and the technical research. Verify and flip before FR-20/FR-21/FR-23 go live.
- **Notion internal-integration-token auth pattern** (medium confidence) — FR-20 (read Tasks/Projects) and FR-23 (write Task Status) both depend on this pattern working as the research described. Confirm against Notion's current docs before build.
- **UTC-default timezone filtering, formula-property read-only status, service-account/personal-calendar constraint** — all medium-confidence claims from the brief's addendum underpinning FR-20–FR-23. Direct-docs check recommended before implementation.
- **Calendar-read freshness** — the brief's addendum rejected ICS-based reads in favor of live Calendar API reads specifically for freshness/latency reasons; FR-21 assumes near-real-time reads. No explicit NFR number attached (the PRD's Latency NFR covers plan-generation compute time only) — worth a stated freshness target (e.g., "reflects changes made in the last N minutes") at architecture time if it turns out to matter in practice.
- **Primary calendar + tagging vs. dedicated secondary calendar** — open per PRD §11 item 3; affects FR-22's implementation approach, not its behavior contract.

## Architecture Guidance (non-binding)

- **Modularity for the roadmap.** The brief's differentiator that Yoh is "architected for the roadmap" (Phase 2 web app, Phase 3 hardware, Phase 4 iOS, Phase 5 Research Vault) isn't a testable FR — it's a constraint on *how* Phase 1 is built, not what it does. Concretely: keep the planning/ritual logic (Derived Priority, Slip-Bump, Escalate-Under-Strain, Propose-Don't-Impose) decoupled from the CLI presentation layer, so Phase 2+ surfaces can call the same core logic instead of forking it.
- **Pi voice-reliability spike.** The brief recommends an early spike test of voice reliability on Raspberry Pi hardware before committing to the Phase 3 architecture direction. Not Phase 1 work, but worth scheduling before Phase 3 planning locks in a hardware approach.
- **Phase 1.5 rollout independence.** FR-25–FR-29 should ship and be enabled independently rather than as one combined release — a bug or provider outage in FR-28 (web search) must not block FR-26/FR-27 (Notion/Calendar writes) from being usable, and vice versa. This was an explicit conclusion of the brainstorm behind this update (`_bmad-output/brainstorming/brainstorm-chat-cli-live-integrations-2026-09-17/`): each capability sits behind its own tier (§6 Data integrity), so gating them behind separate feature flags or build/deploy steps is a natural fit, not a new constraint invented here.

## Canvas API Integration (parked, pending access)

Captured 2026-09-16 while parking the Canvas LMS assignment sync in `prd.md` §9.4/§11 — quick research done up front so this is ready to pick up once school API access is granted, not a specified design yet.

- **What the API offers.** Canvas's REST API exposes assignment data two ways: an `assignments` endpoint, and a `calendar_events` endpoint that can return assignments as calendar-style events with due dates in an `all_day_date` field. Either is usable for "read assignment due dates"; the calendar_events shape also carries assignment-override data (which students/sections an assignment applies to) that Spencer's personal-use case doesn't need.
- **Auth is the actual blocker.** Canvas uses OAuth2 (RFC-6749) via a Developer Key (client ID/secret pair) that must be registered in the school's Canvas instance — for a hosted school instance, that requires the school's Canvas admin to issue it. That approval step, not any technical complexity, is what's currently pending. Once issued, tokens expire in ~1 hour and require the standard refresh-token flow — the same maintenance class as the Google OAuth integration already in Yoh (§6 Observability's "auth expired" failure mode applies here too, once built).
- **Design direction chosen (not yet built).** Canvas assignments sync into Notion Tasks rather than becoming a second Task-input path Yoh reads directly at plan-time. This means FR-20's existing Notion read, FR-4's Data-Completeness Gate, and FR-2's Derived Priority all apply to Canvas-sourced Tasks with zero new code — the sync only needs to create/update the Task's name, Due Date, and Area (mapped from the Canvas course); Estimated Duration and Energy are left blank for Spencer to fill via the existing Gate, exactly as any other incomplete Task today.
- **Left undecided (revisit when unblocked):** the course → Area mapping convention (one Canvas course per Area, or several courses folded into one Area); the dedup/update strategy when a previously-synced assignment's due date changes or the sync runs again (avoid duplicate Notion Tasks); and whether the sync runs as part of the Morning Ritual's existing read step or as its own separate scheduled job.
- **Next step once Canvas API access is granted — BMad path.** All 5 of Yoh's epics are `done` (`sprint-status.yaml`) and the architecture spine (`architecture-YohV1-2026-08-22/`) is finalized, so this isn't a fresh planning cycle — it's a small scoped addition on top of a shipped system:
  1. **Resolve the three undecided items above first** (course→Area mapping, dedup/update strategy, sync trigger point) — either talk them through with `bmad-prd` (update intent, quick) or just decide inline with whoever picks this up; they're small enough not to need a dedicated session.
  2. **`bmad-architecture`** — only if the sync ends up needing new architectural surface (e.g., a new scheduled-job pattern distinct from the existing Morning/Night Ritual cron, or a new credential-storage shape for the Canvas token). Skip it if the sync just reuses the existing Notion-write path and OAuth-token-storage pattern already in place for Google/Notion — check the spine before assuming a new pattern is needed.
  3. **`bmad-create-epics-and-stories`** — add a new epic (e.g. Epic 6) for the Canvas Sync to `epics.md`, sized as its own epic rather than folded into an existing done one.
  4. **`bmad-sprint-planning`** — re-run to fold the new epic's stories into `sprint-status.yaml` alongside the existing (done) epics.
  5. **`bmad-build`** per story, same as every other epic in this project.
  Skip straight to step 3 if the three undecided items turn out trivial in practice — don't let this ceremony gate a genuinely small addition.

## Phase 1.5: Live Integrations — Technical Notes

Sourced from `_bmad-output/brainstorming/brainstorm-chat-cli-live-integrations-2026-09-17/` (memlog + `brainstorm-intent.md`), which did the design exploration behind FR-25–FR-29. Capability-level contract is in `prd.md` §5.7–§5.8; this is supporting detail for architecture/build.

- **Architecture direction: extend, don't rebuild.** `chat-cli.ts` stays a deterministic command parser (as it is today for FR-1–FR-24), not a freeform LLM tool-calling loop. Each Phase 1.5 capability is a new named, typed command, same pattern as `parseTimeBudgetCommand`/`parseFieldAnswer`. This was an explicit brainstorm conclusion, not a default — the alternative (a general tool-calling loop) was considered and rejected as new architecture-class risk (hallucinated tool args, unbounded action space) the deterministic-parser approach doesn't carry.
- **Live Write Registry (§4 glossary term) — concrete shape.** A small fixed set of named functions the chat-cli commands call, mirroring the existing `NotionWriteClient` (`notion-adapter.ts`) and `CalendarWriteClient` (`calendar-adapter.ts`) interface pattern: `createNotionPage(database, properties)` for FR-26, `editCalendarBlock(eventId, change)` for FR-27 (only called after the chat-level confirmation step, never before), `searchWeb(query)` for FR-28, `saveToResearchVault(result)` for FR-29. No component holds a raw Notion integration token or Google API client Yoh can call arbitrarily — only these named functions are reachable from chat.
- **FR-26 schema validation.** Reuse FR-24's fuzzy-match-against-real-options guard (`updateTaskField`'s existing pattern) generalized to arbitrary target databases: fetch the database's schema via the existing `NotionSchemaClient` interface before drafting, validate every property against it, and fail closed (re-prompt) rather than create a page with an invented property or option.
- **FR-27 confirmation flow.** Distinct from FR-22's silent ownership check: FR-27 needs Yoh to (1) read the target event via `CalendarReadClient`, (2) show Spencer what specifically would change (not just "confirm?"), (3) only then call `editCalendarBlock`. The `PLAN_BLOCK_ID_EXTENDED_PROPERTY` tagging FR-22 already uses to recognize Yoh-owned events is the same mechanism that tells FR-27 an event is *not* Yoh-owned and therefore needs this confirmation path rather than FR-22's automatic one.
- **FR-28/FR-29 search provider.** `prd.md` §7 already named Perplexity as the anticipated provider back when Research Vault was Phase 5-scoped; no new research contradicts that choice, so it remains the working assumption for Phase 1.5 — confirm current API pricing/terms before build, since the cost guardrail (§7) depends on it staying low for single-user, on-demand volume.
- **Provenance/receipt mechanism.** The one-line chat receipts required by FR-26–FR-29 and the Data-integrity NFR (§6) are a chat-cli output concern only — no new storage. Source+timestamp tagging for FR-29's saved pages is a Notion page property, not a new subsystem.

## Phase 2: Web App — Technical Notes

Sourced from `_bmad-output/brainstorming/brainstorm-phase2-web-app-ui-2026-09-24/` (`brainstorm-intent.md`, `.memlog.md`). Capability contract is `prd.md` §5.9–§5.13; this section holds the how-leaning detail Spencer supplied, for `bmad-ux` and `bmad-architecture` to confirm or replace.

- **UI stack direction (from the brainstorm, not yet an architecture decision).** Tailwind CSS with a custom config for the neumorphic palette and shadows; neumorphism.io as the shadow-CSS generator; shadcn/ui as the headless component base (Chakra and Material 3 were considered as alternatives); Framer Motion / Motion (or GSAP) for motion.
- **Animation set.** transitions.dev free set: matrix-loader, thinking-states, shimmer-text, streaming-text, page-side-by-side, panel-reveal, tabs-sliding, reasoning-stream, skeleton-reveal; checkbox-check / dissolve for FR-41's check-off fade. transitions.dev's "Image generation placeholder" is the closest match to the Screensaver dot field but is Pro-only — **the Screensaver (FR-45) must be custom-built.**
- **Charts.** `@bklitui/ui/charts` for the Desk usage heatmap (HeatmapChart, Cells, XAxis, YAxis, Tooltip, Legend; fluid layout; week columns × 7 day rows). The Task Completed widget is modeled on Meta Muse's "Task Completed" feature.
- **Wordmark.** "Yoh Meeseek," bold Montserrat.
- **Architecture impacts to raise in `bmad-architecture`** (the spine is deliberately untouched by this PRD update):
  - **AD-3 / AD-5** name `chat-cli.ts` as the only place a `Proposal` is applied. FR-48 requires a surface-agnostic confirm path so the Web App's Approve button (FR-32) and Chat confirmations resolve Proposals through the same rules, including the stale-proposal check.
  - **AD-12** is titled and scoped "CLI-only"; FR-41 (check-off Status write), FR-38 (/sandbox via `updateTaskField`), and FR-51 (/research filing) need the same enumerated, schema-checked write surface reachable from the Web App — still never from a cron-triggered ritual run.
  - **Reshuffle writes (FR-32)** touch only the "Yoh Plan" calendar, so they fit AD-13's narrow client / AD-4's API-layer isolation rather than FR-27's broader client — worth confirming explicitly.
  - **Completion/Activity Log (FR-47)** is new durable storage — likely `memory-store.ts` territory (SQLite), needing an owner under AD-9.
  - **Routines (FR-35)** are new durable storage plus a daily placement step in the Morning Ritual.
  - **In-App Notifications (FR-49)** need a server-to-browser delivery path (push/stream) and a persisted unread state; `/research` (FR-51) needs a background job that survives the browser tab closing.
  - **Public feeds (FR-44)** add three outbound integrations; each must fail independently (no shared failure path with Notion/Calendar), with caching to stay inside free-tier rate limits.
- **Deferred implementation parameters (Phase 2).** Starting values, to tune in use: Reshuffle Preview begins animating ≤ ~2 s after drag-release; check-off undo window ~5 s; idle timeout before the Screensaver ~5 min; feed refresh ~5 min for crypto, ~30 min for weather, ~60 min for news (adjust down if a free tier's rate limit requires).

## Notes

Nothing in this addendum overrides `prd.md`. Where this file states rationale or a starting point, `prd.md`'s FR text is still the binding contract; this is supporting detail for whoever (Spencer, wearing the architect/dev hat) picks up implementation next.

## Epic 13: Memory — Technical Notes (added 2026-09-29)

For `bmad-architecture`. These are starting points, not requirements.

- **Storage:** a server-side chat store (the Spine's anticipated `chat-store.ts` owner under AD-10) plus a memory-item store in SQLite. Each item records folder, text, stated/inferred, created/updated, source turn, optional expiry, and `supersededBy`. Ratings go in their own small log table, never in memory.
- **Retrieval:**
  - Always-loaded folders are injected into every answering/capture/planning model call under a fixed character budget. Research reference points: Letta core memory is about 2k characters; ChatGPT's saved memory is about 1.2–1.4k words.
  - When-relevant folders and chat-history search use SQLite FTS5 (BM25).
  - No embeddings: keyword search is sufficient at hundreds of items (see https://dev.to/intframe/grep-first-embed-when-it-earns-it-530a on grep-first retrieval). Revisit at about 10,000 items, or if keyword search visibly misses (PRD §9.4, §11 item 15).
- **Filing:**
  - One Haiku extraction call per non-trivial turn chooses ADD, UPDATE, SUPERSEDE, or NOOP against the most similar existing items (the Mem0-style operation set).
  - The same extraction call classifies sensitive content (health, emotions, finances) and drops anything Spencer did not state outright, which enforces FR-54's ban, including on FR-60 "What was off?" answers. It also proposes an expiry for time-bound items.
  - Deterministic recognizers in `core/` handle "remember", "forget", and "what do you remember" before any LLM step (AGENTS.md anti-pattern 7).
- **Deferred parameters (Epic 13):** the always-loaded cap, the trivial-turn filter, pattern evidence thresholds and the 30-day quiet period are open (PRD §11 item 14).
- **Research digest (2026-09-29):** Claude Code typed memory (user/feedback/project/reference, one fact per file, index always loaded), ChatGPT saved memories vs chat-history reference, Letta/MemGPT core/recall/archival, LangMem semantic/episodic/procedural, Mem0 extract-then-update, Zep/Graphiti temporal invalidation. The failure modes it names each have a mitigation in the PRD:
  - bloat → FR-56 cap;
  - stale facts → FR-53 expiry and FR-54 supersede;
  - wrong inferences → the stated/inferred label, the FR-54 sensitive-inference ban, and FR-58 repeated evidence;
  - creepy recall → FR-56 "only when it changes the answer";
  - over-generalized feedback → each Feedback item stores its reason and scope.
