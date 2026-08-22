---
title: 'technical research: Yoh voice pipeline and Notion/Calendar API integration'
type: 'technical'
topic: 'Yoh voice pipeline and Notion/Calendar API integration'
decision: 'Ground Yoh architecture/roadmap on (a) the right wake-word/voice-pipeline approach for the Phase-3 Raspberry Pi build, and (b) correct Notion + Google Calendar API integration patterns for the Phase-1 MVP (auth, rate limits, read/write realities)'
source: 'native run'
status: complete
preset: 'standard'
validation: 'normal'
created: '2026-08-21'
updated: '2026-08-21'
claims_verified: 14
claims_unverified: 3
claims_disputed: 1
claims_overturned: 0
---

# technical research: Yoh voice pipeline and Notion/Calendar API integration

**Decision this research serves:** Ground Yoh architecture/roadmap on (a) the right wake-word/voice-pipeline approach for the Phase-3 Raspberry Pi build, and (b) correct Notion + Google Calendar API integration patterns for the Phase-1 MVP (auth, rate limits, read/write realities).

## Executive Summary

**Notion and Google Calendar integration (Phase-1 MVP, needed for Sept 2):** both are straightforward with well-documented, verified patterns. Use a Notion **internal integration token** (not OAuth) [18], respect the ~3 req/s rate limit [19], and use the current, non-deprecated **"Query a data source"** endpoint rather than the now-deprecated `databases/query` [20][21]. For Google Calendar, grant the `calendar.events` scope and tag every event Yoh creates with a private **extended property**, filtering on it before any update/delete so Yoh only ever touches its own events [28] — and move the OAuth consent screen to **"In production"** immediately, since leaving it in "Testing" mode silently kills all refresh tokens after 7 days [31], which would otherwise quietly break the MVP mid-use.

**Wake-word/voice pipeline (Phase-3 hardware, not urgent for Sept 2):** the landscape is settled enough to commit to now. **openWakeWord** is the right wake-word engine for Pi-class hardware (Snowboy is dead [1], microWakeWord targets microcontrollers, not the Pi [2][4]). **whisper.cpp** (tiny/base) for STT and **Piper** (medium quality tier) for TTS both run real-time on a **Raspberry Pi 5** specifically — a Pi 4 is measurably worse for TTS and STT alike, which is a real hardware-spec decision, not a nice-to-have [8][10]. **PipeWire**, not BlueALSA, is the current default Bluetooth-audio path on Raspberry Pi OS (Bookworm) [6] — architect around PipeWire, not older BlueALSA tutorials. Piper's TTS engine was recently relicensed to GPL-3.0 [5] — irrelevant for personal use, relevant only if the code is ever distributed.

**Biggest caveat:** no genuine real-world, multi-month retrospective was found for a Pi-based always-listening voice assistant specifically (false-wake rates, thermal behavior, Bluetooth dropout frequency under sustained daily use) — this is a real open risk for Phase 3, not a confirmed finding either way, and is exactly why the roadmap already puts hardware after the software-only MVP.

---

## Raspberry Pi Wake-Word & Voice Pipeline (Phase 3)

### Landscape & maturity

The wake-word engine landscape has a clear settled answer: **Snowboy is dead** — its cloud training service shut down in Jan 2021, and the original repo itself directs future work to an unmaintained fork [1]. **openWakeWord** is the actively-maintained, current-generation choice, used as the default wake-word engine in Home Assistant's official voice architecture [3], with ongoing (if low-intensity) maintenance activity through early 2026 [2]. Its main documented alternative for constrained hardware, **microWakeWord**, was purpose-built for ESP32-S3 microcontrollers specifically because openWakeWord's model is too slow for that hardware class — that reasoning simply doesn't apply to a Raspberry Pi, so there's no benefit to it here [2][4].

For speech-to-text, **whisper.cpp**'s tiny and base English models are the real-time-capable tier on Pi-class CPUs; the small model, despite better accuracy, is only ~0.4–0.6x real-time — batch-only, not viable for a live assistant [9], independently confirmed [8]. For text-to-speech, **Piper** is real-time-capable with no GPU required, but tier choice depends on which Pi model is used (see Implementation reality below) [10].

**Piper's licensing changed recently and materially**: the original `rhasspy/piper` (MIT) repo is archived/read-only; active development moved to `OHF-Voice/piper1-gpl` under the Open Home Foundation, relicensed to **GPL-3.0** in a v1.3.0 release tagged "July 10" [5] (year inferred as 2025 from context — not explicit in the fetched release page; a secondary source's more specific "October 6, 2025" archive date wasn't independently confirmed). For Yoh — a personal, non-distributed hobby build — this has no practical effect: GPL obligations attach to *distributing* a derivative work, not private use. It only matters if Yoh's code is ever open-sourced or shared as a product later.

### Integration & interoperability

The standard chain is wake-word detector → STT → intent/LLM → TTS → audio out. One real builder account chose a cloud LLM endpoint over local inference specifically because local LLM inference (not STT/TTS) was the practical bottleneck on Pi-class hardware [7b] (low confidence — single thin anecdote) — worth treating as a signal, not a fact, but consistent with general Pi compute limits.

For audio output specifically: Raspberry Pi OS **Bookworm replaced PulseAudio (and JACK) with PipeWire**, which now natively manages Bluetooth device reconnection and A2DP output — independently confirmed directly against Raspberry Pi's own forums [6]. This resolves a real risk from Round 1: most Bluetooth-on-Pi tutorials online (BlueALSA-based) are pre-Bookworm and describe a superseded default. BlueALSA remains packaged and available, and some builders still prefer it for headless/lightweight setups, but it is not the modern default anymore — Yoh's hardware build should target PipeWire's Bluetooth path, not a BlueALSA guide, unless a specific reason emerges to override that. One open PipeWire-Bluetooth GitHub issue (`arkq/bluez-alsa#681`, "no sound on speakers") suggests the path isn't universally friction-free yet [7] (low-medium confidence, snippet-level only).

### Implementation reality

The concrete, verified performance picture: on a **Raspberry Pi 5**, whisper.cpp tiny/base and Piper's "medium" voice tier both run comfortably real-time. On a **Raspberry Pi 4**, Piper TTS lags 1–3 seconds per sentence at the same "medium" tier versus under 1 second on a Pi 5 [10] (independently verified). STT is tighter still: even on a Pi 5, base and small models "saturate the CPU" rather than running comfortably — base.en only becomes viable at all on **Pi 5**, not Pi 4 [8] (independently verified). **This is a genuine hardware-spec decision for Phase 3: build on a Pi 5, not a Pi 3/4 — Pi 4 is not just slower but, for STT specifically, may not clear the real-time bar at all.**

The one thing this research could **not** find, despite a dedicated follow-up round: a genuine, Pi-specific (not ESP32/Home Assistant Voice PE hardware) long-term builder retrospective reporting concrete false-wake rates, thermal throttling incidents, or Bluetooth dropout frequency under sustained daily use [11]. An ESP32-based device (a different hardware class) showed no thermal issues over 15 months [12], which is suggestive but not transferable evidence. **This is a genuine open question, not a resolved one — see Open Questions.**

---

## Notion API Integration (Phase 1 MVP)

### Landscape & maturity

The Notion API versions by date via a required `Notion-Version` header; the current version, confirmed directly against Notion's own docs and changelog, is **2026-03-11** [13][14]. (A third-party blog claimed 2026-04-01 was current, citing a "Views API" — that feature actually shipped March 19, 2026 as an addition under the existing 2026-03-11 version, not a new version number. Treat the blog's claim as incorrect [15].) The last genuine breaking change was the **2025-09-03 "data sources" migration**: databases are now containers that can hold multiple data sources, and pages reference a `data_source_id` as parent. Notion states old integrations keep working as long as a database has only one data source — Yoh's Tasks/Projects/Research Vault databases, being simple single-source personal databases, are unaffected unless deliberately restructured later [16].

### Integration & interoperability

The correct auth pattern for Yoh is a Notion **internal integration** (a static secret token scoped to one workspace, no OAuth, no Notion review) — public/OAuth integrations exist for multi-tenant apps and are unnecessary overhead here [18]. Each database must be manually shared with the integration once; there's no ambient access. For reading tasks, use the current **"Query a data source"** endpoint (`filter`/`sorts`/`start_cursor`/`page_size`), not the now-deprecated `databases/{id}/query` [20][21] — pagination caps at 10,000 results per query, irrelevant at personal-task-list scale. For writing (marking a task's Status, bumping its priority signal, etc.), `PATCH /pages/{id}` accepts typed property updates for select/status/date/number properties — but **rollup properties are explicitly documented as not updatable**, and formula properties, while not explicitly stated read-only in the same doc, are computed and should be treated the same way [22]. Notion also now ships native **webhooks** (real-time change notification via a public HTTPS endpoint with HMAC-signed payloads) as an alternative to polling [17] — useful later, though Yoh's once-daily plan-generation model doesn't need it for the MVP.

### Implementation reality

Rate limits are **~3 requests/second per integration**, with the same limit applying regardless of integration type (no internal-vs-public split found anywhere in the official docs) [19] — trivially within budget for a single personal Tasks database read/write once or twice a day. The clearest practical gotcha: **date filters without an explicit timezone default to UTC comparison** — worth setting timezone explicitly on every date-property write/filter to avoid off-by-hours bugs (this specific claim rests on a search-snippet read of the official docs, not yet a direct-fetch confirmation — flagged as a residual gap, see below). For implementation, the official **`notion-sdk-js`** (JS/TS) is the only first-party SDK; Python has no official SDK, with `notion-client` (PyPI) as the de facto community standard [23][24].

---

## Google Calendar API Integration (Phase 1 MVP)

### Landscape & maturity

The Calendar API remains at v3 with no major-version break; a 2026 update added an `eventType` field (distinguishing e.g. Gmail-derived events) [25]. Google has been actively revising calendar-adjacent policy through 2026 (a March 2026 announcement of orphaned-secondary-calendar cleanup and a new ownership-transfer endpoint) — none of this affects a script reading/writing its own events on an existing calendar, but signals the platform is still actively evolving and worth a periodic recheck before Phase-2/3 build time [26].

### Integration & interoperability

Two decisions matter most here:

1. **Auth flow**: a **service account cannot access a personal (@gmail.com) calendar** — domain-wide delegation only works for Workspace-admin-controlled domains, with no equivalent for personal consumer accounts [30] (medium confidence — sourced from a vendor blog plus a forum thread; no single official Google page was found stating this outright, though the underlying constraint is structurally well-established). The correct path is **OAuth 2.0 with user consent** (the installed-app/desktop flow), and critically: the OAuth consent screen **must be moved to "In production" status**, not left in the default "Testing" state — Testing-mode refresh tokens **auto-expire after exactly 7 days regardless of use**, which would otherwise silently break Yoh's daily automation about a week after setup with no obvious error until it happens [31] (high confidence — confirmed directly against Google's own official docs). This second point is directly load-bearing for the Sept 2 MVP and should be treated as a required setup step, not an afterthought.
2. **Write-isolation pattern**: no OAuth scope restricts an app to "only events it created" *within the user's existing/primary calendar* — that guarantee (`calendar.app.created`) only exists for a *separate, app-owned secondary calendar*, which isn't what was designed (Yoh writes into the user's real, primary calendar). The practical, verified pattern instead: grant the `calendar.events` scope (full read/write), and tag every event Yoh creates with a **private extended property** (`extendedProperties.private`), always filtering on that property before any update or delete so Yoh mechanically cannot touch an event it didn't create [28][29]. No comparative practitioner writeup was found weighing this against the dedicated-secondary-calendar alternative — this is the mechanically correct and Google-documented pattern, but not confirmed as "what everyone actually does in practice" [gap].

As a read-only alternative/complement, Google Calendar's ICS/iCal "subscribe by URL" feature still works in 2026, but refresh latency is coarse and undocumented by Google — independent sources converge on roughly 8–24 hours (some report up to 48h) with no published SLA [32]. **This confirms the earlier design decision to use the live API for reads, not an ICS feed** — ICS's lag would make same-day calendar awareness unreliable.

### Implementation reality

Quotas are generous for personal use (recent standardization: 10,000 req/min per project, 600 req/min per user) [27] — no realistic concern at personal-automation scale. Two real gotchas surfaced, each still only single-source/anecdotal: a report of a **silent no-op bug** when updating a recurring event's RRULE (returns HTTP 200 but doesn't apply the change; workaround is destructive — clear `recurrence` fully before resetting it) [33], and reports that some spec-valid RRULEs are rejected by the API [34] — Yoh's design doesn't currently rely on recurring events, so this is a lower-priority risk, but worth testing directly before relying on recurrence for any future feature. Google's own recurring-events guide states start/end must share a single timezone for correct recurrence expansion [35] (snippet-level, not directly fetched — residual gap). Separately, developers building unattended scheduled scripts commonly report needing to **manually persist the refreshed token back to storage** (the client library's automatic refresh doesn't do this on its own), and some run a periodic "keep-alive" job since tokens can go stale after ~6 months of disuse even in production mode [36][37] — worth building token-refresh persistence in explicitly rather than assuming the client library handles it.

---

## Cross-Dimension Insights

- **The Sept-2 MVP and the Phase-3 hardware build have almost no shared technical risk.** Notion and Google Calendar integration are both well-documented, low-risk, primary-source-confirmed work — nothing here threatens the Sept 2 date. The wake-word/voice pipeline's one real unknown (genuine long-term Pi reliability) sits entirely in Phase 3, which the roadmap already correctly deferred past the MVP — this research validates that sequencing decision rather than complicating it.
- **Both integrations independently converged on the same underlying pattern: tag what you own, and touch only what you tagged.** Notion's rollup/formula read-only boundary and Google Calendar's extended-properties self-tagging pattern are both instances of "never assume write access beyond what you explicitly created or control" — consistent with the "propose, don't impose" trust boundary already established in the brainstorm's design, now confirmed as the technically correct implementation, not just a nice design philosophy.
- **The OAuth "Testing status" 7-day token expiry is the single highest-risk item for the Sept 2 MVP** — not because it's hard to fix (moving to "In production" is a one-time settings change), but because it's exactly the kind of thing that fails silently a week after everything appeared to work, matching the pattern named in the brainstorm's Future Autopsy exercise (a thing that looks fine at first and quietly breaks later). Recommend explicitly checking this before considering the MVP "done."

## Recommendations

1. **Phase 1 (MVP, Sept 2):** Use a Notion internal integration token; query via the current data-source endpoint, not the deprecated database-query endpoint. High confidence on versioning and endpoint shape [13][20][21]; the internal-integration-token recommendation itself rests on medium confidence [18] (sourced via search snippet, never independently fetched) — worth a 2-minute direct check of `developers.notion.com/guides/get-started/authorization` before relying on it. *Feeds: architecture spine (integration approach), roadmap risk (low).*
2. **Phase 1 (MVP, Sept 2):** For Google Calendar, grant `calendar.events` scope, tag Yoh-created events with a private extended property, and — critically — move the OAuth consent screen to "In production" before relying on the integration daily. High confidence, primary-source-verified [28][31]. *Feeds: architecture spine (auth pattern), roadmap risk (currently the MVP's single highest silent-failure risk if skipped).*
3. **Phase 3 (hardware):** Build on a **Raspberry Pi 5**, not a 3/4, and target **openWakeWord + whisper.cpp (tiny/base) + Piper (medium tier) over PipeWire's Bluetooth path**. High confidence, independently verified for Snowboy's death, the Pi 5 performance numbers, and the PipeWire default [1][6][8][10]; the openWakeWord-over-microWakeWord recommendation itself rests on medium confidence (three converging sources, none individually re-verified) [2]. *Feeds: architecture spine (hardware baseline), roadmap estimate (a Pi 5 is the safer default to buy/build around now rather than reusing an older Pi).*
4. **Before committing further to Phase 3**, run a short real-world spike (a few days of actual use, not a benchmark) specifically testing wake-word false-positive/negative rate and Bluetooth reliability in the user's actual bathroom/bedroom setup — this is the one dimension genuine published evidence couldn't answer. Confidence: this recommendation itself is high-confidence; the underlying reliability question remains open. *Feeds: roadmap risk (Phase 3 estimate should carry a buffer for this unknown).*

## Open Questions

- **No genuine Pi-specific long-term reliability data exists** (false-wake rate, thermal behavior, Bluetooth dropout frequency under sustained daily use) — closing this requires either a builder retrospective that doesn't yet appear to be published, or Yoh's own real-world spike test during Phase 3.
- **Whether "primary calendar + extendedProperties tagging" or "dedicated secondary calendar" is more common in practice** for personal Calendar automations was not resolved — both are mechanically valid; the primary-calendar approach was chosen here to match the already-decided design (writing into the user's real calendar), but no practitioner consensus was found either way.
- **Notion's UTC-default timezone-filter behavior and formula-property read-only status** rest on search-snippet-level confirmation, not a direct docs fetch — worth a 2-minute direct check before relying on either specifically.
- **Google Calendar recurring-event gotchas** (silent no-op updates, some spec-valid RRULEs rejected) are single-source/anecdotal — not currently relevant since Yoh's MVP doesn't create recurring events, but re-check before adding any recurrence-based feature later.

## Source Appendix

| # | Claim/finding it supports | Publisher | Pub date | Accessed | Confidence |
|---|---|---|---|---|---|
| [1] | [Snowboy dead/unmaintained](https://github.com/Kitt-AI/snowboy) | GitHub (Kitt-AI) | undated | 2026-08-21 | high |
| [2] | [openWakeWord maintenance + Pi performance + microWakeWord note](https://github.com/dscripka/openWakeWord) | GitHub | 2024-02 / activity to 2026-01 | 2026-08-21 | medium |
| [3] | [Home Assistant wake-word engine choice](https://www.home-assistant.io/voice_control/about_wake_word/) | Home Assistant (official docs) | undated | 2026-08-21 | high |
| [4] | [microWakeWord targets microcontrollers](https://www.kevinahrendt.com/micro-wake-word) | Kevin Ahrendt (microWakeWord author) | undated | 2026-08-21 | medium |
| [5] | [Piper relicensed MIT→GPL-3.0](https://github.com/OHF-Voice/piper1-gpl/releases/tag/v1.3.0) | GitHub (OHF-Voice) | 2025-07 | 2026-08-21 | high |
| [6] | [PipeWire is default Bluetooth-audio path on Bookworm](https://forums.raspberrypi.com/viewtopic.php?t=389048) | Raspberry Pi Forums (official) | undated | 2026-08-21 | high (independently verified) |
| [7] | [PipeWire-Bluetooth open issue](https://github.com/arkq/bluez-alsa/issues/681) | GitHub (arkq/bluez-alsa) | undated | 2026-08-21 | low-medium |
| [7b] | [Cloud LLM chosen over local inference, Pi build](https://forums.raspberrypi.com/viewtopic.php?t=392239) | Raspberry Pi Forums (builder) | undated | 2026-08-21 | low |
| [8] | [whisper.cpp tiny/base real-time on Pi 5](https://github.com/ggml-org/whisper.cpp/discussions/166) | GitHub (ggml-org) | 2024-12 | 2026-08-21 | high (independently verified) |
| [9] | [whisper.cpp small model batch-only](https://www.promptquorum.com/power-local-llm/local-whisper-stt-comparison-2026) | promptquorum.com (benchmark) | 2026 | 2026-08-21 | medium |
| [10] | [Piper medium tier real-time on Pi 5](https://pidiylab.com/text-to-speech-raspberry-pi-piper/) | pidiylab.com | undated | 2026-08-21 | high (independently verified) |
| [11] | No genuine Pi-specific long-term retrospective found | — (absence of evidence, reported as finding) | — | 2026-08-21 | n/a — open question |
| [12] | [HA Voice PE 15-month reliability review (ESP32, not Pi)](https://botmonster.com/smart-home/home-assistant-voice-preview-edition-review/) | Botmonster Tech | 2026 | 2026-08-21 | medium |
| [13] | [Notion current API version 2026-03-11](https://developers.notion.com/reference/versioning) | Notion (official docs) | live | 2026-08-21 | high |
| [14] | [Notion changelog, resolves version discrepancy](https://developers.notion.com/page/changelog) | Notion (official docs) | through 2026-04 | 2026-08-21 | high |
| [15] | [Third-party blog's incorrect 2026-04-01 version claim](https://fazm.ai/blog/notion-api-updates-2026) | Fazm Blog | unclear | 2026-08-21 | low (corrected by [13][14]) |
| [16] | [Notion 2025-09-03 data-sources migration](https://developers.notion.com/docs/upgrade-faqs-2025-09-03) | Notion (official docs) | 2025-09 | 2026-08-21 | high |
| [17] | [Notion native webhooks](https://developers.notion.com/reference/webhooks) | Notion (official docs) | live | 2026-08-21 | high |
| [18] | [Internal integration token auth pattern](https://developers.notion.com/guides/get-started/authorization) | Notion (official docs) | undated | 2026-08-21 | medium |
| [19] | [Notion rate limit ~3 req/s, no type split](https://developers.notion.com/reference/request-limits) | Notion (official docs) | live | 2026-08-21 | high |
| [20] | [Deprecated database-query endpoint](https://developers.notion.com/reference/post-database-query) | Notion (official docs) | live | 2026-08-21 | high |
| [21] | [Current query-a-data-source endpoint](https://developers.notion.com/reference/query-a-data-source) | Notion (official docs) | live | 2026-08-21 | high |
| [22] | [Rollup properties not updatable via PATCH page](https://developers.notion.com/reference/patch-page) | Notion (official docs) | live | 2026-08-21 | high |
| [23] | [Official JS SDK](https://github.com/makenotion/notion-sdk-js) | GitHub (Notion) | undated | 2026-08-21 | high |
| [24] | [Community Python SDK](https://pypi.org/project/notion-client/) | PyPI | undated | 2026-08-21 | medium |
| [25] | [Calendar API eventType field, no major version break](https://developers.google.com/workspace/calendar/release-notes) | Google (official) | rolling/2024-05 | 2026-08-21 | high |
| [26] | [2026 secondary-calendar lifecycle changes](https://workspaceupdates.googleblog.com/2026/03/an-update-on-secondary-calendar-lifecycle-changes-and-a-new-API.html) | Google Workspace Updates (official) | 2026-03 | 2026-08-21 | high |
| [27] | [Calendar API quota standardization](https://developers.google.com/workspace/calendar/api/guides/quota) | Google (official) | live | 2026-08-21 | high |
| [28] | [OAuth scopes; calendar.events + extendedProperties tagging pattern](https://developers.google.com/workspace/calendar/api/auth) | Google (official) | 2026-07-22 | 2026-08-21 | high |
| [29] | [Extended properties mechanics (private/shared)](https://developers.google.com/workspace/calendar/api/guides/extended-properties) | Google (official) | live | 2026-08-21 | high |
| [30] | [Service accounts can't access personal calendars](https://www.unipile.com/gmail-api-service-account-domain-wide-delegation/) | Unipile (vendor) + Google Developer Forum | 2026 | 2026-08-21 | medium |
| [31] | [OAuth "Testing" status 7-day refresh-token expiry](https://developers.google.com/identity/protocols/oauth2) | Google (official) | live | 2026-08-21 | high (independently confirmed) |
| [32] | [ICS feed refresh latency ~8-24h, no SLA](https://usemooncal.com/en/guides/google-calendar-ics-refresh) | usemooncal.com + 2 corroborating sources | 2026 | 2026-08-21 | medium |
| [33] | [Recurring-event silent no-op update bug](https://discuss.google.dev/t/google-calendar-api-sometimes-silently-fails-to-update-recurrence-rules/269516) | Google Developer Forums | 2026 | 2026-08-21 | medium |
| [34] | [RRULE rejection reports](https://github.com/home-assistant/core/issues/85365) | GitHub (home-assistant/core) | undated | 2026-08-21 | low-medium |
| [35] | [Recurring events require single timezone](https://developers.google.com/workspace/calendar/api/guides/recurringevents) | Google (official, snippet-level) | undated | 2026-08-21 | medium |
| [36] | [Refresh-token persistence friction](https://github.com/googleapis/google-api-python-client/issues/2339) | GitHub (googleapis) | undated | 2026-08-21 | medium |
| [37] | [Keep-alive cron for stale refresh tokens](https://dev.to/cardinalby/dont-let-google-refresh-token-expire-pie) | DEV Community | undated | 2026-08-21 | medium |

## Staleness Map

Computed via `recon_kit.py staleness` against the technical pack's freshness bars (version/auth/rate-limit ≤ 1 month; maintenance-status/performance ≤ 6 months; landscape/recommendation ≤ 12 months; pattern ≤ 2 years), run 2026-08-21:

| Claim | Class | Published | Recheck by | Status |
|---|---|---|---|---|
| Notion current API version (2026-03-11) | version | 2026-03 | 2026-04-01 | **due for recheck** |
| Notion 2025-09-03 data-sources migration | version | 2025-09 | 2025-10-01 | **due for recheck** |
| Piper relicensed to GPL-3.0 | version | 2025-07 | 2025-08-01 | **due for recheck** |
| `calendar.events` + extendedProperties pattern | auth | 2026-07 | 2026-08-01 | **due for recheck** |
| Snowboy dead/unmaintained | maintenance-status | 2021-01 | 2021-07-01 | **due for recheck** (historical fact; recommend a quick "still true" check rather than a full re-run) |
| Notion internal-integration auth pattern | auth | 2026-08 | 2026-09-01 | fresh |
| Notion rate limit ~3 req/s | rate-limit | 2026-08 | 2026-09-01 | fresh |
| Service accounts can't access personal Calendar | auth | 2026-08 | 2026-09-01 | fresh |
| OAuth "Testing" 7-day token expiry | auth | 2026-08 | 2026-09-01 | fresh |
| openWakeWord recommended over microWakeWord | recommendation | 2026-01 | 2027-01-01 | fresh |
| PipeWire default Bluetooth path (Bookworm) | landscape | 2026-08 | 2027-08-01 | fresh |
| whisper.cpp / Piper Pi 5 performance (both) | performance | 2026-08 | 2027-02-01 | fresh |
| Everything classed `pattern` (rollup read-only, ICS latency, RRULE gotchas, no Pi retrospective) | pattern | various | 2028-06/08 | fresh (2-year window) |

**Earliest re-check date: 2021-07-01** (the Snowboy claim — a settled historical fact needing only a quick sanity check, not a re-run) — but the practically meaningful earliest re-check for anything genuinely time-sensitive is **2026-09-01**, when the fast-moving auth/rate-limit/version-class claims (Notion version, the Calendar auth pattern) come due under their 1-month windows. Given Yoh's Sept 2 MVP build window sits inside that same month, it's worth a 2-minute live-docs recheck on the Notion API version and Calendar OAuth/scope pages specifically at build time, not just trusting this report's snapshot.

