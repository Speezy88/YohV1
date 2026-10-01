/**
 * web/src/components/StateMessage.tsx — Polish 6 (P6-R6). The one empty /
 * error block. `empty` is a single `ink-secondary` line (plus an optional
 * second); `error` is an alert glyph + an `ink-primary` line + an optional
 * "Try again" button, with `role="alert"`. Errors never rely on colour alone
 * and never carry a raw thrown message (callers pass fixed or server copy).
 */
import { AlertGlyph } from "./icons/AlertGlyph.tsx";
import { BUTTON_SECONDARY, CONTROL_SM } from "../lib/controlStyles.ts";

export interface StateMessageProps {
  readonly variant: "empty" | "error";
  readonly message: string;
  readonly detail?: string;
  readonly onRetry?: () => void;
  readonly className?: string;
}

export function StateMessage({ variant, message, detail, onRetry, className = "" }: StateMessageProps): React.JSX.Element {
  if (variant === "empty") {
    return (
      <div className={`flex flex-col gap-1 font-body ${className}`}>
        <p className="m-0 text-body text-ink-secondary">{message}</p>
        {detail !== undefined && <p className="m-0 text-small text-ink-secondary">{detail}</p>}
      </div>
    );
  }
  return (
    <div role="alert" className={`flex flex-col items-start gap-3 font-body ${className}`}>
      <div className="flex items-start gap-2.5">
        <AlertGlyph className="mt-0.5 shrink-0 text-ink-primary" />
        <div className="flex flex-col gap-1">
          <p className="m-0 text-body text-ink-primary">{message}</p>
          {detail !== undefined && <p className="m-0 text-small text-ink-secondary">{detail}</p>}
        </div>
      </div>
      {onRetry !== undefined && (
        <button type="button" onClick={onRetry} className={`${BUTTON_SECONDARY} ${CONTROL_SM}`}>
          Try again
        </button>
      )}
    </div>
  );
}
