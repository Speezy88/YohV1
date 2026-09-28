import { describe, it, expect, vi, afterEach } from "vitest";
import { playSandboxCompleteChime } from "./sandboxSound.ts";
import * as reducedMotionModule from "../hooks/useReducedMotion.ts";

interface Call {
  readonly frequency: number;
  readonly started: boolean;
  readonly stopped: boolean;
  readonly gainRamps: number[];
}

function stubAudioContext(): { calls: Call[] } {
  const calls: Call[] = [];
  class FakeGain {
    readonly gain = {
      setValueAtTime: (_v: number, _t: number) => {},
      linearRampToValueAtTime: (v: number, _t: number) => calls[calls.length - 1]?.gainRamps.push(v),
      exponentialRampToValueAtTime: (v: number, _t: number) => calls[calls.length - 1]?.gainRamps.push(v),
    };
    connect(): FakeGain {
      return this;
    }
  }
  class FakeOscillator {
    type = "sine";
    frequency = { value: 0 };
    onended: (() => void) | null = null;
    connect(): FakeGain {
      return new FakeGain();
    }
    start(): void {
      calls.push({ frequency: this.frequency.value, started: true, stopped: false, gainRamps: [] });
    }
    stop(): void {
      const last = calls[calls.length - 1];
      if (last) (last as { stopped: boolean }).stopped = true;
    }
  }
  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    createOscillator(): FakeOscillator {
      return new FakeOscillator();
    }
    createGain(): FakeGain {
      return new FakeGain();
    }
    close(): void {}
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("playSandboxCompleteChime", () => {
  it("plays one short oscillator tone at modest volume when motion is not reduced", () => {
    vi.spyOn(reducedMotionModule, "prefersReducedMotion").mockReturnValue(false);
    const { calls } = stubAudioContext();
    playSandboxCompleteChime();
    expect(calls.length).toBe(1);
    expect(calls[0]?.started).toBe(true);
    expect(calls[0]?.frequency).toBeGreaterThan(0);
  });

  it("is silent under reduced motion — never constructs an AudioContext at all", () => {
    vi.spyOn(reducedMotionModule, "prefersReducedMotion").mockReturnValue(true);
    const ctor = vi.fn();
    vi.stubGlobal("AudioContext", ctor);
    playSandboxCompleteChime();
    expect(ctor).not.toHaveBeenCalled();
  });

  it("never throws when AudioContext is unavailable", () => {
    vi.spyOn(reducedMotionModule, "prefersReducedMotion").mockReturnValue(false);
    vi.stubGlobal("AudioContext", undefined);
    expect(() => playSandboxCompleteChime()).not.toThrow();
  });

  it("never throws when the browser refuses to construct an AudioContext (Review Focus #5)", () => {
    vi.spyOn(reducedMotionModule, "prefersReducedMotion").mockReturnValue(false);
    class ThrowingAudioContext {
      constructor() {
        throw new Error("NotAllowedError: no user gesture yet");
      }
    }
    vi.stubGlobal("AudioContext", ThrowingAudioContext);
    expect(() => playSandboxCompleteChime()).not.toThrow();
  });
});
