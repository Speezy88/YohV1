/**
 * web/src/components/icons/Glyphs.tsx — Polish 6 (P6-R11): the repeated
 * decorative glyphs (chevron, search, pin, close, check, plus, send), drawn
 * once. Every stroke is 1.8px with round caps (DESIGN.md `icon`). Each is
 * `aria-hidden`: the control that holds it carries the accessible name.
 * The stroke is `currentColor`, so the caller's `text-*` token sets the tone.
 */
export const SEARCH_PATH = "M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M20 20l-4.5-4.5";
export const CHEVRON_UP_PATH = "M6 15l6-6 6 6";
export const CHEVRON_DOWN_PATH = "M6 9l6 6 6-6";
const CHEVRON_LEFT_PATH = "M15 5l-7 7 7 7";
const CHEVRON_RIGHT_PATH = "M9 5l7 7-7 7";
const CLOSE_PATH = "M6 6l12 12M18 6L6 18";
const CHECK_PATH = "M5 12.5 10 17.5 19 7.5";
const PLUS_PATH = "M12 5v14 M5 12h14";
const SEND_PATH = "M5 12h14M13 6l6 6-6 6";
const EXTERNAL_PATH = "M7 17 17 7 M9 7h8v8";
const CHAT_PATH = "M4 5h16v11H9l-5 4z";

export interface GlyphProps {
  /** Pixel width and height; defaults to 16. */
  readonly size?: number;
  readonly className?: string;
}

function Glyph({ path, size = 16, className }: GlyphProps & { readonly path: string }): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" className={className}>
      <path d={path} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const CHEVRON_PATHS = { up: CHEVRON_UP_PATH, down: CHEVRON_DOWN_PATH, left: CHEVRON_LEFT_PATH, right: CHEVRON_RIGHT_PATH } as const;

export function ChevronGlyph({ direction, ...rest }: GlyphProps & { readonly direction: keyof typeof CHEVRON_PATHS }): React.JSX.Element {
  return <Glyph path={CHEVRON_PATHS[direction]} {...rest} />;
}

export function SearchGlyph(props: GlyphProps): React.JSX.Element {
  return <Glyph path={SEARCH_PATH} {...props} />;
}

export function CloseGlyph(props: GlyphProps): React.JSX.Element {
  return <Glyph path={CLOSE_PATH} {...props} />;
}

export function CheckGlyph(props: GlyphProps): React.JSX.Element {
  return <Glyph path={CHECK_PATH} {...props} />;
}

export function PlusGlyph(props: GlyphProps): React.JSX.Element {
  return <Glyph path={PLUS_PATH} {...props} />;
}

export function SendGlyph(props: GlyphProps): React.JSX.Element {
  return <Glyph path={SEND_PATH} {...props} />;
}

export function ExternalLinkGlyph(props: GlyphProps): React.JSX.Element {
  return <Glyph path={EXTERNAL_PATH} {...props} />;
}

export function ChatGlyph(props: GlyphProps): React.JSX.Element {
  return <Glyph path={CHAT_PATH} {...props} />;
}

/** The pin: a head and a needle. 12px by default (inline with badge text). */
export function PinGlyph({ size = 12, className }: GlyphProps): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" className={className}>
      <path d="M9 4h6l-1 6 3 3H7l3-3-1-6z M12 13v7" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
