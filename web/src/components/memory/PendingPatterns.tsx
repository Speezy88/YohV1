/**
 * web/src/components/memory/PendingPatterns.tsx — Story 13.10 (T11b Part 2).
 * Top of the Patterns folder: each pending Pattern question with its evidence
 * as a caption. Display only; the Yes/No answer lives in Chat (T14b).
 */
import type { OpenItemQuestion } from "../../../../src/types/api.ts";

function evidenceOf(q: OpenItemQuestion): string | undefined {
  const suggested = q.proposal?.suggested;
  if (typeof suggested === "object" && suggested !== null && "evidence" in suggested && typeof suggested.evidence === "string") return suggested.evidence;
  return q.proposal?.reason;
}

export function PendingPatterns({ questions }: { readonly questions: readonly OpenItemQuestion[] }): React.JSX.Element {
  return (
    <>
      {questions.map((q) => {
        const evidence = evidenceOf(q);
        return (
          <li key={q.requestId + q.questionId} className="flex list-none flex-col gap-1 rounded-lg bg-surface-sunken px-[18px] py-4 font-body">
            <span className="text-body font-medium text-ink-primary">{q.text}</span>
            {evidence && <span className="text-small text-ink-secondary">{evidence}</span>}
          </li>
        );
      })}
    </>
  );
}
