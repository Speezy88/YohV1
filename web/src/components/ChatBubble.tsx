/**
 * web/src/components/ChatBubble.tsx
 *
 * Story 8.8, UX-DR35, DESIGN.md `chat-bubble`: Home's always-available
 * capture surface — a small glass pill docked bottom-center, expanding wide
 * on hover or focus (a focus ring plus glow). Reuses `.notification-glass`
 * + `shadow-focus-glow`, the SAME floating-glass mechanism `ChatInput.tsx`
 * (Story 8.5) already uses — DESIGN.md's "Floating elements only" glass
 * list names the Chat Bubble and the Chat Input as sharing one material, so
 * this doesn't invent a second one.
 *
 * Enter sends the typed text as the first turn of a new Chat conversation
 * and moves to Chat (FR-40) — the SAME `chatStore.ts` `send`/`setDraft`
 * `ChatInput.tsx` uses (Task 6), so there is exactly one send path and the
 * SAME shared draft: unsent text follows Spencer to Chat and back
 * (Preflight ruling P5/P6). "/" opens the Command Palette in place (Task
 * 8's palette, mounted directly under this pill) via the SAME
 * `useCommandPaletteInput` hook `ChatInput.tsx` uses (Story 8.8 review fix:
 * not a second copy of that wiring) — here, running a picked command ALSO
 * navigates to Chat, since picking a command is "sending" it. Esc collapses
 * the bubble itself.
 *
 * Registers NO readiness gate — Home's "home-data" gate (Story 7.8, Ruling
 * R16) stays the only one — and is focusable the instant it mounts,
 * independent of Home's own fetch (FR-39, NFR-CaptureSpeed): this
 * component reads nothing from `useHomeView()`'s state at all.
 */
import { useRef, useState } from "react";
import { PAGES } from "../lib/pages.ts";
import { usePageNavigationContext } from "../lib/navigationContext.tsx";
import { send, useChatStore } from "../lib/chatStore.ts";
import { useCommandPaletteInput } from "../hooks/useCommandPaletteInput.ts";
import { CommandPalette } from "./CommandPalette.tsx";

const CHAT_PAGE_INDEX = PAGES.findIndex((p) => p.id === "chat");

export function ChatBubble(): React.JSX.Element {
  const nav = usePageNavigationContext();
  const { draft, sending } = useChatStore();
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const goToChat = (): void => nav.goTo(CHAT_PAGE_INDEX);
  const { showPalette, activeDescendant, handleChange, commandPaletteProps } = useCommandPaletteInput(draft, goToChat);

  const collapse = (): void => {
    setExpanded(false);
    inputRef.current?.blur();
  };

  const submit = (): void => {
    const message = draft.trim();
    if (message.length === 0 || sending) return;
    void send(message);
    goToChat();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      collapse();
      return;
    }
    if (e.key === "Enter" && !showPalette) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      data-testid="chat-bubble"
      className={
        "notification-glass pointer-events-auto absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full transition-[width] " +
        "hover:w-[min(32rem,90vw)] focus-within:shadow-focus-glow " +
        (expanded ? "w-[min(32rem,90vw)]" : "w-64")
      }
    >
      {showPalette && <CommandPalette {...commandPaletteProps} />}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span aria-hidden="true" className="rounded-sm bg-surface-sunken px-1.5 py-0.5 font-body text-caption text-ink-secondary">
          /
        </span>
        <input
          ref={inputRef}
          type="text"
          aria-label="Ask Yoh, or type / for commands"
          placeholder="Ask Yoh, or type / for commands"
          aria-activedescendant={activeDescendant}
          value={draft}
          onFocus={() => setExpanded(true)}
          onBlur={() => {
            if (draft.trim().length === 0) setExpanded(false);
          }}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full min-w-0 bg-transparent font-body text-body text-ink-primary placeholder:text-ink-secondary focus:outline-none"
        />
      </div>
    </div>
  );
}
