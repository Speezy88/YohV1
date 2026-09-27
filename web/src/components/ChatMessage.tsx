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
 * Question — e.g. a new proposal to confirm, or Task 6 addendum's own
 * pending ritual question injected by `chatStore.ts`'s
 * `appendPendingOpenItem`) renders as a `StructuredQuestion`, not plain
 * text. One pick answers it through `submitOpenItemAnswer` (the same
 * `app/answer-open-item.ts` entry point every answer surface uses), and the
 * exchange is recorded into this SAME transcript via `recordAnsweredOpenItem`
 * — independent of whichever OTHER turn is mid-answer.
 *
 * Task 6 (Spencer: "the waiting on you questions do not go away when they
 * are answered"): the old code hid this turn's card on ANY response,
 * including a "try again" one — so a request that failed to parse looked
 * answered but stayed open server-side. The card now hides ONLY when the
 * server actually resolves it: `next === "done"`, or `next` is a genuinely
 * different question (a new one is appended as its own turn instead). A
 * retry (`next` is the SAME question, by `requestId`+`questionId`) or a
 * network/server failure both keep this card and show the server's
 * message/the honest rejection inline underneath it, via `inlineNote`.
 *
 * Task 6A (2026-09-27): the panel renders Yoh's replies as markdown (bold,
 * lists, etc. — the approved mockup's "what's happening tomorrow" reply)
 * via the bundled `react-markdown` — never raw HTML (its default pipeline
 * has no `rehype-raw`, so an embedded `<script>`/`<img onerror>` in a reply
 * renders as inert text, keeping the CSP's `default-src 'self'` meaningful)
 * — and constrained to a small, safe element set via `allowedElements` so a
 * reply can't, say, inject an `<iframe>` even if a future markdown
 * dependency bump added raw-HTML support by accident.
 */
import { useState } from "react";
import Markdown from "react-markdown";
import { ThinkingIndicator } from "./ThinkingIndicator.tsx";
import { StructuredQuestion } from "./StructuredQuestion.tsx";
import { HONEST_REJECTION, submitOpenItemAnswer } from "../lib/openItems.ts";
import { recordAnsweredOpenItem } from "../lib/chatStore.ts";
import type { ChatViewMessage } from "../lib/chatStore.ts";
import type { OpenItemQuestion } from "../../../src/types/api.ts";

export interface ChatMessageProps {
  readonly message: ChatViewMessage;
}

// Polish 4 Task 3 (Spencer: "the font size is weird in these spots"): receipts
// and status/failure lines share one small caption style, from the SAME
// small type-scale token (`--text-small`, 15px) every other "secondary" chat
// line uses — never `--text-caption` (10.6px), which read as illegibly tiny
// next to the ~17.5px message/question-card text.
const CAPTION = "font-body text-small text-ink-secondary";

/** The small, safe markdown element set a Yoh reply may use — plain text plus emphasis, lists, and paragraphs. Never `img`/`iframe`/raw HTML. */
const ALLOWED_MARKDOWN_ELEMENTS = ["p", "strong", "em", "ul", "ol", "li", "br", "code"];

function failureCaption(message: ChatViewMessage): string {
  if (message.text !== "") return "The reply was interrupted.";
  return message.errorText ? `Couldn't get a reply: ${message.errorText}` : "Couldn't get a reply. Try again.";
}

export function ChatMessage({ message }: ChatMessageProps): React.JSX.Element | null {
  const isUser = message.role === "user";
  const thinking = !isUser && message.status === "streaming" && message.text === "";
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The server's own message from a retry or a network/server failure, shown inline under the still-open card (Task 6: the card itself never hides for either). Cleared once the card actually resolves. */
  const [inlineNote, setInlineNote] = useState<string | undefined>(undefined);
  const showQuestion = message.question !== undefined && !answered;
  // Polish 4 Task 3 (Spencer: "an empty grey bubble renders above the first
  // receipt"): traced to `recordAnsweredOpenItem` (`chatStore.ts`) — a
  // declined suggestion, or any answer whose server reply is just an empty
  // `message`/`receipts: []`, appends an assistant turn with nothing to
  // show. A turn with no visible text, receipt, question, or error renders
  // nothing at all, rather than an empty styled row.
  const hasVisibleContent = thinking || message.text !== "" || message.receipts.length > 0 || showQuestion || message.status === "error";

  const answerInline = async (question: OpenItemQuestion, answerText: string): Promise<void> => {
    setBusy(true);
    const outcome = await submitOpenItemAnswer({
      requestId: question.requestId,
      questionId: question.questionId,
      answer: answerText,
      ...(question.proposal ? { proposal: question.proposal } : {}),
    });
    setBusy(false);

    // Task 6: only a genuine resolution ever hides this card.
    if (!outcome.ok) {
      // A network/server failure — keep the card, show the honest rejection inline (never the raw error).
      setInlineNote(HONEST_REJECTION[outcome.kind] ?? outcome.message);
      return;
    }
    const { next } = outcome.value;
    if (next === "done") {
      setAnswered(true);
      recordAnsweredOpenItem(answerText, { message: outcome.value.message, receipts: outcome.value.receipts });
      return;
    }
    if (next.requestId === question.requestId && next.questionId === question.questionId) {
      // A "try again" reply: the SAME question comes back — keep the card, show the server's message inline.
      setInlineNote(outcome.value.message);
      return;
    }
    // A genuinely different question: this card is done, and the new one is appended as its own turn.
    setAnswered(true);
    recordAnsweredOpenItem(answerText, { message: outcome.value.message, receipts: outcome.value.receipts, next });
  };

  if (!hasVisibleContent) return null;

  return (
    <div data-testid={`chat-message-${message.id}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex max-w-[640px] flex-col gap-1 font-body text-body text-ink-primary [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 ${isUser ? "rounded-tl-lg rounded-tr-lg rounded-bl-lg bg-surface-sunken px-5 py-3.5" : ""}`}
      >
        {thinking ? (
          <ThinkingIndicator statusText={message.statusText ?? ""} />
        ) : (
          message.text !== "" && <Markdown allowedElements={ALLOWED_MARKDOWN_ELEMENTS}>{message.text}</Markdown>
        )}
        {message.receipts.map((receipt, i) => (
          <p key={i} className={CAPTION}>
            {receipt}
          </p>
        ))}
        {showQuestion && (
          <>
            <StructuredQuestion
              text={message.question!.text}
              options={message.question!.options}
              allowsFreeText={message.question!.allowsFreeText}
              busy={busy}
              onAnswer={(answerText) => void answerInline(message.question!, answerText)}
            />
            {inlineNote && <p className={CAPTION}>{inlineNote}</p>}
          </>
        )}
        {message.status === "error" && <p className={CAPTION}>{failureCaption(message)}</p>}
      </div>
    </div>
  );
}
