/**
 * web/src/components/memory/PendingPatterns.tsx — Story 13.10 (T11b Part 2), answerable in T14b.
 * Top of the Patterns folder: each pending Pattern question (headline,
 * evidence caption, "Plan for that?") with Yes/No, answered through the one
 * answer path (`submitOpenItemAnswer` -> `app/confirm-proposal.ts`). The
 * server's reply (and a Yes's receipt line, text only: a pattern receipt has
 * no Undo, Revert lives under Changed settings) stays on screen after the
 * memory refetch drops the answered card. Never steals focus.
 */
import { useState } from "react";
import type { OpenItemQuestion } from "../../../../src/types/api.ts";
import { StructuredQuestion } from "../StructuredQuestion.tsx";
import { HONEST_REJECTION, submitOpenItemAnswer } from "../../lib/openItems.ts";
import { refetchMemory } from "../../lib/memory.ts";
import { MEMORY_FOLDER_LABELS } from "../../lib/memoryApi.ts";

const UNREACHABLE = "I couldn't reach Yoh's server just now.";
const CAPTION = "m-0 font-body text-small text-ink-secondary";

interface Settled {
  readonly key: string;
  readonly message: string;
  readonly receiptLine?: string;
}

const keyOf = (q: OpenItemQuestion): string => `${q.requestId}::${q.questionId}`;

export function PendingPatterns({ questions, emptyNote }: { readonly questions: readonly OpenItemQuestion[]; readonly emptyNote?: string }): React.JSX.Element {
  const [busyKey, setBusyKey] = useState<string | undefined>(undefined);
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  const [settled, setSettled] = useState<readonly Settled[]>([]);

  const answer = async (q: OpenItemQuestion, text: string): Promise<void> => {
    const key = keyOf(q);
    setBusyKey(key);
    const outcome = await submitOpenItemAnswer({
      requestId: q.requestId,
      questionId: q.questionId,
      answer: text,
      ...(q.proposal ? { proposal: q.proposal } : {}),
    });
    setBusyKey(undefined);
    if (!outcome.ok) {
      if (outcome.kind === "conflict" || outcome.kind === "stale-proposal") {
        setSettled((prev) => [...prev, { key, message: HONEST_REJECTION[outcome.kind] ?? UNREACHABLE }]);
        void refetchMemory();
        return;
      }
      setNotes((prev) => ({ ...prev, [key]: HONEST_REJECTION[outcome.kind] ?? UNREACHABLE }));
      return;
    }
    const receipt = outcome.value.receipt;
    const receiptLine = receipt
      ? `Remembered: ${receipt.items.map((i) => `${i.text} · ${MEMORY_FOLDER_LABELS[i.folder]}`).join(" ; ")}`
      : undefined;
    setSettled((prev) => [...prev, { key, message: outcome.value.message ?? "", ...(receiptLine ? { receiptLine } : {}) }]);
    void refetchMemory();
  };

  return (
    <>
      {questions.map((q) => {
        const key = keyOf(q);
        return (
          <li key={key} className="flex list-none flex-col gap-1">
            <StructuredQuestion
              text={q.text}
              options={q.options}
              allowsFreeText={false}
              autoFocus={false}
              busy={busyKey === key}
              onAnswer={(a) => void answer(q, a)}
            />
            {notes[key] && <p className={CAPTION}>{notes[key]}</p>}
          </li>
        );
      })}
      {questions.length === 0 && settled.length === 0 && emptyNote && (
        <li className="list-none p-5 font-body text-body text-ink-secondary">{emptyNote}</li>
      )}
      {settled.map((s) => (
        <li key={`settled-${s.key}`} aria-live="polite" className="flex list-none flex-col gap-1 px-[18px] py-2">
          {s.message !== "" && <p className="m-0 font-body text-body text-ink-primary">{s.message}</p>}
          {s.receiptLine && <p className={CAPTION}>{s.receiptLine}</p>}
        </li>
      ))}
    </>
  );
}
