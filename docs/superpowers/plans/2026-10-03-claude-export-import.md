# Claude Export Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distil Spencer's Claude data export into reviewed facts and file them as Yoh memory items.

**Architecture:** A one-shot CLI on the Mac reads the export, asks Haiku for candidate facts (saved memory and project instructions first, then Spencer's own messages in batches), merges them and writes a reviewable `candidates.md`. Spencer edits that file and sends it to a new `POST /api/memory/import` route, whose app function validates, skips duplicates, enforces the always-loaded cap and files the rest in one transaction, tagged with an import batch id.

**Tech Stack:** Node 24 native TypeScript (no build), Hono, better-sqlite3, `@anthropic-ai/sdk`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-03-claude-export-import-design.md`

## Global Constraints

- Layering: `shell → app → {core, adapters}`; `core/` imports only `types/` and `core/`, and no `node:` modules. `app/` exports only `(deps, input) => Promise<Result<Output, YohError>>` functions plus types/interfaces/constants.
- `adapters/memory-item-store.ts` is the sole owner of `memory_items`. Every write runs in `writeTx` and appends one `memory` outbox row in the same transaction.
- Memory item text is at most 280 characters (`MEMORY_ITEM_MAX_CHARS`). The always-loaded folders hold at most 60 loaded items (`ALWAYS_LOADED_CAP`).
- An import never supersedes an existing item, never produces a rule change, and never writes on a dry run.
- Import batch tag: `import:claude-<YYYY-MM-DD>`, the date being today in `YOH_TIMEZONE`, stored in `source_turn_id`.
- Model: Haiku 4.5 via the existing `CLAUDE_CHAT_MODEL_FAST` constant. The API key comes from `CLAUDE_API_KEY` and is never printed.
- Only Spencer's own messages (`sender: "human"`) are sent as conversation evidence.
- The real export and `candidates.md` are never committed. Tests use fabricated fixtures and a fake LLM client; no real Anthropic call in tests.
- User-facing copy: second person, neutral, no emoji, no filler. Error messages that reach the wire are plain sentences with no `module:` prefix.
- Commands: one test file `node --test tests/<file>.test.ts`; typecheck `npm run typecheck`; full gate once before the last commit `npm run check > /tmp/gate.log 2>&1` and read only failures and the summary.
- Work in a worktree, not the main checkout. Never push or merge. Never deploy to or write on the Pi. Commit trailer is exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deviations from the spec (already folded into the spec)

- The extractor lives at `src/shell/claude-export-cli.ts`, not `scripts/`: `tsconfig.json` only typechecks `src/` and `tests/`.
- `importMemory` computes the batch tag itself from `deps.now` and `deps.timeZone` and returns it; the route does not pass one in.
- The store gains `insertMany` so a whole import is one transaction and one outbox row.
- An item whose `sourceTurnId` is an import tag shows no source on the Memory page. Without this it would show as "source deleted".

## Review Focus

1. The reviewed file saved with Windows line endings or a byte-order mark parses the same as a clean file. (Task 2)
2. A fact whose own text ends in parentheses or brackets, such as `(AP Calc)`, is kept whole; only a trailing ISO date and `[sensitive:…]` marker are stripped. (Task 2)
3. The same fact on two lines of one file is filed once; the second is reported as a duplicate. (Task 4)
4. An export with a missing source file, a conversation with no messages from Spencer, or a message whose text is null is skipped and counted, not a crash. (Tasks 6, 8)
5. A model reply that is not a JSON array marks that call as failed, is not cached, and is retried on the next run. (Task 8)

## File Structure

| File | Responsibility |
|---|---|
| `src/core/memory-filing.ts` (modify) | Adds `candidateRejection` and `normalizeMemoryText`. |
| `src/app/memory-edit.ts` (modify) | Uses `normalizeMemoryText` instead of its private copy. |
| `src/core/memory-import.ts` (create) | Batch tag, candidates-file parser and renderer. |
| `src/core/memory-item-view.ts` (modify) | Import-tagged items have no source. |
| `src/adapters/memory-item-store.ts` (modify) | `insertMany`. |
| `src/types/api.ts` (modify) | `ImportMemoryLine`, `ImportMemoryResponse`. |
| `src/app/import-memory.ts` (create) | `importMemory`. |
| `src/shell/server.ts` (modify) | `POST /api/memory/import`. |
| `src/core/claude-export.ts` (create) | Export readers, batching, model-reply parser, merge, cost estimate. |
| `src/adapters/claude-export-llm.ts` (create) | The one Haiku call. |
| `src/shell/claude-export-cli.ts` (create) | File I/O, cache, cost guard, output. |
| `tests/fixtures/claude-export/*.json` (create) | Fabricated export. |
| `deploy/RASPBERRY-PI.md` (modify) | How to run an import. |

---

### Task 1: Split the per-candidate filing check and share the text normalizer

**Files:**
- Modify: `src/core/memory-filing.ts`
- Modify: `src/app/memory-edit.ts` (the private `normalize` function and its two call sites)
- Test: `tests/memory-filing.test.ts`

**Interfaces:**
- Produces: `candidateRejection(c: MemoryCandidate, today: string): string | undefined` and `normalizeMemoryText(text: string): string`, both exported from `src/core/memory-filing.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/memory-filing.test.ts`, and add `candidateRejection, normalizeMemoryText` to its existing import from `../src/core/memory-filing.ts`:

```ts
test("candidateRejection names the reason and has no per-turn limit", () => {
  const today = "2026-09-29";
  assert.equal(candidateRejection(c({}), today), undefined);
  assert.equal(candidateRejection(c({ text: "   " }), today), "empty");
  assert.equal(candidateRejection(c({ text: "x".repeat(281) }), today), "too-long");
  assert.equal(candidateRejection(c({ origin: "inferred", folder: "feedback" }), today), "inferred-in-stated-only-folder");
  assert.equal(candidateRejection(c({ origin: "inferred", sensitive: "health" }), today), "sensitive-inferred");
  assert.equal(candidateRejection(c({ expiresOn: "2026-09-01" }), today), "bad-expiry");
  const many = Array.from({ length: 10 }, (_, i) => c({ text: `fact ${i}` }));
  assert.equal(many.filter((x) => candidateRejection(x, today) === undefined).length, 10);
});

test("normalizeMemoryText ignores case, spacing and trailing punctuation", () => {
  assert.equal(normalizeMemoryText("  Likes  COFFEE. "), "likes coffee");
  assert.equal(normalizeMemoryText("Likes coffee"), normalizeMemoryText("likes coffee!?"));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/memory-filing.test.ts`
Expected: FAIL, `candidateRejection` is not exported.

- [ ] **Step 3: Implement**

In `src/core/memory-filing.ts`, add below `validDate`:

```ts
/** Why a candidate may not be filed, or undefined when it may. `today` is the host-local date. Pure. */
export function candidateRejection(c: MemoryCandidate, today: string): string | undefined {
  const text = c.text.trim();
  if (text.length === 0) return "empty";
  if (text.length > MEMORY_ITEM_MAX_CHARS) return "too-long";
  if (c.origin === "inferred" && STATED_ONLY_FOLDERS.includes(c.folder)) return "inferred-in-stated-only-folder";
  if (c.origin === "inferred" && c.sensitive) return "sensitive-inferred";
  if (c.expiresOn !== undefined && (!validDate(c.expiresOn) || c.expiresOn < today)) return "bad-expiry";
  return undefined;
}

/** The form two memory texts are compared in: case, spacing and trailing punctuation do not matter. Pure. */
export function normalizeMemoryText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s.,;:!?]+$/, "");
}
```

In `validateFiling`, replace the `let reason: string | undefined;` line and the five-branch `if / else if` chain that follows it with:

```ts
    const reason = candidateRejection(c, today);
```

In `src/app/memory-edit.ts`, delete the private `function normalize(text: string): string { … }`, add `normalizeMemoryText` to the imports from `../core/memory-filing.ts` (add the import line if the file has none), and rename both `normalize(` call sites to `normalizeMemoryText(`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/memory-filing.test.ts tests/app-memory-edit.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/memory-filing.ts src/app/memory-edit.ts tests/memory-filing.test.ts
git commit -m "refactor(memory): share the per-candidate filing check and text normalizer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Candidates file parser, renderer and batch tag

**Files:**
- Create: `src/core/memory-import.ts`
- Modify: `src/core/memory-item-view.ts` (the `source` expression in `toMemoryItemView`)
- Test: `tests/memory-import.test.ts`

**Interfaces:**
- Produces, all from `src/core/memory-import.ts`:
  - `IMPORT_TAG_PREFIX = "import:"`
  - `importBatchTag(source: string, date: string): string`
  - `isImportTag(sourceTurnId: string): boolean`
  - `type MemorySensitivity = "health" | "emotion" | "finance"`
  - `interface ImportCandidate { line: number; folder: MemoryFolder; text: string; sensitive?: MemorySensitivity }`
  - `interface ImportProblem { line: number; reason: string }`
  - `parseMemoryImport(fileText: string): { candidates: readonly ImportCandidate[]; problems: readonly ImportProblem[] }`
  - `interface RenderCandidate { folder: MemoryFolder; text: string; sensitive?: MemorySensitivity; sourceDate?: string }`
  - `renderMemoryImport(candidates: readonly RenderCandidate[], notes: readonly string[]): string`

The file format:

```markdown
# Memory import candidates

> Delete lines you do not want.

## About you

- Runs most mornings before school. (2025-11-02)
- Has a peanut allergy. (2025-03-10) [sensitive:health]
```

Blank lines, `# ` title lines and `> ` note lines are ignored. A `## ` heading must be a folder label (`memoryFolderLabel`) or a folder id, case-insensitive. Any other non-list line is a problem.

- [ ] **Step 1: Write the failing tests**

Create `tests/memory-import.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { importBatchTag, isImportTag, parseMemoryImport, renderMemoryImport } from "../src/core/memory-import.ts";
import { toMemoryItemView } from "../src/core/memory-item-view.ts";
import type { MemoryItem } from "../src/types/domain.ts";

const FILE = [
  "# Memory import candidates",
  "",
  "> Delete lines you do not want.",
  "",
  "## About you",
  "",
  "- Runs most mornings before school. (2025-11-02)",
  "- Has a peanut allergy. (2025-03-10) [sensitive:health]",
  "",
  "## goals-projects",
  "* Is building Yoh on a Raspberry Pi.",
].join("\n");

test("parses headings, list lines, dates and sensitive markers", () => {
  const r = parseMemoryImport(FILE);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.candidates, [
    { line: 7, folder: "about-you", text: "Runs most mornings before school." },
    { line: 8, folder: "about-you", text: "Has a peanut allergy.", sensitive: "health" },
    { line: 11, folder: "goals-projects", text: "Is building Yoh on a Raspberry Pi." },
  ]);
});

test("Windows line endings and a byte-order mark parse the same", () => {
  const r = parseMemoryImport(`﻿${FILE.replace(/\n/g, "\r\n")}`);
  assert.deepEqual(r, parseMemoryImport(FILE));
});

test("text that ends in its own parentheses or brackets is kept whole", () => {
  const r = parseMemoryImport("## About you\n- Takes two maths classes (AP Calc)\n- Uses the tag [urgent]\n- Graduates in (2027)");
  assert.deepEqual(r.candidates.map((c) => c.text), ["Takes two maths classes (AP Calc)", "Uses the tag [urgent]", "Graduates in (2027)"]);
});

test("reports unknown headings, stray lines, lines before a heading and empty list lines", () => {
  const r = parseMemoryImport("- orphan\n## Hobbies\n- under an unknown heading\n## About you\nplain sentence\n- \n- fine");
  assert.deepEqual(r.candidates.map((c) => c.text), ["fine"]);
  assert.deepEqual(r.problems, [
    { line: 1, reason: "list line before any folder heading" },
    { line: 2, reason: 'unknown folder heading "Hobbies"' },
    { line: 5, reason: "not a heading or a list line" },
    { line: 6, reason: "empty list line" },
  ]);
});

test("an empty file has no candidates and no problems", () => {
  assert.deepEqual(parseMemoryImport(""), { candidates: [], problems: [] });
});

test("render then parse round-trips, in folder order", () => {
  const text = renderMemoryImport(
    [
      { folder: "goals-projects", text: "Is building Yoh." },
      { folder: "about-you", text: "Has a peanut allergy.", sensitive: "health", sourceDate: "2025-03-10" },
    ],
    ["Delete lines you do not want."],
  );
  assert.match(text, /^# Memory import candidates\n\n> Delete lines you do not want\.\n/);
  assert.ok(text.indexOf("## About you") < text.indexOf("## Goals & projects"));
  assert.match(text, /- Has a peanut allergy\. \(2025-03-10\) \[sensitive:health\]/);
  const r = parseMemoryImport(text);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.candidates.map((c) => [c.folder, c.text, c.sensitive]), [
    ["about-you", "Has a peanut allergy.", "health"],
    ["goals-projects", "Is building Yoh.", undefined],
  ]);
});

test("batch tag", () => {
  assert.equal(importBatchTag("claude", "2026-10-03"), "import:claude-2026-10-03");
  assert.equal(isImportTag("import:claude-2026-10-03"), true);
  assert.equal(isImportTag("a3f1c2d4-turn"), false);
});

test("an import-tagged item has no source on the Memory page", () => {
  const item: MemoryItem = {
    id: "m1",
    folder: "about-you",
    text: "Runs at 6",
    origin: "inferred",
    ruleChange: "none",
    status: "current",
    createdAt: "2026-10-03T12:00:00.000Z",
    confirmedAt: "2026-10-03T12:00:00.000Z",
    sourceTurnId: "import:claude-2026-10-03",
  };
  const view = toMemoryItemView(item, { chain: [item], timeZone: "America/New_York" });
  assert.equal(view.source, undefined);
  const gone = toMemoryItemView({ ...item, sourceTurnId: "turn-that-was-deleted" }, { chain: [item], timeZone: "America/New_York" });
  assert.equal(gone.source, "deleted");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/memory-import.test.ts`
Expected: FAIL, cannot find `../src/core/memory-import.ts`.

- [ ] **Step 3: Implement**

Create `src/core/memory-import.ts`:

```ts
/** Memory import: the batch tag, and the reviewed candidates file in both directions. Pure. */
import type { MemoryCandidate, MemoryFolder } from "../types/domain.ts";
import { MEMORY_FOLDERS_IN_ORDER, memoryFolderLabel } from "./memory-folders.ts";

/** `source_turn_id` values with this prefix name an import batch, not a chat turn. */
export const IMPORT_TAG_PREFIX = "import:";

export function importBatchTag(source: string, date: string): string {
  return `${IMPORT_TAG_PREFIX}${source}-${date}`;
}

export function isImportTag(sourceTurnId: string): boolean {
  return sourceTurnId.startsWith(IMPORT_TAG_PREFIX);
}

export type MemorySensitivity = NonNullable<MemoryCandidate["sensitive"]>;

export interface ImportCandidate {
  /** 1-based line in the file, for the report. */
  readonly line: number;
  readonly folder: MemoryFolder;
  readonly text: string;
  readonly sensitive?: MemorySensitivity;
}

export interface ImportProblem {
  readonly line: number;
  readonly reason: string;
}

export interface ParsedImport {
  readonly candidates: readonly ImportCandidate[];
  readonly problems: readonly ImportProblem[];
}

export interface RenderCandidate {
  readonly folder: MemoryFolder;
  readonly text: string;
  readonly sensitive?: MemorySensitivity;
  /** The day of the conversation the fact came from. */
  readonly sourceDate?: string;
}

const HEADING = /^##\s+(.+?)\s*$/;
const ITEM = /^[-*]\s*(.*)$/;
const SENSITIVE_SUFFIX = /\s*\[sensitive:(health|emotion|finance)\]\s*$/i;
const DATE_SUFFIX = /\s*\(\d{4}-\d{2}-\d{2}\)\s*$/;

function folderForHeading(heading: string): MemoryFolder | undefined {
  const wanted = heading.toLowerCase();
  return MEMORY_FOLDERS_IN_ORDER.find((f) => f === wanted || memoryFolderLabel(f).toLowerCase() === wanted);
}

/** Reads the reviewed file. Lines under an unknown heading are dropped; the heading itself is the reported problem. */
export function parseMemoryImport(fileText: string): ParsedImport {
  const candidates: ImportCandidate[] = [];
  const problems: ImportProblem[] = [];
  let folder: MemoryFolder | undefined;
  let headingSeen = false;
  fileText
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = index + 1;
      const text = raw.trim();
      if (text === "" || text.startsWith(">") || /^#(\s|$)/.test(text)) return;
      const heading = HEADING.exec(text);
      if (heading) {
        const name = heading[1] as string;
        headingSeen = true;
        folder = folderForHeading(name);
        if (!folder) problems.push({ line, reason: `unknown folder heading "${name}"` });
        return;
      }
      const item = ITEM.exec(text);
      if (!item) {
        problems.push({ line, reason: "not a heading or a list line" });
        return;
      }
      if (!folder) {
        if (!headingSeen) problems.push({ line, reason: "list line before any folder heading" });
        return;
      }
      let body = item[1] as string;
      const sensitive = SENSITIVE_SUFFIX.exec(body);
      if (sensitive) body = body.slice(0, sensitive.index);
      const date = DATE_SUFFIX.exec(body);
      if (date) body = body.slice(0, date.index);
      body = body.trim();
      if (body === "") {
        problems.push({ line, reason: "empty list line" });
        return;
      }
      candidates.push({
        line,
        folder,
        text: body,
        ...(sensitive ? { sensitive: (sensitive[1] as string).toLowerCase() as MemorySensitivity } : {}),
      });
    });
  return { candidates, problems };
}

/** Writes the file `parseMemoryImport` reads: one heading per non-empty folder, in the folders' fixed order. */
export function renderMemoryImport(candidates: readonly RenderCandidate[], notes: readonly string[]): string {
  const out: string[] = ["# Memory import candidates", "", ...notes.map((n) => `> ${n}`)];
  for (const folder of MEMORY_FOLDERS_IN_ORDER) {
    const inFolder = candidates.filter((c) => c.folder === folder);
    if (inFolder.length === 0) continue;
    out.push("", `## ${memoryFolderLabel(folder)}`, "");
    for (const c of inFolder) {
      out.push(`- ${c.text}${c.sourceDate ? ` (${c.sourceDate})` : ""}${c.sensitive ? ` [sensitive:${c.sensitive}]` : ""}`);
    }
  }
  return `${out.join("\n")}\n`;
}
```

In `src/core/memory-item-view.ts`, add `import { isImportTag } from "./memory-import.ts";` and change the `source` expression's first condition from

```ts
    item.sourceTurnId === undefined ? undefined : sourceTurn ? …
```

to

```ts
    item.sourceTurnId === undefined || isImportTag(item.sourceTurnId) ? undefined : sourceTurn ? …
```

leaving the rest of the expression unchanged.

The "Graduates in (2027)" test passes because `DATE_SUFFIX` needs a full `YYYY-MM-DD`. The "empty list line" test relies on `ITEM` using `\s*` so `- ` with trailing space trimmed (`-`) still matches.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/memory-import.test.ts tests/app-memory-view.test.ts tests/layering-rules.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/memory-import.ts src/core/memory-item-view.ts tests/memory-import.test.ts
git commit -m "feat(memory): candidates file parser, renderer and import batch tag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `insertMany` on the memory item store

**Files:**
- Modify: `src/adapters/memory-item-store.ts` (the `MemoryItemStore` interface and the object `createMemoryItemStore` returns)
- Test: `tests/memory-item-store.test.ts`

**Interfaces:**
- Produces: `MemoryItemStore.insertMany(inputs: readonly NewMemoryItem[]): MemoryItem[]`. One `writeTx`, one outbox row; an invalid row throws `MemoryItemValidationError` and nothing is written; an empty array writes nothing.

- [ ] **Step 1: Write the failing tests**

Append to `tests/memory-item-store.test.ts` (it already has `fresh`, `outboxCount` and the `MemoryItemValidationError` import):

```ts
test("insertMany writes every row in one transaction with one outbox row", () => {
  const { store, connection } = fresh();
  const before = outboxCount(connection);
  const tag = "import:claude-2026-10-03";
  const items = store.insertMany([
    { folder: "about-you", text: "Runs at 6", origin: "inferred", sourceTurnId: tag },
    { folder: "feedback", text: "Keep replies short", origin: "stated", scope: "this kind of request", sourceTurnId: tag },
  ]);
  assert.equal(items.length, 2);
  assert.equal(outboxCount(connection) - before, 1);
  assert.deepEqual(store.listItems().map((i) => i.text).sort(), ["Keep replies short", "Runs at 6"]);
  assert.equal(items[0]?.sourceTurnId, tag);
  assert.equal(items[1]?.scope, "this kind of request");
  assert.deepEqual(store.searchRelevant("replies", ["feedback"], 5).map((i) => i.text), ["Keep replies short"]);
});

test("insertMany writes nothing when one row is invalid, and nothing for an empty list", () => {
  const { store, connection } = fresh();
  const before = outboxCount(connection);
  assert.throws(
    () => store.insertMany([{ folder: "about-you", text: "fine", origin: "inferred" }, { folder: "about-you", text: "x".repeat(281), origin: "inferred" }]),
    MemoryItemValidationError,
  );
  assert.deepEqual(store.insertMany([]), []);
  assert.equal(store.listItems().length, 0);
  assert.equal(outboxCount(connection), before);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/memory-item-store.test.ts`
Expected: FAIL, `store.insertMany is not a function`.

- [ ] **Step 3: Implement**

In the `MemoryItemStore` interface, directly under `insert(input: NewMemoryItem): MemoryItem;`:

```ts
  /** Inserts every row in one transaction with one outbox row (an import batch). Throws before writing if any row is invalid. */
  insertMany(inputs: readonly NewMemoryItem[]): MemoryItem[];
```

In `createMemoryItemStore`, directly under the `insert(input) { … },` method:

```ts
    insertMany(inputs) {
      if (inputs.length === 0) return [];
      const texts = inputs.map(validate);
      const ids = connection.writeTx((tx) => {
        const newIds = inputs.map((input, i) => insertRow(tx, input, texts[i] as string, input.ruleChange ?? "none", null));
        hint(tx, inputs[0]?.sourceTurnId ?? (newIds[0] as string));
        return newIds;
      });
      return ids.map(read);
    },
```

Run `npm run typecheck`. If any object literal elsewhere implements `MemoryItemStore` in full, the compiler names it; add a matching `insertMany` there.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/memory-item-store.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/memory-item-store.ts tests/memory-item-store.test.ts
git commit -m "feat(memory): insertMany files a batch in one transaction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `importMemory` app function

**Files:**
- Create: `src/app/import-memory.ts`
- Modify: `src/types/api.ts` (append a new section at the end of the memory types)
- Test: `tests/app-import-memory.test.ts`

**Interfaces:**
- Consumes: `candidateRejection`, `normalizeMemoryText`, `NARROWEST_FEEDBACK_SCOPE` (`src/core/memory-filing.ts`); `importBatchTag`, `ImportCandidate` (`src/core/memory-import.ts`); `MemoryItemStore.insertMany`; `ALWAYS_LOADED_CAP` (`src/core/memory-context.ts`); `ALWAYS_LOADED_FOLDERS`, `STATED_ONLY_FOLDERS` (`src/core/memory-folders.ts`); `localIsoDate(instant: Date, timeZone: string)` (`src/core/local-time.ts`); `errorCopyForThrown(error)` (`src/core/error-copy.ts`).
- Produces:
  - `src/types/api.ts`: `ImportMemoryLine { line: number; folder: MemoryFolder; text: string }` and `ImportMemoryResponse { dryRun: boolean; batchTag: string; counts: { filed: number; skippedDuplicate: number; rejected: number }; filed: readonly ImportMemoryLine[]; skippedDuplicate: readonly ImportMemoryLine[]; rejected: readonly (ImportMemoryLine & { reason: string })[] }`.
  - `importMemory(deps: ImportMemoryDeps, input: ImportMemoryInput): Promise<Result<ImportMemoryResponse, YohError>>` with `ImportMemoryDeps { memoryItems: MemoryItemStore; now: () => Date; timeZone: string }` and `ImportMemoryInput { candidates: readonly ImportCandidate[]; dryRun: boolean }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/app-import-memory.test.ts`:

```ts
/** Claude export import through app/import-memory.ts. Real in-memory stores. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { importMemory } from "../src/app/import-memory.ts";
import type { ImportCandidate } from "../src/core/memory-import.ts";

function world() {
  const c = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(c.db);
  initMemoryItemStoreSchema(c.db);
  const memoryItems = createMemoryItemStore(c);
  // 02:00 UTC on the 4th is still the 3rd in New York: the tag must use the host day.
  return { c, memoryItems, deps: { memoryItems, now: () => new Date("2026-10-04T02:00:00Z"), timeZone: "America/New_York" } };
}
const line = (n: number, o: Partial<ImportCandidate> = {}): ImportCandidate => ({ line: n, folder: "about-you", text: `fact ${n}`, ...o });

test("files candidates tagged with the batch, in one outbox row", async () => {
  const w = world();
  const before = tailOutboxSince(w.c, 0).length;
  const r = await importMemory(w.deps, { candidates: [line(3), line(4, { folder: "goals-projects" })], dryRun: false });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.batchTag, "import:claude-2026-10-03");
  assert.deepEqual(r.value.counts, { filed: 2, skippedDuplicate: 0, rejected: 0 });
  assert.deepEqual(r.value.filed.map((l) => l.line), [3, 4]);
  const items = w.memoryItems.listItems();
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.sourceTurnId === "import:claude-2026-10-03" && i.origin === "inferred" && i.ruleChange === "none"));
  assert.equal(tailOutboxSince(w.c, 0).length - before, 1);
});

test("a dry run returns the same report and writes nothing", async () => {
  const w = world();
  const before = tailOutboxSince(w.c, 0).length;
  const r = await importMemory(w.deps, { candidates: [line(1), line(2)], dryRun: true });
  assert.ok(r.ok && r.value.dryRun === true);
  if (r.ok) assert.deepEqual(r.value.counts, { filed: 2, skippedDuplicate: 0, rejected: 0 });
  assert.equal(w.memoryItems.listItems().length, 0);
  assert.equal(tailOutboxSince(w.c, 0).length, before);
});

test("skips lines that match current memory and repeats inside the file; never supersedes", async () => {
  const w = world();
  const mine = w.memoryItems.insert({ folder: "about-you", text: "Likes coffee", origin: "stated" });
  const r = await importMemory(w.deps, {
    candidates: [line(1, { text: "  likes  COFFEE. " }), line(2, { text: "Likes tea" }), line(3, { text: "likes tea!" })],
    dryRun: false,
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.filed.map((l) => l.line), [2]);
  assert.deepEqual(r.value.skippedDuplicate.map((l) => l.line), [1, 3]);
  assert.equal(w.memoryItems.getItem(mine.id)?.status, "current");
  assert.equal(w.memoryItems.listItems().length, 2);
});

test("stated-only folders and sensitive lines are filed as stated; feedback gets the narrowest scope", async () => {
  const w = world();
  const r = await importMemory(w.deps, {
    candidates: [
      line(1, { folder: "feedback", text: "Keep replies short" }),
      line(2, { folder: "planning-preferences", text: "No meetings before 10" }),
      line(3, { text: "Has a peanut allergy", sensitive: "health" }),
    ],
    dryRun: false,
  });
  assert.ok(r.ok);
  const byText = new Map(w.memoryItems.listItems().map((i) => [i.text, i]));
  assert.equal(byText.get("Keep replies short")?.origin, "stated");
  assert.equal(byText.get("Keep replies short")?.scope, "this kind of request");
  assert.equal(byText.get("No meetings before 10")?.origin, "stated");
  assert.equal(byText.get("No meetings before 10")?.ruleChange, "none");
  assert.equal(byText.get("Has a peanut allergy")?.origin, "stated");
});

test("an over-long line is rejected with its reason and the rest is filed", async () => {
  const w = world();
  const r = await importMemory(w.deps, { candidates: [line(1, { text: "x".repeat(281) }), line(2)], dryRun: false });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value.rejected.map((l) => [l.line, l.reason]), [[1, "too-long"]]);
  assert.deepEqual(r.value.filed.map((l) => l.line), [2]);
});

test("refuses the whole import when the always-loaded folders would pass the cap", async () => {
  const w = world();
  for (let i = 0; i < 58; i++) w.memoryItems.insert({ folder: "about-you", text: `existing ${i}`, origin: "stated" });
  const candidates = [line(1), line(2), line(3), line(4, { folder: "goals-projects" })];
  for (const dryRun of [true, false]) {
    const r = await importMemory(w.deps, { candidates, dryRun });
    assert.ok(!r.ok);
    if (r.ok) continue;
    assert.equal(r.error.kind, "validation");
    assert.match(r.error.message, /61 items/);
    assert.match(r.error.message, /limit is 60/);
    assert.match(r.error.message, /Cut 1 line /);
  }
  assert.equal(w.memoryItems.listItems().length, 58);
  const fits = await importMemory(w.deps, { candidates: candidates.slice(1), dryRun: false });
  assert.ok(fits.ok);
  assert.equal(w.memoryItems.listItems().length, 61);
});

test("lines outside the always-loaded folders are not blocked by a full cap", async () => {
  const w = world();
  for (let i = 0; i < 60; i++) w.memoryItems.insert({ folder: "about-you", text: `existing ${i}`, origin: "stated" });
  const r = await importMemory(w.deps, { candidates: [line(1, { folder: "ideas-notes" })], dryRun: false });
  assert.ok(r.ok);
});

test("an empty candidate list is a validation error", async () => {
  const w = world();
  const r = await importMemory(w.deps, { candidates: [], dryRun: false });
  assert.ok(!r.ok && r.error.kind === "validation");
});

test("a failing store becomes an unreachable error, not a throw", async () => {
  const w = world();
  w.c.close();
  const r = await importMemory(w.deps, { candidates: [line(1)], dryRun: false });
  assert.ok(!r.ok && r.error.kind === "unreachable");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/app-import-memory.test.ts`
Expected: FAIL, cannot find `../src/app/import-memory.ts`.

- [ ] **Step 3: Implement**

Append to `src/types/api.ts`, after the `MemorySearchResponse` interface:

```ts
// ---- Memory import (Claude export) -----------------------------------------

/** One line of the reviewed candidates file. */
export interface ImportMemoryLine {
  readonly line: number;
  readonly folder: MemoryFolder;
  readonly text: string;
}

/** `POST /api/memory/import`'s value. A dry run returns the same report and writes nothing. */
export interface ImportMemoryResponse {
  readonly dryRun: boolean;
  /** Stored as each filed item's `sourceTurnId`. */
  readonly batchTag: string;
  readonly counts: { readonly filed: number; readonly skippedDuplicate: number; readonly rejected: number };
  readonly filed: readonly ImportMemoryLine[];
  readonly skippedDuplicate: readonly ImportMemoryLine[];
  readonly rejected: readonly (ImportMemoryLine & { readonly reason: string })[];
}
```

Create `src/app/import-memory.ts`:

```ts
/** `POST /api/memory/import`: files reviewed candidates from a Claude export as memory items, or reports what it would file. */
import type { MemoryItemStore, NewMemoryItem } from "../adapters/memory-item-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { localIsoDate } from "../core/local-time.ts";
import { ALWAYS_LOADED_CAP } from "../core/memory-context.ts";
import { candidateRejection, NARROWEST_FEEDBACK_SCOPE, normalizeMemoryText } from "../core/memory-filing.ts";
import { ALWAYS_LOADED_FOLDERS, STATED_ONLY_FOLDERS } from "../core/memory-folders.ts";
import { importBatchTag, type ImportCandidate } from "../core/memory-import.ts";
import type { ImportMemoryLine, ImportMemoryResponse } from "../types/api.ts";
import type { MemoryCandidate, Result, YohError } from "../types/domain.ts";

export interface ImportMemoryDeps {
  readonly memoryItems: MemoryItemStore;
  readonly now: () => Date;
  readonly timeZone: string;
}

export interface ImportMemoryInput {
  readonly candidates: readonly ImportCandidate[];
  readonly dryRun: boolean;
}

export async function importMemory(deps: ImportMemoryDeps, input: ImportMemoryInput): Promise<Result<ImportMemoryResponse, YohError>> {
  if (input.candidates.length === 0) return { ok: false, error: { kind: "validation", message: "The file has no lines to import." } };
  try {
    const now = deps.now();
    const today = localIsoDate(now, deps.timeZone);
    const batchTag = importBatchTag("claude", today);
    const current = deps.memoryItems.listItems({ status: ["current"] });
    // What Spencer told Yoh directly wins: a match is skipped, never superseded.
    const seen = new Set(current.map((i) => normalizeMemoryText(i.text)));
    const filed: ImportMemoryLine[] = [];
    const skippedDuplicate: ImportMemoryLine[] = [];
    const rejected: (ImportMemoryLine & { reason: string })[] = [];
    const rows: NewMemoryItem[] = [];
    for (const c of input.candidates) {
      const line: ImportMemoryLine = { line: c.line, folder: c.folder, text: c.text };
      // Spencer approved each line by hand, so the cases the filing rules reserve for his own words count as stated.
      const origin = STATED_ONLY_FOLDERS.includes(c.folder) || c.sensitive !== undefined ? "stated" : "inferred";
      const candidate: MemoryCandidate = { folder: c.folder, text: c.text, origin, ...(c.sensitive !== undefined ? { sensitive: c.sensitive } : {}) };
      const reason = candidateRejection(candidate, today);
      if (reason !== undefined) {
        rejected.push({ ...line, reason });
        continue;
      }
      const key = normalizeMemoryText(c.text);
      if (seen.has(key)) {
        skippedDuplicate.push(line);
        continue;
      }
      seen.add(key);
      filed.push(line);
      rows.push({
        folder: c.folder,
        text: c.text,
        origin,
        ...(c.folder === "feedback" ? { scope: NARROWEST_FEEDBACK_SCOPE } : {}),
        sourceTurnId: batchTag,
        at: now.toISOString(),
      });
    }
    const alwaysNow = current.filter((i) => ALWAYS_LOADED_FOLDERS.includes(i.folder)).length;
    const alwaysNew = rows.filter((r) => ALWAYS_LOADED_FOLDERS.includes(r.folder)).length;
    const over = alwaysNow + alwaysNew - ALWAYS_LOADED_CAP;
    if (alwaysNew > 0 && over > 0) {
      const message = `This import would put ${alwaysNow + alwaysNew} items in the always-loaded folders, and the limit is ${ALWAYS_LOADED_CAP}. Cut ${over} ${over === 1 ? "line" : "lines"} from Feedback, Planning preferences, Corrections, About you or Patterns and send it again.`;
      return { ok: false, error: { kind: "validation", message } };
    }
    if (!input.dryRun) deps.memoryItems.insertMany(rows);
    return {
      ok: true,
      value: {
        dryRun: input.dryRun,
        batchTag,
        counts: { filed: filed.length, skippedDuplicate: skippedDuplicate.length, rejected: rejected.length },
        filed,
        skippedDuplicate,
        rejected,
      },
    };
  } catch (error) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(error) } };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/app-import-memory.test.ts tests/layering-rules.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/import-memory.ts src/types/api.ts tests/app-import-memory.test.ts
git commit -m "feat(memory): importMemory files reviewed candidates as one batch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `POST /api/memory/import`

**Files:**
- Modify: `src/shell/server.ts` (imports; a new route in `createApp` directly after the `/api/memory/search` route)
- Test: `tests/server-memory-import.test.ts`

**Interfaces:**
- Consumes: `parseMemoryImport` (`src/core/memory-import.ts`); `importMemory` (`src/app/import-memory.ts`); the existing `MEMORY_NOT_CONFIGURED`, `wire`, `httpStatus`, `ApiFailure` in `server.ts`.
- Produces: `POST /api/memory/import[?dryRun=1]`, body = the candidates file as text, response = the `Result` envelope of `ImportMemoryResponse`. Unparseable file → 400 validation.

- [ ] **Step 1: Write the failing tests**

Create `tests/server-memory-import.test.ts`:

```ts
/** POST /api/memory/import: unparseable body (400), dry run, real run. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../src/adapters/memory-item-store.ts";
import { createApp } from "../src/shell/server.ts";
import type { ImportMemoryResponse } from "../src/types/api.ts";

function setup() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initMemoryItemStoreSchema(connection.db);
  const memoryItems = createMemoryItemStore(connection);
  const app = createApp({ connection, log: () => {}, memoryItems });
  const post = (path: string, body: string) => app.request(path, { method: "POST", headers: { "Content-Type": "text/markdown" }, body });
  return { connection, memoryItems, app, post };
}
const FILE = "## About you\n- Runs most mornings. (2025-11-02)\n\n## Goals & projects\n- Is building Yoh.\n";

test("an unparseable file is a 400 that names the line, and writes nothing", async () => {
  const { post, memoryItems } = setup();
  const res = await post("/api/memory/import", "## Hobbies\n- chess\n## About you\n- fine");
  assert.equal(res.status, 400);
  const body = (await res.json()) as { ok: boolean; error: { kind: string; message: string } };
  assert.equal(body.error.kind, "validation");
  assert.match(body.error.message, /Line 1/);
  assert.match(body.error.message, /Hobbies/);
  assert.equal(memoryItems.listItems().length, 0);
});

test("an empty body is a 400", async () => {
  const { post } = setup();
  const res = await post("/api/memory/import", "");
  assert.equal(res.status, 400);
});

test("dry run reports and writes nothing; the real run files", async () => {
  const { post, memoryItems } = setup();
  const dry = await post("/api/memory/import?dryRun=1", FILE);
  assert.equal(dry.status, 200);
  const dryBody = (await dry.json()) as { ok: true; value: ImportMemoryResponse };
  assert.equal(dryBody.value.dryRun, true);
  assert.deepEqual(dryBody.value.counts, { filed: 2, skippedDuplicate: 0, rejected: 0 });
  assert.equal(memoryItems.listItems().length, 0);

  const real = await post("/api/memory/import", FILE);
  assert.equal(real.status, 200);
  const realBody = (await real.json()) as { ok: true; value: ImportMemoryResponse };
  assert.equal(realBody.value.dryRun, false);
  assert.match(realBody.value.batchTag, /^import:claude-\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(memoryItems.listItems().map((i) => i.text).sort(), ["Is building Yoh.", "Runs most mornings."]);

  const again = await post("/api/memory/import", FILE);
  const againBody = (await again.json()) as { ok: true; value: ImportMemoryResponse };
  assert.deepEqual(againBody.value.counts, { filed: 0, skippedDuplicate: 2, rejected: 0 });
  assert.equal(memoryItems.listItems().length, 2);
});

test("without a memory store the route answers not-configured", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  const app = createApp({ connection, log: () => {} });
  const res = await app.request("/api/memory/import", { method: "POST", body: FILE });
  assert.equal(((await res.json()) as { ok: boolean }).ok, false);
  assert.notEqual(res.status, 200);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/server-memory-import.test.ts`
Expected: FAIL with 404 statuses.

- [ ] **Step 3: Implement**

In `src/shell/server.ts`, add next to the other memory imports:

```ts
import { importMemory } from "../app/import-memory.ts";
import { parseMemoryImport } from "../core/memory-import.ts";
```

In `createApp`, directly after the `.get("/api/memory/search", …)` route:

```ts
      // Claude export import: the body is the reviewed candidates file; `?dryRun=1` reports without writing.
      .post("/api/memory/import", async (c) => {
        if (!deps.memoryItems) return c.json(MEMORY_NOT_CONFIGURED, httpStatus(MEMORY_NOT_CONFIGURED));
        const parsed = parseMemoryImport(await c.req.text());
        if (parsed.problems.length > 0) {
          const shown = parsed.problems.slice(0, 5).map((p) => `Line ${p.line}: ${p.reason}`).join("; ");
          const more = parsed.problems.length > 5 ? `; and ${parsed.problems.length - 5} more` : "";
          const invalid: ApiFailure = { ok: false, error: { kind: "validation", message: `The file could not be read. ${shown}${more}.` } };
          return c.json(invalid, httpStatus(invalid));
        }
        const result = wire(
          await importMemory(
            { memoryItems: deps.memoryItems, now: () => new Date(), timeZone: deps.chat?.timeZone ?? process.env["YOH_TIMEZONE"] ?? "UTC" },
            { candidates: parsed.candidates, dryRun: c.req.query("dryRun") === "1" },
          ),
        );
        return c.json(result, httpStatus(result));
      })
```

The time-zone expression is the one `memoryPageDeps` already uses.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/server-memory-import.test.ts tests/server-memory-edit.test.ts tests/layering-rules.test.ts && npm run typecheck && npm run typecheck:web`
Expected: PASS. (`typecheck:web` confirms the typed Hono client still compiles with the new route.)

- [ ] **Step 5: Commit**

```bash
git add src/shell/server.ts tests/server-memory-import.test.ts
git commit -m "feat(memory): POST /api/memory/import with a dry-run flag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Export readers, batching, reply parser, merge and cost estimate

**Files:**
- Create: `src/core/claude-export.ts`
- Create: `tests/fixtures/claude-export/conversations.json`, `tests/fixtures/claude-export/projects.json`, `tests/fixtures/claude-export/memories.json`
- Test: `tests/claude-export.test.ts`

**Interfaces:**
- Consumes: `normalizeMemoryText` (`src/core/memory-filing.ts`); `RenderCandidate` (`src/core/memory-import.ts`); `costForRow` (`src/core/llm-cost.ts`); `isMemoryFolder`, `MEMORY_ITEM_MAX_CHARS` (`src/core/memory-folders.ts`).
- Produces, all from `src/core/claude-export.ts`:
  - `EXPORT_MESSAGE_MAX_CHARS = 4000`, `EXPORT_BATCH_MAX_CHARS = 60_000`, `EXPORT_NEAR_DUPLICATE_JACCARD = 0.8`, `EXPORT_COST_CONFIRM_USD = 5`
  - `interface ExportConversation { title: string; date: string; humanMessages: readonly string[] }`
  - `interface ExportDistilled { label: string; text: string }`
  - `readConversations(json: unknown): { conversations: ExportConversation[]; skipped: number }`
  - `readProjects(json: unknown): ExportDistilled[]`
  - `readSavedMemory(json: unknown): ExportDistilled[]`
  - `renderDistilled(sources: readonly ExportDistilled[]): string`
  - `batchConversations(conversations: readonly ExportConversation[], maxChars?: number): string[]`
  - `interface ExtractedCandidate extends RenderCandidate { stage: 1 | 2 }`
  - `parseExtractedCandidates(modelText: string, stage: 1 | 2): ExtractedCandidate[] | undefined`
  - `mergeCandidates(candidates: readonly ExtractedCandidate[]): ExtractedCandidate[]`
  - `estimateExtractCostUsd(callTexts: readonly string[], model: string): number`

The export layout assumed here (Task 9 confirms it against the real export): `conversations.json` is an array of `{ name, created_at, updated_at, chat_messages: [{ sender: "human" | "assistant", text, content: [{ type: "text", text }] }] }`; `projects.json` is an array of `{ name, prompt_template }`; `memories.json` is an array of `{ conversations_memory, project_memories: { <uuid>: <text> } }`. Every reader takes `unknown` and skips what does not fit.

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/claude-export/conversations.json` (fabricated; no real data):

```json
[
  {
    "uuid": "c1",
    "name": "Morning routine",
    "created_at": "2025-11-01T08:00:00.000000Z",
    "updated_at": "2025-11-02T09:30:00.000000Z",
    "chat_messages": [
      { "sender": "human", "text": "I run most mornings before school and I want to keep that.", "content": [] },
      { "sender": "assistant", "text": "You seem to love swimming.", "content": [] },
      { "sender": "human", "text": "", "content": [{ "type": "text", "text": "Also I am allergic to peanuts." }, { "type": "tool_use", "name": "x" }] }
    ]
  },
  {
    "uuid": "c2",
    "name": "",
    "created_at": "2026-01-10T10:00:00.000000Z",
    "updated_at": "2026-01-10T10:05:00.000000Z",
    "chat_messages": [{ "sender": "human", "text": "I am building a planning assistant on a Raspberry Pi.", "content": [] }]
  },
  {
    "uuid": "c3",
    "name": "Only the assistant spoke",
    "created_at": "2026-02-01T10:00:00.000000Z",
    "updated_at": "2026-02-01T10:00:00.000000Z",
    "chat_messages": [{ "sender": "assistant", "text": "Hello.", "content": [] }, { "sender": "human", "text": null, "content": null }]
  },
  { "uuid": "c4", "name": "No messages", "created_at": "2026-02-02T10:00:00.000000Z", "updated_at": "2026-02-02T10:00:00.000000Z" },
  "not an object"
]
```

`tests/fixtures/claude-export/projects.json`:

```json
[
  { "uuid": "p1", "name": "Yoh", "prompt_template": "Keep answers short. I plan my day the night before.", "docs": [{ "filename": "notes.md", "content": "ignored" }] },
  { "uuid": "p2", "name": "Empty", "prompt_template": "" }
]
```

`tests/fixtures/claude-export/memories.json`:

```json
[{ "conversations_memory": "Spencer is a student who dives.", "project_memories": { "p1": "Yoh runs on a Raspberry Pi.", "p2": "" } }]
```

- [ ] **Step 2: Write the failing tests**

Create `tests/claude-export.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  batchConversations,
  estimateExtractCostUsd,
  EXPORT_MESSAGE_MAX_CHARS,
  mergeCandidates,
  parseExtractedCandidates,
  readConversations,
  readProjects,
  readSavedMemory,
  renderDistilled,
  type ExtractedCandidate,
} from "../src/core/claude-export.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/claude-export/${name}`, import.meta.url), "utf8"));

test("readConversations keeps only Spencer's messages and skips what does not fit", () => {
  const r = readConversations(fixture("conversations.json"));
  assert.equal(r.skipped, 3);
  assert.deepEqual(r.conversations, [
    { title: "Morning routine", date: "2025-11-02", humanMessages: ["I run most mornings before school and I want to keep that.", "Also I am allergic to peanuts."] },
    { title: "Untitled", date: "2026-01-10", humanMessages: ["I am building a planning assistant on a Raspberry Pi."] },
  ]);
  assert.ok(!JSON.stringify(r.conversations).includes("swimming"));
});

test("readConversations caps a long message and tolerates a wrong shape", () => {
  const long = [{ name: "x", updated_at: "2026-01-01T00:00:00Z", chat_messages: [{ sender: "human", text: "a".repeat(EXPORT_MESSAGE_MAX_CHARS + 50) }] }];
  assert.equal(readConversations(long).conversations[0]?.humanMessages[0]?.length, EXPORT_MESSAGE_MAX_CHARS);
  assert.deepEqual(readConversations(undefined), { conversations: [], skipped: 0 });
  assert.deepEqual(readConversations({ nope: true }), { conversations: [], skipped: 0 });
});

test("readProjects and readSavedMemory return the non-empty distilled sources", () => {
  assert.deepEqual(readProjects(fixture("projects.json")), [{ label: "Project instructions: Yoh", text: "Keep answers short. I plan my day the night before." }]);
  assert.deepEqual(readSavedMemory(fixture("memories.json")), [
    { label: "Claude's saved memory", text: "Spencer is a student who dives." },
    { label: "Claude's saved project memory", text: "Yoh runs on a Raspberry Pi." },
  ]);
  assert.deepEqual(readProjects(undefined), []);
  assert.deepEqual(readSavedMemory(undefined), []);
  assert.equal(renderDistilled([{ label: "A", text: "one" }, { label: "B", text: "two" }]), "### A\none\n\n### B\ntwo");
});

test("batchConversations packs conversations under the limit and splits an oversized one", () => {
  const { conversations } = readConversations(fixture("conversations.json"));
  const one = batchConversations(conversations);
  assert.equal(one.length, 1);
  assert.match(one[0] as string, /^### Conversation \(2025-11-02\): Morning routine\n- I run most mornings/);
  assert.match(one[0] as string, /### Conversation \(2026-01-10\): Untitled/);

  const small = batchConversations(conversations, 120);
  assert.ok(small.length >= 2);
  assert.ok(small.every((b) => b.startsWith("### Conversation (")));
  assert.equal(small.join("\n").match(/allergic to peanuts/g)?.length, 1);

  const big = [{ title: "Big", date: "2026-03-01", humanMessages: ["m".repeat(80), "n".repeat(80), "o".repeat(80)] }];
  const split = batchConversations(big, 150);
  assert.equal(split.length, 3);
  assert.ok(split.every((b) => b.startsWith("### Conversation (2026-03-01): Big\n- ")));
  assert.deepEqual(batchConversations([]), []);
});

test("parseExtractedCandidates keeps valid elements and returns undefined for a non-array reply", () => {
  const reply = `Here you go:\n[{"folder":"about-you","text":"Runs most  mornings.","date":"2025-11-02"},{"folder":"about-you","text":"Has a peanut allergy.","sensitive":"health","date":"soon"},{"folder":"hobbies","text":"x"},{"folder":"about-you","text":""},{"folder":"about-you","text":"${"y".repeat(281)}"},7]`;
  assert.deepEqual(parseExtractedCandidates(reply, 2), [
    { folder: "about-you", text: "Runs most mornings.", stage: 2, sourceDate: "2025-11-02" },
    { folder: "about-you", text: "Has a peanut allergy.", stage: 2, sensitive: "health" },
  ]);
  assert.deepEqual(parseExtractedCandidates("[]", 1), []);
  assert.equal(parseExtractedCandidates("I could not find anything.", 2), undefined);
  assert.equal(parseExtractedCandidates('[{"folder": "about-you", "text": "cut off', 2), undefined);
  assert.equal(parseExtractedCandidates('{"folder":"about-you"}', 2), undefined);
});

test("mergeCandidates collapses near-duplicates: stage 1 wins, then the newest wording", () => {
  const c = (o: Partial<ExtractedCandidate>): ExtractedCandidate => ({ folder: "about-you", text: "Runs most mornings before school", stage: 2, ...o });
  const merged = mergeCandidates([
    c({ text: "Runs most mornings before school", sourceDate: "2024-01-01" }),
    c({ text: "Runs most mornings before school now", sourceDate: "2026-01-01" }),
    c({ text: "runs most mornings before school.", stage: 1 }),
    c({ text: "Has a peanut allergy", sourceDate: "2025-01-01" }),
    c({ text: "Has a peanut allergy", sourceDate: "2025-06-01", sensitive: "health" }),
    c({ text: "Runs most mornings before school", folder: "patterns", sourceDate: "2025-01-01" }),
    c({ text: "Go", sourceDate: "2025-01-01" }),
    c({ text: "go!", sourceDate: "2025-02-01" }),
  ]);
  assert.deepEqual(merged.map((m) => [m.folder, m.text, m.stage]), [
    ["about-you", "runs most mornings before school.", 1],
    ["about-you", "Has a peanut allergy", 2],
    ["about-you", "go!", 2],
    ["patterns", "Runs most mornings before school", 2],
  ]);
  assert.equal(merged[1]?.sensitive, "health");
});

test("estimateExtractCostUsd grows with the text and is zero for no calls", () => {
  const model = "claude-haiku-4-5-20251001";
  assert.equal(estimateExtractCostUsd([], model), 0);
  const small = estimateExtractCostUsd(["a".repeat(4000)], model);
  const large = estimateExtractCostUsd(["a".repeat(4000), "a".repeat(400_000)], model);
  assert.ok(small > 0 && large > small);
  // 1 call: (1000 + 500) input tokens at $1/M plus 400 output tokens at $5/M.
  assert.ok(Math.abs(small - (1500 / 1_000_000 + (400 * 5) / 1_000_000)) < 1e-9);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/claude-export.test.ts`
Expected: FAIL, cannot find `../src/core/claude-export.ts`.

- [ ] **Step 4: Implement**

Create `src/core/claude-export.ts`:

```ts
/** Claude data export → extraction inputs and merged candidates. Pure: the caller reads the files and calls the model. */
import { costForRow } from "./llm-cost.ts";
import { normalizeMemoryText } from "./memory-filing.ts";
import { isMemoryFolder, MEMORY_FOLDERS_IN_ORDER, MEMORY_ITEM_MAX_CHARS } from "./memory-folders.ts";
import type { RenderCandidate } from "./memory-import.ts";

/** A longer message is almost always pasted material, not a statement about Spencer. */
export const EXPORT_MESSAGE_MAX_CHARS = 4000;
/** Characters of conversation text per model call (about 15k tokens). */
export const EXPORT_BATCH_MAX_CHARS = 60_000;
/** Word-set overlap at which two candidates in one folder count as the same fact. */
export const EXPORT_NEAR_DUPLICATE_JACCARD = 0.8;
/** An estimate above this needs an explicit yes. */
export const EXPORT_COST_CONFIRM_USD = 5;

const CHARS_PER_TOKEN = 4;
const PROMPT_OVERHEAD_TOKENS = 500;
const EXPECTED_OUTPUT_TOKENS = 400;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ExportConversation {
  readonly title: string;
  /** Day of the conversation's last update. */
  readonly date: string;
  readonly humanMessages: readonly string[];
}

/** A source another assistant or Spencer already distilled: saved memory, project instructions. */
export interface ExportDistilled {
  readonly label: string;
  readonly text: string;
}

export interface ExtractedCandidate extends RenderCandidate {
  /** 1 = saved memory and project instructions; 2 = conversations. */
  readonly stage: 1 | 2;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function messageText(m: Record<string, unknown>): string {
  const direct = str(m["text"]).trim();
  if (direct !== "") return direct;
  const content: unknown[] = Array.isArray(m["content"]) ? m["content"] : [];
  return content
    .filter(isRecord)
    .filter((b) => b["type"] === "text")
    .map((b) => str(b["text"]))
    .join("\n")
    .trim();
}

/** Only Spencer's own messages are kept. A conversation with none, or with no usable date, is counted as skipped. */
export function readConversations(json: unknown): { conversations: ExportConversation[]; skipped: number } {
  if (!Array.isArray(json)) return { conversations: [], skipped: 0 };
  const conversations: ExportConversation[] = [];
  let skipped = 0;
  for (const raw of json as unknown[]) {
    if (!isRecord(raw)) {
      skipped++;
      continue;
    }
    const messages: unknown[] = Array.isArray(raw["chat_messages"]) ? raw["chat_messages"] : [];
    const humanMessages = messages
      .filter(isRecord)
      .filter((m) => m["sender"] === "human")
      .map(messageText)
      .filter((t) => t !== "")
      .map((t) => t.slice(0, EXPORT_MESSAGE_MAX_CHARS));
    const date = (str(raw["updated_at"]) || str(raw["created_at"])).slice(0, 10);
    if (humanMessages.length === 0 || !ISO_DATE.test(date)) {
      skipped++;
      continue;
    }
    conversations.push({ title: str(raw["name"]).trim() || "Untitled", date, humanMessages });
  }
  return { conversations, skipped };
}

export function readProjects(json: unknown): ExportDistilled[] {
  if (!Array.isArray(json)) return [];
  return (json as unknown[])
    .filter(isRecord)
    .map((p) => ({ label: `Project instructions: ${str(p["name"]).trim() || "Untitled"}`, text: str(p["prompt_template"]).trim() }))
    .filter((d) => d.text !== "");
}

export function readSavedMemory(json: unknown): ExportDistilled[] {
  const entries: unknown[] = Array.isArray(json) ? json : isRecord(json) ? [json] : [];
  const out: ExportDistilled[] = [];
  for (const e of entries.filter(isRecord)) {
    const main = str(e["conversations_memory"]).trim();
    if (main !== "") out.push({ label: "Claude's saved memory", text: main });
    const perProject = isRecord(e["project_memories"]) ? e["project_memories"] : {};
    for (const v of Object.values(perProject)) {
      const text = str(v).trim();
      if (text !== "") out.push({ label: "Claude's saved project memory", text });
    }
  }
  return out;
}

export function renderDistilled(sources: readonly ExportDistilled[]): string {
  return sources.map((s) => `### ${s.label}\n${s.text}`).join("\n\n");
}

/** Packs conversations into model inputs of about `maxChars`. A conversation larger than that is split, each part under its own heading. */
export function batchConversations(conversations: readonly ExportConversation[], maxChars: number = EXPORT_BATCH_MAX_CHARS): string[] {
  const batches: string[] = [];
  let current = "";
  const add = (block: string): void => {
    if (current !== "" && current.length + block.length + 2 > maxChars) {
      batches.push(current);
      current = "";
    }
    current = current === "" ? block : `${current}\n\n${block}`;
  };
  for (const c of conversations) {
    const heading = `### Conversation (${c.date}): ${c.title}`;
    let block = heading;
    for (const m of c.humanMessages) {
      const line = `- ${m.replace(/\s+/g, " ")}`;
      if (block !== heading && block.length + line.length + 1 > maxChars) {
        add(block);
        block = heading;
      }
      block = `${block}\n${line}`;
    }
    add(block);
  }
  if (current !== "") batches.push(current);
  return batches;
}

/** The model's JSON array → candidates. Undefined when the reply holds no JSON array, so the caller can retry instead of caching an empty result. */
export function parseExtractedCandidates(modelText: string, stage: 1 | 2): ExtractedCandidate[] | undefined {
  const start = modelText.indexOf("[");
  const end = modelText.lastIndexOf("]");
  if (start < 0 || end <= start) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(modelText.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!Array.isArray(raw)) return undefined;
  const out: ExtractedCandidate[] = [];
  for (const e of raw as unknown[]) {
    if (!isRecord(e)) continue;
    const folder = e["folder"];
    if (!isMemoryFolder(folder)) continue;
    const text = str(e["text"]).replace(/\s+/g, " ").trim();
    if (text === "" || text.length > MEMORY_ITEM_MAX_CHARS) continue;
    const s = e["sensitive"];
    const date = str(e["date"]);
    out.push({
      folder,
      text,
      stage,
      ...(s === "health" || s === "emotion" || s === "finance" ? { sensitive: s } : {}),
      ...(ISO_DATE.test(date) ? { sourceDate: date } : {}),
    });
  }
  return out;
}

function wordSet(text: string): Set<string> {
  return new Set(
    normalizeMemoryText(text)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function nearDuplicate(a: { key: string; words: Set<string> }, b: { key: string; words: Set<string> }): boolean {
  if (a.key === b.key) return true;
  if (a.words.size === 0 || b.words.size === 0) return false;
  let shared = 0;
  for (const w of a.words) if (b.words.has(w)) shared++;
  return shared / (a.words.size + b.words.size - shared) >= EXPORT_NEAR_DUPLICATE_JACCARD;
}

/** Collapses near-duplicates within a folder. Stage 1 wins over stage 2; within a stage the newest source date wins. Output is in folder order. */
export function mergeCandidates(candidates: readonly ExtractedCandidate[]): ExtractedCandidate[] {
  const preferred = [...candidates].sort((a, b) => a.stage - b.stage || (b.sourceDate ?? "").localeCompare(a.sourceDate ?? ""));
  const kept: { candidate: ExtractedCandidate; key: string; words: Set<string> }[] = [];
  for (const candidate of preferred) {
    const entry = { candidate, key: normalizeMemoryText(candidate.text), words: wordSet(candidate.text) };
    if (kept.some((k) => k.candidate.folder === candidate.folder && nearDuplicate(k, entry))) continue;
    kept.push(entry);
  }
  return MEMORY_FOLDERS_IN_ORDER.flatMap((folder) => kept.filter((k) => k.candidate.folder === folder).map((k) => k.candidate));
}

/** Dollars for the calls still to make, from their input sizes. An estimate: real usage is reported after the run. */
export function estimateExtractCostUsd(callTexts: readonly string[], model: string): number {
  if (callTexts.length === 0) return 0;
  const inputTokens = callTexts.reduce((n, t) => n + Math.ceil(t.length / CHARS_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS, 0);
  return costForRow({ model, inputTokens, outputTokens: callTexts.length * EXPECTED_OUTPUT_TOKENS, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
}
```

Note on the merge test's expected order: within `about-you`, kept entries stay in preference order (stage 1 first, then stage 2 newest first), so "Has a peanut allergy" (2025-06-01, the sensitive one) comes before "go!" (2025-02-01).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/claude-export.test.ts tests/layering-rules.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/claude-export.ts tests/claude-export.test.ts tests/fixtures/claude-export
git commit -m "feat(export): read, batch and merge a Claude data export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The extraction call

**Files:**
- Create: `src/adapters/claude-export-llm.ts`
- Test: `tests/claude-export-llm.test.ts`

**Interfaces:**
- Consumes: `AnthropicMessagesClient`, `CLAUDE_CHAT_MODEL_FAST` (`src/adapters/llm-adapter.ts`); `parseExtractedCandidates`, `ExtractedCandidate` (`src/core/claude-export.ts`); `LlmUsageCostRow` (`src/core/llm-cost.ts`).
- Produces:
  - `type ExportSourceKind = "distilled" | "conversations"`
  - `interface ExportExtraction { candidates: ExtractedCandidate[] | undefined; usage: LlmUsageCostRow }`
  - `extractExportCandidates(client: AnthropicMessagesClient, kind: ExportSourceKind, content: string): Promise<ExportExtraction>`. `candidates` is undefined when the reply holds no JSON array. A transport error throws.

- [ ] **Step 1: Write the failing tests**

Create `tests/claude-export-llm.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractExportCandidates } from "../src/adapters/claude-export-llm.ts";
import { CLAUDE_CHAT_MODEL_FAST, type AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";

interface SeenCall {
  model: string;
  max_tokens: number;
  system: string;
  user: string;
}

function fakeClient(reply: string, seen: SeenCall[]): AnthropicMessagesClient {
  return {
    messages: {
      create: async (params: { model: string; max_tokens: number; system: string; messages: { content: string }[] }) => {
        seen.push({ model: params.model, max_tokens: params.max_tokens, system: params.system, user: params.messages[0]?.content ?? "" });
        return { content: [{ type: "text", text: reply }], usage: { input_tokens: 1200, output_tokens: 80, cache_creation_input_tokens: null, cache_read_input_tokens: null } };
      },
    },
  } as unknown as AnthropicMessagesClient;
}

test("conversations: sends the batch to Haiku and returns stage 2 candidates with usage", async () => {
  const seen: SeenCall[] = [];
  const client = fakeClient('[{"folder":"about-you","text":"Runs most mornings.","date":"2025-11-02"}]', seen);
  const r = await extractExportCandidates(client, "conversations", "### Conversation (2025-11-02): Morning\n- I run most mornings.");
  assert.deepEqual(r.candidates, [{ folder: "about-you", text: "Runs most mornings.", stage: 2, sourceDate: "2025-11-02" }]);
  assert.deepEqual(r.usage, { model: CLAUDE_CHAT_MODEL_FAST, inputTokens: 1200, outputTokens: 80, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.model, CLAUDE_CHAT_MODEL_FAST);
  assert.match(seen[0]?.user ?? "", /I run most mornings/);
  assert.match(seen[0]?.system ?? "", /messages Spencer wrote/);
  assert.match(seen[0]?.system ?? "", /about-you/);
});

test("distilled: stage 1 candidates and a larger output budget", async () => {
  const seen: SeenCall[] = [];
  const r = await extractExportCandidates(fakeClient('[{"folder":"goals-projects","text":"Is building Yoh."}]', seen), "distilled", "### Claude's saved memory\nBuilds Yoh.");
  assert.deepEqual(r.candidates, [{ folder: "goals-projects", text: "Is building Yoh.", stage: 1 }]);
  const conv: SeenCall[] = [];
  await extractExportCandidates(fakeClient("[]", conv), "conversations", "x");
  assert.ok((seen[0]?.max_tokens ?? 0) > (conv[0]?.max_tokens ?? 0));
  assert.match(seen[0]?.system ?? "", /saved notes/);
});

test("a reply with no JSON array yields undefined candidates but still reports usage", async () => {
  const r = await extractExportCandidates(fakeClient("Sorry, nothing here.", []), "conversations", "x");
  assert.equal(r.candidates, undefined);
  assert.equal(r.usage.inputTokens, 1200);
});

test("a transport error throws", async () => {
  const client = { messages: { create: async () => { throw new Error("network down"); } } } as unknown as AnthropicMessagesClient;
  await assert.rejects(() => extractExportCandidates(client, "conversations", "x"), /network down/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/claude-export-llm.test.ts`
Expected: FAIL, cannot find `../src/adapters/claude-export-llm.ts`.

- [ ] **Step 3: Implement**

Create `src/adapters/claude-export-llm.ts`:

```ts
/**
 * The one model call of the Claude export extractor. Kept out of
 * `llm-adapter.ts`: it runs from a one-shot CLI with no Yoh database, so it
 * returns its usage to the caller instead of recording it in `llm_usage`.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { parseExtractedCandidates, type ExtractedCandidate } from "../core/claude-export.ts";
import type { LlmUsageCostRow } from "../core/llm-cost.ts";
import { MEMORY_FOLDERS_IN_ORDER, MEMORY_ITEM_MAX_CHARS } from "../core/memory-folders.ts";
import { CLAUDE_CHAT_MODEL_FAST, type AnthropicMessagesClient } from "./llm-adapter.ts";

export type ExportSourceKind = "distilled" | "conversations";

export interface ExportExtraction {
  /** Undefined when the reply held no JSON array. */
  readonly candidates: ExtractedCandidate[] | undefined;
  readonly usage: LlmUsageCostRow;
}

const CONVERSATIONS_MAX_TOKENS = 1500;
/** Saved memory and project instructions are dense; one call may yield dozens of facts. */
const DISTILLED_MAX_TOKENS = 4000;

function systemPrompt(kind: ExportSourceKind): string {
  return [
    "You extract durable facts about Spencer for Yoh, his daily-planning assistant.",
    kind === "distilled"
      ? "The input is another assistant's saved notes about Spencer and the instructions he wrote for his projects. Rewrite what is durable as separate facts."
      : "The input is messages Spencer wrote to another assistant, grouped by conversation; each heading carries the conversation's date. Return at most 5 facts for the whole input, and [] when nothing is durable.",
    'Reply with ONLY a JSON array (no prose). Each element: {"folder", "text", optional "sensitive", optional "date"}.',
    `folder is one of: ${MEMORY_FOLDERS_IN_ORDER.filter((f) => f !== "patterns").join(", ")}.`,
    "feedback: how he wants an assistant to respond. planning-preferences: how he likes to plan his days. corrections: things assistants get wrong about him. about-you: stable facts about him. goals-projects: goals and ongoing projects. decisions-commitments: decisions he has made and commitments he holds. ideas-notes: ideas he wants kept.",
    `text: one standalone sentence about Spencer with no pronoun for him ("Prefers ...", "Is training for ..."), at most ${MEMORY_ITEM_MAX_CHARS} characters.`,
    'sensitive: "health", "emotion" or "finance" when the fact is about those.',
    "date: the YYYY-MM-DD from the heading of the conversation the fact came from; leave it out when there is none.",
    "Leave out: one-off requests, facts about other people, anything time-bound that has likely passed, passwords and account numbers, and anything you would be guessing.",
  ].join("\n");
}

/** Malformed output yields `candidates: undefined`; only a transport error throws. */
export async function extractExportCandidates(client: AnthropicMessagesClient, kind: ExportSourceKind, content: string): Promise<ExportExtraction> {
  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: kind === "distilled" ? DISTILLED_MAX_TOKENS : CONVERSATIONS_MAX_TOKENS,
    system: systemPrompt(kind),
    messages: [{ role: "user", content }],
  });
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return {
    candidates: parseExtractedCandidates(text, kind === "distilled" ? 1 : 2),
    usage: {
      model: CLAUDE_CHAT_MODEL_FAST,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
    },
  };
}
```

The `patterns` folder is left out of the prompt on purpose: Yoh fills it from its own observations.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/claude-export-llm.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/claude-export-llm.ts tests/claude-export-llm.test.ts
git commit -m "feat(export): Haiku extraction call for export batches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The extractor CLI

**Files:**
- Create: `src/shell/claude-export-cli.ts`
- Modify: `deploy/RASPBERRY-PI.md` (append one section at the end)
- Test: `tests/claude-export-cli.test.ts`

**Interfaces:**
- Consumes: everything Task 6 exports from `src/core/claude-export.ts`; `extractExportCandidates`, `ExportSourceKind`, `ExportExtraction` (`src/adapters/claude-export-llm.ts`); `renderMemoryImport` (`src/core/memory-import.ts`); `ALWAYS_LOADED_FOLDERS` (`src/core/memory-folders.ts`); `ALWAYS_LOADED_CAP` (`src/core/memory-context.ts`); `costForRows` (`src/core/llm-cost.ts`); `CLAUDE_CHAT_MODEL_FAST`, `createAnthropicMessagesClient`, `loadLlmAdapterConfigFromEnv`, `AnthropicMessagesClient` (`src/adapters/llm-adapter.ts`).
- Produces: `runClaudeExportExtract(options: ExtractOptions): Promise<number>` with `ExtractOptions { exportDir: string; outPath: string; yes: boolean; client: AnthropicMessagesClient; print: (line: string) => void }`. Exit codes: `0` done; `1` nothing to extract; `2` estimate over `EXPORT_COST_CONFIRM_USD` without `yes`; `3` file written but some calls failed.
- Command line: `node --env-file=.env src/shell/claude-export-cli.ts <export-dir> --out <file> [--yes]`.
- Cache: `<outPath>.cache/<sha256 of kind + NUL + text>.json`, holding `{ candidates, usage }`. Only a call with defined `candidates` is cached.

- [ ] **Step 1: Write the failing tests**

Create `tests/claude-export-cli.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnthropicMessagesClient } from "../src/adapters/llm-adapter.ts";
import { parseMemoryImport } from "../src/core/memory-import.ts";
import { runClaudeExportExtract } from "../src/shell/claude-export-cli.ts";

const FIXTURE = fileURLToPath(new URL("./fixtures/claude-export", import.meta.url));

function world() {
  const dir = mkdtempSync(join(tmpdir(), "yoh-export-"));
  const exportDir = join(dir, "export");
  cpSync(FIXTURE, exportDir, { recursive: true });
  const printed: string[] = [];
  return { dir, exportDir, outPath: join(dir, "candidates.md"), printed, print: (l: string) => void printed.push(l) };
}

/** Replies are chosen by what the call contains, so the test does not depend on call order. */
function fakeClient(replyFor: (user: string) => string | Error): { client: AnthropicMessagesClient; users: string[] } {
  const users: string[] = [];
  const client = {
    messages: {
      create: async (params: { messages: { content: string }[] }) => {
        const user = params.messages[0]?.content ?? "";
        users.push(user);
        const reply = replyFor(user);
        if (reply instanceof Error) throw reply;
        return { content: [{ type: "text", text: reply }], usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
      },
    },
  } as unknown as AnthropicMessagesClient;
  return { client, users };
}

const DISTILLED_REPLY = '[{"folder":"goals-projects","text":"Is building Yoh on a Raspberry Pi."},{"folder":"feedback","text":"Wants short answers."}]';
const CONVERSATION_REPLY =
  '[{"folder":"about-you","text":"Runs most mornings before school.","date":"2025-11-02"},{"folder":"about-you","text":"Has a peanut allergy.","sensitive":"health","date":"2025-11-02"},{"folder":"goals-projects","text":"is building yoh on a raspberry pi","date":"2026-01-10"}]';
const goodReplies = (user: string): string => (user.includes("### Conversation (") ? CONVERSATION_REPLY : DISTILLED_REPLY);

test("writes a candidates file the import parser reads, merged across stages", async () => {
  const w = world();
  const { client, users } = fakeClient(goodReplies);
  const code = await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client, print: w.print });
  assert.equal(code, 0);
  assert.equal(users.length, 2);
  assert.ok(users.every((u) => !u.includes("swimming")), "the assistant's messages are never sent");
  const text = readFileSync(w.outPath, "utf8");
  const parsed = parseMemoryImport(text);
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.candidates.map((c) => [c.folder, c.text, c.sensitive]), [
    ["feedback", "Wants short answers.", undefined],
    ["about-you", "Runs most mornings before school.", undefined],
    ["about-you", "Has a peanut allergy.", "health"],
    ["goals-projects", "Is building Yoh on a Raspberry Pi.", undefined],
  ]);
  assert.match(text, /> Always-loaded folders: 3 lines here/);
  assert.ok(w.printed.some((l) => /2 conversations/.test(l) && /3 skipped/.test(l)));
  assert.ok(w.printed.some((l) => /Estimated cost: \$0\.\d\d/.test(l)));
  assert.ok(w.printed.some((l) => /Actual cost: \$0\.\d\d/.test(l)));
  rmSync(w.dir, { recursive: true });
});

test("a rerun uses the cache and makes no calls", async () => {
  const w = world();
  const first = fakeClient(goodReplies);
  await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client: first.client, print: w.print });
  const before = readFileSync(w.outPath, "utf8");
  const second = fakeClient(() => new Error("must not be called"));
  const code = await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client: second.client, print: w.print });
  assert.equal(code, 0);
  assert.equal(second.users.length, 0);
  assert.equal(readFileSync(w.outPath, "utf8"), before);
  rmSync(w.dir, { recursive: true });
});

test("a malformed reply and a transport error are not cached, and the next run retries only those", async () => {
  const w = world();
  const flaky = fakeClient((user) => (user.includes("### Conversation (") ? "I found nothing I can format." : new Error("network down")));
  const code = await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client: flaky.client, print: w.print });
  assert.equal(code, 3);
  assert.equal(readdirSync(`${w.outPath}.cache`).length, 0);
  assert.ok(w.printed.some((l) => /2 of 2 calls failed/.test(l)));
  assert.ok(w.printed.every((l) => !l.includes("network down")), "raw error text is not printed");
  assert.ok(existsSync(w.outPath));

  const healed = fakeClient(goodReplies);
  assert.equal(await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client: healed.client, print: w.print }), 0);
  assert.equal(healed.users.length, 2);
  assert.equal(readdirSync(`${w.outPath}.cache`).length, 2);
  rmSync(w.dir, { recursive: true });
});

test("an estimate over the limit stops before any call unless --yes was given", async () => {
  const w = world();
  // 6,000 conversations of 4,000 characters: about 6M input tokens, roughly $7 on Haiku.
  const big = Array.from({ length: 6000 }, (_, i) => ({ name: `c${i}`, updated_at: "2026-01-01T00:00:00Z", chat_messages: [{ sender: "human", text: `${i} `.padEnd(4000, "word ") }] }));
  writeFileSync(join(w.exportDir, "conversations.json"), JSON.stringify(big));
  const refused = fakeClient(() => "[]");
  assert.equal(await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client: refused.client, print: w.print }), 2);
  assert.equal(refused.users.length, 0);
  assert.ok(w.printed.some((l) => /--yes/.test(l)));
  assert.equal(existsSync(w.outPath), false);

  const allowed = fakeClient(() => "[]");
  assert.equal(await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: true, client: allowed.client, print: w.print }), 0);
  assert.ok(allowed.users.length > 100);
  rmSync(w.dir, { recursive: true });
});

test("missing source files are reported and skipped; an empty export exits 1", async () => {
  const w = world();
  rmSync(join(w.exportDir, "memories.json"));
  rmSync(join(w.exportDir, "projects.json"));
  const only = fakeClient(goodReplies);
  assert.equal(await runClaudeExportExtract({ exportDir: w.exportDir, outPath: w.outPath, yes: false, client: only.client, print: w.print }), 0);
  assert.equal(only.users.length, 1);
  assert.ok(w.printed.some((l) => /memories\.json: not found/.test(l)));

  rmSync(join(w.exportDir, "conversations.json"));
  const none = fakeClient(goodReplies);
  assert.equal(await runClaudeExportExtract({ exportDir: w.exportDir, outPath: join(w.dir, "other.md"), yes: false, client: none.client, print: w.print }), 1);
  assert.equal(none.users.length, 0);
  rmSync(w.dir, { recursive: true });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/claude-export-cli.test.ts`
Expected: FAIL, cannot find `../src/shell/claude-export-cli.ts`.

- [ ] **Step 3: Implement**

Create `src/shell/claude-export-cli.ts`:

```ts
/**
 * One-shot: a Claude data export → a candidates file Spencer reviews before
 * `POST /api/memory/import`. Run on the Mac. Opens no Yoh database; writes
 * only the output file and its cache directory.
 *
 *   node --env-file=.env src/shell/claude-export-cli.ts <export-dir> --out <file> [--yes]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractExportCandidates, type ExportExtraction, type ExportSourceKind } from "../adapters/claude-export-llm.ts";
import { CLAUDE_CHAT_MODEL_FAST, createAnthropicMessagesClient, loadLlmAdapterConfigFromEnv, type AnthropicMessagesClient } from "../adapters/llm-adapter.ts";
import {
  batchConversations,
  estimateExtractCostUsd,
  EXPORT_COST_CONFIRM_USD,
  mergeCandidates,
  readConversations,
  readProjects,
  readSavedMemory,
  renderDistilled,
  type ExtractedCandidate,
} from "../core/claude-export.ts";
import { costForRows, type LlmUsageCostRow } from "../core/llm-cost.ts";
import { ALWAYS_LOADED_CAP } from "../core/memory-context.ts";
import { ALWAYS_LOADED_FOLDERS } from "../core/memory-folders.ts";
import { renderMemoryImport } from "../core/memory-import.ts";

export interface ExtractOptions {
  readonly exportDir: string;
  readonly outPath: string;
  /** Go ahead even when the estimate is over `EXPORT_COST_CONFIRM_USD`. */
  readonly yes: boolean;
  readonly client: AnthropicMessagesClient;
  readonly print: (line: string) => void;
}

interface Call {
  readonly kind: ExportSourceKind;
  readonly text: string;
}

/** Parsed JSON, or undefined when the file is absent. Invalid JSON throws. */
function readJson(path: string): unknown {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown) : undefined;
}

export async function runClaudeExportExtract(o: ExtractOptions): Promise<number> {
  const source = (name: string): unknown => {
    const json = readJson(join(o.exportDir, name));
    if (json === undefined) o.print(`${name}: not found, skipped.`);
    return json;
  };
  const distilled = [...readSavedMemory(source("memories.json")), ...readProjects(source("projects.json"))];
  const { conversations, skipped } = readConversations(source("conversations.json"));
  o.print(`Found ${distilled.length} saved-memory and project sources and ${conversations.length} conversations (${skipped} skipped: no messages from you).`);

  const calls: Call[] = [
    ...(distilled.length > 0 ? [{ kind: "distilled" as const, text: renderDistilled(distilled) }] : []),
    ...batchConversations(conversations).map((text) => ({ kind: "conversations" as const, text })),
  ];
  if (calls.length === 0) {
    o.print("Nothing to extract. Check that the folder is an unzipped Claude export.");
    return 1;
  }

  const cacheDir = `${o.outPath}.cache`;
  const cachePath = (c: Call): string => join(cacheDir, `${createHash("sha256").update(`${c.kind}\0${c.text}`).digest("hex")}.json`);
  const uncached = calls.filter((c) => !existsSync(cachePath(c)));
  const estimate = estimateExtractCostUsd(uncached.map((c) => c.text), CLAUDE_CHAT_MODEL_FAST);
  o.print(`${calls.length} calls, ${calls.length - uncached.length} already cached. Estimated cost: $${estimate.toFixed(2)}.`);
  if (estimate > EXPORT_COST_CONFIRM_USD && !o.yes) {
    o.print(`That is over $${EXPORT_COST_CONFIRM_USD}. Run again with --yes to go ahead.`);
    return 2;
  }

  mkdirSync(cacheDir, { recursive: true });
  const candidates: ExtractedCandidate[] = [];
  const usage: LlmUsageCostRow[] = [];
  let failed = 0;
  for (const [i, call] of calls.entries()) {
    const path = cachePath(call);
    if (existsSync(path)) {
      candidates.push(...((JSON.parse(readFileSync(path, "utf8")) as { candidates: ExtractedCandidate[] }).candidates));
      continue;
    }
    let result: ExportExtraction;
    try {
      result = await extractExportCandidates(o.client, call.kind, call.text);
    } catch {
      // The raw error may hold request details; the count is enough to act on.
      failed++;
      o.print(`Call ${i + 1} of ${calls.length} could not reach Claude.`);
      continue;
    }
    usage.push(result.usage);
    if (result.candidates === undefined) {
      failed++;
      o.print(`Call ${i + 1} of ${calls.length} returned no readable list.`);
      continue;
    }
    writeFileSync(path, JSON.stringify({ candidates: result.candidates, usage: result.usage }));
    candidates.push(...result.candidates);
  }

  const merged = mergeCandidates(candidates);
  const always = merged.filter((c) => ALWAYS_LOADED_FOLDERS.includes(c.folder)).length;
  writeFileSync(
    o.outPath,
    renderMemoryImport(merged, [
      "Delete the lines you do not want, reword freely, and move lines between headings.",
      "Each line is one memory item of at most 280 characters. The date and [sensitive] marker are optional.",
      `Always-loaded folders: ${always} lines here (Feedback, Planning preferences, Corrections, About you). Yoh loads at most ${ALWAYS_LOADED_CAP} in total, counting what it already holds.`,
    ]),
  );
  o.print(`Wrote ${merged.length} candidates (from ${candidates.length} before merging) to ${o.outPath}.`);
  o.print(`Actual cost: $${costForRows(usage).toFixed(2)}.`);
  if (failed > 0) {
    o.print(`${failed} of ${calls.length} calls failed. Run the same command again to retry only those.`);
    return 3;
  }
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const print = (line: string): void => void process.stdout.write(`${line}\n`);
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const exportDir = argv.find((a, i) => !a.startsWith("--") && i !== outIndex + 1);
  if (!exportDir || !outPath) {
    print("Usage: node --env-file=.env src/shell/claude-export-cli.ts <export-dir> --out <file> [--yes]");
    return 64;
  }
  try {
    const client = createAnthropicMessagesClient(loadLlmAdapterConfigFromEnv());
    return await runClaudeExportExtract({ exportDir, outPath, yes: argv.includes("--yes"), client, print });
  } catch (error) {
    process.stderr.write(`claude-export-cli: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
```

Two points the tests pin: the "2 of 2 calls failed" line comes from the final summary, and the estimate test's large export must exit `2` before `mkdirSync`, so the cache directory is created only after the cost check.

Append to `deploy/RASPBERRY-PI.md`:

````markdown
## Importing a Claude data export into memory

Run on the Mac, from the repo. The export and the candidates file stay outside the repo.

1. Unzip the export, for example to `~/Documents/claude-export`.
2. Extract candidates (prints an estimate first; over $5 it stops until you add `--yes`):

   ```bash
   node --env-file=.env src/shell/claude-export-cli.ts ~/Documents/claude-export --out ~/Documents/Yoh-previews/claude-candidates.md
   ```

   If it reports failed calls, run the same command again; finished calls are cached.
3. Edit `claude-candidates.md`: delete lines, reword, move lines between headings.
4. Dry run against the Pi, then the real import:

   ```bash
   curl -sS -X POST -H 'Content-Type: text/markdown' --data-binary @"$HOME/Documents/Yoh-previews/claude-candidates.md" 'https://yoh.<tailnet>.ts.net/api/memory/import?dryRun=1'
   curl -sS -X POST -H 'Content-Type: text/markdown' --data-binary @"$HOME/Documents/Yoh-previews/claude-candidates.md" 'https://yoh.<tailnet>.ts.net/api/memory/import'
   ```

   The reply lists what was filed, skipped as a duplicate, or rejected. If it says the always-loaded folders would pass 60, cut that many lines and send it again. Sending the same file twice is harmless.
````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/claude-export-cli.test.ts tests/layering-rules.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `npm run check > /tmp/gate.log 2>&1; tail -30 /tmp/gate.log`
Expected: every stage passes. Read only failures and the summary.

- [ ] **Step 6: Commit**

```bash
git add src/shell/claude-export-cli.ts tests/claude-export-cli.test.ts deploy/RASPBERRY-PI.md
git commit -m "feat(export): CLI that turns a Claude export into a candidates file

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Confirm against the real export (coordinator, with Spencer)

Not an implementer task. It needs the real export, which never enters the repo or a subagent's context.

**Files:**
- Modify (only if the layout differs): `src/core/claude-export.ts` readers, `tests/fixtures/claude-export/*.json`, `tests/claude-export.test.ts`

- [ ] **Step 1: Check the layout by key names only**

Print structure, not content:

```bash
cd <export-dir> && ls
jq 'if type=="array" then (.[0] | keys) else keys end' conversations.json
jq '.[0].chat_messages[0] | keys' conversations.json
jq '[.[].chat_messages[]?.sender] | unique' conversations.json
jq 'if type=="array" then (.[0] | keys) else keys end' projects.json
jq 'if type=="array" then (.[0] | keys) else keys end' memories.json
```

Expected: `conversations.json` items have `name`, `updated_at`, `chat_messages`; messages have `sender` (`human` / `assistant`), `text`, `content`; `projects.json` items have `name`, `prompt_template`; `memories.json` items have `conversations_memory`, `project_memories`.

- [ ] **Step 2: If a name differs, fix the reader test-first**

Change the fabricated fixture to the real key name, run `node --test tests/claude-export.test.ts` to see it fail, change the one reader in `src/core/claude-export.ts`, run again to see it pass, and commit with message `fix(export): match the real export layout`.

- [ ] **Step 3: Run the extractor on the real export**

```bash
node --env-file=.env src/shell/claude-export-cli.ts <export-dir> --out ~/Documents/Yoh-previews/claude-candidates.md
```

Expected: source counts that look right to Spencer, an estimate, then the candidates file. Report the estimate and the actual cost to Spencer. Do not paste the file's contents into the session; Spencer reviews it himself.

- [ ] **Step 4: Hand over**

After the branch is merged and Spencer has deployed, he runs the dry run and the real import from `deploy/RASPBERRY-PI.md`. The import route is a write on the Pi's database: Spencer runs both `curl` commands, not the agent.
