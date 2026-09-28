/**
 * web/src/components/SandboxFinale.tsx
 *
 * Story 9.3, UX-DR39: one `sandbox-finale` `StreamEntry` in the chat
 * stream — a right-aligned `accent-solid` loading bar while
 * `POST /api/sandbox/finish` is in flight, then the resolved outcome.
 * `sandbox.ts`'s `finishSandbox()` owns WHEN this renders; this component
 * only renders whatever state it's given.
 *
 * C2 late addition (fix-round ruling on chunk C1): `summaryFailed` covers
 * AD-17's other failure mode — the finish REQUEST itself failed (never a
 * per-Task outcome), so the client must not invent counts. Rendered as its
 * own fixed copy, distinct from both the success and per-Task-failure
 * copy, with no numbers in it. A `savedCount: 0` alongside a non-empty
 * `failedTitles` (every card this session failed-then-was-skipped) still
 * renders only the failure lines — never "Saved 0 Tasks" — the same
 * `failed` branch below already covers it since it keys off
 * `failedTitles.length`, not `savedCount`.
 */
import { useReducedMotion } from "../hooks/useReducedMotion.ts";

export interface SandboxFinaleProps {
  readonly status: "pending" | "done";
  readonly savedCount?: number;
  readonly failedTitles?: readonly string[];
  readonly summaryFailed?: boolean;
}

export function SandboxFinale({ status, savedCount = 0, failedTitles = [], summaryFailed = false }: SandboxFinaleProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();

  if (status === "pending") {
    return (
      <div className="flex justify-end py-1">
        <div
          data-testid="sandbox-finale-bar"
          role="status"
          aria-live="polite"
          aria-label="Saving your answers"
          className="w-32 overflow-hidden rounded-full bg-surface-sunken"
        >
          <div className={"h-1.5 w-full rounded-full bg-accent-solid" + (reducedMotion ? "" : " sandbox-finale-shimmer")} />
        </div>
      </div>
    );
  }

  if (summaryFailed) {
    return (
      <div data-testid="sandbox-finale-result" className="flex flex-col gap-0.5 py-1 font-body text-body text-ink-primary">
        <p>Couldn't load the summary. Your saved cards above are in Notion.</p>
      </div>
    );
  }

  const failed = failedTitles.length > 0;
  return (
    <div data-testid="sandbox-finale-result" className="flex flex-col gap-0.5 py-1 font-body text-body text-ink-primary">
      {failed ? failedTitles.map((title) => <p key={title}>{`Couldn't save ${title}.`}</p>) : <p>{`Saved ${savedCount} Tasks`}</p>}
    </div>
  );
}
