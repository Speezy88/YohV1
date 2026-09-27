/**
 * Structural layering enforcement for Phase 2 (Story 7.2; AD-1, AD-9,
 * AD-16, AD-17). A source-scan test, the same convention
 * `tests/mid-day-reflow.test.ts` and `tests/token-store.test.ts` already use
 * for their single-caller / sole-importer rules.
 *
 * Each rule is a small pure detector over file contents, exercised twice:
 * once against inline fixtures (so every rule is proven able to FAIL, even
 * while `src/app/` is still empty), and once against the real `src/` tree.
 *
 * Rules:
 *   1. AD-1 — nothing in `rituals/`, and not `shell/ritual-cli.ts`, imports
 *      from `app/` (a cron one-shot can never reach the interactive layer).
 *   2. AD-16 — no `shell/*.ts` file names one of the closed Notion/Calendar
 *      write functions, except the named allowlist entry `chat-cli.ts`
 *      (Ruling R1: Phase 1 call sites Epic 8 moves into `app/`; delete the
 *      entry when `chat-cli.ts` is deleted, FR-50 — tracked in
 *      `_bmad-output/implementation-artifacts/deferred-work.md`).
 *   3. AD-16 — every function exported from `app/*.ts` is shaped
 *      `(deps, input) => Promise<Result<Output, YohError>>`.
 *   4. AD-9/AD-17 (Ruling R2) — `types/` never depends on `shell/`, except
 *      exactly one type-only edge: `api.ts`'s
 *      `export type { AppType } from "../shell/server.ts"`, which lets
 *      `web/`'s typed Hono RPC client import only from `types/`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SRC_DIR = join(import.meta.dirname, "..", "src");

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Every module specifier in `contents`: static import/export-from and dynamic `import(...)`. */
function moduleSpecifiers(contents: string): string[] {
  const specs: string[] = [];
  for (const m of contents.matchAll(/\b(?:import|export)\b[^;"'`]*?\bfrom\s*["']([^"']+)["']/g)) specs.push(m[1]!);
  for (const m of contents.matchAll(/\bimport\s*["']([^"']+)["']/g)) specs.push(m[1]!);
  for (const m of contents.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)) specs.push(m[1]!);
  return specs;
}

// ---------------------------------------------------------------------------
// Rule 1 — AD-1
// ---------------------------------------------------------------------------

function importsFromApp(contents: string): string[] {
  return moduleSpecifiers(contents).filter((s) => /(^|\/)app(\/|$)/.test(s));
}

// ---------------------------------------------------------------------------
// Rule 2 — AD-16 closed write surface
// ---------------------------------------------------------------------------

/** AD-12's Notion writes + AD-13's Calendar edit — callable only from `app/` (AD-16). */
const ADAPTER_WRITE_FUNCTIONS = ["setTaskStatus", "updateTaskField", "createPage", "applyCalendarEdit"] as const;
/** Ruling R1. Delete this entry in the same change that deletes `shell/chat-cli.ts` (FR-50, Epic 8). */
const SHELL_WRITE_ALLOWLIST: ReadonlySet<string> = new Set(["chat-cli.ts"]);

function adapterWriteReferences(contents: string): string[] {
  return ADAPTER_WRITE_FUNCTIONS.filter((fn) => new RegExp(`\\b${fn}\\b`).test(contents));
}

// ---------------------------------------------------------------------------
// Rule 3 — AD-16 app/ export shape
// ---------------------------------------------------------------------------

/** Index of the `)` matching the `(` at `open`, or -1. */
function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Top-level parameter count of a parameter list's inner text. */
function countParams(inner: string): number {
  if (inner.trim() === "") return 0;
  let depth = 0;
  let count = 1;
  let prev = "";
  for (const ch of inner) {
    if ("([{<".includes(ch)) depth++;
    else if (")]}".includes(ch) || (ch === ">" && prev !== "=")) depth--;
    else if (ch === "," && depth === 0) count++;
    prev = ch;
  }
  // A trailing comma doesn't add a parameter.
  return inner.trim().endsWith(",") ? count - 1 : count;
}

/** Exported functions in an `app/*.ts` file that aren't `(deps, input): Promise<Result<...>>`. */
function badAppExports(contents: string): string[] {
  const bad: string[] = [];
  const starts = [
    ...contents.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^(]*>)?\s*\(/g),
    ...contents.matchAll(/export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/g),
  ];
  for (const m of starts) {
    const name = m[1]!;
    const open = m.index! + m[0].length - 1;
    const close = matchParen(contents, open);
    if (close < 0) {
      bad.push(`${name}: unparseable parameter list`);
      continue;
    }
    const params = countParams(contents.slice(open + 1, close));
    const returnsResult = /^\s*:\s*Promise\s*<\s*Result\s*</.test(contents.slice(close + 1));
    if (params !== 2 || !returnsResult) bad.push(`${name}: ${params} param(s), ${returnsResult ? "" : "no "}Promise<Result<…>> return annotation`);
  }
  return bad;
}

// ---------------------------------------------------------------------------
// Rule 4 — AD-9/AD-17 types/ → shell/ edge (Ruling R2)
// ---------------------------------------------------------------------------

const ALLOWED_TYPES_TO_SHELL_EDGE = /^export\s+type\s*\{\s*AppType\s*\}\s*from\s*["']\.\.\/shell\/server\.ts["'];?$/;

/** Statements in a `types/*.ts` file that reach into `shell/`, other than the one allowed type-only re-export in `api.ts`. */
function disallowedShellEdges(fileName: string, contents: string): string[] {
  const bad: string[] = [];
  const statements = [
    ...contents.matchAll(/\b(?:import|export)\b[^;"'`]*?\bfrom\s*["'][^"']*\bshell\/[^"']*["'];?/g),
    ...contents.matchAll(/\bimport\s*\(\s*["'][^"']*\bshell\/[^"']*["']\s*\)/g),
  ].map((m) => m[0].replace(/\s+/g, " ").trim());
  for (const stmt of statements) {
    if (fileName === "api.ts" && ALLOWED_TYPES_TO_SHELL_EDGE.test(stmt)) continue;
    bad.push(`${fileName}: ${stmt}`);
  }
  return bad;
}

// ===========================================================================
// Detector fixtures — prove each rule can fail
// ===========================================================================

test("detector: importsFromApp flags static, re-export, and dynamic imports of app/", () => {
  assert.deepEqual(importsFromApp(`import { checkOff } from "../app/check-off.ts";`), ["../app/check-off.ts"]);
  assert.deepEqual(importsFromApp(`import { confirmProposal } from "../app/confirm-proposal.ts";`), ["../app/confirm-proposal.ts"]); // Story 8.2 — named explicitly per the SDD plan's Task 3 implementer note; the rule itself is already generic over any app/-matching path.
  assert.deepEqual(importsFromApp(`import type { X } from '../../src/app/x.ts'`), ["../../src/app/x.ts"]);
  assert.deepEqual(importsFromApp(`export { y } from "../app/y.ts";`), ["../app/y.ts"]);
  assert.deepEqual(importsFromApp(`const m = await import("../app/z.ts");`), ["../app/z.ts"]);
  assert.deepEqual(importsFromApp(`import { a } from "../adapters/app-thing.ts"; import b from "../core/apple.ts";`), []);
});

test("detector: adapterWriteReferences flags each closed write-surface name", () => {
  assert.deepEqual(adapterWriteReferences(`await setTaskStatus(client, id, "Done");`), ["setTaskStatus"]);
  assert.deepEqual(adapterWriteReferences(`import { createPage, applyCalendarEdit } from "../adapters/x.ts";`), [
    "createPage",
    "applyCalendarEdit",
  ]);
  assert.deepEqual(adapterWriteReferences(`proposeCalendarEdit(); readNotionTasks();`), []);
});

test("detector: badAppExports accepts (deps, input) => Promise<Result<…>> and rejects anything else", () => {
  const good = `
    export async function checkOff(deps: CheckOffDeps, input: CheckOffInput): Promise<Result<CheckOffOutput, YohError>> { return x; }
    export const approve = async (deps: { run: (a: string) => void }, input: ApproveInput): Promise<Result<void, YohError>> => x;
    export interface CheckOffDeps { readonly now: () => Date }
    export type CheckOffInput = { taskId: string };
  `;
  assert.deepEqual(badAppExports(good), []);
  assert.deepEqual(badAppExports(`export function a(input: A): Promise<Result<B, YohError>> {}`), [
    "a: 1 param(s), Promise<Result<…>> return annotation",
  ]);
  assert.deepEqual(badAppExports(`export async function b(deps: D, input: I): Promise<B> {}`), [
    "b: 2 param(s), no Promise<Result<…>> return annotation",
  ]);
  assert.deepEqual(badAppExports(`export async function c(deps: D, input: I) { return 1; }`), [
    "c: 2 param(s), no Promise<Result<…>> return annotation",
  ]);
});

test("detector: disallowedShellEdges permits only api.ts's type-only AppType re-export", () => {
  assert.deepEqual(disallowedShellEdges("api.ts", `export type { AppType } from "../shell/server.ts";`), []);
  assert.deepEqual(disallowedShellEdges("api.ts", `export { app } from "../shell/server.ts";`), [
    `api.ts: export { app } from "../shell/server.ts";`,
  ]);
  assert.deepEqual(disallowedShellEdges("api.ts", `import type { AppType } from "../shell/server.ts";`), [
    `api.ts: import type { AppType } from "../shell/server.ts";`,
  ]);
  assert.deepEqual(disallowedShellEdges("api.ts", `export type { AppType, Other } from "../shell/server.ts";`).length, 1);
  assert.deepEqual(disallowedShellEdges("domain.ts", `export type { AppType } from "../shell/server.ts";`).length, 1);
  assert.deepEqual(disallowedShellEdges("api.ts", `export * from "../shell/chat-cli.ts";`).length, 1);
});

// ===========================================================================
// The real tree
// ===========================================================================

test("AD-1: rituals/ and shell/ritual-cli.ts never import from app/", () => {
  const files = [...listTsFiles(join(SRC_DIR, "rituals")), join(SRC_DIR, "shell", "ritual-cli.ts")];
  assert.ok(files.length > 1, "expected to scan rituals/ and ritual-cli.ts");
  const offenders = files.flatMap((f) =>
    importsFromApp(readFileSync(f, "utf8")).map((s) => `${relative(SRC_DIR, f)} imports ${s}`),
  );
  assert.deepEqual(offenders, [], "a cron one-shot must never reach the interactive app/ layer (AD-1)");
});

test("AD-16: no shell/*.ts file except the allowlisted chat-cli.ts names a Notion/Calendar write function", () => {
  const shellDir = join(SRC_DIR, "shell");
  const offenders: string[] = [];
  for (const full of listTsFiles(shellDir)) {
    const name = relative(shellDir, full).split(sep).join("/");
    if (SHELL_WRITE_ALLOWLIST.has(name)) continue;
    for (const fn of adapterWriteReferences(readFileSync(full, "utf8"))) offenders.push(`${name}: ${fn}`);
  }
  assert.deepEqual(offenders, [], "only app/ may call setTaskStatus/updateTaskField/createPage/applyCalendarEdit (AD-16)");
});

test("AD-16: the chat-cli.ts allowlist entry still names a real file (delete it with chat-cli.ts, FR-50)", () => {
  for (const name of SHELL_WRITE_ALLOWLIST) {
    assert.ok(existsSync(join(SRC_DIR, "shell", name)), `stale allowlist entry ${name} — remove it from SHELL_WRITE_ALLOWLIST`);
  }
});

test("AD-16: every app/*.ts exported function is (deps, input) => Promise<Result<Output, YohError>>", () => {
  const appDir = join(SRC_DIR, "app");
  assert.ok(existsSync(appDir), "src/app/ is scaffolded");
  const offenders = listTsFiles(appDir).flatMap((f) =>
    badAppExports(readFileSync(f, "utf8")).map((b) => `${relative(SRC_DIR, f)}: ${b}`),
  );
  assert.deepEqual(offenders, []);
});

test("AD-9/AD-17: types/ reaches shell/ only via api.ts's type-only AppType re-export", () => {
  const typesDir = join(SRC_DIR, "types");
  const offenders = listTsFiles(typesDir).flatMap((f) =>
    disallowedShellEdges(relative(typesDir, f).split(sep).join("/"), readFileSync(f, "utf8")),
  );
  assert.deepEqual(offenders, []);
});
