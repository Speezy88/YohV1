/**
 * Story 7.5, NFR-Accessibility: recomputes DESIGN.md's own "Measured
 * contrast (load-bearing pairs)" table directly from `tokens.css`'s
 * `light-dark(light, dark)` values, in both themes, and fails below
 * DESIGN.md's stated threshold. Parses tokens.css as text (a single regex
 * over one predictable per-line shape this file's own author controls) —
 * not a full CSS parser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKENS_PATH = join(import.meta.dirname, "..", "web", "src", "tokens.css");
const css = readFileSync(TOKENS_PATH, "utf8");

function readToken(name: string): { light: string; dark: string } {
  const match = new RegExp(`--color-${name}:\\s*light-dark\\(([^,]+),\\s*([^)]+)\\)`).exec(css);
  if (!match) throw new Error(`token-contrast: --color-${name} not found in tokens.css`);
  return { light: match[1]!.trim(), dark: match[2]!.trim() };
}

/** Parses `#rrggbb` or `rgba(r,g,b,a)` (alpha ignored — every pair checked below is opaque-on-opaque). */
function toRgb(value: string): readonly [number, number, number] {
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  const rgba = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(value);
  if (!rgba) throw new Error(`token-contrast: could not parse color "${value}"`);
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
}

function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
  const chan = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(toRgb(a));
  const lb = relativeLuminance(toRgb(b));
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

function assertPairMeets(fgName: string, bgName: string, threshold: number): void {
  const fg = readToken(fgName);
  const bg = readToken(bgName);
  const lightRatio = contrastRatio(fg.light, bg.light);
  const darkRatio = contrastRatio(fg.dark, bg.dark);
  assert.ok(lightRatio >= threshold, `${fgName} on ${bgName} (light): ${lightRatio.toFixed(2)} < ${threshold}`);
  assert.ok(darkRatio >= threshold, `${fgName} on ${bgName} (dark): ${darkRatio.toFixed(2)} < ${threshold}`);
}

test("detector: contrastRatio computes the WCAG relative-luminance ratio and can fail below threshold", () => {
  assert.throws(() => assertPairMeetsFixture("#000000", "#010101", 3.0));
  function assertPairMeetsFixture(fg: string, bg: string, threshold: number): void {
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= threshold, `fixture: ${ratio.toFixed(2)} < ${threshold}`);
  }
});

test("ink-primary on surface-raised meets 4.5:1 in both themes", () => {
  assertPairMeets("ink-primary", "surface-raised", 4.5);
});

test("ink-secondary on surface-raised meets 4.5:1 in both themes", () => {
  assertPairMeets("ink-secondary", "surface-raised", 4.5);
});

test("rim-interactive vs surface-raised meets 3:1 in both themes", () => {
  assertPairMeets("rim-interactive", "surface-raised", 3.0);
});

test("accent-solid vs surface-raised meets 3:1 in both themes", () => {
  assertPairMeets("accent-solid", "surface-raised", 3.0);
});

test("on-accent-solid on accent-solid meets 4.5:1 in both themes", () => {
  assertPairMeets("on-accent-solid", "accent-solid", 4.5);
});

test("event-fixed-ink on event-fixed-stripe-a and -b each meet 4.5:1 in both themes", () => {
  assertPairMeets("event-fixed-ink", "event-fixed-stripe-a", 4.5);
  assertPairMeets("event-fixed-ink", "event-fixed-stripe-b", 4.5);
});

// ---------------------------------------------------------------------------
// Story 8.5, OQ17: the Thinking Indicator's shimmer is a translucent
// `mix-blend-mode: overlay` sweep of the accent gradient over ink-primary
// status text. The overlay tints the glyphs AND the background under them,
// so this recomputes the composite of both, at every point of the sweep
// (start → end colors, any alpha up to the declared opacity, since the
// gradient's transparent ends only lower it), and requires 4.5:1 throughout.
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

/** CSS `overlay` (W3C Compositing: HardLight with the layers swapped), per 0-255 channel. */
function overlayChannel(backdrop: number, source: number): number {
  const b = backdrop / 255;
  const s = source / 255;
  const mixed = b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
  return mixed * 255;
}

/** `source` blended over `backdrop` with `overlay`, then composited at `alpha`. */
function overlayComposite(backdrop: Rgb, source: Rgb, alpha: number): Rgb {
  return backdrop.map((b, i) => b * (1 - alpha) + overlayChannel(b, source[i]!) * alpha) as unknown as Rgb;
}

function contrastRatioRgb(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

function shimmerOpacity(): number {
  const match = /--thinking-shimmer-opacity:\s*([\d.]+)\s*;/.exec(css);
  if (!match) throw new Error("token-contrast: --thinking-shimmer-opacity not found in tokens.css");
  return Number(match[1]);
}

function worstShimmerContrast(textHex: string, surfaceHex: string, startHex: string, endHex: string, maxAlpha: number): number {
  const text = toRgb(textHex);
  const surface = toRgb(surfaceHex);
  const start = toRgb(startHex);
  const end = toRgb(endHex);
  let worst = Number.POSITIVE_INFINITY;
  for (let t = 0; t <= 20; t++) {
    const source = start.map((c, i) => c + ((end[i]! - c) * t) / 20) as unknown as Rgb;
    for (let a = 0; a <= 20; a++) {
      const alpha = (maxAlpha * a) / 20;
      worst = Math.min(worst, contrastRatioRgb(overlayComposite(text, source, alpha), overlayComposite(surface, source, alpha)));
    }
  }
  return worst;
}

test("OQ17: the shimmer rule is a translucent overlay sweep of the accent gradient, never a text fill", () => {
  const rule = /\.thinking-shimmer::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(rule, /mix-blend-mode:\s*overlay/);
  assert.match(rule, /opacity:\s*var\(--thinking-shimmer-opacity\)/);
  assert.match(rule, /var\(--color-accent-gradient-start\)/);
  assert.match(rule, /var\(--color-accent-gradient-end\)/);
  assert.doesNotMatch(css, /\.thinking-shimmer[^{]*\{[^}]*(background-clip:\s*text|color:\s*transparent)/);
  const opacity = shimmerOpacity();
  assert.ok(opacity > 0 && opacity < 1, `--thinking-shimmer-opacity must be translucent, got ${opacity}`);
});

test("OQ17: ink-primary under the shimmer sweep stays at or above 4.5:1 on surface-base and surface-raised, in both themes", () => {
  const ink = readToken("ink-primary");
  const start = readToken("accent-gradient-start");
  const end = readToken("accent-gradient-end");
  const opacity = shimmerOpacity();
  for (const surfaceName of ["surface-base", "surface-raised"]) {
    const surface = readToken(surfaceName);
    const light = worstShimmerContrast(ink.light, surface.light, start.light, end.light, opacity);
    const dark = worstShimmerContrast(ink.dark, surface.dark, start.dark, end.dark, opacity);
    assert.ok(light >= 4.5, `shimmer over ink-primary on ${surfaceName} (light): worst ${light.toFixed(2)} < 4.5`);
    assert.ok(dark >= 4.5, `shimmer over ink-primary on ${surfaceName} (dark): worst ${dark.toFixed(2)} < 4.5`);
  }
});

test("detector: the shimmer check catches a pair that passes unshimmered but not under the sweep (why the text is ink-primary, not ink-secondary)", () => {
  const secondary = readToken("ink-secondary");
  const surface = readToken("surface-base");
  assert.ok(contrastRatio(secondary.light, surface.light) >= 4.5, "precondition: ink-secondary passes on its own");
  const start = readToken("accent-gradient-start");
  const end = readToken("accent-gradient-end");
  assert.ok(worstShimmerContrast(secondary.light, surface.light, start.light, end.light, shimmerOpacity()) < 4.5);
});

// ink-primary/ink-secondary/rim-interactive "on glass" use DESIGN.md's own
// pre-composited hex (glass-fill alpha-blended over surface-raised, already
// computed in DESIGN.md's own table) rather than re-deriving alpha
// compositing here — DESIGN.md is the source of truth for the composite.
const GLASS_COMPOSITE = { light: "#f4f2ed", dark: "#2d2a25" };

test("ink-primary/ink-secondary/rim-interactive on the glass composite meet their thresholds in both themes", () => {
  const glass = GLASS_COMPOSITE;
  for (const [name, threshold] of [
    ["ink-primary", 4.5],
    ["ink-secondary", 4.5],
    ["rim-interactive", 3.0],
  ] as const) {
    const fg = readToken(name);
    const lightRatio = contrastRatio(fg.light, glass.light);
    const darkRatio = contrastRatio(fg.dark, glass.dark);
    assert.ok(lightRatio >= threshold, `${name} on glass (light): ${lightRatio.toFixed(2)} < ${threshold}`);
    assert.ok(darkRatio >= threshold, `${name} on glass (dark): ${darkRatio.toFixed(2)} < ${threshold}`);
  }
});
