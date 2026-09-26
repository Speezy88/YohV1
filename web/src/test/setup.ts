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
