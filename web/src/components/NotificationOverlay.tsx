/**
 * web/src/components/NotificationOverlay.tsx
 *
 * Story 7.7, DESIGN.md `in-app-notification`, UX-DR45: a glass card with a
 * 3px `accent-solid` left bar, a pulsing dot, and a one-line message,
 * rendered on whatever page is open. The whole surface is clickable (and
 * keyboard-operable — UX-DR51: "every control is keyboard-reachable"): a
 * `deepLink` navigates via `PageNavigationContext` (Story 7.6's real
 * navigation, exposed through a small context — requirement #3, kept
 * minimal) and the card always dismisses on activation. An `operational`
 * notification carries no `deepLink` and is message-only — activating it
 * only dismisses.
 *
 * Only the newest 3 render, newest-first — the store
 * (`lib/notifications.ts`) deliberately never caps itself, so this is the
 * one place "up to three visible" is enforced; nothing is ever dropped from
 * the underlying list here, just not rendered this instant.
 */
import { PAGES } from "../lib/pages.ts";
import { usePageNavigationContext } from "../lib/navigationContext.tsx";
import { dismissNotification, useNotifications } from "../lib/notifications.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { Icon } from "./icons/Icon.tsx";
import type { NotificationRecord } from "../../../src/types/api.ts";

const MAX_VISIBLE = 3;

/**
 * Maps a notification's `deepLink` to a `PAGES` index. No producer sets a
 * real `deepLink` yet (every notification raised so far is `operational`
 * with `deepLink: null` — Story 7.7 is the first consumer), so this accepts
 * a bare page id ("tasks") or a leading-slash path ("/tasks"),
 * case-insensitive; an unrecognized target just dismisses without
 * navigating, never throws.
 */
function resolveDeepLinkIndex(deepLink: string): number | undefined {
  const id = deepLink.replace(/^\//, "").toLowerCase();
  const index = PAGES.findIndex((p) => p.id === id);
  return index === -1 ? undefined : index;
}

export function NotificationOverlay(): React.JSX.Element {
  const notifications = useNotifications();
  const nav = usePageNavigationContext();
  const reducedMotion = useReducedMotion();
  const visible = notifications.slice(0, MAX_VISIBLE);

  const activate = (n: NotificationRecord): void => {
    if (n.deepLink) {
      const index = resolveDeepLinkIndex(n.deepLink);
      if (index !== undefined) nav.goTo(index);
    }
    dismissNotification(n.id);
  };

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-40 flex flex-col gap-2" role="status" aria-live="polite">
      {visible.map((n) => (
        <div
          key={n.id}
          data-testid="notification-card"
          role="button"
          tabIndex={0}
          aria-label={n.body}
          onClick={() => activate(n)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return; // let the nested Dismiss button handle its own Enter/Space
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              activate(n);
            }
          }}
          className={
            "notification-glass pointer-events-auto flex w-80 cursor-pointer items-start gap-2 rounded-md border-l-[3px] border-accent-solid p-3 text-body text-ink-primary " +
            (reducedMotion ? "notification-card--reduced-motion" : "notification-card")
          }
        >
          <span
            aria-hidden="true"
            data-testid="notification-dot"
            className={"mt-1 size-2 shrink-0 rounded-full bg-accent-solid" + (reducedMotion ? "" : " notification-dot")}
          />
          <span className="flex-1">{n.body}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={(e) => {
              e.stopPropagation();
              dismissNotification(n.id);
            }}
            className="shrink-0"
          >
            <Icon path="M6 6 L18 18 M18 6 L6 18" label="Dismiss" />
          </button>
        </div>
      ))}
    </div>
  );
}
