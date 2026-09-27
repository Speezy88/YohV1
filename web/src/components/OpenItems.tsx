/**
 * web/src/components/OpenItems.tsx — Story 8.6, UX-DR36/UX-DR38, AD-5.
 *
 * Renders every open interaction request / Proposal at the top of Chat,
 * each as one `StructuredQuestion` card (UX-DR36: "Open interaction
 * requests and Proposals render at the top of Chat"). A pick or typed
 * "Other" answers that item's CURRENT pending question via
 * `submitOpenItemAnswer` — the same `POST /api/open-items/answer` a typed
 * answer would use, never a proposal-apply path of its own (FR-48, AD-3).
 * The card hides itself optimistically the instant it's answered
 * (NFR-Latency); the exchange itself is recorded into the SAME transcript
 * `Chat.tsx` renders (`chatStore.ts`'s `recordAnsweredOpenItem`), and the
 * open-items list refetches to pick up either the item's next question
 * (a multi-question request, e.g. night close-out) or its absence
 * (`next === "done"`).
 *
 * A `stale-proposal`/`conflict` rejection renders honestly and neutrally in
 * that same recorded exchange — never the raw `YohError.message`, never a
 * silent retry (FR-48).
 */
import { useState } from "react";
import type { OpenItem } from "../../../src/types/api.ts";
import { submitOpenItemAnswer } from "../lib/openItems.ts";
import { recordAnsweredOpenItem } from "../lib/chatStore.ts";
import { StructuredQuestion } from "./StructuredQuestion.tsx";

/** Neutral, guilt-free copy for the two rejection kinds `answerOpenItem` can return (AD-3, AD-5's conflict rule) — never the raw adapter/validation message. */
export const HONEST_REJECTION: Readonly<Record<string, string>> = {
  "stale-proposal": "That proposal is out of date — nothing was changed.",
  conflict: "That's already been answered elsewhere — nothing was changed.",
};

export interface OpenItemsProps {
  readonly items: readonly OpenItem[];
}

function itemKey(item: OpenItem): string {
  return `${item.requestId}:${item.question.questionId}`;
}

export function OpenItems({ items }: OpenItemsProps): React.JSX.Element | null {
  const [busyRequestId, setBusyRequestId] = useState<string | undefined>(undefined);
  const [answeredKeys, setAnsweredKeys] = useState<ReadonlySet<string>>(new Set());

  const visible = items.filter((item) => !answeredKeys.has(itemKey(item)));
  if (visible.length === 0) return null;

  const answer = async (item: OpenItem, answerText: string): Promise<void> => {
    // Busy immediately (disables the whole card so a second click/pick
    // can't race the first, AD-5's conflict rule) — but the card itself
    // stays visible until the answer actually settles. Once it does, this
    // hides the card right away (NFR-Latency) rather than waiting for the
    // SEPARATE `GET /api/open-items` refetch `submitOpenItemAnswer` also
    // kicks off to come back and remove it via updated `items` props.
    setBusyRequestId(item.requestId);
    const outcome = await submitOpenItemAnswer({
      requestId: item.requestId,
      questionId: item.question.questionId,
      answer: answerText,
      ...(item.question.proposal ? { proposal: item.question.proposal } : {}),
    });
    setBusyRequestId(undefined);
    setAnsweredKeys((prev) => new Set(prev).add(itemKey(item)));
    if (outcome.ok) recordAnsweredOpenItem(answerText, { message: outcome.value.message, receipts: outcome.value.receipts });
    else recordAnsweredOpenItem(answerText, { message: HONEST_REJECTION[outcome.kind] ?? outcome.message, receipts: [] });
  };

  return (
    <div data-testid="open-items" className="flex flex-col gap-3 border-b-[length:var(--rim-width)] border-rim-structural pb-3">
      {visible.map((item) => (
        <StructuredQuestion
          key={itemKey(item)}
          text={item.question.text}
          options={item.question.options}
          allowsFreeText={item.question.allowsFreeText}
          busy={busyRequestId === item.requestId}
          onAnswer={(answerText) => void answer(item, answerText)}
        />
      ))}
    </div>
  );
}
