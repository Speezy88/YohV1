/**
 * web/src/components/RatingPrompt.tsx
 *
 * Story 13.11: the occasional one-click "How is Yoh doing?" rating under a
 * substantive reply. Three chips (1 Poor, 2 Okay, 3 Good) form a labeled
 * radiogroup; keys 1-3 answer while it has focus, arrows move focus, Enter or
 * Space picks. A pick posts at once and folds to a muted "Rated 3 (good)"
 * line; a 1 also offers an optional "What was off?" note (Send / Skip). "Not
 * now" posts a dismissal and removes the prompt. A failed post keeps the
 * prompt with an inline retry line. State lives on the chat message
 * (`MessageRating`) so a new message can close an open prompt locally.
 */
import { BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_TEXT, CONTROL_MD, FOCUS_RING } from "../lib/controlStyles.ts";
import { useRef, useState } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { submitRating } from "../lib/ratingApi.ts";
import type { MessageRating } from "../lib/chatStore.ts";
import type { RememberedReceipt } from "../../../src/types/api.ts";

const CAPTION = "font-body text-small text-ink-secondary";
const TEXT_BUTTON = `${BUTTON_TEXT} px-2 text-small`;

export const RATING_FAILED_COPY = "Couldn't save that. Try again.";

const OPTIONS = [
  { score: 1, label: "Poor", word: "poor" },
  { score: 2, label: "Okay", word: "okay" },
  { score: 3, label: "Good", word: "good" },
] as const;

export interface RatingPromptProps {
  readonly rating: MessageRating;
  onChange(patch: Partial<MessageRating>): void;
  /** A note that filed to memory: the caller renders it as the message's Remembered Receipt. */
  onReceipt(receipt: RememberedReceipt): void;
}

export function RatingPrompt({ rating, onChange, onReceipt }: RatingPromptProps): React.JSX.Element | null {
  const reduced = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (rating.phase === "dismissed") return null;

  const pick = async (score: 1 | 2 | 3): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const outcome = await submitRating({ promptId: rating.promptId, score });
    setBusy(false);
    if (outcome.status === "failed") return setFailed(true);
    onChange({ score, phase: score === 1 && outcome.status === "ok" ? "note" : "answered" });
  };

  const dismiss = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const outcome = await submitRating({ promptId: rating.promptId, dismissed: true });
    setBusy(false);
    if (outcome.status === "failed") return setFailed(true);
    onChange({ phase: "dismissed" });
  };

  const sendNote = async (): Promise<void> => {
    const trimmed = note.trim();
    if (busy || trimmed === "") return;
    setBusy(true);
    setFailed(false);
    const outcome = await submitRating({ promptId: rating.promptId, score: 1, note: trimmed });
    setBusy(false);
    if (outcome.status === "failed") return setFailed(true);
    if (outcome.status === "ok" && outcome.receipt) onReceipt(outcome.receipt);
    onChange({ phase: "done" });
  };

  const focusChip = (index: number): void => {
    const next = (index + OPTIONS.length) % OPTIONS.length;
    setFocusIndex(next);
    chipRefs.current[next]?.focus();
  };

  const onGroupKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "1" || e.key === "2" || e.key === "3") {
      e.preventDefault();
      void pick(Number(e.key) as 1 | 2 | 3);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusChip(focusIndex + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusChip(focusIndex - 1);
    }
  };

  const fade = reduced ? "" : " receipt-fade";

  if (rating.phase === "open") {
    return (
      <div data-testid="rating-prompt" className={`flex flex-col gap-2 pt-1${fade}`}>
        <p className="m-0 font-body text-body font-normal">How is Yoh doing?</p>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="How is Yoh doing?" onKeyDown={onGroupKeyDown} className="flex flex-wrap gap-2">
            {OPTIONS.map((option, i) => (
              <button
                key={option.score}
                ref={(el) => {
                  chipRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={rating.score === option.score}
                tabIndex={i === focusIndex ? 0 : -1}
                disabled={busy}
                onFocus={() => setFocusIndex(i)}
                onClick={() => void pick(option.score)}
                className={`${rating.score === option.score ? BUTTON_PRIMARY : BUTTON_SECONDARY} ${CONTROL_MD}`}
              >
                {option.score} {option.label}
              </button>
            ))}
          </div>
          <button type="button" disabled={busy} onClick={() => void dismiss()} className={TEXT_BUTTON}>
            Not now
          </button>
        </div>
        {failed && (
          <p role="alert" className={CAPTION}>
            {RATING_FAILED_COPY}
          </p>
        )}
      </div>
    );
  }

  const chosen = OPTIONS.find((o) => o.score === rating.score);
  return (
    <div data-testid="rating-prompt" className="flex flex-col gap-2">
      {chosen && <p className={CAPTION}>{`Rated ${chosen.score} (${chosen.word})`}</p>}
      {rating.phase === "note" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            aria-label="What was off?"
            placeholder="What was off?"
            maxLength={280}
            disabled={busy}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void sendNote();
              }
            }}
            className={`h-11 min-w-0 flex-1 rounded-sm border-[length:var(--rim-width)] border-rim-interactive bg-surface-raised px-4 font-body text-body text-ink-primary shadow-extruded-sm ${FOCUS_RING}`}
          />
          <button
            type="button"
            disabled={busy || note.trim() === ""}
            onClick={() => void sendNote()}
            className={`${BUTTON_SECONDARY} ${CONTROL_MD}`}
          >
            Send
          </button>
          <button type="button" disabled={busy} onClick={() => onChange({ phase: "done" })} className={TEXT_BUTTON}>
            Skip
          </button>
        </div>
      )}
      {failed && (
        <p role="alert" className={CAPTION}>
          {RATING_FAILED_COPY}
        </p>
      )}
    </div>
  );
}
