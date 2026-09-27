/**
 * web/src/components/ChatInput.tsx
 *
 * Story 8.5, UX-DR36, DESIGN.md `chat-input`: the Chat page composer.
 * Glass (`.notification-glass`, the one floating-glass mechanism), a pill,
 * always wide, with DESIGN.md's focus ring + accent glow
 * (`--shadow-focus-glow`). Enter sends; Shift+Enter adds a newline; Enter
 * while an IME is composing is left alone. The draft is `chatStore.ts`'s
 * own `draft`, so an unsent message survives a swipe or the Screensaver.
 * Typing the next message stays possible while a reply streams; only
 * sending waits.
 *
 * Story 8.7 (UX-DR38): typing "/" as the first character opens the Command
 * Palette, sourced from the server's one command registry. Esc closes it
 * without clearing the typed text; typing further re-offers it. Picking a
 * row sends it immediately and clears the draft — `/morning`/`/night` are
 * chat messages, not routes (C5). This wiring — and the Story 8.8
 * combobox (`aria-activedescendant`) carry-in — is shared with
 * `ChatBubble.tsx` via `useCommandPaletteInput` (Story 8.8 review fix), not
 * duplicated.
 */
import { send, useChatStore } from "../lib/chatStore.ts";
import { useCommandPaletteInput } from "../hooks/useCommandPaletteInput.ts";
import { CommandPalette } from "./CommandPalette.tsx";

export function ChatInput(): React.JSX.Element {
  const { draft, sending } = useChatStore();
  const { showPalette, activeDescendant, handleChange, commandPaletteProps } = useCommandPaletteInput(draft);
  const canSend = draft.trim() !== "" && !sending;

  const submit = (): void => {
    if (canSend) void send(draft);
  };

  return (
    <div
      data-testid="chat-input"
      className="notification-glass relative flex w-full items-end gap-2 rounded-full px-4 py-2 focus-within:shadow-focus-glow"
    >
      {showPalette && <CommandPalette {...commandPaletteProps} />}
      <textarea
        rows={1}
        value={draft}
        aria-label="Message Yoh"
        placeholder="Ask Yoh anything"
        aria-activedescendant={activeDescendant}
        className="field-sizing-content max-h-32 min-w-0 flex-1 resize-none bg-transparent py-1 font-body text-body text-ink-primary outline-none placeholder:text-ink-secondary"
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          submit();
        }}
      />
      <button
        type="button"
        disabled={!canSend}
        onClick={submit}
        className="shrink-0 rounded-full px-3 py-1 font-body text-body font-bold text-accent-solid focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid disabled:text-ink-secondary"
      >
        Send
      </button>
    </div>
  );
}
