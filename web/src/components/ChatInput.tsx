/**
 * web/src/components/ChatInput.tsx
 *
 * Story 8.5, UX-DR36, DESIGN.md `chat-input`: the Chat page composer.
 * Glass (`.notification-glass`, the one floating-glass mechanism), a pill,
 * always wide, with DESIGN.md's focus ring + accent glow
 * (`--shadow-focus-glow`). Enter sends; Shift+Enter adds a newline; Enter
 * while an IME is composing is left alone. The draft is `chatStore.ts`'s
 * own `draft`, so an unsent message survives a swipe.
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
import { CommandPalette, COMMAND_PALETTE_ID } from "./CommandPalette.tsx";
import { CONTROL_DISABLED, CONTROL_TRANSITION, FOCUS_RING } from "../lib/controlStyles.ts";
import { SendGlyph } from "./icons/Glyphs.tsx";

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
      className="notification-glass relative flex w-full items-center gap-3 rounded-full py-1.5 pl-5 pr-1.5 focus-within:shadow-focus-glow"
    >
      {showPalette && <CommandPalette {...commandPaletteProps} />}
      <textarea
        rows={1}
        value={draft}
        role="combobox"
        aria-label="Message Meeseek"
        aria-expanded={showPalette}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={showPalette ? COMMAND_PALETTE_ID : undefined}
        placeholder="Ask Meeseek, or type / for commands"
        aria-activedescendant={activeDescendant}
        className="field-sizing-content max-h-32 min-w-0 flex-1 resize-none self-center bg-transparent py-2.5 font-body text-body text-ink-primary outline-none placeholder:text-ink-secondary"
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
        aria-label="Send"
        className={`flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end text-on-accent-solid enabled:hover:brightness-105 enabled:active:brightness-95 ${FOCUS_RING} ${CONTROL_TRANSITION} ${CONTROL_DISABLED}`}
      >
        <SendGlyph />
      </button>
    </div>
  );
}
