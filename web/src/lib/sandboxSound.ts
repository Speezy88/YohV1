/**
 * web/src/lib/sandboxSound.ts
 *
 * Story 9.3, UX-DR39/OQ16 (rulings (b)/(c)): the ONE reward-chime call
 * site (`playSandboxCompleteChime`) — an oscillator envelope, no external
 * asset, swappable here without touching any caller. Reduced motion is
 * checked INSIDE this function (not by the caller, `sandbox.ts`, which is
 * plain client state, not a component). Never throws: a browser refusing
 * to construct an `AudioContext` must not interrupt the session-ending
 * path that calls this.
 */
import { prefersReducedMotion } from "../hooks/useReducedMotion.ts";

const CHIME_FREQUENCY_HZ = 880; // A5
const CHIME_DURATION_SECONDS = 0.22;
const CHIME_PEAK_GAIN = 0.12; // modest volume, per ruling (b)

export function playSandboxCompleteChime(): void {
  if (prefersReducedMotion()) return;
  try {
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = CHIME_FREQUENCY_HZ;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(CHIME_PEAK_GAIN, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + CHIME_DURATION_SECONDS);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + CHIME_DURATION_SECONDS + 0.02);
    oscillator.onended = () => ctx.close();
  } catch {
    // Never the only confirmation, and never load-bearing — a construction
    // or playback failure (no user gesture yet, Web Audio disabled) is a
    // silent no-op, not a broken session end.
  }
}
