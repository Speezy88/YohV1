# Digest: Raspberry Pi wake-word/voice pipeline — Round 1

## Claims

1. Snowboy's cloud training service was shut down Dec 31, 2020; pre-existing models still usable but no new training via the original service; the Kitt-AI/snowboy GitHub repo itself notes future development moved to a fork (seasalt-ai/snowboy) — original is legacy/unmaintained.
   - Source: https://github.com/Kitt-AI/snowboy — Publisher: GitHub (Kitt-AI) — pub_date: undated repo notice — accessed: 2026-08-21 — confidence: high — class: maintenance-status

2. openWakeWord (dscripka/openWakeWord) is actively maintained; last tagged release v0.6.0 was Feb 11, 2024, but issues/PRs continued through 2025 into Jan 2026 (a PR merged/opened Jan 8, 2026) — ongoing low-intensity maintenance, not a fresh major-release cadence.
   - Source: https://github.com/dscripka/openWakeWord — confidence: medium — class: maintenance-status

3. A single core of a Raspberry Pi 3 can run 15-20 openWakeWord models simultaneously in real time; the project recommends microWakeWord for more constrained hardware (microcontrollers) than the Pi.
   - Source: https://github.com/dscripka/openWakeWord (README/docs) — confidence: medium — class: performance

4. Home Assistant's official voice architecture ships openWakeWord as default wake-word engine, with Porcupine v1 (29 wake words, EN/FR/ES/DE) and microWakeWord (ESP32/Android-class hardware) as alternatives; openWakeWord's stated limitation is English-only support (lack of multi-speaker training data in other languages).
   - Source: https://www.home-assistant.io/voice_control/about_wake_word/ — Publisher: Home Assistant (official docs) — confidence: high — class: pattern

5. Home Assistant's documented architecture is centralized: voice satellites do local VAD and stream audio to a Home Assistant server for wake-word detection, then intent recognition and TTS; docs state 5 voice satellites can stream simultaneously to a Raspberry Pi 4 without overwhelming it.
   - Source: https://www.home-assistant.io/voice_control/about_wake_word/ — confidence: medium — class: performance

6. whisper.cpp tiny/base English models are real-time-capable on Raspberry Pi 5 CPU (tiny faster than real-time; base ~real-time with 4 threads, ~5.0% WER); whisper small is only ~0.4-0.6x real-time on Pi 5 (10-min clip takes 17-25 min) despite better 3.4% WER — batch-only, not live-assistant-viable.
   - Source: https://www.promptquorum.com/power-local-llm/local-whisper-stt-comparison-2026 — Publisher: benchmark writeup — pub_date: 2026 (exact date unclear) — confidence: medium — class: performance

7. A working STT+TTS Pi 5 voice-assistant-style build (GPIO lights/buttons, USB mic) used whisper.cpp for STT and Piper for TTS, but chose an external/cloud LLM endpoint over local inference — suggesting local LLM inference was a practical bottleneck even when local STT/TTS were fine.
   - Source: https://forums.raspberrypi.com/viewtopic.php?t=392239 — Publisher: Raspberry Pi Forums (builder self-report) — confidence: low (single anecdote, thin thread) — class: pattern

8. Piper TTS: original rhasspy/piper repo is now read-only/inactive; active development moved to OHF-Voice/piper1-gpl (Open Home Foundation), relicensed MIT→GPL-3.0 as of ~Oct 2025 — material licensing change for anyone bundling Piper into a product.
   - Source: https://github.com/OHF-Voice/piper1-gpl — confidence: medium (corroborating source not independently verified as primary; short of full two-primary-source confirmation) — class: maintenance-status

9. Piper achieves real-time synthesis on Pi 5 CPU, no GPU needed; on Pi 5 the "medium" quality voice tier is the highest that stays comfortably real-time, while on Pi 4 users should drop to "low" tier or accept a few seconds of lag/sentence.
   - Source: https://localaimaster.com/blog/piper-tts-setup-guide — confidence: low (single blog, marketing-adjacent, not cross-verified) — class: performance

10. BlueALSA is the standard non-PulseAudio bridge between BlueZ 5 and ALSA for headless Pi Bluetooth (A2DP) audio output; SBC codec latency ~100-200ms, a known limitation; Pi's combined Wi-Fi/Bluetooth chip can cause interference/stutter, mitigated by a USB Wi-Fi adapter freeing the onboard radio for Bluetooth.
    - Source: aggregated from introt.github.io, sigmdel.ca, Raspberry Pi Forums guides — pub_date: pages dated 2021-2022 (below freshness bar for a 2026 call) — confidence: low — class: pattern

## Leads

- **microWakeWord** — repeatedly surfaces as the recommended lighter-weight alternative for constrained hardware; unclear how it compares on a full Pi specifically vs. openWakeWord.
- **Porcupine/Picovoice pricing** — one source claimed "$6K+/year" for commercial use; not verified against Picovoice's own current pricing page; free-tier device-count limits not checked.
- **piper1-gpl fork date / GPL-3.0 implications** — needs a second independent primary source (release note/changelog) to fully satisfy the two-source rule.
- **openWakeWord vs Porcupine accuracy** (Dinner Party Corpus claim) — surfaced only via an aggregator summary (voxrt.com), not traced to the original benchmark.
- **Rhasspy project's overall status** vs. Home Assistant's newer voice pipeline — not checked.
- **Cloud STT/TTS streaming + auth patterns** (Azure/Google/OpenAI Realtime API) — not directly researched this round (local build was the focus).
- **Thermal throttling under sustained whisper.cpp + Piper + wake-word concurrent load, Pi 4 vs Pi 5** — not found; only single-component benchmarks retrieved.

## Gaps

- No verified false-positive/false-negative wake-word rate data from real multi-month builds.
- No independently confirmed combined-pipeline CPU/RAM resource profile (wake-word + STT + TTS running concurrently) — only single-component benchmarks found.
- No genuine "6-12 months later" retrospective with concrete pain-point data (thermal throttling incidents, false-wake logs, Bluetooth dropout frequency); the one forum thread found was too thin (2 posts, no metrics).
- Bluetooth audio sources retrieved are 2021-2022 vintage, below the freshness bar — current (2025-2026) state wasn't verified; **Raspberry Pi OS now defaults to PipeWire, not raw ALSA/PulseAudio, and PipeWire's Bluetooth stack may have superseded BlueALSA as the modern default — this was not checked** and is a load-bearing gap for the hardware decision.
- Could not verify Porcupine's current exact pricing/licensing terms for a hobbyist/personal Pi build from Picovoice's own site.
- Budget (10 calls/8 sources) reached before independently confirming the Piper GPL relicensing date with a second primary source, and before checking microWakeWord/Rhasspy current status directly.
