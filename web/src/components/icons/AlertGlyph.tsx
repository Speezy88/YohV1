/**
 * web/src/components/icons/AlertGlyph.tsx — Polish 6 (P6-R6): the error
 * state's alert glyph. Decorative (`aria-hidden`): the message beside it
 * carries the meaning. 1.8px stroke, round caps, like every other glyph.
 */
export function AlertGlyph({ className = "" }: { readonly className?: string }): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" className={className}>
      <path d="M12 3 2.5 20h19L12 3z M12 10v4.5 M12 17.5v.01" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
