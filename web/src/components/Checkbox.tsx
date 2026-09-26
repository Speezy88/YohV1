/**
 * web/src/components/Checkbox.tsx — Story 7.10, DESIGN.md `checkbox`.
 *
 * 17px, `rounded-xs`, an inset well with a rim-width `rim-interactive` rim.
 * Checked: `accent-solid` fill with an `on-accent-solid` checkmark. Color is
 * never the only signal — the Plan Row pairs the checkmark with
 * strikethrough and a fade. A real `role="checkbox"` with `aria-checked`
 * and the Task's name as its accessible name; keyboard-operable as a button.
 */
export interface CheckboxProps {
  /** The accessible name — the Task's label. */
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  onCheck(): void;
}

export function Checkbox({ label, checked, disabled = false, onCheck }: CheckboxProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onCheck}
      className={
        "flex size-[17px] shrink-0 items-center justify-center rounded-xs border-[length:var(--rim-width)] border-rim-interactive shadow-inset " +
        "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid " +
        (checked ? "bg-accent-solid" : "bg-surface-sunken")
      }
    >
      {checked && (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-full stroke-on-accent-solid" strokeWidth={1.8}>
          <path d="M5 12.5 L10 17.5 L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
