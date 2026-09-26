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
