/**
 * Story 7.7, requirement #4 / DESIGN.md Elevation & Depth: "Where blur is
 * unsupported, fall back to an opaque `{colors.surface-raised}` fill with
 * the same rim." Windows Chromium/Edge + macOS `backdrop-filter` rendering
 * is a manual check (see the story's manual checklist) — this is the
 * automatable half, parsing `tokens.css` as text (the same convention
 * `tests/token-contrast.test.ts` already uses) to prove:
 *   1. `.notification-glass`'s base rule (outside any `@supports` block)
 *      sets an opaque `surface-raised` background and the neutral
 *      interactive rim — this is what a browser without `backdrop-filter`
 *      support actually renders.
 *   2. An `@supports (backdrop-filter: …)` block exists and is the ONLY
 *      place the glass fill / blur is set — so the real glass material
 *      never applies where it isn't supported.
 *   3. The rim/border is never redeclared inside the `@supports` block
 *      (it must be identical in both cases — "the same rim").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKENS_PATH = join(import.meta.dirname, "..", "web", "src", "tokens.css");
const css = readFileSync(TOKENS_PATH, "utf8");

/** Extracts the FIRST top-level (non-@supports) `.notification-glass { … }` block's body. */
function baseNotificationGlassRule(source: string): string {
  const match = /(?:^|\n)\.notification-glass\s*\{([^}]*)\}/.exec(source);
  if (!match) throw new Error("notification-glass-fallback: no top-level .notification-glass rule found");
  return match[1]!;
}

/** Extracts every `@supports (...) { ... }` block's full text (braces balanced one level deep — no nested @supports in this file). */
function supportsBlocks(source: string): string[] {
  const blocks: string[] = [];
  const re = /@supports\s*\(([^)]*backdrop-filter[^)]*)\)[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (depth > 0 && i < source.length) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    blocks.push(source.slice(start, i - 1));
  }
  return blocks;
}

test("detector: baseNotificationGlassRule finds the top-level rule, not one nested in @supports", () => {
  const fixture = `.notification-glass { background: red; }\n@supports (backdrop-filter: blur(1px)) {\n.notification-glass { background: blue; }\n}`;
  assert.match(baseNotificationGlassRule(fixture), /red/);
});

test("detector: supportsBlocks extracts a backdrop-filter @supports block's body", () => {
  const fixture = `@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {\n.x { color: red; }\n}`;
  assert.match(supportsBlocks(fixture)[0]!, /color: red/);
});

test("the base .notification-glass rule (no @supports needed) is opaque surface-raised with the neutral interactive rim", () => {
  const base = baseNotificationGlassRule(css);
  assert.match(base, /background:\s*var\(--color-surface-raised\)/);
  assert.match(base, /border:\s*var\(--rim-width\)\s+solid\s+var\(--color-rim-interactive\)/);
});

test("an @supports (backdrop-filter) block exists and is the only place the glass fill / blur is set", () => {
  const blocks = supportsBlocks(css);
  assert.ok(blocks.length >= 1, "expected at least one @supports(backdrop-filter…) block");
  const glassBlock = blocks.find((b) => b.includes(".notification-glass"));
  assert.ok(glassBlock, "expected a .notification-glass rule inside an @supports(backdrop-filter…) block");
  assert.match(glassBlock!, /background:\s*var\(--color-glass-fill\)/);
  assert.match(glassBlock!, /backdrop-filter:\s*blur\(var\(--blur-glass\)\)\s*saturate\(var\(--glass-saturate\)\)/);
  assert.match(glassBlock!, /-webkit-backdrop-filter:/);

  // The base rule (outside every @supports block) must never itself set
  // backdrop-filter — that's exactly what makes the fallback a fallback.
  const base = baseNotificationGlassRule(css);
  assert.doesNotMatch(base, /backdrop-filter/);
});

test("the rim/border is not redeclared inside the @supports block — it's identical whether or not blur is supported", () => {
  const glassBlock = supportsBlocks(css).find((b) => b.includes(".notification-glass"))!;
  assert.doesNotMatch(glassBlock, /border:/);
});

test("--duration-notification-enter and --duration-notification-pulse exist as tokens (DESIGN.md's 0.55s / 2.2s), not JS/CSS literals", () => {
  assert.match(css, /--duration-notification-enter:\s*550ms;/);
  assert.match(css, /--duration-notification-pulse:\s*2200ms;/);
});
