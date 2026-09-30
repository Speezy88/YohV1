/**
 * web/src/components/memory/TranscriptTurn.tsx — Story 13.9 (T10b Part 2).
 * One turn of a stored Conversation, read-only: Markdown text (only
 * `#memory-item-` links are live), and the Remembered Receipt the server
 * attached, settled and without a View in Memory link. Nothing here acts.
 */
import { SafeMarkdown } from "../ChatMessage.tsx";
import { RememberedReceipt } from "../RememberedReceipt.tsx";
import type { ChatConversationView } from "../../../../src/types/api.ts";

const CAPTION = "font-body text-small text-ink-secondary";

export function TranscriptTurn({ turn }: { readonly turn: ChatConversationView["turns"][number] }): React.JSX.Element {
  const isUser = turn.role === "user";
  return (
    <div
      id={`turn-${turn.id}`}
      data-testid="transcript-turn"
      tabIndex={-1}
      className={`flex flex-col gap-1 focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid ${isUser ? "items-end" : "items-start"}`}
    >
      <div
        className={`flex max-w-[640px] flex-col gap-1 font-body text-body text-ink-primary [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 ${isUser ? "rounded-tl-lg rounded-tr-lg rounded-bl-lg bg-surface-sunken px-5 py-3.5" : ""}`}
      >
        <SafeMarkdown text={turn.text} />
      </div>
      {turn.truncated && <p className={`m-0 ${CAPTION}`}>Shortened when saved.</p>}
      {turn.receipt && <RememberedReceipt messageId={turn.id} receipt={turn.receipt} state="settled" showViewInMemory={false} />}
    </div>
  );
}
