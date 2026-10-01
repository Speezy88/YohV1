/**
 * web/src/components/ReshufflePreviewCard.tsx
 *
 * The open reshuffle preview on Home: the server's one-line summary, what
 * couldn't be placed, and Approve / Discard. Errors and notices are always
 * visible; nothing here writes until Approve.
 */
import type { ReshufflePreviewView } from "../../../src/types/api.ts";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CONTROL_SM } from "../lib/controlStyles.ts";

export interface ReshufflePreviewCardProps {
  readonly preview: ReshufflePreviewView;
  readonly busy?: boolean;
  readonly error?: string | undefined;
  readonly notice?: string | undefined;
  readonly onApprove: (proposalId: string) => void;
  readonly onDiscard: (proposalId: string) => void;
}

export function ReshufflePreviewCard({ preview, busy = false, error, notice, onApprove, onDiscard }: ReshufflePreviewCardProps): React.JSX.Element {
  return (
    <div data-testid="reshuffle-preview-card" className="flex shrink-0 flex-col gap-3 rounded-lg bg-surface-sunken p-4 font-body text-body text-ink-primary">
      <p className="m-0 font-bold">
        {preview.rejectedReason ?? preview.summary}
      </p>
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
        {!preview.rejectedReason && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onApprove(preview.proposalId)}
            className={`${BUTTON_PRIMARY} ${CONTROL_SM}`}
          >
            Approve
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onDiscard(preview.proposalId)}
          className={`${BUTTON_SECONDARY} ${CONTROL_SM}`}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
