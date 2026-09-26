// web/src/components/PageShell.tsx — Story 7.6. Home → Chat → Tasks → Desk
// as one flex row, one page in view at a time. Navigation (swipe, click,
// arrow key) only ever changes `usePageNavigation`'s index — every page
// stays mounted the whole time, so a page's scroll position and any
// in-progress client-side state (an unsent Chat draft) survive a swipe away
// and back (AD-17's "ephemeral view state is client-only").
//
// Motion (UX-DR49/DESIGN.md "Page transition" row): full motion slides the
// row by `transform`; reduced motion cross-fades instead — every page stays
// mounted, stacked on top of itself, with only the active one at
// opacity-100 and a transition between states (never an instant snap
// disguised as "reduced motion"). The transition duration
// (`--duration-page-transition`) lives in tokens.css, not a JS literal —
// fix round 1, controller ruling R14 #3.
//
// Accessibility (fix round 1, ruling R14 #1): every inactive page is both
// `inert` and `aria-hidden`, in BOTH layouts (not only the reduced-motion
// stack) — an off-screen page in the slide layout was previously still in
// the tab order. A `focusin` guard is paired with `inert`/`aria-hidden` as
// defense-in-depth: `inert`'s focus-blocking behavior isn't implemented in
// every environment (notably jsdom, which is why this guard is what makes
// "unreachable" independently testable rather than relying on a browser
// feature the test environment can't exercise), so this guard blurs any
// focus that lands inside a page currently marked `aria-hidden`.
import { useEffect, useRef, useState } from "react";
import { PAGES, isTextFieldFocused, usePageNavigation } from "../lib/pages.ts";
import { PageIndicator } from "./PageIndicator.tsx";
import HomePage from "../pages/Home.tsx";
import ChatPage from "../pages/Chat.tsx";
import TasksPage from "../pages/Tasks.tsx";
import DeskPage from "../pages/Desk.tsx";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { Screensaver } from "./Screensaver.tsx";
import { useLaunchSplash } from "../lib/readiness.ts";
import { useIdleScreensaver } from "../lib/idle.ts";
import { useSwipeNavigation } from "../lib/swipe.ts";
import { PageNavigationContext } from "../lib/navigationContext.tsx";
import { NotificationOverlay } from "./NotificationOverlay.tsx";
import { startNotificationStream } from "../lib/notifications.ts";
import { startEventBus } from "../lib/eventBus.ts";

const PAGE_COMPONENTS = { home: HomePage, chat: ChatPage, tasks: TasksPage, desk: DeskPage } as const;

export function PageShell(): React.JSX.Element {
  const nav = usePageNavigation();
  const reducedMotion = useReducedMotion();
  const showSplash = useLaunchSplash();
  const idle = useIdleScreensaver();
  const rootRef = useRef<HTMLDivElement>(null);

  // The launch splash: visible while `showSplash` is true, then either
  // fades out (normal motion, `onTransitionEnd` unmounts it once the real
  // CSS transition completes — no JS timer duplicating the CSS duration) or
  // disappears instantly (reduced motion, per DESIGN.md's "Screensaver
  // drift … reduced motion: static" pattern applied to entry/exit too).
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashFadingOut, setSplashFadingOut] = useState(false);

  useEffect(() => {
    // Idempotent, bidirectional sync — not a one-shot "start fading" trigger
    // — deliberately: `useAppReady`'s `useSyncExternalStore` snapshot can be
    // transiently stale on a render where a sibling `useReadinessGate` owner
    // (e.g. Story 7.8's Home) mounts in the same tick as this component and
    // hasn't registered its gate yet. React still flushes that stale
    // render's passive effects before the corrective re-render's effect
    // runs, so if this effect only ever moved state one way (not-fading ->
    // fading), a single spurious "ready" tick could start the fade
    // permanently even though the very next render says "not ready" after
    // all. Re-asserting "fully visible, not fading" in the `showSplash`
    // branch makes the settled (last) render always win, regardless of how
    // many transient renders preceded it.
    if (showSplash) {
      setSplashVisible(true);
      setSplashFadingOut(false);
      return;
    }
    if (reducedMotion) {
      setSplashVisible(false);
      return;
    }
    setSplashFadingOut(true);
  }, [showSplash, reducedMotion]);

  useSwipeNavigation(rootRef, (direction) => (direction > 0 ? nav.next() : nav.prev()));

  // Story 7.8, AD-18: the one shared SSE connection, started once for the
  // app's lifetime (multiple subscribers, e.g. Home's own `homeView.ts`
  // store, multiplex over this single `EventSource`) and torn down on
  // unmount.
  useEffect(() => startEventBus(), []);
  // Story 7.7: the notification store's own subscription to that shared bus.
  useEffect(() => startNotificationStream(), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTextFieldFocused(document.activeElement)) return;
      if (e.key === "ArrowRight") nav.next();
      if (e.key === "ArrowLeft") nav.prev();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [nav]);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent): void => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const pageContainer = target.closest<HTMLElement>('[data-testid^="page-"]');
      if (pageContainer && pageContainer.getAttribute("aria-hidden") === "true") {
        target.blur();
      }
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  return (
    <PageNavigationContext.Provider value={nav}>
      <div ref={rootRef} className="relative h-dvh overflow-hidden" style={{ overscrollBehaviorX: "none" }}>
        <div
          className={reducedMotion ? "relative h-full" : "flex h-full ease-out"}
          style={{
            transitionProperty: reducedMotion ? undefined : "transform",
            transitionDuration: reducedMotion ? undefined : "var(--duration-page-transition)",
            ...(reducedMotion
              ? {}
              : { width: `${PAGES.length * 100}%`, transform: `translateX(-${(nav.index * 100) / PAGES.length}%)` }),
          }}
        >
          {PAGES.map((page, i) => {
            const Component = PAGE_COMPONENTS[page.id];
            const isActive = i === nav.index;
            return (
              <div
                key={page.id}
                data-testid={`page-${page.id}`}
                aria-hidden={isActive ? undefined : true}
                inert={isActive ? undefined : true}
                className={
                  reducedMotion
                    ? `absolute inset-0 h-full ease-out ${isActive ? "opacity-100" : "pointer-events-none opacity-0"}`
                    : `h-full shrink-0 ${isActive ? "" : "pointer-events-none"}`
                }
                style={{
                  transitionProperty: reducedMotion ? "opacity" : undefined,
                  transitionDuration: reducedMotion ? "var(--duration-page-transition)" : undefined,
                  ...(reducedMotion ? {} : { width: `${100 / PAGES.length}%` }),
                }}
              >
                <Component />
              </div>
            );
          })}
        </div>
        <PageIndicator index={nav.index} goTo={nav.goTo} />
        {splashVisible && (
          <div
            data-testid="launch-splash"
            // Story 7.10: once fading, the splash never intercepts input or
            // gets read out — if Home was ready before the splash was ever
            // painted opaque, no transition runs and `transitionend` never
            // fires, which would otherwise leave an invisible layer on top.
            aria-hidden={splashFadingOut || undefined}
            className={`absolute inset-0 z-50 transition-opacity ${splashFadingOut ? "pointer-events-none opacity-0" : "opacity-100"}`}
            style={{ transitionDuration: "var(--duration-splash-fade)" }}
            // `e.target === e.currentTarget` guards against a bubbled
            // transitionend from some future descendant animation — only this
            // wrapper's own opacity transition should ever unmount the splash.
            onTransitionEnd={(e) => {
              if (e.target === e.currentTarget) setSplashVisible(false);
            }}
          >
            <Screensaver variant="splash" />
          </div>
        )}
        {idle && <Screensaver variant="idle" />}
      </div>
      <NotificationOverlay />
    </PageNavigationContext.Provider>
  );
}
