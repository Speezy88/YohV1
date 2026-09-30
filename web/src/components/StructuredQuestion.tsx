/**
 * web/src/components/StructuredQuestion.tsx — Story 8.6, UX-DR38.
 *
 * An inline question: the question text, one Secondary-style button per
 * option chip (flips to Primary the instant it's picked), and — when
 * `allowsFreeText` — a free-text "Other" field submitted on Enter or its
 * Send button. Every control is a native `<button>`/`<input>`, so Tab order
 * and Enter/Space activation come for free (WCAG 2.1.1) — no custom roving
 * tabindex. One pick calls `onAnswer` with that option's `value` (or the
 * typed, trimmed line); the caller (`OpenItems.tsx` / `ChatMessage.tsx`)
 * turns that into an `AnswerOpenItemRequest` and records Spencer's turn
 * (UX-DR38: "recorded as Spencer's turn").
 *
 * Story 8.8 AC3: the first option chip is pre-focused the moment a question
 * mounts, so Enter alone confirms it (used by the capture flow's "Create"
 * chip — `core/open-item-questions.ts`'s `buildProposalQuestion` puts it
 * first for any `notion-page-draft` proposal, the ONE place that shape is
 * assembled). This is a plain mount-only effect, not a prop-driven key:
 * every real caller already gives a genuinely NEW question its own fresh
 * component instance —
 * `OpenItems.tsx` keys each card by `requestId:questionId` (so a
 * DIFFERENT question remounts and re-focuses, while a re-render of the
 * SAME item, e.g. an unrelated refetch, reuses the same instance and never
 * steals focus back), and `ChatMessage.tsx` mounts this element fresh the
 * instant `message.question` first appears. So an effect that fires once,
 * on mount, is exactly the right behavior for both callers without adding
 * any new prop to this component.
 */
import { useLayoutEffect, useRef, useState } from "react";

export interface StructuredQuestionOption {
  readonly label: string;
  readonly value: string;
}

export interface StructuredQuestionProps {
  readonly text: string;
  readonly options: readonly StructuredQuestionOption[];
  readonly allowsFreeText: boolean;
  /** True while a pick is in flight — disables every chip and the Other field so a second pick can't race the first (AD-5's conflict rule). */
  readonly busy?: boolean;
  /** Pre-focus the first chip on mount (default true). The Memory page passes false so a card never steals focus. */
  readonly autoFocus?: boolean;
  onAnswer(answer: string): void;
}

export function StructuredQuestion({ text, options, allowsFreeText, busy = false, autoFocus = true, onAnswer }: StructuredQuestionProps): React.JSX.Element {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [freeText, setFreeText] = useState("");
  const lines = text.split("\n");
  const firstChipRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (autoFocus) firstChipRef.current?.focus();
    // Mount-only, intentionally: see this component's own doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (value: string): void => {
    if (busy) return;
    setPicked(value);
    onAnswer(value);
  };

  const submitFreeText = (): void => {
    const trimmed = freeText.trim();
    if (busy || trimmed === "") return;
    setPicked(undefined);
    onAnswer(trimmed);
  };

  return (
    <div data-testid="structured-question" className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-4 font-body text-body text-ink-primary shadow-inset">
      {lines.length >= 3 ? (
        <>
          <p className="m-0 font-body text-body font-normal">{lines[0]}</p>
          {lines.slice(1, -1).map((line, i) => (
            <p key={i} className="m-0 font-body text-small text-ink-secondary">{line}</p>
          ))}
          <p className="m-0 font-body text-body font-semibold">{lines[lines.length - 1]}</p>
        </>
      ) : (
        <p className="m-0 font-body text-body font-normal">{text}</p>
      )}
      {options.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Answer options">
          {options.map((option, i) => {
            const selected = picked === option.value;
            return (
              <button
                key={option.value}
                ref={i === 0 ? firstChipRef : undefined}
                type="button"
                disabled={busy}
                aria-pressed={selected}
                onClick={() => pick(option.value)}
                className={
                  "h-[42px] rounded-full border-[length:var(--rim-width)] px-4 font-body text-body font-semibold shadow-extruded-sm " +
                  "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid " +
                  (selected
                    ? "border-transparent bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end text-on-accent-solid"
                    : "border-rim-interactive bg-surface-raised text-ink-primary")
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
      {allowsFreeText && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label="Other"
            placeholder="Other…"
            disabled={busy}
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitFreeText();
              }
            }}
            className={
              "h-[42px] min-w-0 flex-1 rounded-full border-[length:var(--rim-width)] border-rim-interactive bg-surface-raised px-4 font-body text-body text-ink-primary shadow-extruded-sm " +
              "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid"
            }
          />
          <button
            type="button"
            disabled={busy || freeText.trim() === ""}
            onClick={submitFreeText}
            className={
              "h-[42px] rounded-full border-[length:var(--rim-width)] border-rim-interactive bg-surface-raised px-4 font-body text-body font-semibold text-ink-primary shadow-extruded-sm " +
              "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid"
            }
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
