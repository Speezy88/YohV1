/**
 * Task 6 fix round 1 (controller ruling R14 #3): the page-transition and
 * launch-splash-fade durations must be CSS custom properties inside
 * `tokens.css`'s `@theme` block (Tailwind v4's theme), not bare JS
 * constants — components consume them via `var(--duration-…)`. This test
 * fails if either token is missing from `@theme`, matching the pattern
 * `tests/token-elevation.test.ts` already uses for the elevation tokens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKENS_PATH = join(import.meta.dirname, "..", "web", "src", "tokens.css");
const css = readFileSync(TOKENS_PATH, "utf8");

function themeBlockText(source: string): string {
  const themeBlockMatch = /@theme\s*\{/.exec(source);
  assert.ok(themeBlockMatch, "no @theme block found in tokens.css");
  const themeStart = themeBlockMatch!.index;
  let depth = 0;
  let themeEnd = -1;
  for (let i = themeStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      themeEnd = i;
      break;
    }
  }
  assert.ok(themeEnd > themeStart, "unterminated @theme block");
  return source.slice(themeStart, themeEnd);
}

const REQUIRED_DURATION_TOKENS = ["duration-page-transition", "duration-splash-fade", "duration-check-off-dissolve"] as const;

for (const name of REQUIRED_DURATION_TOKENS) {
  test(`tokens.css defines --${name} inside @theme`, () => {
    assert.ok(themeBlockText(css).includes(`--${name}:`), `--${name} must have its default declared inside @theme`);
  });

  test(`--${name} is a valid CSS time value (ends in ms or s)`, () => {
    const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
    assert.ok(match, `--${name} declaration not found`);
    assert.match(match![1]!.trim(), /^\d+(\.\d+)?(ms|s)$/, `--${name} should be a plain time value, got: ${match![1]}`);
  });
}

test("PageShell.tsx does not hard-code the page-transition or splash-fade duration as a JS number/template literal", () => {
  const pageShellPath = join(import.meta.dirname, "..", "web", "src", "components", "PageShell.tsx");
  const pageShellSrc = readFileSync(pageShellPath, "utf8");
  assert.ok(!/\d+\s*,?\s*\/\/\s*ms|`\$\{.*\}ms`|:\s*300\b/.test(pageShellSrc), "PageShell.tsx appears to hard-code a duration literal instead of reading a CSS custom property");
  assert.ok(pageShellSrc.includes("var(--duration-page-transition)"), "PageShell.tsx should consume --duration-page-transition via var()");
  assert.ok(pageShellSrc.includes("var(--duration-splash-fade)"), "PageShell.tsx should consume --duration-splash-fade via var()");
});
