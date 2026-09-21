---
reviewer: rubric-walker
target: ARCHITECTURE-SPINE.md — Phase 1.5 update pass (AD-3 revised, AD-4 note, AD-11 revised, AD-12 revised, AD-13 new, AD-14 new; Stack/Structural Seed/Capability Map/Deferred extended)
scope: weighted to new/changed material only — AD-1/AD-2/AD-5–AD-10 not re-litigated
date: 2026-09-18
verdict: NOT CLEAN — one critical PRD contradiction and one likely-infeasible technical premise, both in brand-new ADs
---

# Rubric Walk — Phase 1.5 Update

## Overall verdict

**Not clean.** Two findings are severe enough to block treating this update as a settled build substrate: AD-3's classification of FR-29 as direct-write directly contradicts the PRD's own Data-Integrity NFR text, and AD-13's OAuth-scope "widening" premise is very likely not achievable the way it's described, based on Google's own documented scope semantics (which the codebase's own `token-store.ts` already correctly documents). Everything else — Perplexity pricing currency, AD-3's reuse of the existing Proposal<T> mechanism for FR-25/26/27, AD-12's schema-validation generalization, the Capability Map/Structural Seed bookkeeping — is solid work. This is a fixable pass, not a rewrite, but it should not ship as-is.

## Findings

### 1. [CRITICAL] AD-3 contradicts the PRD's own tier assignment for FR-29

AD-3's Binds clause states: *"Also does not bind: FR-29 (file search result to Research Vault) — see AD-12; FR-29 is modeled as direct-write, the same shape as FR-24, not a Proposal."*

The PRD's Data Integrity NFR (prd.md §6) is explicit and enumerates exactly which FRs sit in which tier: *"**direct-write**... (FR-24 only)"* and *"**confirm-then-write**, where Yoh proposes or drafts something and nothing is written until Spencer explicitly confirms it (FR-25, FR-26, FR-27, FR-29)."* The PRD names FR-29 in the confirm-then-write tier by name, and explicitly restricts the direct-write tier to FR-24 alone ("FR-24 only").

This is a direct, textual contradiction on a load-bearing behavioral question: does "save that" write to the Research Vault immediately, or does Yoh show a draft first and wait for explicit confirmation? The spine's own `.memlog.md` for this session logged this exact call as `[ASSUMPTION]` with a note to flag it for review correction ("flagging for correction in review rather than silently assuming") — but that flag never made it into the spine body itself; AD-3's clause reads as a flat `[ADOPTED]` decision with no inline `[ASSUMPTION]` tag, unlike AD-13's OAuth-scope call which does carry one. A reader of the spine alone has no signal this needs Spencer's sign-off.

**Fix:** either re-bind FR-29 to AD-3/Proposal<T> (matching the PRD), or get an explicit, visibly-tagged override from Spencer with a documented rationale for departing from the PRD's stated tier — not a silent classification.

### 2. [CRITICAL] AD-13's OAuth-scope premise is likely infeasible as described

AD-13's Dependency clause: *"this AD's `proposeCalendarEdit`/`applyCalendarEdit` pair requires the Calendar OAuth grant to permit read/write on the primary calendar, not read-only as AD-4 currently scopes it."* The Deferred item frames this as a routine lookup: *"verify current scope names against Google's own docs... and confirm the widened scope doesn't grant more than AD-13 actually needs (read/write on primary only, nothing beyond)."*

The already-built codebase's `src/adapters/token-store.ts` documents (and I independently confirmed against Google's current docs) that the existing write scope, `https://www.googleapis.com/auth/calendar.app.created`, is restricted by Google specifically to calendars the app itself created — it structurally cannot ever grant write access to the primary calendar, "widened" or not. There is no Google Calendar OAuth scope that grants read/write on *specifically and only* the primary calendar; the realistic option is a materially broader scope (`calendar.events`, full read/write on **all** of Spencer's calendars, not primary-only). That is a significantly bigger trade than AD-13 represents to Spencer, and the Deferred item's stated goal — a scope that grants "read/write on primary only, nothing beyond" — is very likely unattainable as Google's scope catalog is actually shaped.

This isn't a "confirm the exact string" due-diligence item; it's a premise that may need to be re-architected (e.g., accept the broader `calendar.events` scope and document the real trade honestly, or find another mechanism) before FR-27 can be built as specified. Notably, the codebase's own `token-store.ts` comment already gets this right for AD-4 ("scoped to calendars the app itself creates via `Calendars.insert`, never the primary calendar") — AD-13 talks past information the codebase already correctly captured.

**Fix:** resolve the actual achievable scope before finalizing AD-13; if `calendar.events` (all-calendars read/write) is the real requirement, say so plainly and let Spencer weigh that trade explicitly, rather than deferring it as a naming lookup.

### 3. [MEDIUM] `updateTaskFields` (plural) doesn't exist — the built function is `updateTaskField` (singular)

AD-11 and AD-12 (both revised this session) reference *"the existing `updateTaskFields` write path (AD-12) FR-24 already established"* and enumerate the write surface as including `updateTaskFields`. The actual function FR-24 built, in `src/adapters/notion-adapter.ts:489`, is:

```ts
export async function updateTaskField(
  client: NotionWriteClient & NotionSchemaClient,
  config: NotionFieldWriteConfig,
  taskId: string,
  field: PlanningFieldNames,
  value: NonNullable<Task[PlanningFieldNames]>,
): Promise<Result<void, YohError>>
```

— singular, one field/value pair per call, not a batch-fields function the plural name implies. The PRD addendum itself gets this right: *"Reuse FR-24's fuzzy-match-against-real-options guard (`updateTaskField`'s existing pattern)"* (singular). This naming drift, introduced in this session's fast-path pass, is exactly the kind of divergence AD-9 exists to prevent: an FR-25 implementer following the spine literally would search for a nonexistent plural function and could end up inventing a second, parallel one.

**Fix:** correct `updateTaskFields` → `updateTaskField` in AD-11 and AD-12.

### 4. [MEDIUM] AD-14 doesn't pin a concrete signature or shared type for `search-adapter.ts`'s output

Sibling ADs in this spine pin exact signatures where cross-file boundaries matter: AD-6 pins `computeEscalation(strainCount: number, curve: EscalationCurve): EscalationLevel`; AD-13 (this same update) pins `proposeCalendarEdit(eventId, change)` / `applyCalendarEdit(proposal)` by name. AD-14 only describes `search-adapter.ts` in prose — *"performs a query and returns a synthesized answer plus source citation URLs"* — with no exported function name, no return type, and no corresponding entry in `types/domain.ts`'s Phase 1.5 additions list (which names only `FieldValueSuggestion`, `NotionPageDraft`, `CalendarEditChange`).

This matters concretely: FR-29's Notion-filing leg has to consume whatever FR-28's search leg produces, and `llm-adapter.ts`'s intent router has to call into `search-adapter.ts`. Left unpinned, two independently-built files (the adapter and its callers) can diverge on the exact shape of a "search result" — the same class of divergence AD-9's `PlanBlock.id` rule and AD-6's shared signature exist to close off elsewhere in this spine.

**Fix:** name the function and its return type explicitly (e.g. a `SearchAnswer`/`SearchResult` shape added to `types/domain.ts`), matching the rigor already applied to AD-6/AD-13.

### 5. [MEDIUM] AD-10's enumerated secrets list wasn't extended for the new Perplexity key

AD-10 (unchanged this pass, not re-reviewed on its own merits) enumerates static secrets by name: *"Notion token, Google OAuth client id/secret, Pushover key, SMTP credentials, Claude API key."* AD-14 introduces a new external secret (the Perplexity Sonar API key) that isn't added anywhere to this list. Confirmed `.env.example` has no Perplexity entry yet either. This is a gap left by the new material, not a re-litigation of AD-10 itself: nothing in the updated spine says where/how the new adapter's secret is loaded, even though AD-10 is the authoritative convention the new adapter depends on for exactly this.

**Fix:** add the Perplexity API key to AD-10's enumerated list (one line).

### 6. [LOW–MEDIUM] AD-4's Rule text is now literally self-contradicting without its own edit

AD-4's Rule sentence is unchanged and still absolute: *"against the primary calendar it may only read, never call insert/update/delete."* AD-13's `applyCalendarEdit` now does exactly that (insert/update against the primary calendar, on confirmation). Only a separately appended "Phase 1.5 note" — not an edit to the Rule sentence itself — resolves the apparent contradiction, and it sits after the Honesty note, easy to miss on a literal read of the Rule. A build-substrate Rule that needs a bolted-on footnote elsewhere in the same AD to not directly contradict a sibling AD is fragile.

**Fix:** tighten the Rule sentence itself, e.g. "...never call insert/update/delete against the primary calendar via the automatic path (AD-13 defines the confirm-gated exception)."

### 7. [LOW, informational] Function names diverge from the PRD addendum's suggested Live Write Registry shape

The addendum names `createNotionPage(database, properties)`, `editCalendarBlock(eventId, change)`, `searchWeb(query)`, `saveToResearchVault(result)`. The spine uses `createPage`, `proposeCalendarEdit`/`applyCalendarEdit` (a deliberate propose/apply split, which fits AD-3's established pattern better than the addendum's single-function suggestion), no named search function (see Finding 4), and reuses `createPage` instead of a separate `saveToResearchVault`. These are reasoned, explained refinements and the addendum is explicitly "supporting detail for architecture/build," not binding — not a defect, just worth flagging since a builder cross-referencing addendum.md could be briefly confused before noticing the spine supersedes it.

## Dimension ratings (new/changed material only)

| Dimension | Rating | Basis |
| --- | --- | --- |
| Fixes real divergence points for the level below, misses none | **Thin** | Misses the search-adapter.ts boundary type (Finding 4); actively mis-resolves the FR-29 tier question instead of fixing it (Finding 1) |
| Every AD's Rule is enforceable and prevents its stated divergence | **Thin** | AD-3 and AD-13 have substantive problems (Findings 1, 2); AD-11/AD-12 cite a function that doesn't exist under that name (Finding 3); AD-14 under-specified (Finding 4); AD-4's Rule text self-contradicts post-AD-13 (Finding 6) |
| Nothing under Deferred could let two independently-built units diverge | **Thin–Broken** | The OAuth-scope Deferred item (Finding 2) frames a possibly-infeasible premise as a routine naming lookup — genuinely load-bearing, wrongly sized as low-effort; the FR-29 tier call (Finding 1) should have surfaced as a visible open question, not a silent ADOPTED clause |
| Named tech is verified-current | **Strong** | Perplexity Sonar pricing spot-checked live today and matches the spine's numbers closely ($1/$1 per M tokens, $5–12/1,000 requests context fee); no-SDK/fetch approach confirmed correct |
| Ratifies rather than contradicts the existing brownfield codebase's conventions | **Thin** | `updateTaskFields`/`updateTaskField` naming drift (Finding 3); AD-13 talks past what `token-store.ts`'s own comments already correctly document about `calendar.app.created`'s restriction (Finding 2) |
| Covers the driving PRD's capabilities | **Broken on FR-29** | FR-25/26/27/28 are all reasonably covered with matching, testable consequences; FR-29's write-tier classification directly contradicts PRD §6's explicit text (Finding 1) |
| Every dimension the altitude owns is decided/deferred/open | **Adequate** | Deployment/environments paragraph correctly extended for the new integration; secrets convention has a gap but it's narrower than a whole silent dimension (Finding 5) |

## Finding counts by severity

- Critical: 2 (Findings 1, 2)
- Medium: 3 (Findings 3, 4, 5)
- Low: 2 (Findings 6, 7)

**File:** `/Users/spencerhatch/Documents/GitHub/YohV1/_bmad-output/planning-artifacts/architecture/architecture-YohV1-2026-08-22/reviews/review-rubric-phase1.5.md`
