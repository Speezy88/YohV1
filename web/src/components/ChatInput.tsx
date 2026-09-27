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
 */
import { send, setDraft, useChatStore } from "../lib/chatStore.ts";

export function ChatInput(): React.JSX.Element {
  const { draft, sending } = useChatStore();
  const canSend = draft.trim() !== "" && !sending;

  const submit = (): void => {
    if (canSend) void send(draft);
  };

  return (
    <div
      data-testid="chat-input"
      className="notification-glass flex w-full items-end gap-2 rounded-full px-4 py-2 focus-within:shadow-focus-glow"
    >
      <textarea
        rows={1}
        value={draft}
        aria-label="Message Yoh"
        placeholder="Ask Yoh anything"
        className="field-sizing-content max-h-32 min-w-0 flex-1 resize-none bg-transparent py-1 font-body text-body text-ink-primary outline-none placeholder:text-ink-secondary"
        onChange={(e) => setDraft(e.target.value)}
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
