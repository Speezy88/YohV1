/**
 * web/src/components/ChatMessage.tsx
 *
 * Story 8.5, UX-DR36: one turn of the Chat transcript. Spencer's turns are
 * right-aligned on `surface-sunken`; Yoh's are left-aligned and flat. A Yoh
 * turn that is still streaming with no text yet shows the Thinking
 * Indicator, which gives way to the text as soon as the first delta lands
 * (AD-18). Each write receipt is its own caption-style line (DESIGN.md
 * `Chat Message`). A failed turn always says so (UX-DR48).
 *
 * Story 8.6 (Task 7), UX-DR38: a `response.question` (a follow-up Structured
 * Question — e.g. a new proposal to confirm) renders as a
 * `StructuredQuestion`, not plain text. One pick answers it through the SAME
 * `submitOpenItemAnswer` call `OpenItems.tsx`'s top-of-Chat list uses (the
 * identical `app/answer-open-item.ts` entry point either way), and the
 * exchange is recorded into this SAME transcript via `recordAnsweredOpenItem`
 * — the answer becomes an ordinary later turn, and this turn's own chips
 * hide once answered (`answered` state), independent of whichever OTHER
 * turn or top-of-Chat item is mid-answer.
 */
import { useState } from "react";
import { ThinkingIndicator } from "./ThinkingIndicator.tsx";
import { StructuredQuestion } from "./StructuredQuestion.tsx";
import { HONEST_REJECTION } from "./OpenItems.tsx";
import { submitOpenItemAnswer } from "../lib/openItems.ts";
import { recordAnsweredOpenItem } from "../lib/chatStore.ts";
import type { ChatViewMessage } from "../lib/chatStore.ts";
import type { OpenItemQuestion } from "../../../src/types/api.ts";

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
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState(false);

  const answerInline = async (question: OpenItemQuestion, answerText: string): Promise<void> => {
    setBusy(true);
    const outcome = await submitOpenItemAnswer({
      requestId: question.requestId,
      questionId: question.questionId,
      answer: answerText,
      ...(question.proposal ? { proposal: question.proposal } : {}),
    });
    setBusy(false);
    setAnswered(true);
    if (outcome.ok) recordAnsweredOpenItem(answerText, { message: outcome.value.message, receipts: outcome.value.receipts });
    else recordAnsweredOpenItem(answerText, { message: HONEST_REJECTION[outcome.kind] ?? outcome.message, receipts: [] });
  };

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
        {message.question && !answered && (
          <StructuredQuestion
            text={message.question.text}
            options={message.question.options}
            allowsFreeText={message.question.allowsFreeText}
            busy={busy}
            onAnswer={(answerText) => void answerInline(message.question!, answerText)}
          />
        )}
        {message.status === "error" && <p className={CAPTION}>{failureCaption(message)}</p>}
      </div>
    </div>
  );
}
