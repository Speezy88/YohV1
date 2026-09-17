/**
 * Tests for `src/rituals/ritual-shared.ts`'s `renderMarkdownForTerminal` —
 * the narrow markdown-to-plain-terminal renderer applied to Claude's
 * general-chat replies in `shell/chat-cli.ts`, so `**bold**`/`*italic*`/`#
 * headings`/`` `code` `` render (or, with styling off, get cleanly stripped)
 * instead of printing as literal syntax characters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdownForTerminal } from "../src/rituals/ritual-shared.ts";

test("renderMarkdownForTerminal: bold markdown becomes real ANSI bold when enabled, with no literal asterisks left", () => {
  const out = renderMarkdownForTerminal("this is **important** context", true);
  assert.doesNotMatch(out, /\*/);
  assert.match(out, /\x1b\[1mimportant\x1b\[0m/);
});

test("renderMarkdownForTerminal: italic markdown becomes real ANSI italic when enabled, with no literal asterisks left", () => {
  const out = renderMarkdownForTerminal("just *slightly* off", true);
  assert.doesNotMatch(out, /\*/);
  assert.match(out, /\x1b\[3mslightly\x1b\[0m/);
});

test("renderMarkdownForTerminal: a heading's # markers are stripped and the text is bolded when enabled", () => {
  const out = renderMarkdownForTerminal("# Tomorrow's Plan", true);
  assert.doesNotMatch(out, /#/);
  assert.match(out, /\x1b\[1mTomorrow's Plan\x1b\[0m/);
});

test("renderMarkdownForTerminal: inline code backticks are stripped, content kept plain either way", () => {
  const enabled = renderMarkdownForTerminal("run `npm test` first", true);
  const disabled = renderMarkdownForTerminal("run `npm test` first", false);
  assert.equal(enabled, "run npm test first");
  assert.equal(disabled, "run npm test first");
});

test("renderMarkdownForTerminal: fenced code block fences are dropped, code content survives", () => {
  const out = renderMarkdownForTerminal("before\n```js\nconst x = 1;\n```\nafter", false);
  assert.doesNotMatch(out, /```/);
  assert.match(out, /const x = 1;/);
});

test("renderMarkdownForTerminal: disabled mode strips all markdown syntax to clean plain text, no ANSI codes at all", () => {
  const out = renderMarkdownForTerminal("# A heading\n**bold** and *italic* and `code`", false);
  assert.doesNotMatch(out, /\x1b/);
  assert.doesNotMatch(out, /[*#`]/);
  assert.match(out, /A heading\nbold and italic and code/);
});

test("renderMarkdownForTerminal: leaves single underscores alone — env-var-style names must not be mangled as italic", () => {
  const out = renderMarkdownForTerminal("set NOTION_TOKEN and PUSHOVER_APP_TOKEN in .env", true);
  assert.equal(out, "set NOTION_TOKEN and PUSHOVER_APP_TOKEN in .env");
});

test("renderMarkdownForTerminal: plain text with no markdown syntax passes through unchanged", () => {
  const plain = "Tomorrow's tight. The problem set and the call are fixed.";
  assert.equal(renderMarkdownForTerminal(plain, true), plain);
  assert.equal(renderMarkdownForTerminal(plain, false), plain);
});
