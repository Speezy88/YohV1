/**
 * web/src/components/ChatMessage.tsx
 *
 * Story 8.5, UX-DR36: one turn of the Chat transcript. Spencer's turns are
 * right-aligned on `surface-sunken`; Yoh's are left-aligned and flat. A Yoh
 * turn that is still streaming with no text yet shows the Thinking
 * Indicator, which gives way to the text as soon as the first delta lands
 * (AD-18). Each write receipt is its own caption-style line (DESIGN.md
 * `Chat Message`). A failed turn always says so (UX-DR48). `question` is
 * plain text here; Story 8.6 renders it as a Structured Question.
 */
import { ThinkingIndicator } from "./ThinkingIndicator.tsx";
import type { ChatViewMessage } from "../lib/chatStore.ts";

export interface ChatMessageProps {
  readonly message: ChatViewMessage;
}

const CAPTION = "font-body text-caption text-ink-secondary";

function failureCaption(message: ChatViewMessage): string {
  if (message.text !== "") return "The reply was interrupted.";
  return message.errorText ? `Couldn't get a reply: ${message.errorText}` : "Couldn't get a reply. Try again.";
}

export function ChatMessage({ message }: ChatMessageProps): React.JSX.Element {
  const isUser = message.role === "user";
  const thinking = !isUser && message.status === "streaming" && message.text === "";

  return (
    <div data-testid={`chat-message-${message.id}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex max-w-[80%] flex-col gap-1 font-body text-body text-ink-primary ${isUser ? "rounded-lg bg-surface-sunken px-3 py-2" : ""}`}
      >
        {thinking ? (
          <ThinkingIndicator statusText={message.statusText ?? ""} />
        ) : (
          message.text !== "" && <p className="whitespace-pre-wrap break-words">{message.text}</p>
        )}
        {message.receipts.map((receipt, i) => (
          <p key={i} className={CAPTION}>
            {receipt}
          </p>
        ))}
        {message.question && <p className="whitespace-pre-wrap break-words">{message.question.text}</p>}
        {message.status === "error" && <p className={CAPTION}>{failureCaption(message)}</p>}
      </div>
    </div>
  );
}
