/**
 * web/src/components/Checkbox.tsx — Story 7.10, DESIGN.md `checkbox`.
 *
 * 17px, `rounded-xs`, an inset well with a rim-width `rim-interactive` rim.
 * Checked: `accent-solid` fill with an `on-accent-solid` checkmark. Color is
 * never the only signal — the Plan Row pairs the checkmark with
 * strikethrough and a fade. A real `role="checkbox"` with `aria-checked`
 * and the Task's name as its accessible name; keyboard-operable as a button.
 */
import { CONTROL_DISABLED, CONTROL_TRANSITION, FOCUS_RING } from "../lib/controlStyles.ts";

export interface CheckboxProps {
  /** The accessible name — the Task's label. */
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  /** Task 6B: the Tasks page's larger 26px box (the approved mockup's `.box`); Home keeps the 17px default. */
  readonly size?: "sm" | "lg";
  onCheck(): void;
}

export function Checkbox({ label, checked, disabled = false, size = "sm", onCheck }: CheckboxProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onCheck}
      className={
        // The button is the hit area (>= 24px); the drawn box inside keeps its design size. The
        // sm box's 32px button is pulled back with a negative margin so layout is unchanged.
        (size === "lg" ? "size-[26px] " : "-m-[7.5px] size-6 ") +
        `group flex shrink-0 items-center justify-center rounded-xs ${FOCUS_RING} ${CONTROL_DISABLED}`
      }
    >
      <span
        data-checkbox-box
        className={
          (size === "lg" ? "size-[26px] rounded-sm " : "size-[17px] rounded-xs ") +
          `flex items-center justify-center border-[length:var(--rim-width)] border-rim-interactive shadow-inset group-enabled:group-hover:border-accent-solid ${CONTROL_TRANSITION} ` +
          (checked ? "bg-accent-solid" : "bg-surface-sunken")
        }
      >
        {checked && (
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-full stroke-on-accent-solid" strokeWidth={1.8}>
            <path d="M5 12.5 L10 17.5 L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  );
}
