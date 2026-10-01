/**
 * web/src/components/AskYohPill.tsx — Task 6A, Spencer's information-
 * architecture decisions (2026-09-27), DESIGN.md `ask-yoh-pill`.
 *
 * Replaces `ChatBubble.tsx` (Story 8.8): Chat is no longer a page, and the
 * pill is no longer an inline expanding text field — it's a small, fixed
 * bottom-center, ~46px-tall button (like Wispr Flow's pill) that opens the
 * large Chat panel over the current page, per the approved mockup. It never
 * covers content: every page reserves room for it (bottom padding on the
 * page's own scroll area).
 *
 * Registers NO readiness gate — Home's "home-data" gate stays the only one
 * — and is focusable the instant it mounts, independent of Home's own
 * fetch (FR-39, NFR-CaptureSpeed): this component reads nothing from
 * `useHomeView()`'s state at all. The capture flow is: click this pill (or
 * press ⌘K, wired in `PageShell.tsx`) — opens the panel with its Chat Input
 * already focused — type — Enter. Three actions, as before.
 */
import { openChatPanel } from "../lib/chatPanel.ts";
import { CONTROL_TRANSITION, FOCUS_RING } from "../lib/controlStyles.ts";

export function AskYohPill(): React.JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[30px] z-(--z-pill) flex justify-center">
      <button
        type="button"
        data-testid="ask-yoh-pill"
        aria-label="Ask Yoh (Command K)"
        onClick={openChatPanel}
        className={`notification-glass pointer-events-auto flex h-[46px] items-center gap-2.5 rounded-full py-0 pl-2 pr-4.5 font-body text-small font-bold text-ink-primary shadow-extruded-md hover:shadow-extruded-lg active:shadow-inset ${FOCUS_RING} ${CONTROL_TRANSITION}`}
      >
        <span
          aria-hidden="true"
          className="flex size-[30px] items-center justify-center rounded-full bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end shadow-extruded-sm"
        >
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="var(--color-on-accent-solid)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h16v11H9l-5 4z" />
          </svg>
        </span>
        Ask Yoh
        <span className="pl-1 font-body text-caption font-medium text-ink-secondary">⌘K</span>
      </button>
    </div>
  );
}
