/**
 * web/src/lib/readiness.ts
 *
 * Story 7.6, FR-45: the app is "ready" once every registered named gate is
 * true. This story registers none of its own, so the launch splash always
 * resolves promptly. Story 7.8 calls `useReadinessGate("home-data",
 * planLoaded)` from Home — no change to this file's signature — and the
 * splash then waits for Home's first fetch too, exactly the "hook 7.8
 * extends" the AC calls for.
 */
import { useLayoutEffect, useSyncExternalStore } from "react";

const gates = new Map<string, boolean>();
const listeners = new Set<() => void>();

/**
 * Fix round 2 (controller ruling R16): the launch splash's one-way latch —
 * once true, permanently true for the session, regardless of any later
 * gate flapping (e.g. Home's `planLoaded` going false again on a
 * refetch-on-focus/reconnect). See `isSplashReady` for why this is safe
 * from the mount-order race that a naive "latch on first true" would
 * reintroduce.
 */
let hasBeenReady = false;

function notify(): void {
  listeners.forEach((l) => l());
}

/** Live readiness: true once every registered gate is true (vacuously true with zero gates registered — Story 7.6 has none). */
function isAppReady(): boolean {
  for (const ready of gates.values()) if (!ready) return false;
  return true;
}

export function useAppReady(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    isAppReady,
  );
}

/**
 * The launch splash's own readiness snapshot: live-tracking (self-healing,
 * same as `isAppReady`) until it latches permanently true, and never
 * un-latches.
 *
 * Critically, the latch condition is `gates.size > 0 && isAppReady()`, NOT
 * bare `isAppReady()`. With zero gates registered, `isAppReady()` is
 * vacuously true — including on a render before any gate owner (e.g. a
 * sibling/descendant `useReadinessGate` caller mounting in the same tick)
 * has had a chance to register anything yet. A naive "latch the first time
 * I see true" would permanently latch on that transient bootstrap
 * artifact, before a real gate (which might start `false`) ever gets a
 * say — reintroducing exactly the mount-order race the `useLayoutEffect`
 * registration fix (below) was written to avoid. Requiring `gates.size >
 * 0` excludes that vacuous case from ever tripping the latch: the latch
 * can only fire once a REAL, named gate exists and is satisfied, which by
 * definition cannot happen before that gate has registered. Reading
 * `gates.size`/`gates.values()` directly (not a React-closure-captured
 * value) also means every call reflects the map's true current contents,
 * whichever render or effect triggered it — there is no stale snapshot to
 * worry about here, unlike a value latched inside a passive/layout effect
 * closure.
 */
function isSplashReady(): boolean {
  if (hasBeenReady) return true;
  const live = isAppReady();
  if (gates.size > 0 && live) hasBeenReady = true;
  return live;
}

/**
 * Test-only: clears the splash's one-way latch (and, defensively, any
 * leftover gates — normal test cleanup already removes these via each
 * `useReadinessGate` caller's own unmount, but this is a backstop). Both
 * are module-level singleton state; `hasBeenReady` in particular has no
 * React lifecycle to hang off (a real one-way latch, by design, never
 * resets on its own), so it does not clear between tests within the same
 * file the way a component's own state would. Call this in a
 * `beforeEach`/`afterEach` wherever a test exercises `useLaunchSplash`'s
 * latch behavior. Never called from production code.
 */
export function __resetReadinessForTests(): void {
  hasBeenReady = false;
  gates.clear();
}

/**
 * Registers a named readiness condition for the lifetime of the calling
 * component. Story 7.8: `useReadinessGate("home-data", planLoaded)`.
 *
 * Registration runs in a *layout* effect, not a passive one: layout effects
 * for an entire commit run before any component's passive effects fire
 * (React's ordering guarantee), so a gate owner and a reader that both
 * mount in the same tick (e.g. `PageShell` and Story 7.8's `Home`) can
 * never observe a stale "no gates yet" snapshot — a gate that starts
 * `false` reliably holds `useAppReady()`/the launch splash open from that
 * very first render, instead of racing a passive-effect registration that
 * arrives one tick too late.
 */
export function useReadinessGate(key: string, ready: boolean): void {
  useLayoutEffect(() => {
    gates.set(key, ready);
    notify();
    return () => {
      gates.delete(key);
      notify();
    };
  }, [key, ready]);
}

/**
 * True until the app has been ready at least once, then permanently false
 * for the rest of the session — it never re-shows the splash even if a
 * gate later flips back to not-ready (fix round 2, controller ruling R16:
 * Home's `planLoaded` gate could plausibly go true, then false again on a
 * background refetch-on-focus/reconnect; a live-tracking splash would
 * otherwise re-cover Home with a full-screen takeover mid-session — the
 * idle Screensaver already owns "no input for a while", so the splash has
 * no business reappearing for this). No timer: `isSplashReady`'s one-way
 * `hasBeenReady` latch (module-level, in this file) is what makes this
 * permanent, and it is deliberately immune to the mount-order race a naive
 * "latch on first true" would reintroduce — see `isSplashReady`'s own
 * docstring for why `gates.size > 0` is the load-bearing guard there.
 *
 * (Fix round 1's version of this function was a bare `!useAppReady()` with
 * no latch at all, and before that, a `shown` state latched inside this
 * hook's own passive effect — both replaced: the former reintroduced the
 * mid-session-reappearance bug this round fixes, the latter was itself
 * vulnerable to the mount-order race. The latch now lives in the shared
 * snapshot function instead of component state, so it settles correctly
 * regardless of which/how many components call this hook.)
 */
export function useLaunchSplash(): boolean {
  const splashReady = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    isSplashReady,
  );
  return !splashReady;
}
