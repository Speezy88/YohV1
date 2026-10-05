/**
 * The Yoh brand square: the accent gradient with the app icon's "M"
 * (`web/public/icon.svg`) drawn in `on-accent-solid`. Decorative — the
 * "Meeseek" wordmark beside it carries the name.
 */
export function YohMark({ className }: { readonly className: string }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-testid="yoh-mark"
      className={`flex items-center justify-center bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end text-on-accent-solid ${className}`}
    >
      <svg viewBox="0 0 192 192" className="size-[70%]" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round">
        <path d="M60 142 L60 50 L96 104 L132 50 L132 142" />
      </svg>
    </span>
  );
}
