# Digest: Raspberry Pi wake-word/voice pipeline — Round 2 (lead-following)

## Claims

1. On Raspberry Pi OS Bookworm (Debian 12), PipeWire has replaced PulseAudio as the default audio server and now handles Bluetooth A2DP output natively; BlueALSA (packaged as `bluez-alsa-utils`, v3.0.0 in Bookworm) remains available and is still favored for headless/lightweight builds, but is no longer the modern default.
   - Source: https://pidiylab.com/raspberry-pi-audio/ ; https://github.com/arkq/bluez-alsa/issues/681 — Publisher: pidiylab.com (blog); GitHub (arkq/bluez-alsa issue tracker) — accessed: 2026-08-21 — confidence: medium (search synthesis, not independently fetched against Raspberry Pi Foundation/PipeWire official docs) — class: landscape/maintenance-status

2. Open reports exist of PipeWire producing "no sound on speakers" regressions for Bluetooth-ALSA-based audio, indicating the PipeWire Bluetooth path is not yet fully mature/reliable for all setups.
   - Source: https://github.com/arkq/bluez-alsa/issues/681 — confidence: low-medium (title/snippet only, issue not read in full) — class: reliability signal

3. openWakeWord is the recommended wake-word engine for Pi-class (not microcontroller) hardware; a single Pi 3 core runs 15-20 openWakeWord models simultaneously in real time. microWakeWord was purpose-built for ESP32-S3 microcontrollers specifically because openWakeWord's speech-embedding model is too slow for that constrained hardware — the reasoning does not apply to Pi-class hardware, so there's no advantage to microWakeWord there.
   - Source: https://github.com/dscripka/openWakeWord ; https://www.kevinahrendt.com/micro-wake-word ; https://www.home-assistant.io/voice_control/about_wake_word/ — confidence: medium-high (converges across three independent sources, not each individually fetched in full) — class: recommendation/landscape

4. Piper's original repo (rhasspy/piper, MIT) was archived/read-only; active development moved to OHF-Voice/piper1-gpl (Open Home Foundation), relicensed to GPL-3.0. Release v1.3.0 of OHF-Voice/piper1-gpl (tagged "July 10", year presumed 2025 from context) explicitly states "Change license to GPLv3" in its changelog, alongside the org move and removal of C++ code in favor of Python.
   - Source: https://github.com/OHF-Voice/piper1-gpl/releases/tag/v1.3.0 — Publisher: GitHub (primary, directly fetched) — confidence: high — class: primary/versioning

5. A second, less-disambiguated characterization states rhasspy/piper was archived specifically on **October 6, 2025**, and the GPL-3.0 successor still works as a Home Assistant Wyoming add-on going forward.
   - Source: search-synthesis citing grokipedia.com/page/Piper_text-to-speech_system and/or localaimaster.com (exact attribution not disambiguated) — confidence: low-medium (not independently fetched; date attribution ambiguous) — class: secondary, needs verification

6. For a personal hobby project bundling Piper (not distributing commercially): GPL-3.0 obligations trigger on *distribution* of a derivative work, not private/personal use — so for personal, non-distributed use, GPL-3.0 imposes no meaningful restriction. Pinning the old MIT rhasspy/piper avoids the license question entirely but means using an archived/unmaintained codebase.
   - Source: synthesized from general GPL-3.0 terms + the repo above — confidence: medium (well-established GPL principle, but the actual LICENSE file text/a Piper-specific legal analysis wasn't fetched this run) — class: inference, flagged as such

7. The Home Assistant Voice Preview Edition (ESP32-based satellite hardware, NOT Raspberry Pi) shows no thermal throttling under sustained use in a long-term review; three units ran reliably 15 months without cloud dependency; OTA firmware ships roughly every 4-6 weeks.
   - Source: https://botmonster.com/smart-home/home-assistant-voice-preview-edition-review/ — confidence: medium — class: retrospective — **note: ESP32 hardware, not Pi, so only partially answers the Pi-specific retrospective question**

## Leads

- Home Assistant Community threads "Voice PE slow" and "Voice Command Latency" — not fetched, likely contain genuine long-term complaints (may transfer even though hardware differs from Pi).
- GitHub issue arkq/bluez-alsa#681 — worth opening fully to assess whether it's resolved/legacy or an ongoing PipeWire-Bluetooth reliability gap.
- Raspberry Pi Forums "Stream A2DP Audio to Pi Over Bluetooth" and "Basic Bluetooth Connectivity" threads — likely contain real BlueALSA-vs-PipeWire troubleshooting detail, not fetched.
- Grokipedia's Piper page / localaimaster.com should be fetched directly to pin the true second source for the Oct 6, 2025 archive date.
- No genuine Raspberry-Pi-specific (not ESPHome/Voice-PE) long-term builder retrospective was found — a targeted r/homeassistant, r/raspberry_pi, or community.rhasspy.org search is still needed.

## Gaps (round cap reached — reporting as open questions, not silently dropped)

- **Bluetooth stack**: no official Raspberry Pi Foundation or PipeWire project documentation was directly fetched to confirm PipeWire is now the standard/default recommended path for A2DP output on Bookworm; latency/reliability numbers (specific ms figures) were not found. **This remains an open question for the hardware phase (Phase 3) — recommend a dedicated spike/test before committing the architecture to either BlueALSA or PipeWire.**
- **Piper relicensing date**: the exact year of the "July 10" v1.3.0 release wasn't explicit in the fetched page content (presumed 2025 from context); the second independent source for the Oct 6, 2025 archive date wasn't disambiguated to one specific fetched page — falls short of the strict two-source rule as currently sourced.
- **Real-world Pi-specific retrospectives**: no genuine Raspberry-Pi-specific (as opposed to ESP32/Voice PE) long-term builder retrospective with concrete false-wake-rate, thermal, or Bluetooth-dropout numbers was found within budget. This question is effectively **unanswered for Pi hardware specifically** — flagged as an open risk for Phase 3, not a confirmed finding either way.
- Round/dimension budget reached (max_depth=2 cap for this dimension) — no further rounds will run; these three gaps carry forward as open questions in the final report.
