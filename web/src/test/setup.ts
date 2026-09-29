import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// @testing-library/react's automatic afterEach cleanup only registers itself
// when it detects Jest-style globals; Vitest's config below runs without
// `globals: true` (deliberately — no implicit globals in web/ source), so
// cleanup is wired explicitly here instead.
afterEach(() => {
  cleanup();
});

// jsdom (27.0.0) does not implement window.matchMedia at all. A default
// stub (always "no preference matched") lets code under test call it
// unconditionally; individual tests override it with vi.spyOn where the
// preference itself is what's under test (useReducedMotion.test.tsx).
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom (27.0.0) has no EventSource at all (confirmed: `"EventSource" in
// new JSDOM(...).window` is false). Story 7.7's `events.ts` (via
// `notifications.ts`'s `startNotificationStream`) constructs one
// unconditionally on mount, including from components (`PageShell`) whose
// own tests never exercise SSE behavior — a bare `ReferenceError` there
// would fail every one of those tests. This inert default (never opens,
// never fires) is a no-op stand-in; `events.test.ts` replaces it per-test
// with a real fake via `vi.stubGlobal`/`vi.unstubAllGlobals` (which restores
// THIS stub afterward, not `undefined`).
if (typeof globalThis.EventSource === "undefined") {
  class InertEventSource {
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public readonly url: string) {}
    close(): void {}
  }
  // @ts-expect-error — a minimal stand-in, not a spec-complete EventSource.
  globalThis.EventSource = InertEventSource;
}

// jsdom has no ResizeObserver; @dnd-kit/dom constructs one at import time.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
