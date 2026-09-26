import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { __resetReadinessForTests, useAppReady, useLaunchSplash, useReadinessGate } from "./readiness.ts";

describe("readiness", () => {
  beforeEach(() => {
    // `useLaunchSplash`'s one-way latch (fix round 2, ruling R16) is
    // module-level singleton state with no React lifecycle to hang off —
    // it doesn't reset itself between tests in this file the way component
    // state or `gates` (cleared via each `useReadinessGate` owner's own
    // unmount) would.
    __resetReadinessForTests();
  });

  it("useAppReady is true when no gate is registered", () => {
    const { result } = renderHook(() => useAppReady());
    expect(result.current).toBe(true);
  });

  it("registering a not-ready gate makes useAppReady false until it flips true", () => {
    const { result: appReady } = renderHook(() => useAppReady());
    const { rerender } = renderHook(({ ready }) => useReadinessGate("test-gate-a", ready), { initialProps: { ready: false } });
    expect(appReady.current).toBe(false);
    rerender({ ready: true });
    expect(appReady.current).toBe(true);
  });

  it("unmounting a gate's owner clears it — a stale not-ready gate never blocks forever", () => {
    const { result: appReady } = renderHook(() => useAppReady());
    const { unmount } = renderHook(() => useReadinessGate("temp-gate", false));
    expect(appReady.current).toBe(false);
    unmount();
    expect(appReady.current).toBe(true);
  });

  it("useLaunchSplash is true while not ready, false once ready (the original mount-order race case)", () => {
    // Fix round 1 (ruling R14 #4): no fake timers here — useLaunchSplash has
    // no timer of its own (PageShell.tsx owns the fade-out timing, driven by
    // a real onTransitionEnd, not a duplicated JS number). A controllable
    // gate (the same pattern the other tests in this file already use)
    // exercises "visible while not ready, then false once ready" directly.
    // The gate is rendered before useLaunchSplash so the very first render
    // already reflects the registered gate, exactly the ordering a sibling
    // gate-owner (e.g. Story 7.8's Home) and PageShell must get right when
    // they mount together — and, per fix round 2, this must still hold now
    // that useLaunchSplash carries a one-way latch: the latch's
    // `gates.size > 0` guard (see readiness.ts's isSplashReady) is what
    // keeps a transient "zero gates yet" bootstrap window from ever
    // tripping it before this real gate gets a say.
    const { rerender } = renderHook(({ ready }) => useReadinessGate("splash-gate", ready), { initialProps: { ready: false } });
    const { result } = renderHook(() => useLaunchSplash());
    expect(result.current).toBe(true);
    rerender({ ready: true });
    expect(result.current).toBe(false);
  });

  it("useLaunchSplash is a one-way latch — once ready, it never re-shows even if the gate later flips back to not-ready", () => {
    // Fix round 2 (ruling R16): this is the exact regression the review
    // caught — Home's `planLoaded` gate going true, then false again (a
    // background refetch), must not re-cover Home with the full-screen
    // splash mid-session.
    const { rerender } = renderHook(({ ready }) => useReadinessGate("splash-gate-latch", ready), { initialProps: { ready: true } });
    const { result } = renderHook(() => useLaunchSplash());
    expect(result.current).toBe(false); // ready from the start — no splash
    rerender({ ready: false }); // gate flips back to not-ready (e.g. a refetch)
    expect(result.current).toBe(false); // latched — must NOT reappear
    rerender({ ready: true }); // and flipping ready again changes nothing
    expect(result.current).toBe(false);
  });

  it("the one-way latch does not fire on the vacuous zero-gates case — only a real, registered gate can retire the splash for good", () => {
    // If the latch fired on bare `isAppReady()` (vacuously true with zero
    // gates), a gate that hasn't registered YET (but is about to, starting
    // `false`) could never hold the splash open — the latch would already
    // have fired on the empty-gates snapshot that exists for an instant
    // before any gate owner's effect runs. Registering a gate as `false`
    // AFTER a render with zero gates must still show (not permanently hide)
    // the splash.
    const { result } = renderHook(() => useLaunchSplash());
    expect(result.current).toBe(false); // zero gates: vacuously ready, no splash (Story 7.6 today)
    const { rerender } = renderHook(({ ready }) => useReadinessGate("late-gate", ready), { initialProps: { ready: false } });
    expect(result.current).toBe(true); // a real gate now exists and is not ready — splash must show
    rerender({ ready: true });
    expect(result.current).toBe(false);
  });
});
