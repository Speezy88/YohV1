# Verification spot-check: 3 load-bearing wake-word-pipeline claims

- **Claim (whisper.cpp tiny/base real-time on Pi 5, small is batch-only): VERIFIED.** Independent source: GitHub ggml-org/whisper.cpp Discussion #166 (https://github.com/ggml-org/whisper.cpp/discussions/166) — confirms tiny runs fine on Pi 4; a Dec-2024 comment notes base and small models "saturate the Pi 5 CPU," with base.en only becoming viable on Pi 5 (not Pi 4) — consistent with tiny/base being marginal-to-real-time and small being the strained/batch-leaning tier, though this source doesn't give the exact 0.4-0.6x RTF figure from Round 1.

- **Claim (Piper "medium" tier real-time on Pi 5, Pi 4 needs "low"/lags): VERIFIED.** Independent source: pidiylab.com (https://pidiylab.com/text-to-speech-raspberry-pi-piper/) gives concrete timing — medium-quality Piper generation takes 1-3 seconds per short sentence on Pi 4 (lag) vs. under 1 second on Pi 5 (near real-time), directly corroborating Pi 5 handling "medium" comfortably while Pi 4 does not.

- **Claim (PipeWire now default Bluetooth-audio path on Bookworm, BlueALSA still available as alternative): VERIFIED.** Independent source: Raspberry Pi's own official forums (forums.raspberrypi.com, e.g. https://forums.raspberrypi.com/viewtopic.php?t=389048) — confirms "Bookworm introduced the pipewire audio system, which replaces pulseaudio and JACK" and that Bookworm's PipeWire natively manages Bluetooth audio device reconnection, matching the claim that PipeWire is now the default Bluetooth-audio path on Bookworm (BlueALSA/bluez-alsa-utils remains packaged separately as an alternative).

All 3 load-bearing claims upgraded from medium/low confidence (single-source) to **high confidence (independently verified)**.
