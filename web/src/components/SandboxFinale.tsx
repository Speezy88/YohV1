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
 *
 * C2 fix round 1: the resolved ("done") state — success, per-Task failure,
 * or `summaryFailed` — is now itself one `role="status" aria-live="polite"`
 * region (`sandbox-finale-result`), matching the announcement idiom
 * `SandboxCard.tsx`'s own settled state uses. Without it, a screen reader
 * announced "Saving your answers" when the pending bar mounted but heard
 * nothing when it resolved. The three resolved cases share this one
 * wrapper (previously `summaryFailed` had its own near-duplicate div).
 *
 * Task 7 (polish-5): that `sandbox-finale-result` region is now PERSISTENT —
 * mounted from the component's very first (pending) render, not created
 * fresh on settle, the same idiom `SandboxCard.tsx`'s Task 6 status region
 * uses. Only its children (empty while pending) change on resolve, so the
 * DOM node — and the `aria-live="polite"` region attached to it — already
 * exists by the time the settle-time text arrives, rather than a brand-new
 * node that starts out already holding the content (easy for a screen
 * reader to miss).
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

  const failed = !summaryFailed && failedTitles.length > 0;
  const lines = summaryFailed
    ? ["Couldn't load the summary. Your saved cards above are in Notion."]
    : failed
      ? failedTitles.map((title) => `Couldn't save ${title}.`)
      : [`Saved ${savedCount} Task${savedCount === 1 ? "" : "s"}`];

  // Task 7 (polish-5): the PERSISTENT status region — mounted from the very
  // first (pending) render, same `key` throughout so it's the same DOM node
  // whether or not the loading bar above it is also present. Empty (no
  // lines) while pending; only its children change on resolve.
  const resultRegion = (
    <div
      key="sandbox-finale-result"
      data-testid="sandbox-finale-result"
      role="status"
      aria-live="polite"
      className={"flex flex-col gap-0.5 font-body text-body text-ink-primary" + (status === "done" ? " py-1" : "")}
    >
      {status === "done" &&
        lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
    </div>
  );

  // A single Fragment return, in both states, keeps `resultRegion` at the
  // SAME position in the rendered tree whether or not the loading bar (only
  // rendered while pending) precedes it — two different root element types
  // (Fragment vs. bare `div`) would force React to tear down and remount
  // everything on the pending→done transition, defeating the point of a
  // persistent region.
  return (
    <>
      {status === "pending" && (
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
      )}
      {resultRegion}
    </>
  );
}
