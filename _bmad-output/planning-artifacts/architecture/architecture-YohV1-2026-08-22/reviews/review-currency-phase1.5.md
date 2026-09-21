# Reviewer Gate — Currency Check (Phase 1.5 additions)

**Lens:** every committed decision must be web-researched or reality-checked, not asserted from training data.
**Scope:** new material only — Perplexity Sonar API (Stack table, AD-14), AD-13's OAuth-scope-widening assumption, FR-28's citation requirement.
**Date run:** 2026-09-18.

## Verdict: FAIL — one finding is blocking, not a nitpick

The Stack table's Perplexity row is stale in a way that matters immediately: **Perplexity is deprecating the Sonar API (Chat Completions) on 2026-09-27 — nine days from today** — in favor of a new Agent API with a different response shape. AD-14 and the Stack table commit to building `search-adapter.ts` against the Sonar chat-completions endpoint with no mention of this, and FR-28's citation requirement (checked in item 3 below) does not carry over cleanly to the replacement API. This is not a "verify later" item; it changes what should be built starting now.

---

## 1. Perplexity Sonar API — stack table row

**Verified accurate:**
- Sonar is a real, current product family (Sonar, Sonar Pro, Sonar Reasoning, Sonar Reasoning Pro, sonar-deep-research).
- It genuinely exposes an OpenAI-compatible endpoint (`https://api.perplexity.ai`, `POST /v1/chat/completions`, OpenAI SDK works by swapping `base_url` + API key) — the spine's "no SDK needed, just fetch against an OpenAI-compatible REST endpoint" claim is correct and current.
- Pricing figures in the spine check out against current sources: base Sonar $1.00/$1.00 per M input/output tokens, plus a $5–12 per 1,000 requests search-context fee on the base tier (Sonar Pro is $6–14/1,000, not what's cited here, but the spine correctly cites base Sonar figures). Sources: [Sonar API Pricing 2026 – pricepertoken.com](https://pricepertoken.com/pricing-page/model/perplexity-sonar), [Perplexity API Pricing 2026 – burnwise.io](https://www.burnwise.io/ai-pricing/perplexity).

**NOT verified / newly discovered and load-bearing:**
- **Sonar Chat Completions is deprecated as of 2026-09-27**, per Perplexity's own docs: "Sonar Chat Completions is now Agent API. Sonar will be supported until September 27, 2026." Source: [Sonar API quickstart – docs.perplexity.ai](https://docs.perplexity.ai/docs/sonar/quickstart), corroborated independently by [migrate-sonar-to-agent-api SKILL.md – perplexityai/api-platform-developers](https://github.com/perplexityai/api-platform-developers/blob/main/skills/migrate-sonar-to-agent-api/SKILL.md), [bifrost issue #7236](https://github.com/maximhq/bifrost/issues/7236), and a third-party tracking issue explicitly citing the same 2026-09-27 date ([JuergenB/artwork-archive#111](https://github.com/JuergenB/artwork-archive/issues/111)).
- The replacement is the **Agent API**, reachable at `/v1/responses` (still OpenAI-SDK-compatible in transport shape, but not chat-completions-shaped) with new agent-specific parameters (`preset`, `max_steps`) and server-side tools (`sandbox`, `fetch_url`, `finance_search`, `people_search`).
- Whether the Agent API's *pricing* matches the $1/$1 + $5–12/1,000 figures cited in the spine was not confirmed — the search-context fee structure is documented for Sonar specifically; the Agent API's cost model was not independently checked here and should not be assumed identical.
- **Action needed on the spine, not just noted as Deferred:** either (a) target the Agent API from the start, since any build starting after 2026-09-27 literally cannot use Sonar chat completions, or (b) explicitly accept building against a dying endpoint for a short bridge period with a hard migration date already on the books before FR-28 ships. Silence on this in AD-14 / the Stack table is the actual gap — the existing Deferred item on "pick context tier + daily cost ceiling" does not cover it.

## 2. AD-13 — Calendar OAuth scope widening (primary read-only → read/write)

**This narrows the spine's own Deferred item — it does not resolve it, but it gets further than "unconfirmed."**

Fetched Google's current scope reference page directly ([Choose Google Calendar API scopes – developers.google.com](https://developers.google.com/workspace/calendar/api/auth)) rather than relying on secondary summaries. Current, correctly-named scopes as of this check:

| Scope | Grant |
| --- | --- |
| `https://www.googleapis.com/auth/calendar.events.readonly` | View events (all calendars) — this is AD-4's current primary-calendar grant |
| `https://www.googleapis.com/auth/calendar.events` | **View and edit events on all your calendars** |
| `https://www.googleapis.com/auth/calendar.events.owned` | Events on calendars you own only (narrower than `.events`, but named for ownership scoping, not per-calendar scoping) |
| `https://www.googleapis.com/auth/calendar` | Full calendar management — create/delete/share calendars, not just events |

**Finding:** `calendar.events` is the correctly-named, current scope for what AD-13 actually needs — read/write on calendar *events* without the calendar-management powers (`calendar` scope's ability to delete/share entire calendars, which AD-13 explicitly does not want). This is a real, current, correctly-spelled OAuth scope, not a guess.

**What remains genuinely unconfirmed (the part the spine's Deferred item should keep, narrowed):**
- **No scope in Google's current catalog restricts to a *specific* calendar (e.g., "primary only").** `calendar.events` grants read/write on events across *all* calendars the user can access — broader than "primary calendar only." AD-13's guarantee that the widened grant is "read/write on primary only, nothing beyond" is an application-level constraint YohV1's own code must enforce (checking `calendarId === 'primary'` before any write), not something the OAuth scope itself restricts. The spine's Deferred item should be revised to say this explicitly rather than framing it as an open question about scope *names* — the name is now resolved (`calendar.events`); the remaining gap is that no scope narrower than "all calendars' events" exists, so AD-13's "primary only" promise is enforced entirely in `calendar-adapter.ts`, not by Google.
- The original Deferred item's separate claim — that Google added new finer-grained Calendar scopes specifically in 2026 per a Workspace Updates blog snippet — was not corroborated or found in this pass. The scopes found above (`calendar.events`, `calendar.events.owned`, `calendar.events.freebusy`, `calendar.addons.*`) are long-standing, not 2026-new as far as this search surfaced. That earlier claim should probably be dropped or re-flagged as unconfirmed-and-likely-mistaken rather than carried forward.

## 3. FR-28 citations — still a real, current Sonar feature (with a caveat for item 1)

**Verified:** Sonar chat-completions responses do return citations. The response includes numbered `[1]`, `[2]` inline references in `message.content` mapped to a `citations` array of source URLs (exact field placement has shifted across SDK versions — nested under `metadata.citations` in some wrapper libraries — but the raw API does return citation URLs). This is a real, current, load-bearing feature, not an assumption. Sources: [Perplexity Sonar API with citations – OpenWebUI](https://openwebui.com/f/yazon/perplexity_sonar_api_with_citations), [Citations included – theneuralbase.com](https://theneuralbase.com/perplexity-api/learn/advanced/citations-included/).

**Caveat tied directly to Finding 1:** the citation *shape changes* under the Agent API — "There is no top-level `citations` or `search_results` on Agent responses. Read the `search_results` OUTPUT ITEM inside `output[]`" per Perplexity's own migration skill doc, and "message annotations are often an empty array — do not rely on them for citations." If AD-14/FR-28 end up targeting the Agent API (per Finding 1's near-term forcing function), the "every search-derived answer includes at least one citation" implementation needs to parse a different response structure than what a Sonar-chat-completions-era build would assume. This is not yet a problem in the spine's prose, but it will become one the moment `search-adapter.ts` is actually coded, if coded against Sonar chat completions per the current Stack table.

---

## Summary of recommended spine changes

1. **Stack table / AD-14:** add the 2026-09-27 Sonar chat-completions deprecation date and either commit to the Agent API now or add an explicit bridge-and-migrate note with a hard deadline before FR-28 ships.
2. **AD-13 / Deferred section:** replace "exact 2026 scope name unconfirmed" with the resolved name (`calendar.events`) and reframe the remaining gap correctly — it's an application-level "primary calendar only" enforcement question, not a scope-naming question. Consider dropping or re-flagging the unconfirmed "Google added new finer-grained scopes in 2026" claim, which this pass didn't corroborate.
3. **FR-28 citation handling:** note that the citation-extraction implementation is response-shape-dependent on which API (Sonar vs. Agent) is actually targeted, so it isn't finalized until Finding 1 is resolved.
