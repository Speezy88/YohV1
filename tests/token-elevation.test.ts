/**
 * Task 5 fix round 1 (controller ruling R13): UX-DR24's elevation recipes
 * (Inset, Extruded-sm/md/lg, Glass) were missing from `tokens.css` — only
 * the two raw shadow colors existed, and DESIGN.md's own component specs
 * (e.g. the Theme Toggle's Extruded-sm) had no token to reach for.
 *
 * This test fails if any required elevation token is absent from
 * `tokens.css`, or present with only one value where DESIGN.md's table
 * gives a genuinely different light and dark recipe. It parses the file as
 * text (the same convention as `token-contrast.test.ts`), not a full CSS
 * parser — a token counts as theme-aware if either (a) its declaration
 * uses `light-dark(...)` directly (valid for a <color> sub-value, e.g.
 * `--shadow-inset`'s color-only switch), or (b) at least two distinct
 * declarations of the same custom property exist in the file (a light
 * default plus a dark-scope override — the only way to switch a whole
 * box-shadow/length value, since `light-dark()` only ever resolves a
 * <color>).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKENS_PATH = join(import.meta.dirname, "..", "web", "src", "tokens.css");
const css = readFileSync(TOKENS_PATH, "utf8");

/** Every `--<name>: <value>;` declaration of `name` found anywhere in `source`, in order. */
function declarationsOf(source: string, name: string): string[] {
  const re = new RegExp(`--${name}:\\s*([^;]+);`, "g");
  return [...source.matchAll(re)].map((m) => m[1]!.trim());
}

/** True if `name` has at least one declaration, and that declaration set is genuinely theme-aware. */
function isThemeAwareToken(source: string, name: string): boolean {
  const decls = declarationsOf(source, name);
  if (decls.length === 0) return false;
  if (decls.some((d) => d.includes("light-dark("))) return true;
  const distinctValues = new Set(decls);
  return decls.length >= 2 && distinctValues.size >= 2;
}

// ---------------------------------------------------------------------------
// Detector fixtures — prove the checker can fail before trusting it to pass.
// ---------------------------------------------------------------------------

test("detector: declarationsOf finds every occurrence of a custom property across a file", () => {
  const fixture = `:root { --shadow-x: 1px 1px 1px red; }\n:root[data-theme="dark"] { --shadow-x: 2px 2px 2px blue; }\n`;
  assert.deepEqual(declarationsOf(fixture, "shadow-x"), ["1px 1px 1px red", "2px 2px 2px blue"]);
});

test("detector: isThemeAwareToken is false for a token that is missing entirely", () => {
  assert.equal(isThemeAwareToken(":root { --shadow-other: 1px 1px 1px red; }", "shadow-inset"), false);
});

test("detector: isThemeAwareToken is false for a token declared only once with a flat (non-light-dark) value", () => {
  assert.equal(isThemeAwareToken(":root { --shadow-inset: inset 1px 1px 3px red; }", "shadow-inset"), false);
});

test("detector: isThemeAwareToken is true for a single light-dark()-based declaration", () => {
  const fixture = `:root { --shadow-inset: inset 1px 1px 3px light-dark(red, blue); }`;
  assert.equal(isThemeAwareToken(fixture, "shadow-inset"), true);
});

test("detector: isThemeAwareToken is true for two distinct declarations (light default + dark override)", () => {
  const fixture = `:root { --shadow-extruded-sm: 3px 3px 7px red; }\n:root[data-theme="dark"] { --shadow-extruded-sm: 3px 3px 8px blue; }\n`;
  assert.equal(isThemeAwareToken(fixture, "shadow-extruded-sm"), true);
});

test("detector: isThemeAwareToken is false for two IDENTICAL declarations (not actually theme-aware, just repeated)", () => {
  const fixture = `:root { --shadow-extruded-sm: 3px 3px 7px red; }\n:root[data-theme="dark"] { --shadow-extruded-sm: 3px 3px 7px red; }\n`;
  assert.equal(isThemeAwareToken(fixture, "shadow-extruded-sm"), false);
});

// ---------------------------------------------------------------------------
// The real tokens.css — UX-DR24's required elevation tokens.
// ---------------------------------------------------------------------------

const REQUIRED_ELEVATION_TOKENS = ["shadow-inset", "shadow-extruded-sm", "shadow-extruded-md", "shadow-extruded-lg"] as const;

for (const name of REQUIRED_ELEVATION_TOKENS) {
  test(`tokens.css defines --${name} with a light and a dark value (UX-DR24)`, () => {
    assert.ok(isThemeAwareToken(css, name), `--${name} is missing from tokens.css, or has only one (non-theme-aware) value`);
  });
}

test("tokens.css defines a glass blur token (UX-DR24 Glass row) with a light and a dark value", () => {
  assert.ok(isThemeAwareToken(css, "blur-glass"), "--blur-glass is missing from tokens.css, or has only one value");
});

test("tokens.css defines a glass saturate token (UX-DR24 Glass row: 'saturate 140%')", () => {
  const decls = declarationsOf(css, "glass-saturate");
  assert.ok(decls.length > 0, "--glass-saturate is missing from tokens.css");
  assert.ok(decls.every((d) => d === "140%"), `--glass-saturate should be 140% per DESIGN.md, got: ${decls.join(", ")}`);
});

test("every elevation token is inside web/src/tokens.css's @theme block (so Tailwind v4 generates a utility for it)", () => {
  const themeBlockMatch = /@theme\s*\{/.exec(css);
  assert.ok(themeBlockMatch, "no @theme block found in tokens.css");
  const themeStart = themeBlockMatch!.index;
  // Find the matching closing brace for the @theme block.
  let depth = 0;
  let themeEnd = -1;
  for (let i = themeStart; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      themeEnd = i;
      break;
    }
  }
  assert.ok(themeEnd > themeStart, "unterminated @theme block");
  const themeBlockText = css.slice(themeStart, themeEnd);
  for (const name of [...REQUIRED_ELEVATION_TOKENS, "blur-glass", "glass-saturate", "shadow-focus-glow"]) {
    assert.ok(themeBlockText.includes(`--${name}:`), `--${name} must have its default declared inside @theme, found none`);
  }
});

test("Story 8.5: --shadow-focus-glow is DESIGN.md's chat-input/chat-bubble focus recipe (ring + glow), built only from tokens", () => {
  const decls = declarationsOf(css, "shadow-focus-glow");
  assert.equal(decls.length, 1, "--shadow-focus-glow should be declared once: its colors are already theme-aware tokens");
  assert.equal(decls[0], "0 0 0 var(--focus-ring-width) var(--color-accent-solid), 0 0 16px var(--color-accent-glow)");
});
