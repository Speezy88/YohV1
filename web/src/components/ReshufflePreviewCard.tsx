/**
 * web/src/components/ReshufflePreviewCard.tsx
 *
 * The open reshuffle preview on Home: the server's one-line summary, what
 * couldn't be placed, and Approve / Discard. Errors and notices are always
 * visible; nothing here writes until Approve.
 */
import type { ReshufflePreviewView } from "../../../src/types/api.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";

export interface ReshufflePreviewCardProps {
  readonly preview: ReshufflePreviewView;
  readonly busy?: boolean;
  readonly error?: string | undefined;
  readonly notice?: string | undefined;
  readonly onApprove: (proposalId: string) => void;
  readonly onDiscard: (proposalId: string) => void;
}

const FOCUS = "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid";

export function ReshufflePreviewCard({ preview, busy = false, error, notice, onApprove, onDiscard }: ReshufflePreviewCardProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const motion = reducedMotion ? "" : "transition-opacity";
  return (
    <div data-testid="reshuffle-preview-card" className="flex shrink-0 flex-col gap-3 rounded-2xl bg-surface-sunken p-4 font-body text-body text-ink-primary">
      <p className="m-0 font-semibold">{preview.summary}</p>
      {preview.rejectedReason && <p className="m-0 text-small text-ink-secondary">{preview.rejectedReason}</p>}
      {preview.unplacedRoutineLabels.length > 0 && (
        <p className="m-0 text-small text-ink-secondary">Couldn't place: {preview.unplacedRoutineLabels.join(", ")}</p>
      )}
      {notice && <p className="m-0 text-small text-ink-secondary">{notice}</p>}
      {error && (
        <p role="alert" className="m-0 text-small font-bold text-ink-primary">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onApprove(preview.proposalId)}
          className={`rounded-md bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end px-4 py-1.5 text-small font-bold text-on-accent-solid shadow-extruded-sm disabled:opacity-50 ${motion} ${FOCUS}`}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDiscard(preview.proposalId)}
          className={`rounded-md border-[length:var(--rim-width)] border-rim-interactive px-4 py-1.5 text-small text-ink-primary shadow-extruded-sm disabled:opacity-50 ${motion} ${FOCUS}`}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
