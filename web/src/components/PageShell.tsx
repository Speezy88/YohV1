// web/src/components/PageShell.tsx — Story 7.6; Task 6A (2026-09-27)
// rebuilds this as the vertical page stack: Home → Tasks → Desk →
// Research Hub → Memory, one page in view at a time, with a persistent left Sidebar
// and a Chat panel that overlays every page. Navigation (sidebar click, the
// on-screen up/down arrow buttons, ↑/↓/Page Up/Page Down, an edge-aware
// mouse wheel) only ever changes `usePageNavigation`'s index — every page
// stays mounted the whole time, so a page's scroll position and any
// in-progress client-side state survive a page change (AD-17's "ephemeral
// view state is client-only"). Side swipe is retired: no swipe gesture code
// remains in web/ (`web/src/lib/swipe.ts` is deleted).
//
// Motion (UX-DR49/DESIGN.md "Page transition" row): full motion slides the
// column by `transform` (now vertically, `translateY`, not the retired
// horizontal `translateX`); reduced motion cross-fades instead — every page
// stays mounted, stacked on top of itself, with only the active one at
// opacity-100 and a transition between states. The transition duration
// (`--duration-page-transition`) lives in tokens.css, not a JS literal.
//
// Accessibility (fix round 1, ruling R14 #1, carried into Task 6A): every
// inactive page is both `inert` and `aria-hidden`, in BOTH layouts. Task 6A
// adds one more source of "not the foreground": while the Chat panel is
// open, EVERY page (including the active one) is `inert`/`aria-hidden` too
// — "the page behind is dimmed context, not functional" — the Sidebar
// stays interactive throughout. A `focusin` guard is paired with
// `inert`/`aria-hidden` as defense-in-depth (`inert`'s focus-blocking
// behavior isn't implemented in every environment, notably jsdom).
import { useEffect, useRef, useState } from "react";
import { PAGES, capturesArrowKeys, isTextFieldFocused, usePageNavigation } from "../lib/pages.ts";
import HomePage from "../pages/Home.tsx";
import TasksPage from "../pages/Tasks.tsx";
import DeskPage from "../pages/Desk.tsx";
import ResearchHubPage from "../pages/ResearchHub.tsx";
import MemoryPage from "../pages/Memory.tsx";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { Screensaver } from "./Screensaver.tsx";
import { useLaunchSplash } from "../lib/readiness.ts";
import { useIdleScreensaver } from "../lib/idle.ts";
import { useWheelPageNavigation } from "../lib/wheelNav.ts";
import { PageNavigationContext } from "../lib/navigationContext.tsx";
import { NotificationOverlay } from "./NotificationOverlay.tsx";
import { startNotificationStream } from "../lib/notifications.ts";
import { startEventBus } from "../lib/eventBus.ts";
import { Sidebar } from "./Sidebar.tsx";
import { AskYohPill } from "./AskYohPill.tsx";
import { ChatPanel } from "./ChatPanel.tsx";
import { FOCUS_RING } from "../lib/controlStyles.ts";
import { toggleChatPanel, useChatPanel } from "../lib/chatPanel.ts";

const MAIN_ID = "main-content";

const PAGE_COMPONENTS = { home: HomePage, tasks: TasksPage, desk: DeskPage, research: ResearchHubPage, memory: MemoryPage } as const;

export function PageShell(): React.JSX.Element {
  const nav = usePageNavigation();
  const reducedMotion = useReducedMotion();
  const showSplash = useLaunchSplash();
  const idle = useIdleScreensaver();
  const { open: chatOpen } = useChatPanel();
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
    // (e.g. Home) mounts in the same tick as this component and hasn't
    // registered its gate yet. React still flushes that stale render's
    // passive effects before the corrective re-render's effect runs, so if
    // this effect only ever moved state one way (not-fading -> fading), a
    // single spurious "ready" tick could start the fade permanently even
    // though the very next render says "not ready" after all. Re-asserting
    // "fully visible, not fading" in the `showSplash` branch makes the
    // settled (last) render always win, regardless of how many transient
    // renders preceded it.
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

  useWheelPageNavigation(rootRef, (direction) => {
    if (chatOpen) return; // the panel owns its own scroll; never navigate pages underneath it
    if (direction > 0) nav.next();
    else nav.prev();
  });

  // Story 7.8, AD-18: the one shared SSE connection, started once for the
  // app's lifetime (multiple subscribers, e.g. Home's own `homeView.ts`
  // store, multiplex over this single `EventSource`) and torn down on
  // unmount.
  useEffect(() => startEventBus(), []);
  // Story 7.7: the notification store's own subscription to that shared bus.
  useEffect(() => startNotificationStream(), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // ⌘K / Ctrl+K opens or closes the Chat panel from anywhere, even a
      // text field (Spencer's IA decision: "Click the pill or press ⌘K").
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleChatPanel();
        return;
      }
      if (chatOpen) return; // the panel is the foreground surface; page keys are inert while it's open
      if (isTextFieldFocused(document.activeElement)) return;
      // Task 6B: a region that owns ↑/↓ (the Tasks list's rows) keeps them.
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && (e.defaultPrevented || capturesArrowKeys(document.activeElement))) return;
      if (e.key === "ArrowDown" || e.key === "PageDown") nav.next();
      if (e.key === "ArrowUp" || e.key === "PageUp") nav.prev();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [nav, chatOpen]);

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
      {/* Task 8 (polish-6): first tab stop; visible only while focused. */}
      <a
        href={`#${MAIN_ID}`}
        onClick={(e) => {
          e.preventDefault();
          document.getElementById(MAIN_ID)?.focus();
        }}
        className={`fixed left-4 top-4 z-(--z-skip-link) -translate-y-24 rounded-md bg-surface-raised px-4 py-2 font-body text-body font-bold text-ink-primary shadow-extruded-md focus:translate-y-0 ${FOCUS_RING}`}
      >
        Skip to content
      </a>
      <div
        ref={rootRef}
        data-testid="page-shell-root"
        // Task 8 (polish-6): the Chat panel is a modal — everything outside it
        // (Sidebar, pill, pages) is inert while it is open. The panel,
        // notifications and the Undo Toast are siblings of this root.
        inert={chatOpen ? true : undefined}
        className="relative flex h-dvh overflow-hidden"
        style={{ overscrollBehaviorY: "none" }}
      >
        <Sidebar />
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <main id={MAIN_ID} tabIndex={-1} className="h-full outline-none">
          <div
            className={reducedMotion ? "relative h-full" : "flex h-full flex-col ease-out"}
            style={{
              transitionProperty: reducedMotion ? undefined : "transform",
              transitionDuration: reducedMotion ? undefined : "var(--duration-page-transition)",
              ...(reducedMotion
                ? {}
                : { height: `${PAGES.length * 100}%`, transform: `translateY(-${(nav.index * 100) / PAGES.length}%)` }),
            }}
          >
            {PAGES.map((page, i) => {
              const Component = PAGE_COMPONENTS[page.id];
              const isActive = i === nav.index;
              const hidden = !isActive || chatOpen;
              return (
                <div
                  key={page.id}
                  data-testid={`page-${page.id}`}
                  aria-hidden={hidden ? true : undefined}
                  inert={hidden ? true : undefined}
                  // Polish-2 (real bug from a live 1440x760 screenshot): each
                  // page's own slot is exactly one viewport tall, but its
                  // ancestor's `overflow-hidden` only clips the WHOLE
                  // translated column at the visible viewport's own edges —
                  // it does nothing about one page's content overflowing
                  // past the bottom of ITS OWN slot into the slot directly
                  // below (the next page in the stack), which is what was
                  // visible on screen. `overflow-hidden` here clips every
                  // page to its own box, so a page can never paint into a
                  // neighboring page's slot no matter how tall its content
                  // gets — a page that needs to show more scrolls
                  // internally instead (Home's calendar panel, Tasks' list).
                  className={
                    reducedMotion
                      ? `absolute inset-0 h-full overflow-hidden ease-out ${isActive ? "opacity-100" : "pointer-events-none opacity-0"}`
                      : `h-full shrink-0 overflow-hidden ${isActive ? "" : "pointer-events-none"}`
                  }
                  style={{
                    transitionProperty: reducedMotion ? "opacity" : undefined,
                    transitionDuration: reducedMotion ? "var(--duration-page-transition)" : undefined,
                    ...(reducedMotion ? {} : { height: `${100 / PAGES.length}%` }),
                  }}
                >
                  <Component />
                </div>
              );
            })}
          </div>
          </main>
          <AskYohPill />
        </div>
        {splashVisible && (
          <div
            data-testid="launch-splash"
            // Story 7.10: once fading, the splash never intercepts input or
            // gets read out — if Home was ready before the splash was ever
            // painted opaque, no transition runs and `transitionend` never
            // fires, which would otherwise leave an invisible layer on top.
            aria-hidden={splashFadingOut || undefined}
            className={`absolute inset-0 z-(--z-splash) transition-opacity ${splashFadingOut ? "pointer-events-none opacity-0" : "opacity-100"}`}
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
      <ChatPanel />
      <NotificationOverlay />
    </PageNavigationContext.Provider>
  );
}
