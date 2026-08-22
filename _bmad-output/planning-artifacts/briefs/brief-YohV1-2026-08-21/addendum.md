# Addendum: Yoh

Supporting depth for `brief.md` — technical rationale, options considered and rejected, and the full phase roadmap. Nothing here overrides the brief; it's the detail that didn't need to be in the reader's way.

## Technical Foundations — Full Detail

### Notion API (Phase 1)

- Auth: **internal integration token**, not OAuth — correct for single-workspace personal use; no multi-tenant auth complexity needed.
- Endpoint: current **"Query a data source"** endpoint, not the deprecated `databases/{id}/query` (Yoh's single-source personal DBs are unaffected by the 2025-09-03 "data sources" migration that prompted the deprecation).
- Rate limit ~3 req/s per integration — trivial at personal scale, not a design constraint.
- Writes via `PATCH /pages/{id}`. Rollup properties are not updatable via the API; formula properties should be treated as read-only too (implied by the API's behavior, not stated outright — worth a direct check before relying on it).
- Gotcha: date filters default to UTC unless timezone is set explicitly — set it explicitly, don't rely on the default.
- API version `2026-03-11` (`Notion-Version` header required).
- No official Python SDK; `notion-client` (PyPI) is the de facto community standard. Official JS SDK is `notion-sdk-js`.
- Notion also ships native webhooks (real-time change notification) — not needed for the once-daily MVP model, but useful to know about for a later phase.
- Confidence note: the "internal integration token" pattern is sourced at medium confidence (search-snippet/vendor-blog level) — worth a quick direct-docs check at build time, not just trusted as-is.

### Google Calendar API (Phase 1)

- **Service accounts cannot access a personal (@gmail.com) calendar.** Domain-wide delegation only works for Workspace-admin-controlled domains; there's no equivalent for personal consumer accounts. Medium confidence (vendor blog + forum thread, no single official page found stating it outright, though the underlying constraint is structurally well-established). The correct path is the **OAuth 2.0 user-consent (installed-app/desktop) flow.**
- **Critical, high-confidence, primary-source-verified**: the OAuth consent screen must be moved to **"In production"** status. Left in "Testing," refresh tokens auto-expire after exactly 7 days regardless of use — this is the single highest silent-failure risk to the Sept 2 MVP specifically, and is called out in the brief's Known Risks for that reason.
- Write-isolation: there's no scope that restricts Yoh to "only events it created" on the *primary* calendar (that scope only exists for a separate secondary calendar). The chosen pattern instead: grant `calendar.events` (full read/write) and tag every Yoh-created event with a private **extended property**, always filtering on it before update/delete. This matches the design decision that Yoh writes into the real/primary calendar and never touches events it doesn't own.
- **ICS/iCal subscribe-by-URL was evaluated and rejected** as the read mechanism — refresh latency runs 8–24h (sometimes up to 48h) with no SLA, unacceptable for same-day plan generation. Live API reads are required.
- Quotas (10,000 req/min/project, 600 req/min/user) are generous — no concern at personal scale.
- Lower-priority gotchas, not currently relevant (MVP has no recurring events, revisit if recurrence is added later): a possible silent no-op bug when updating recurring-event RRULEs; some spec-valid RRULEs are rejected by the API; refresh tokens must be manually persisted back to storage (the client library doesn't do this automatically); tokens can go stale after ~6 months of disuse (worth a keep-alive job eventually).

### Wake-word / voice pipeline (Phase 3, settled direction, not urgent for Sept 2)

- **openWakeWord** is the recommended wake-word engine. Rejected alternatives: **Snowboy** (its cloud training service shut down Jan 2021, the original repo now points to an unmaintained fork — dead); **microWakeWord** (purpose-built for ESP32-S3 microcontrollers specifically because openWakeWord's model is too slow for that hardware class — that reasoning doesn't apply to Pi-class hardware, so there's no benefit here). openWakeWord is also the default in Home Assistant's official voice architecture, with maintenance activity continuing into early 2026. Confidence on the openWakeWord-over-microWakeWord call itself is medium (three converging sources, none independently re-verified).
- **whisper.cpp** (tiny/base models) for STT. The small model is batch-only and too slow for live use.
- **Piper** (medium quality tier) for TTS. Piper was relicensed from MIT to GPL-3.0 (inferred ~2025 from context, not stated explicitly in the source) — irrelevant for personal, non-distributed use; would matter only if the code is ever open-sourced or shared.
- **Build target: Raspberry Pi 5, not Pi 4 or 3.** This is a real hardware-spec decision, not a nice-to-have: Pi 4 lags 1–3s/sentence on Piper TTS versus under 1s on Pi 5; STT saturates the CPU even on a Pi 5, and the `base.en` Whisper model is only viable at all on Pi 5.
- **PipeWire**, not BlueALSA, is the current default Bluetooth-audio path on Raspberry Pi OS Bookworm (Bookworm replaced PulseAudio/JACK with PipeWire, confirmed directly against Raspberry Pi's own forums). Most Bluetooth-on-Pi tutorials online are pre-Bookworm and describe the superseded BlueALSA default — architect around PipeWire instead. BlueALSA is still packaged and some builders prefer it for headless setups, so it isn't ruled out for a specific reason, just not the default to start from. One open PipeWire-Bluetooth GitHub issue (`arkq/bluez-alsa#681`, "no sound on speakers") suggests the path isn't universally friction-free yet (low-medium confidence, snippet-level only).
- A comparable community build (Pi 5, GPIO lights/buttons, USB mic, whisper.cpp + Piper) chose an external/cloud LLM endpoint over local inference for the reasoning step — suggesting local LLM inference specifically was the practical bottleneck even when local STT/TTS ran fine. Worth keeping in mind if/when Yoh's own reasoning layer needs to run on-device.

### Hardware shopping list — status

Checked directly against `research.md`, its digests, and `brainstorm-intent.md` at the user's request. What exists: the *architecture* is decided (Pi 5; openWakeWord + whisper.cpp + Piper over PipeWire), and the *concept* is described (bedroom screen running the web app, kept away from water; Bluetooth-bridged to a waterproof bathroom speaker; idle state is a small sleep-friendly red passive clock display; voice commands "Yoh, headphones" / "Yoh, headphones off" to mute/resume). No specific microphone, speaker, or display product has been chosen. The bathroom-side mic/input solution is explicitly parked pending the bedroom device design. This is Phase 3 territory and doesn't block the Sept 2 MVP.

## Options Considered and Rejected

- **Breaks aligned to task boundaries** (intuitive, flexible spacing) — an early idea, overridden mid-brainstorm in favor of strictly clock-based breaks (default 70/15) for predictability.
- **Silently defaulting missing task fields**, or letting incomplete tasks rot unflagged — rejected in favor of the proactive data-completeness gate.
- **Yoh proactively pinging mid-block** — rejected; mid-day re-flow must be user-initiated only, to avoid the "friction" failure mode named in The Problem.
- **Auto-switching character voice packs** based on tone or escalation state — rejected; voice packs are manual-only and fully decoupled from the escalate-under-strain mechanic, so the default experience never gets erratic.
- **`calendar.app.created` scope** for automatic event-ownership restriction — doesn't exist for events on the user's *primary* calendar (only for a separate app-owned secondary calendar), so rejected in favor of manual extended-property tagging.

## Full Phase Roadmap

1. **MVP loop** (Sept 2, 2026) — morning/night ritual, CLI/terminal interface, Notion + Calendar integration. See `brief.md` Scope.
2. **Web app** — retires the CLI as the primary interface.
3. **Physical hardware** — Raspberry Pi 5 build: 3D-printed bedroom case and screen (away from water), Bluetooth-bridged waterproof bathroom speaker, sleep-friendly idle clock display, voice mute/resume commands. Includes a real-world spike test for Pi voice reliability before committing further (see Known Risks in `brief.md`).
4. **iOS app.**
5. **Research Vault + Perplexity integration**, plus manual voice packs (robot, Hulk, Morty, etc. — on-demand only, decoupled from tone escalation) and, loosely bundled, browser-access search surfaced on the hardware device screen.
6. **Task timer / self-calibrating duration estimates** — Estimated Duration moves from a manually-entered field to one Yoh refines from actual completion times.

**Long-term / aspirational, not committed to any phase:** a room-cleanliness camera that nags about mess (only its cadence — every 3 days, folded into an existing ritual — is pre-decided, contingent on whether this is ever built at all).

**Cross-cutting constraint:** the codebase should be built modularly enough that each later phase bolts on without reworking the Phase 1 core loop.

## Confidence Notes Worth Re-Checking at Build Time

A few claims underpinning the technical direction are sourced at medium (search-snippet/vendor-blog) rather than high (primary-source-verified) confidence, and are worth a direct check before being load-bearing in the implementation:

- Notion's UTC-default timezone-filter behavior, and formula properties being read-only.
- The "internal integration token" pattern as the right auth choice.
- "Service accounts can't access personal Calendar" (the underlying constraint is well-established structurally, but no single official Google page states it outright).
- Google Calendar's recurring-event gotchas (silent no-op RRULE updates, some valid RRULEs rejected) — anecdotal, single-source, and not relevant until recurrence is added post-MVP.
