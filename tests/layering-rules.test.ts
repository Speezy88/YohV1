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
 *   1. AD-1 — nothing in `rituals/`, and not `shell/ritual-cli.ts` or its
 *      per-subcommand deps builders under `shell/ritual-cli/` (Task 12's
 *      pure-move split), imports from `app/` (a cron one-shot can never
 *      reach the interactive layer).
 *   2. AD-16 — no `shell/*.ts` file names one of the closed Notion/Calendar
 *      write functions — the allowlist is now empty (Ruling R1, resolved in
 *      Story 8.4: `chat-cli.ts`'s last four call sites moved into `app/`);
 *      every `shell/*.ts` file is checked.
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
const ADAPTER_WRITE_FUNCTIONS = ["setTaskStatus", "updateTaskField", "updateTaskTitle", "archiveTask", "createPage", "applyCalendarEdit"] as const;
/**
 * Ruling R1 (Story 8.4): empty, not deleted — the "no shell/*.ts file...
 * names a Notion/Calendar write function" test below still needs a set to
 * check membership against, and a future write-surface exception (if one is
 * ever needed again) has a documented place to go. `chat-cli.ts`'s last four
 * call sites (create-item, calendar-edit, search, save-search-result) moved
 * into `app/*.ts` in this same story, so it no longer needs an entry here.
 */
const SHELL_WRITE_ALLOWLIST: ReadonlySet<string> = new Set([]);

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
  // "chat-cli.ts" here is an intentionally synthetic fixture string for the detector logic — it
  // doesn't assert anything about a real file's existence (chat-cli.ts itself was retired, Story 8.9).
  assert.deepEqual(disallowedShellEdges("api.ts", `export * from "../shell/chat-cli.ts";`).length, 1);
});

// ===========================================================================
// The real tree
// ===========================================================================

test("AD-1: rituals/, shell/ritual-cli.ts, and shell/ritual-cli/'s per-subcommand deps builders never import from app/", () => {
  const files = [
    ...listTsFiles(join(SRC_DIR, "rituals")),
    join(SRC_DIR, "shell", "ritual-cli.ts"),
    // Task 12: shell/ritual-cli.ts's pure-move split put each subcommand's
    // real adapter wiring in its own file here — same AD-1 rule applies.
    ...listTsFiles(join(SRC_DIR, "shell", "ritual-cli")),
  ];
  assert.ok(files.length > 1, "expected to scan rituals/ and ritual-cli.ts");
  assert.ok(
    files.some((f) => f.includes(`${sep}ritual-cli${sep}`)),
    "expected to also scan shell/ritual-cli/'s per-subcommand deps builders",
  );
  const offenders = files.flatMap((f) =>
    importsFromApp(readFileSync(f, "utf8")).map((s) => `${relative(SRC_DIR, f)} imports ${s}`),
  );
  assert.deepEqual(offenders, [], "a cron one-shot must never reach the interactive app/ layer (AD-1)");
});

test("Ruling R1: SHELL_WRITE_ALLOWLIST is empty — chat-cli.ts is no longer allowlisted", () => {
  assert.deepEqual([...SHELL_WRITE_ALLOWLIST], []);
});

test("AD-16: no shell/*.ts file names a Notion/Calendar write function (Ruling R1: the allowlist is now empty)", () => {
  const shellDir = join(SRC_DIR, "shell");
  const offenders: string[] = [];
  for (const full of listTsFiles(shellDir)) {
    const name = relative(shellDir, full).split(sep).join("/");
    if (SHELL_WRITE_ALLOWLIST.has(name)) continue;
    for (const fn of adapterWriteReferences(readFileSync(full, "utf8"))) offenders.push(`${name}: ${fn}`);
  }
  assert.deepEqual(offenders, [], "only app/ may call setTaskStatus/updateTaskField/createPage/applyCalendarEdit (AD-16)");
});

test("AD-16: every SHELL_WRITE_ALLOWLIST entry (if any) still names a real file", () => {
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

// ============================================================================
// Story 8.9 (FR-42/FR-50): CLI parity check and retirement
// ============================================================================

test("FR-50: shell/chat-cli.ts no longer exists once CLI parity retirement is complete", () => {
  assert.equal(existsSync(join(SRC_DIR, "shell", "chat-cli.ts")), false, "chat-cli.ts must be deleted once FR-42 parity passes (FR-50)");
});

test("ritual-shared.ts no longer exports WRAP_WIDTH or renderMarkdownForTerminal (chat-cli-only, dead after FR-50)", () => {
  const contents = readFileSync(join(SRC_DIR, "rituals", "ritual-shared.ts"), "utf8");
  assert.ok(!/export (const WRAP_WIDTH|function renderMarkdownForTerminal)/.test(contents));
});

test("E11-R16: only app/queue-research.ts references insertQueuedResearchJobInTx (besides its definition)", () => {
  const offenders = listTsFiles(SRC_DIR)
    .map((f) => relative(SRC_DIR, f).split(sep).join("/"))
    .filter((name) => readFileSync(join(SRC_DIR, name), "utf8").includes("insertQueuedResearchJobInTx"))
    .filter((name) => name !== "app/queue-research.ts" && name !== "adapters/job-store.ts");
  assert.deepEqual(offenders, []);
  assert.ok(readFileSync(join(SRC_DIR, "app", "queue-research.ts"), "utf8").includes("insertQueuedResearchJobInTx"));
});

test("E11 review M9: no raw INSERT INTO research_jobs under src/ outside adapters/job-store.ts", () => {
  const offenders = listTsFiles(SRC_DIR)
    .map((f) => relative(SRC_DIR, f).split(sep).join("/"))
    .filter((name) => /INSERT\s+INTO\s+research_jobs/i.test(readFileSync(join(SRC_DIR, name), "utf8")))
    .filter((name) => name !== "adapters/job-store.ts");
  assert.deepEqual(offenders, []);
  assert.ok(readFileSync(join(SRC_DIR, "adapters", "job-store.ts"), "utf8").includes("INSERT INTO research_jobs"));
});
