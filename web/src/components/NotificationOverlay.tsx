/**
 * web/src/components/NotificationOverlay.tsx
 *
 * Story 7.7, DESIGN.md `in-app-notification`, UX-DR45: a glass card with a
 * 3px `accent-solid` left bar, a pulsing dot, and a message, rendered on
 * whatever page is open. The whole surface is clickable (and
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
 *
 * Polish-1 (2026-09-27) fix round, "readable notification cards": the live
 * app showed calendar text bleeding through these cards (tokens.css's
 * `--color-glass-fill` was only 55%/6% opaque — fixed there, this file
 * unaffected) and the cards were a single undifferentiated line even for a
 * long AD-7 alert body. Three changes here:
 *  1. A `shadow-extruded-sm` (subtle shadow, per the brief) on top of the
 *     now-solid glass fill.
 *  2. A bold title line, separate from the body — but ONLY when `title`
 *     differs from `body` (several notification kinds, and most of this
 *     component's own existing tests, use the same string for both; showing
 *     the same line twice would be redundant, not "compact").
 *  3. A long body clamps to 3 lines (`line-clamp-3`) with a "Show more" /
 *     "Show less" toggle — `expandedIds`, a local Set of notification ids,
 *     tracks which cards are expanded; CSS `line-clamp` never touches the
 *     DOM text itself, so every existing `getByText(body)` query still
 *     matches. Short bodies (at/under `CLAMP_THRESHOLD_CHARS`) never show
 *     the toggle at all.
 *  4. When the store holds more than `MAX_VISIBLE`, a small "+N more"
 *     affordance renders after the visible cards (own `data-testid`, not a
 *     `notification-card`, so it doesn't affect the visible-card count).
 */
import { useState } from "react";
import { PAGES } from "../lib/pages.ts";
import { usePageNavigationContext } from "../lib/navigationContext.tsx";
import { dismissNotification, useNotifications } from "../lib/notifications.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { openChatWithCommand, useChatPanel } from "../lib/chatPanel.ts";
import { BUTTON_TEXT, CONTROL_TRANSITION, FOCUS_RING } from "../lib/controlStyles.ts";
import { Icon } from "./icons/Icon.tsx";
import type { NotificationRecord } from "../../../src/types/api.ts";

const MAX_VISIBLE = 3;
/** A body at or under this length never clamps — no "Show more" toggle for an already-short message. */
const CLAMP_THRESHOLD_CHARS = 140;

/**
 * Maps a notification's `deepLink` to a `PAGES` index. Accepts a bare page
 * id ("tasks") or a leading-slash path ("/tasks"), case-insensitive; an
 * unrecognized target just dismisses without navigating, never throws.
 * A `deepLink` starting with "chat" is handled separately by `activate`
 * below and never reaches this resolver — Chat is a panel, not a `PAGES`
 * entry (Story 9.3, E8).
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
  // Task 8: while the Chat panel is open, sit below its header band (title + close control) rather than over it.
  const { open: chatOpen } = useChatPanel();
  const visible = notifications.slice(0, MAX_VISIBLE);
  const hiddenCount = notifications.length - visible.length;
  // Which cards' long bodies are expanded past their 3-line clamp — a local
  // Set of notification ids, never persisted (a fresh mount re-clamps).
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  /**
   * Story 9.3 (E8), generalized by Task 7 (polish-5): a "chat"-prefixed
   * deepLink opens the Chat panel instead of resolving a PAGES index — Chat
   * is a panel. Anything after a "chat:" prefix, trimmed, is sent as a
   * command exactly as if typed (so "chat:/sandbox" sends "/sandbox",
   * "chat:/plan" sends "/plan", ...); a bare "chat" or an empty "chat:"
   * just opens the panel with no command. Every other deepLink keeps its
   * existing page-navigation behavior.
   */
  const activate = (n: NotificationRecord): void => {
    if (n.deepLink?.startsWith("chat")) {
      const rest = n.deepLink.startsWith("chat:") ? n.deepLink.slice("chat:".length).trim() : "";
      openChatWithCommand(rest !== "" ? rest : undefined);
    } else if (n.deepLink) {
      const index = resolveDeepLinkIndex(n.deepLink);
      if (index !== undefined) nav.goTo(index);
    }
    dismissNotification(n.id);
  };

  const toggleExpanded = (id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div data-testid="notification-overlay" className={`pointer-events-none fixed right-4 ${chatOpen ? "top-28" : "top-4"} z-(--z-toast) flex flex-col gap-2`} role="status" aria-live="polite">
      {visible.map((n) => {
        const showTitle = n.title.length > 0 && n.title !== n.body;
        const isLong = n.body.length > CLAMP_THRESHOLD_CHARS;
        const expanded = expandedIds.has(n.id);
        return (
          <div
            key={n.id}
            data-testid="notification-card"
            className={
              "notification-glass shadow-extruded-sm pointer-events-auto flex w-80 items-start gap-2 rounded-md glass-accent-bar p-3 text-body text-ink-primary " +
              (reducedMotion ? "notification-card--reduced-motion" : "notification-card")
            }
          >
            <span
              aria-hidden="true"
              data-testid="notification-dot"
              className={"mt-1 size-2 shrink-0 rounded-full bg-accent-solid" + (reducedMotion ? "" : " notification-dot")}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {/* Task 8 (polish-6): the message is the primary button; Show more and Dismiss are its siblings, never nested inside it. */}
              <button
                type="button"
                onClick={() => activate(n)}
                className={`flex min-w-0 flex-col gap-0.5 rounded-xs text-left ${FOCUS_RING}`}
              >
                {showTitle && <span className="font-bold">{n.title}</span>}
                <span className={isLong && !expanded ? "line-clamp-3" : ""}>{n.body}</span>
              </button>
              {isLong && (
                <button
                  type="button"
                  onClick={() => toggleExpanded(n.id)}
                  className={`${BUTTON_TEXT} min-h-6 self-start text-caption-lg font-bold! ${FOCUS_RING}`}
                >
                  {expanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissNotification(n.id)}
              className={`flex size-8 shrink-0 items-center justify-center rounded-sm hover:bg-surface-sunken ${FOCUS_RING} ${CONTROL_TRANSITION}`}
            >
              <Icon path="M6 6 L18 18 M18 6 L6 18" label="Dismiss" />
            </button>
          </div>
        );
      })}
      {hiddenCount > 0 && (
        <div data-testid="notification-more-indicator" className="text-center text-caption text-ink-secondary">
          +{hiddenCount} more
        </div>
      )}
    </div>
  );
}
