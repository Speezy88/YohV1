---
name: reconcile-phase2-prd-ux
type: review
subject: architecture-YohV1-2026-08-22/ARCHITECTURE-SPINE.md (Phase 2 amendments)
reconciled-against:
  - prd-YohV1-2026-08-21/prd.md (§5.9-5.13, amended FR-2/4/23/24, §6, §7, §8, §9.3, §11 items 8-13, §12)
  - prd-YohV1-2026-08-21/addendum.md ("Phase 2: Web App — Technical Notes")
  - ux-YohV1-2026-08-21/EXPERIENCE.md
  - ux-YohV1-2026-08-21/DESIGN.md
  - ux-YohV1-2026-08-21/.memlog.md (Phase 2 decisions, lines 10-65)
created: 2026-09-25
---

# Reconciliation: Phase 2 spine vs. PRD/UX inputs

## Verdict

The spine correctly absorbs the addendum's own "architecture impacts" checklist and the large majority of PRD/UX Phase 2 content, but it has one real internal contradiction (a closed enum that breaks its own stated rule), one unresolved accessibility path that two competing spine mechanisms both half-cover, and several UX decisions with genuine storage/state consequences that never got an owner — most center on "what happens to ritual-created interaction needs and ephemeral client state once the CLI is gone."

## Findings

### F1 — `NotificationKind`'s closed union contradicts AD-5's own promise for Self-Check and close-out [HIGH]

**Source:** ARCHITECTURE-SPINE.md AD-5 Phase 2 bullet (line 103): *"A ritual that needs Spencer's attention (a needs-data Task, an open close-out, a Self-Check due) also appends an in-app notification (AD-18) alongside the interaction request."* vs. AD-18 (line 222): *"`NotificationKind` is a closed union in `types/api.ts` covering FR-49's consumers: `research-ready`, `research-failed`, `sandbox-complete`, `sandbox-failed`, `needs-data`, `reshuffle-apply-failed`, `operational`."*

**Problem:** `needs-data` is the only one of the three cases AD-5 names that actually has a matching `NotificationKind`. There is no kind for "a Self-Check is due" or "an open close-out (unchecked-day risk)." AD-18's union is explicitly closed ("A progress or check-in notification is not a constructible value" — this is the mechanism FR-49's "never proactive" guarantee relies on), so AD-5's promise can't be satisfied by construction; it can only be satisfied by silently repurposing `operational`, which the spine never says to do.

This is also exactly the gap EXPERIENCE.md flags and leaves open in its own Open Questions (line 277): *"Where Ritual-created Proposals, Self-Check prompts, and the unchecked-day flag surface when Spencer isn't in Chat — there is no FR-49 consumer for them."* The spine reads as though it answered that question (AD-5's parenthetical), but AD-18 never actually built the answer.

**Proposed fix:** Add explicit `NotificationKind` members — e.g. `self-check-due`, `close-out-open` (or fold "open close-out" into a renamed `needs-attention` covering both needs-data and self-check/close-out with a sub-discriminant) — and update AD-5's Phase 2 bullet to name them, or update AD-18's enumerated list directly. Either way, close the loop EXPERIENCE.md left open rather than let it read as already resolved.

### F2 — WCAG 2.5.7 non-drag reshuffle path has no wired entry point [HIGH]

**Source:** EXPERIENCE.md Accessibility Floor (line 154): *"**Dragging alternative (WCAG 2.5.7):** `[ASSUMPTION]` A typed Chat request ('move my study block to 4') via Mid-Day Re-Flow is the non-drag path to the same Reshuffle Preview."* vs. ARCHITECTURE-SPINE.md AD-19 (lines 227-236), whose only entry point into `app/request-reshuffle.ts` is a drag payload (`{kind: 'move-block', ...}` / `{kind: 'pin-task', ...}`, line 232).

**Problem:** Mid-Day Re-Flow (FR-9) already has an older Phase-1 pipeline — `rituals/mid-day-reflow.ts` (Structural Seed line 325), reached via `chat-cli.ts`'s free-text routing (AD-5's Phase 1/1.5 wording, line 100) — that predates AD-19 and never produces a `Proposal<ReshufflePreview>`. UX now requires that a *typed* re-flow request produce "the same Reshuffle Preview" a drag does. Nothing in the spine says whether a typed request should now route into `app/request-reshuffle.ts` (AD-19's new pipeline) instead of, or as well as, the old `mid-day-reflow.ts` ritual — so today the two possible non-drag paths (old ritual vs. new reshuffle Proposal) both exist unreconciled, and neither is explicitly wired to satisfy the a11y requirement.

**Proposed fix:** Add a `ChatIntent` variant (parallel to AD-14's `{kind: 'search-trigger', ...}` pattern) — e.g. `{kind: 'reshuffle-request', change}` — that `chat-turn.ts` dispatches into the *same* `app/request-reshuffle.ts` AD-19 already defines, so both drag and typed text produce one `Proposal<ReshufflePreview>` through one code path. Note in AD-19 (or AD-1's Phase 2 bullet) that `rituals/mid-day-reflow.ts` is superseded for this purpose, or explicitly scope it to a narrower remaining case.

### F3 — Screensaver's "unsent text + scroll position survives" guarantee has no client-state home [MEDIUM-HIGH]

**Source:** PRD FR-45 consequence (line 633): *"The idle Screensaver dismisses on any input and returns Spencer to the page he was on, with any unsent chat text intact."* EXPERIENCE.md State Patterns (line 132): *"Idle 10 min | Any input returns to the same page, scroll position, and state."* Component Patterns, Chat Input (line 84): *"Unsent text survives the Screensaver and page swipes (FR-45)."*

**Problem:** AD-17 (line 213) is the spine's only statement about client-side state, and it defines client state purely as *"a cache of server state, refreshed after each mutation and on each SSE hint."* An unsent chat draft and a scroll offset are neither: they're ephemeral, client-only, never-sent-to-server state that a naive Screensaver overlay (mount/unmount of the underlying page) would wipe unless something explicit keeps it alive. This is a tested PRD consequence, not a nice-to-have, and it's currently unaddressed by any AD or convention.

**Proposed fix:** Add a line to AD-17 or the Web UI Consistency Convention row: ephemeral UI state that must survive the Screensaver and page swipes (chat draft text, scroll position, open Command Palette state) lives in a persistent client-side store above the per-page component tree (e.g. a small Zustand/context slice), never in state local to a component the Screensaver would unmount.

### F4 — No storage owner for Chat conversation history, despite UX assuming persistence [MEDIUM]

**Source:** EXPERIENCE.md Component Patterns, Sandbox Card (line 90): *"Cards stay in chat history."* Open Questions #13 (line 281): *"Chat history persistence across launches (Sandbox Cards 'remain in history')"* — itself unresolved by UX.

**Problem:** AD-10's Phase 2 storage split (line 146) enumerates an owner file for every new record kind (`completion-log.ts`, `routine-store.ts`, `plan-state-store.ts`, `notification-store.ts`, `job-store.ts`) but none for chat/conversation transcripts. If UX resolves its own open question toward "yes, history persists across launches," there is currently no owner file this would slot into — a gap worth flagging now rather than after UX decides, since it changes AD-10's storage-split enumeration and possibly AD-9's file-ownership rule.

**Proposed fix:** Add a Deferred entry naming this dependency on UX's open question, and reserve the shape of the fix (a `chat-store.ts` owner, if persistence is chosen) so it isn't a surprise mid-build.

### F5 — No defined mechanism for persisted client-only preferences (Theme Toggle, Tasks grouping) [MEDIUM]

**Source:** EXPERIENCE.md Foundation (line 32): *"the first launch follows the OS appearance, and a manual toggle persists after that."* Component Patterns, Grouping Control (line 96): *"The choice persists across visits."* `[ASSUMPTION]`s in both cases.

**Problem:** Same shape as F3/F4: these are per-viewer preferences that must survive a reload, and AD-17's "client state = cache of server state" framing doesn't cover them. Nothing says whether they're `localStorage` (fine for single-device use, but Spencer uses both a Mac and a Windows PC per AD-15 — a `localStorage`-only choice means the theme and grouping choice don't follow him between devices) or a tiny server-side preference record.

**Proposed fix:** One Consistency Convention line: name where per-viewer UI preferences live (recommend `localStorage`, and explicitly accept the known consequence that theme/grouping choice is per-device, not per-Spencer, given AD-15's two-device reality) or add a `preferences` record to `plan-state-store.ts` if cross-device parity is wanted.

### F6 — Skill Switcher's reserved (but hidden) layout space isn't in the Structural Seed or Capability Map [LOW-MEDIUM]

**Source:** EXPERIENCE.md IA table (line 41: Chat's Key components list includes *"Skill Switcher (hidden in Phase 2, space reserved)"*) and Component Patterns (line 89): *"The IA reserves the left-bar space. The switcher appears once a second real skill (Goals) exists... Flagged for PRD update."* PRD §9.4 (line 779) only says the menu bar "ships empty."

**Problem:** This is real, if minor, architectural information: a future capability (multi-skill Chat) needs the Chat page's layout, and possibly `app/chat-turn.ts`'s intent routing, to have a seam for it later. Nothing in the Structural Seed's `web/pages/` list or the FR-42 Capability Map row mentions this reservation, so a future implementer has to re-derive it from UX docs rather than the spine.

**Proposed fix:** A one-line note under FR-42's Capability Map row or AD-16: Chat's layout reserves a left-bar region for a future Skill Switcher; no `app/` seam is needed yet since General chat is the only skill.

### F7 — AD-17's CSP doesn't fully cover the "no third-party script" guarantees it's meant to enforce [LOW]

**Source:** PRD §7 (line 724): *"The Web App's own assets and data stay on Spencer's host — no third-party analytics script ships in it."* Consistency Conventions, Web UI row (line 278): *"Fonts are self-hosted... and never loaded from a third-party CDN (§7 Privacy)."* vs. AD-17 (line 215): *"The Content-Security-Policy allows `connect-src 'self'` only."*

**Problem:** `connect-src 'self'` blocks outbound network calls to non-self origins (the thing AD-17 cites it for — no credential/data exfiltration), but it doesn't restrict `script-src` or `font-src`, so nothing in the spine's stated CSP actually prevents a third-party analytics `<script>` tag or a CDN-hosted font from being included, even though §7 and the fonts convention state both as categorical "never"s.

**Proposed fix:** Extend AD-17's CSP line to also state `script-src 'self'` and `font-src 'self'`, matching the guarantees §7 and the Consistency Convention already claim.

### F8 — AD-5's Phase 2 wording is looser than UX's precise "blocks conflicting writes, not unrelated chat" rule [MEDIUM]

**Source:** EXPERIENCE.md Component Patterns, Structured Question (line 88): *"An unanswered question blocks conflicting writes but not unrelated chat `[ASSUMPTION]`."* vs. AD-5 Phase 1/1.5 wording (line 100): *"it surfaces any open interaction requests before accepting an unrelated command"* (i.e., blocks), carried into the Phase 2 bullet (line 103) as: *"'surfaces open requests before an unrelated command' means Chat renders open interaction requests and Proposals ahead of new input."*

**Problem:** "Renders... ahead of new input" is ambiguous between (a) a display-ordering rule (show old items first, but new chat still proceeds) and (b) the original Phase 1 hard block (nothing else is accepted until the open item resolves). UX's stated rule is narrower and more usable: block only writes that would conflict with the open item, let ordinary chat continue. The spine doesn't clearly pick between these readings.

**Proposed fix:** Tighten AD-5's Phase 2 bullet to state the UX's narrower rule explicitly: an open interaction request/Proposal blocks only a conflicting write, never ordinary chat traffic.

### F9 — Birthday confetti's "today" isn't pinned to the spine's own configured-timezone rule [LOW]

**Source:** DESIGN.md Motion table (line 341): *"Birthday confetti | Feb 19 on Home (`[ASSUMPTION]` first Home view that day) | one short burst."* vs. Consistency Conventions, Data & formats row (line 276): *"'Today', Pin expiry, activity days, and the streak all use one configured local timezone (the host's `TZ`), never the browser's."*

**Problem:** Purely decorative and low-risk (single user, single location), but the spine's own convention exists precisely to prevent client-local-time drift for "is it today" checks, and the confetti trigger is exactly that kind of check. It's currently outside the convention's stated scope ("Pin expiry, activity days, and the streak" — confetti isn't listed).

**Proposed fix:** Either extend the Data & formats convention to cover "any client-side date-equality check (including the birthday confetti)," or explicitly note the confetti is allowed to use browser-local date since the consequence of drift is trivial.

## Not flagged (checked, landed correctly)

For completeness — these were checked against the "quiet requirement" list in the task and found to be present in the spine, not dropped: Structured Question component (AD-3, AD-9, AD-21), the deferred Notion write on check-off (AD-20, matches UX's accepted lid-close risk with an explicit `[ASSUMPTION]` cross-reference), the dark/light toggle's *existence* as a sanctioned FR-46 exception (not covered here — see F5 for its persistence-mechanism gap specifically), the Windows platform's OAuth/Tailscale/PWA concerns (AD-15, Deferred), the Screensaver's 10-minute idle timeout (Deferred correctly uses the UX's 10 min over the addendum's stale ~5 min draft value), and all six items on the addendum's own "Architecture impacts to raise in bmad-architecture" checklist (AD-3/AD-5 confirm path, AD-12 CLI-only title, reshuffle writes' calendar-client scoping, Completion/Activity Log ownership, Routines storage, In-App Notifications delivery + /research job durability, public feeds isolation).

## Top 5 (for handback)

1. **F1 [HIGH]** — `NotificationKind`'s closed union (AD-18) has no member for "Self-Check due" or "open close-out," contradicting AD-5's own promise and leaving EXPERIENCE.md's flagged Open Question #9 unresolved. *Fix: add `self-check-due`/`close-out-open` kinds (or equivalent) and update AD-5/AD-18 together.*
2. **F2 [HIGH]** — WCAG 2.5.7's required non-drag reshuffle path has two half-built candidates (old `mid-day-reflow.ts` ritual vs. new `app/request-reshuffle.ts`) and the spine never says which one satisfies it. *Fix: add a `reshuffle-request` ChatIntent that calls `app/request-reshuffle.ts` directly, and mark `mid-day-reflow.ts` superseded for this case.*
3. **F3 [MED-HIGH]** — Screensaver's tested guarantee (unsent chat text + scroll position survive) has no client-state home under AD-17's "state is a cache of server state" framing. *Fix: add an ephemeral-client-state rule to AD-17/Web UI convention.*
4. **F4 [MED]** — No storage owner reserved for Chat history despite UX assuming persistence ("Cards stay in chat history"), and UX's own Open Question #13 on this is unresolved. *Fix: Deferred-list entry now; reserve a `chat-store.ts` shape if UX later says yes.*
5. **F5 [MED]** — Theme Toggle and Tasks Grouping Control persistence ("choice persists across visits") has no defined mechanism, and matters more than usual because Spencer uses two devices (Mac + Windows, AD-15). *Fix: one Consistency Convention line naming `localStorage` (per-device) or a `plan-state-store.ts` preferences record (cross-device).*

Full findings F6-F9 (Skill Switcher layout reservation, CSP completeness, AD-5 chat-blocking wording, birthday-confetti timezone) are lower severity and detailed above.

**File:** `_bmad-output/planning-artifacts/architecture/architecture-YohV1-2026-08-22/reviews/reconcile-phase2-prd-ux.md`
