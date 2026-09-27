# Epic 6 Retro Item 7 — `runChatCli` Deps Object and One Planning-Field Value Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two independent findings from the Epic 6 retrospective (F8, F9), filed as sprint-status.yaml action item 7 ("Before next chat-command epic: replace runChatCli positional deps with a deps object; extract shared planning-field value parser for FR-4/FR-25"), land before Epic 8 adds any more chat-command surface area. `runChatCli`'s 17 positional parameters (7 added across Epic 6 alone, each with a throws-only-if-invoked default) become one `ChatCliDeps` object, and `chat-cli.ts`'s `parseFieldAnswer` (FR-4) and `llm-adapter.ts`'s `parseSuggestedValue` (FR-25) — two independent copies of the same field-value validation logic — become one `core/planning-field-value.ts` function both call. This is a pure refactor: every existing behavior, message, and test outcome is unchanged.

**Architecture:** `core/planning-field-value.ts` is a new, dependency-free `core/*.ts` file (AD-1: imports only `types/*.ts`; AD-2: pure, no I/O, no module state) exporting the one `parsePlanningFieldValue` function. `shell/chat-cli.ts` (FR-4's typed-answer path) imports it directly — AD-1's Phase 2 revision permits `shell/{server,chat-cli}.ts → app → {rituals, core, adapters}`, and `chat-cli.ts` already imports several other `core/*.ts` files (`data-completeness-gate.ts`, `slip-bump.ts`, `time-budget.ts`, `tone.ts`) directly today, so this is the established pattern, not a new one. `adapters/llm-adapter.ts` (FR-25's suggestion path) **cannot** import `core/*.ts` (AD-1 forbids `adapters/` depending on anything but `types/` and sibling adapters), so `suggestFieldValue` takes the parser as an injected `parseValue` parameter instead, and `chat-cli.ts` — the one file that may import both — passes a thin wrapper over `parsePlanningFieldValue`. Separately, `runChatCli`'s positional-parameter list becomes one exported `ChatCliDeps` interface, destructured with the exact same default values at the top of the function signature, so the function body needs zero changes. `main()`'s call site becomes an object literal built from the same local bindings it already has.

**Tech Stack:** existing `node:test` conventions; no new packages; no changes to `web/`.

**Spec:**
- `_bmad-output/planning-artifacts/architecture/architecture-YohV1-2026-08-22/ARCHITECTURE-SPINE.md` — AD-1 (layering, Phase 2 revision), AD-2 (core purity), AD-8 (Result shape at the core/adapter boundary), AD-16 (the `app/` layer Tasks 2-5 build on top of this one).
- `_bmad-output/implementation-artifacts/epic-6-retro-2026-09-24.md` — findings F8 (duplicated parsers) and F9 (`runChatCli`'s positional-parameter growth).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — action item `epic-6-retro-item-7-before-next-chat-command-epic-replace-ru`, the binding requirement text.
- `_bmad-output/implementation-artifacts/sdd-plan-YohV1-phase2-epic8.md`, Task 1.

There is no `epics.md` story for this task — it is an Epic 6 retrospective action item, not an Epic 8 FR. "Acceptance Criteria" below are drawn from the action item's own text plus the SDD plan's Task 1 "Owns" line.

## Assumptions about earlier tasks

None — this is the first task in the Epic 8 SDD plan ("Depends on: nothing"). It runs against the Epic 7 baseline exactly as committed.

## Global Constraints

(Subset of the Epic 8 SDD plan's Global Constraints that binds this task.)

- **Layering (AD-1):** `core/*.ts` imports only `types/*.ts` and other `core/*.ts`. `adapters/*.ts` imports only `types/*.ts` (plus sibling adapters). `shell/chat-cli.ts` may import `core/*.ts` directly (established pattern; Task 1 predates the `app/` layer Tasks 2+ add). `tests/layering-rules.test.ts` must stay green.
- **Functional core (AD-2):** `core/planning-field-value.ts`'s export is pure — no I/O, no module state, no argument mutation, and it never throws.
- **Moved, not copied:** `chat-cli.ts`'s `parseFieldAnswer` and `llm-adapter.ts`'s `parseSuggestedValue` are both **deleted** in this task, and every test that pinned either one moves with the logic (adapted only where the function name changed). After this task, `grep -rn "parseFieldAnswer\|parseSuggestedValue" src tests` finds nothing.
- **Tests:** `node:test` with fake adapters. The per-task gate is `npm run check` (typecheck, web typecheck, web build, node tests, web tests). Baseline going into this task: node 964, web 149, Playwright 3/3 (untouched by this task — it's a pure `src/`/`tests/` refactor with zero `web/` changes). This task's own verified result: **node 968** (+4), web 149 (unchanged).
- **Process:** one squashed commit, `sprint-status.yaml` updated in the same commit. Commit trailer is **only** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never bare `git stash`.

## Review Focus

Five failure modes this refactor could silently introduce, with no epics.md AC to catch them — each pinned by a specific test below, ordered most-likely-first.

1. **The unified parser silently narrows what one of the two original call sites used to accept.** `parseFieldAnswer` (FR-4) and `parseSuggestedValue` (FR-25) were compared line-for-line before merging: same `TASK_STATUSES`/`ENERGIES` arrays, same ISO-date regex, same real-calendar-date check, same whole-number-minutes rule — no disagreement was found. Pinned by: the 10 moved tests (Task 1, Step 1) plus two new tests proving raw input padded with whitespace (FR-4's untrimmed terminal line) and raw input already trimmed (FR-25's Claude-claimed value) parse identically (Task 1, Step 1).
2. **`suggestFieldValue`'s new required `parseValue` parameter isn't actually wired at chat-cli.ts's one production call site**, silently disabling FR-25 suggestions entirely while still typechecking (any function matching the shape would satisfy the type). Pinned by: `tests/chat-cli.test.ts`'s four existing FR-25 end-to-end tests (`"a confident inference is shown as a proposal..."` etc., lines 555-619) continuing to pass unchanged — they exercise the real production wrapper through `answerDataCompletenessRequest`, not a test-only fake.
3. **`suggestFieldValue` stops trusting its injected `parseValue` and re-derives the value itself**, making the injection point cosmetic. Pinned by: a new llm-adapter.test.ts test asserting `suggestFieldValue` calls `parseValue` with the exact trimmed claimed string and returns *exactly* whatever `parseValue` returns, even a deliberately nonsensical value a fake `parseValue` supplies (Task 2, Step 1).
4. **Converting `runChatCli`'s 17 positional parameters into one destructured `ChatCliDeps` object silently breaks the "throws only if the dependency is actually invoked" default for an omitted optional field** (for example, if a field is destructured without its default, an omitted property becomes `undefined` and callers crash with a raw, unhelpful `TypeError` instead of the original, honest error message). Pinned by: a new test that builds `ChatCliDeps` with `readTasks` omitted entirely, triggers the Mid-Day Re-Flow path, and asserts the *original* `"chat-cli: no readTasks dependency configured — cannot re-flow the day"` message still surfaces (Task 3, Step 4).
5. **The ~59-call-site mechanical rewrite of `tests/chat-cli.test.ts` (positional args → named object properties) transposes two arguments**, e.g. swapping `createNotionPage` and `validateNotionPageDraft` into each other's slot. Guarded structurally (their function signatures differ, so a swap fails `npm run typecheck`) and behaviorally (every one of the ~59 already-existing call sites' own assertions must still pass byte-for-byte after the rewrite — Task 4, Step 4 requires the *exact same* pass count as before the rewrite, zero new failures, zero skipped).

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/core/planning-field-value.ts` | **create** | The one `parsePlanningFieldValue` export (C1's contract name) — moved from `chat-cli.ts:356-449` (`FieldAnswerParseResult` type, `TASK_STATUSES`, `ENERGIES`, `ISO_DATE_RE`, `isRealCalendarDate`, `parseFieldAnswer`, renamed). |
| `tests/planning-field-value.test.ts` | **create** | The 10 tests moved unchanged (name updated) from `tests/chat-cli.test.ts:404-465`, plus 2 new union-behavior tests (Review Focus #1). |
| `src/adapters/llm-adapter.ts` | modify | Delete `parseSuggestedValue` and its three private constants (`SUGGEST_FIELD_VALUE_TASK_STATUSES`, `SUGGEST_FIELD_VALUE_ENERGIES`, `SUGGEST_FIELD_VALUE_ISO_DATE_RE`); add the `ParsePlanningFieldValueFn` type and `suggestFieldValue`'s new `parseValue` parameter; drop the now-unused `Energy`/`TaskStatus` type imports. |
| `tests/llm-adapter.test.ts` | modify | Add a `realParseValue` wrapper (imports the real `parsePlanningFieldValue`) and pass it at all 5 existing `suggestFieldValue(...)` call sites; add 1 new test (Review Focus #3). |
| `src/shell/chat-cli.ts` | modify | Delete `parseFieldAnswer`'s whole block (lines 356-449); add the `import { parsePlanningFieldValue } from "../core/planning-field-value.ts"`; add the private `suggestedFieldValueParser` wrapper; add the exported `ChatCliDeps` interface; convert `runChatCli`'s positional signature to one destructured `{ ... }: ChatCliDeps` parameter (body unchanged); update the two internal call sites (`suggestFieldValue(...)`, `parseFieldAnswer(...)` → `parsePlanningFieldValue(...)`); update `main()`'s `runChatCli(...)` call site to an object literal; update 2 stale doc-comment cross-references to the old function name. |
| `tests/chat-cli.test.ts` | modify | Remove the `parseFieldAnswer` import and its 12-test block (moved out); mechanically rewrite all ~59 `runChatCli(...)` call sites from positional args to a `{ field: value, ... }` object literal (a provided codemod script, run once); add 1 new pinning test (Review Focus #4). |
| `src/core/derived-priority.ts` | modify | One doc-comment line updated (`shell/chat-cli.ts's parseFieldAnswer` → `core/planning-field-value.ts's parsePlanningFieldValue`) — no logic change. |
| `src/core/time-budget.ts` | modify | One doc-comment updated (same rename) — no logic change. |
| `src/rituals/night-ritual.ts` | modify | One doc-comment updated (same rename) — no logic change. |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | modify | Action item `epic-6-retro-item-7-before-next-chat-command-epic-replace-ru`'s `status: open` → `status: done`. |

**Moved test names** (from `tests/chat-cli.test.ts` → `tests/planning-field-value.test.ts`, function name updated in each):
1. `parseFieldAnswer(estimatedDurationMinutes) accepts a positive whole number of minutes`
2. `parseFieldAnswer(estimatedDurationMinutes) rejects non-numeric, zero, negative, and fractional input`
3. `parseFieldAnswer(area) accepts any non-blank free-form text`
4. `parseFieldAnswer(area) rejects blank input`
5. `parseFieldAnswer(dueDate) accepts a YYYY-MM-DD date`
6. `parseFieldAnswer(dueDate) rejects an unparseable or malformed date`
7. `parseFieldAnswer(status) accepts one of the fixed TaskStatus values, case/space-insensitively`
8. `parseFieldAnswer(status) rejects a value outside the fixed enum`
9. `parseFieldAnswer(energy) accepts one of the fixed Energy values, case-insensitively`
10. `parseFieldAnswer(energy) rejects a value outside the fixed enum`

(All 10 renamed `parseFieldAnswer(...)` → `parsePlanningFieldValue(...)`; two new tests are added alongside them, not moved.)

## Interfaces

**Consumes:** nothing from an earlier task (this is Task 1).

**Produces** (for Tasks 2-5, per contract C1 and the SDD plan's own Task 1 "Owns" line):

```ts
// src/core/planning-field-value.ts
export type PlanningFieldValueParseResult<F extends PlanningFieldNames> =
  | { readonly ok: true; readonly value: TaskFieldOverride[F] }
  | { readonly ok: false; readonly message: string };

export function parsePlanningFieldValue<F extends PlanningFieldNames>(
  field: F,
  raw: string,
): PlanningFieldValueParseResult<F>;
```

```ts
// src/adapters/llm-adapter.ts
export type ParsePlanningFieldValueFn = (
  field: PlanningFieldNames,
  raw: string,
) => NonNullable<Task[PlanningFieldNames]> | undefined;

export async function suggestFieldValue(
  client: AnthropicMessagesClient,
  taskId: ExternalId,
  taskTitle: string,
  field: PlanningFieldNames,
  recentMessages: readonly string[],
  parseValue: ParsePlanningFieldValueFn,
): Promise<FieldValueSuggestion | undefined>;
```

```ts
// src/shell/chat-cli.ts
export interface ChatCliDeps {
  readonly store: MemoryStore;
  readonly io: ChatCliIo;
  readonly timeZone: string;
  readonly llmClient: AnthropicMessagesClient;
  readonly now?: () => Date;
  readonly readTasks?: () => Promise<readonly Task[]>;
  readonly setTaskStatus?: SetTaskStatusFn;
  readonly updateTaskField?: UpdateTaskFieldFn;
  readonly createNotionPage?: CreateNotionPageFn;
  readonly validateNotionPageDraft?: ValidateNotionPageDraftFn;
  readonly searchFn?: SearchFn;
  readonly readCalendarEventsFn?: () => Promise<readonly CalendarEvent[]>;
  readonly resolveCalendarEditRouteFn?: ResolveCalendarEditRouteFn;
  readonly proposeCalendarEditFn?: ProposeCalendarEditFn;
  readonly applyCalendarEditFn?: ApplyCalendarEditFn;
  readonly recordCompletion?: RecordCompletionFn;
  readonly lookupTask?: LookupTaskFn;
}

export async function runChatCli(deps: ChatCliDeps): Promise<void>;
```

`ChatCliDeps` is exactly the shape Tasks 2-5 extend with new optional fields as they move more handlers into `app/` — its four required fields (`store`, `io`, `timeZone`, `llmClient`) and every other field's original throws-only-if-invoked default are unchanged from today's positional defaults.

---

## Task 1: `core/planning-field-value.ts` — the one planning-field value parser

**Files:**
- Create: `src/core/planning-field-value.ts`, `tests/planning-field-value.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/planning-field-value.test.ts`:

```ts
/**
 * Tests for `src/core/planning-field-value.ts` (Epic 6 retro item 7, F8/F9).
 *
 * The first 10 tests below are moved unchanged (only the function name
 * changed, `parseFieldAnswer` -> `parsePlanningFieldValue`) from
 * `tests/chat-cli.test.ts`, where they pinned `chat-cli.ts`'s own
 * (now-deleted) copy of this parser. The remaining tests pin the union
 * behavior this file's module docstring claims: identical results whether
 * `raw` carries surrounding whitespace (FR-4's untrimmed terminal answer) or
 * arrives already trimmed (FR-25's Claude-claimed value).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlanningFieldValue } from "../src/core/planning-field-value.ts";

test("parsePlanningFieldValue(estimatedDurationMinutes) accepts a positive whole number of minutes", () => {
  const result = parsePlanningFieldValue("estimatedDurationMinutes", "30");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 30);
});

test("parsePlanningFieldValue(estimatedDurationMinutes) rejects non-numeric, zero, negative, and fractional input", () => {
  for (const raw of ["not a number", "0", "-5", "12.5", ""]) {
    const result = parsePlanningFieldValue("estimatedDurationMinutes", raw);
    assert.equal(result.ok, false, `expected "${raw}" to be rejected`);
  }
});

test("parsePlanningFieldValue(area) accepts any non-blank free-form text", () => {
  const result = parsePlanningFieldValue("area", "  Health  ");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "Health");
});

test("parsePlanningFieldValue(area) rejects blank input", () => {
  const result = parsePlanningFieldValue("area", "   ");
  assert.equal(result.ok, false);
});

test("parsePlanningFieldValue(dueDate) accepts a YYYY-MM-DD date", () => {
  const result = parsePlanningFieldValue("dueDate", "2026-08-25");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "2026-08-25");
});

test("parsePlanningFieldValue(dueDate) rejects an unparseable or malformed date", () => {
  for (const raw of ["not a date", "08/25/2026", "2026-13-40", "2026-02-30"]) {
    const result = parsePlanningFieldValue("dueDate", raw);
    assert.equal(result.ok, false, `expected "${raw}" to be rejected`);
  }
});

test("parsePlanningFieldValue(status) accepts one of the fixed TaskStatus values, case/space-insensitively", () => {
  const result = parsePlanningFieldValue("status", "In Progress");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "in-progress");
});

test("parsePlanningFieldValue(status) rejects a value outside the fixed enum", () => {
  const result = parsePlanningFieldValue("status", "done-ish");
  assert.equal(result.ok, false);
});

test("parsePlanningFieldValue(energy) accepts one of the fixed Energy values, case-insensitively", () => {
  const result = parsePlanningFieldValue("energy", "HIGH");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "high");
});

test("parsePlanningFieldValue(energy) rejects a value outside the fixed enum", () => {
  const result = parsePlanningFieldValue("energy", "extreme");
  assert.equal(result.ok, false);
});

// ============================================================================
// Union behavior (Epic 6 retro F8): FR-4 (chat-cli.ts's old parseFieldAnswer)
// passed an untrimmed line straight from `io.readLine`; FR-25 (llm-adapter.ts's
// old parseSuggestedValue) passed an already-trimmed claimed value. Both
// origins must parse identically now that there is one function.
// ============================================================================

test("parsePlanningFieldValue accepts the same valid value whether raw carries surrounding whitespace (FR-4 style) or is already trimmed (FR-25 style)", () => {
  const cases: ReadonlyArray<{ field: Parameters<typeof parsePlanningFieldValue>[0]; raw: string; value: unknown }> = [
    { field: "estimatedDurationMinutes", raw: "30", value: 30 },
    { field: "area", raw: "Health", value: "Health" },
    { field: "dueDate", raw: "2026-08-25", value: "2026-08-25" },
    { field: "status", raw: "in-progress", value: "in-progress" },
    { field: "energy", raw: "high", value: "high" },
  ];
  for (const { field, raw, value } of cases) {
    const untrimmed = parsePlanningFieldValue(field, `  ${raw}  `);
    const trimmed = parsePlanningFieldValue(field, raw);
    assert.equal(untrimmed.ok, true, `expected padded "${raw}" to be accepted for ${field}`);
    assert.equal(trimmed.ok, true, `expected trimmed "${raw}" to be accepted for ${field}`);
    if (untrimmed.ok && trimmed.ok) {
      assert.equal(untrimmed.value, value);
      assert.equal(trimmed.value, value);
    }
  }
});

test("parsePlanningFieldValue rejects the same invalid value whether raw carries surrounding whitespace or is already trimmed", () => {
  const cases: ReadonlyArray<{ field: Parameters<typeof parsePlanningFieldValue>[0]; raw: string }> = [
    { field: "estimatedDurationMinutes", raw: "not a number" },
    { field: "dueDate", raw: "2026-02-30" },
    { field: "status", raw: "done-ish" },
    { field: "energy", raw: "extreme" },
  ];
  for (const { field, raw } of cases) {
    assert.equal(parsePlanningFieldValue(field, `  ${raw}  `).ok, false, `expected padded "${raw}" to be rejected for ${field}`);
    assert.equal(parsePlanningFieldValue(field, raw).ok, false, `expected trimmed "${raw}" to be rejected for ${field}`);
  }
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
node --test tests/planning-field-value.test.ts
```
Expected: `Cannot find module '../src/core/planning-field-value.ts'` (module doesn't exist yet).

- [ ] **Step 3: Implement**

Create `src/core/planning-field-value.ts`:

```ts
/**
 * src/core/planning-field-value.ts
 *
 * The ONE planning-field-value parser (Epic 6 retro item 7, findings F8/F9):
 * validates/coerces a raw string into the correctly-typed value for a given
 * `PlanningFieldNames` field, per each field's real type in
 * `types/domain.ts`. Used by BOTH:
 *  - `shell/chat-cli.ts`'s `answerDataCompletenessRequest` (FR-4: a typed
 *    answer to a blind "what's the Due Date?" ask) — which also wants the
 *    Spencer-facing rejection message this function returns.
 *  - `adapters/llm-adapter.ts`'s `suggestFieldValue` (FR-25: validating a
 *    value Claude claims to have confidently inferred from recent chat) —
 *    via an injected `parseValue` parameter, since AD-1 forbids `adapters/`
 *    importing from `core/`; `chat-cli.ts` passes a thin wrapper over this
 *    function that discards the message on a rejection.
 *
 * Before this file existed, `chat-cli.ts`'s `parseFieldAnswer` and
 * `llm-adapter.ts`'s `parseSuggestedValue` were two independent copies of
 * the same validation logic (Epic 6 retro F8) — the same fixed
 * TaskStatus/Energy enum lists, the same ISO-date-with-real-calendar-date
 * check, the same whole-number-minutes rule. Comparing both line-for-line
 * found NO behavioral disagreement between them: this function is their
 * exact union (every raw input either both accepted identically, or both
 * rejected). See `tests/planning-field-value.test.ts`.
 *
 * Pure (AD-2, AD-8): no I/O, no module state, never throws. `core/*.ts`
 * imports only `types/*.ts` and other `core/*.ts` (AD-1) — this file has no
 * other imports at all.
 */
import type { PlanningFieldNames, Task, TaskFieldOverride } from "../types/domain.ts";

/**
 * Result of parsing one raw string into the type a given planning field
 * actually needs. Discriminated on `ok` like `Result<T, YohError>`, but
 * deliberately its own (simpler) shape — this is input-parsing, not bound by
 * AD-8's `YohError` contract. `ok:false`'s `message` is written for Spencer
 * directly (FR-4's re-prompt text); FR-25's caller (`llm-adapter.ts`'s
 * `suggestFieldValue`, via its injected `parseValue`) discards it and
 * treats `ok:false` as "no confident inference," never surfacing why.
 */
export type PlanningFieldValueParseResult<F extends PlanningFieldNames> =
  | { readonly ok: true; readonly value: TaskFieldOverride[F] }
  | { readonly ok: false; readonly message: string };

const TASK_STATUSES: readonly Task["status"][] = ["not-started", "in-progress", "completed", "slipped"];
const ENERGIES: readonly Task["energy"][] = ["low", "medium", "high"];
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether `year`/`month`/`day` (1-indexed month) is a real calendar date —
 * rejects e.g. "2026-02-30", which `Date.parse`/`Date.UTC` alone would
 * silently roll over into March rather than reject (mirrors
 * `calendar-adapter.ts`'s own care around not trusting an unverified
 * roll-over).
 */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Parses a raw string into the correctly-typed value for `field`, per each
 * field's real type in `types/domain.ts` (Estimated Duration: a positive
 * whole number of minutes; Area: any non-blank free text, since it's
 * Spencer's own free-form Notion taxonomy; Due Date: an ISO-8601 calendar
 * date `YYYY-MM-DD`; Status/Energy: one of their fixed enum values, matched
 * case- and whitespace-insensitively for typing convenience). Rejects
 * (rather than guesses at) anything that doesn't parse cleanly.
 *
 * `raw` is trimmed internally, so it's safe to call with either an
 * untrimmed line straight from a terminal prompt (FR-4's
 * `answerDataCompletenessRequest`) or an already-trimmed value Claude
 * claimed (FR-25's `suggestFieldValue`) — both call shapes produce
 * identical results.
 */
export function parsePlanningFieldValue<F extends PlanningFieldNames>(
  field: F,
  raw: string,
): PlanningFieldValueParseResult<F> {
  const trimmed = raw.trim();
  switch (field) {
    case "estimatedDurationMinutes": {
      const minutes = Number(trimmed);
      if (trimmed.length === 0 || !Number.isInteger(minutes) || minutes <= 0) {
        return {
          ok: false,
          message: `I didn't understand "${raw}" as a whole number of minutes — try e.g. "30".`,
        };
      }
      return { ok: true, value: minutes as TaskFieldOverride[F] };
    }
    case "area": {
      if (trimmed.length === 0) {
        return { ok: false, message: "Area can't be blank — what should I call it?" };
      }
      return { ok: true, value: trimmed as TaskFieldOverride[F] };
    }
    case "dueDate": {
      const match = ISO_DATE_RE.exec(trimmed);
      const parsesAsRealDate =
        match !== null && isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
      if (!parsesAsRealDate) {
        return {
          ok: false,
          message: `I didn't understand "${raw}" as a date — use YYYY-MM-DD, e.g. "2026-08-25".`,
        };
      }
      return { ok: true, value: trimmed as TaskFieldOverride[F] };
    }
    case "status": {
      const normalized = trimmed.toLowerCase().replace(/\s+/g, "-");
      const match = TASK_STATUSES.find((status) => status === normalized);
      if (!match) {
        return {
          ok: false,
          message: `I didn't understand "${raw}" as a Status — try one of: ${TASK_STATUSES.join(", ")}.`,
        };
      }
      return { ok: true, value: match as TaskFieldOverride[F] };
    }
    case "energy": {
      const normalized = trimmed.toLowerCase();
      const match = ENERGIES.find((energy) => energy === normalized);
      if (!match) {
        return {
          ok: false,
          message: `I didn't understand "${raw}" as an Energy level — try one of: ${ENERGIES.join(", ")}.`,
        };
      }
      return { ok: true, value: match as TaskFieldOverride[F] };
    }
  }
}
```

- [ ] **Step 4: Run, verify pass; typecheck**

```bash
node --test tests/planning-field-value.test.ts
```
Expected: 12/12 pass (verified while writing this plan).

```bash
npm run typecheck
```
Expected: clean (no changes yet to any file this new module's exports aren't used by).

---

## Task 2: `llm-adapter.ts` — inject the parser into `suggestFieldValue`

**Files:**
- Modify: `src/adapters/llm-adapter.ts`, `tests/llm-adapter.test.ts`

**Interfaces:**
- Consumes: nothing from `core/` directly (AD-1 forbids it) — the injected `parseValue: ParsePlanningFieldValueFn` is the seam.
- Produces: `ParsePlanningFieldValueFn` (exported type), `suggestFieldValue`'s new 6th parameter.

- [ ] **Step 1: Write the failing test (Review Focus #3 — the injection seam)**

Add to `tests/llm-adapter.test.ts`, right after the `fakeClient` helper and before the existing `suggestFieldValue` describe block:

```ts
import { parsePlanningFieldValue } from "../src/core/planning-field-value.ts";
import type { ChatTurn, FieldValueSuggestion, PlanningFieldNames, Task } from "../src/types/domain.ts";

/**
 * The real production wrapper `shell/chat-cli.ts` injects into
 * `suggestFieldValue` (Epic 6 retro item 7) — using the REAL
 * `parsePlanningFieldValue` here, rather than a synthetic per-test fake,
 * proves the actual FR-25 <-> FR-4 integration contract, not just
 * `suggestFieldValue`'s own internal dispatch logic.
 */
function realParseValue(field: PlanningFieldNames, raw: string): NonNullable<Task[PlanningFieldNames]> | undefined {
  const parsed = parsePlanningFieldValue(field, raw);
  return parsed.ok ? (parsed.value as NonNullable<Task[PlanningFieldNames]>) : undefined;
}
```

(This replaces the existing `import type { ChatTurn, FieldValueSuggestion } from "../src/types/domain.ts";` line — widen it to also import `PlanningFieldNames, Task`, as shown.)

Then add this new test alongside the existing `suggestFieldValue` tests:

```ts
test("suggestFieldValue calls the injected parseValue with the trimmed claimed value, and trusts its result verbatim (Epic 6 retro item 7 — the injected-parser seam)", async () => {
  const { client } = fakeClient(textMessage("CONFIDENT:   42   | a fake parser gets the final say"));
  const parseValueCalls: Array<{ field: string; raw: string }> = [];
  const fakeParseValue = (field: PlanningFieldNames, raw: string): NonNullable<Task[PlanningFieldNames]> | undefined => {
    parseValueCalls.push({ field, raw });
    return "a completely different value" as unknown as NonNullable<Task[PlanningFieldNames]>;
  };
  const result = await suggestFieldValue(client, "t1", "Call dentist", "area", ["some message"], fakeParseValue);
  assert.deepEqual(parseValueCalls, [{ field: "area", raw: "42" }]);
  assert.equal(result?.value, "a completely different value", "suggestFieldValue must trust whatever parseValue returns, not re-derive it");
});
```

Also update the 5 existing `suggestFieldValue(...)` call sites to pass `realParseValue` as the 6th argument (they currently omit it, which will now be a type error):

```ts
// before: await suggestFieldValue(client, "t1", "Call dentist", "area", []);
const result = await suggestFieldValue(client, "t1", "Call dentist", "area", [], realParseValue);
```
Apply the same trailing `, realParseValue` addition to the other four existing call sites (`"...returns a FieldValueSuggestion for a CONFIDENT response..."`, `"...returns undefined for a plain NONE response"`, `"...never trusts a CONFIDENT value that doesn't parse..."`, `"...sends the joined recent messages..."`) — each currently ends its argument list with the `recentMessages` array; append `, realParseValue` after it.

- [ ] **Step 2: Run tests, verify they fail**

```bash
node --test tests/llm-adapter.test.ts
```
Expected: FAIL — `suggestFieldValue` doesn't accept a 6th argument yet, and the new test's `fakeParseValue` is unused by production code.

- [ ] **Step 3: Implement**

In `src/adapters/llm-adapter.ts`:

1. Narrow the top-of-file type import — remove `Energy` and `TaskStatus` (only used by the code being deleted below):
```ts
import type {
  ChatIntent,
  ChatTurn,
  ExternalId,
  FieldValueSuggestion,
  NotionDatabaseTarget,
  PlanningFieldNames,
  Task,
} from "../types/domain.ts";
```

2. Delete `SUGGEST_FIELD_VALUE_TASK_STATUSES`, `SUGGEST_FIELD_VALUE_ENERGIES`, `SUGGEST_FIELD_VALUE_ISO_DATE_RE`, and the whole `parseSuggestedValue` function (currently right after `SUGGEST_FIELD_VALUE_MAX_TOKENS`, immediately before `suggestFieldValue` itself).

3. Add the injected-parser type right after `SUGGEST_FIELD_VALUE_MAX_TOKENS`:
```ts
/**
 * The shape `suggestFieldValue` is injected with (Epic 6 retro item 7,
 * F8/F9) — `core/planning-field-value.ts`'s `parsePlanningFieldValue`,
 * validating/coercing Claude's claimed raw value into `field`'s real type.
 * AD-1 forbids this `adapters/*.ts` file from importing `core/*.ts`
 * directly, so `shell/chat-cli.ts` (which may import both) passes a thin
 * wrapper over `parsePlanningFieldValue` that discards the rejection
 * message: unlike FR-4's typed answer, an unparseable CONFIDENT claim never
 * surfaces to Spencer — it just means "no confident inference"
 * (`undefined`), falling back to the ordinary blind ask.
 */
export type ParsePlanningFieldValueFn = (
  field: PlanningFieldNames,
  raw: string,
) => NonNullable<Task[PlanningFieldNames]> | undefined;
```

4. Change `suggestFieldValue`'s signature and body to take and use `parseValue`:
```ts
/**
 * Attempts to confidently infer `field`'s value for Task `taskId`
 * (`taskTitle`) from `recentMessages` (Spencer's own recent chat lines,
 * oldest first). Returns `undefined` — never throws — for every "no
 * confident answer" case: no recent messages at all (a cheap short-circuit,
 * no API call made); a response that doesn't match the required
 * `CONFIDENT: <value> | <reason>` format; or a claimed value `parseValue`
 * rejects as invalid for `field` (never trusted blindly). A genuine
 * API/transport failure still propagates as a thrown error (AD-8) —
 * `chat-cli.ts` treats that identically to "no confident inference" at its
 * own call site.
 */
export async function suggestFieldValue(
  client: AnthropicMessagesClient,
  taskId: ExternalId,
  taskTitle: string,
  field: PlanningFieldNames,
  recentMessages: readonly string[],
  parseValue: ParsePlanningFieldValueFn,
): Promise<FieldValueSuggestion | undefined> {
  if (recentMessages.length === 0) return undefined;

  const message = await client.messages.create({
    model: CLAUDE_CHAT_MODEL_FAST,
    max_tokens: SUGGEST_FIELD_VALUE_MAX_TOKENS,
    system: buildSuggestFieldValueSystemPrompt(taskTitle, field),
    messages: [{ role: "user", content: recentMessages.join("\n") }],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const match = /^CONFIDENT:\s*(.+?)\s*\|\s*(.+)$/s.exec(text);
  if (!match) return undefined;

  const [, rawValue, rawReason] = match;
  const value = parseValue(field, rawValue!.trim());
  if (value === undefined) return undefined;

  return { taskId, taskTitle, field, value, reason: rawReason!.trim() };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
node --test tests/llm-adapter.test.ts
```
Expected: 35/35 pass (34 existing + 1 new — verified while writing this plan).

---

## Task 3: `chat-cli.ts` — `ChatCliDeps`, the FR-25 wrapper, and call-site updates

**Files:**
- Modify: `src/shell/chat-cli.ts`

**Interfaces:**
- Consumes: `parsePlanningFieldValue` (Task 1), `ParsePlanningFieldValueFn`-shaped `suggestFieldValue` (Task 2).
- Produces: `ChatCliDeps` (exported interface), `runChatCli(deps: ChatCliDeps): Promise<void>`.

- [ ] **Step 1: Add the import and delete the old parser block**

Add, alongside the other `core/*.ts` imports (right after the `MissingFieldReport` import):
```ts
import { parsePlanningFieldValue } from "../core/planning-field-value.ts";
```

Delete `chat-cli.ts:356-449` in full — this is the `FieldAnswerParseResult` type, `TASK_STATUSES`, `ENERGIES`, `ISO_DATE_RE`, `isRealCalendarDate`, and `parseFieldAnswer` — and replace it with the thin FR-25 wrapper:

```ts
/**
 * The thin wrapper `suggestFieldValue` (`llm-adapter.ts`, FR-25) is injected
 * with (Epic 6 retro item 7, F8/F9) — AD-1 forbids that `adapters/*.ts` file
 * from importing `core/planning-field-value.ts` directly, so this file,
 * which may import both, bridges them. Discards the Spencer-facing
 * rejection message: FR-25 treats an unparseable claimed value identically
 * to "no confident inference," never showing Spencer why (unlike FR-4's
 * `parsePlanningFieldValue` call below, which re-prompts with that exact
 * message).
 */
function suggestedFieldValueParser(
  field: PlanningFieldNames,
  raw: string,
): NonNullable<Task[PlanningFieldNames]> | undefined {
  const parsed = parsePlanningFieldValue(field, raw);
  return parsed.ok ? (parsed.value as NonNullable<Task[PlanningFieldNames]>) : undefined;
}
```

- [ ] **Step 2: Update the two call sites inside `answerDataCompletenessRequest`**

```ts
// before: suggestion = await suggestFieldValue(llmClient, report.taskId, report.taskTitle, field, recentMessages);
suggestion = await suggestFieldValue(llmClient, report.taskId, report.taskTitle, field, recentMessages, suggestedFieldValueParser);
```

```ts
// before: const parsed = parseFieldAnswer(field, answer);
const parsed = parsePlanningFieldValue(field, answer);
```

- [ ] **Step 3: Add `ChatCliDeps` and convert `runChatCli`'s signature**

Insert this interface right before `runChatCli`'s doc comment (currently starting "The REPL loop (Task 5, extended by...)"):

```ts
/**
 * `runChatCli`'s dependencies (Epic 6 retro item 7, F9 — replaces what used
 * to be 17 positional parameters, 7 of them added across Epic 6 alone).
 * Only `store`/`io`/`timeZone`/`llmClient` are required; every other field
 * is optional and defaults to the same throws-only-if-actually-invoked stub
 * it always has (see each default's own doc note below) — Tasks 2-5 extend
 * this interface with new optional fields as they move more of this file's
 * handlers into `app/`.
 */
export interface ChatCliDeps {
  readonly store: MemoryStore;
  readonly io: ChatCliIo;
  readonly timeZone: string;
  readonly llmClient: AnthropicMessagesClient;
  readonly now?: () => Date;
  readonly readTasks?: () => Promise<readonly Task[]>;
  readonly setTaskStatus?: SetTaskStatusFn;
  readonly updateTaskField?: UpdateTaskFieldFn;
  readonly createNotionPage?: CreateNotionPageFn;
  readonly validateNotionPageDraft?: ValidateNotionPageDraftFn;
  readonly searchFn?: SearchFn;
  readonly readCalendarEventsFn?: () => Promise<readonly CalendarEvent[]>;
  readonly resolveCalendarEditRouteFn?: ResolveCalendarEditRouteFn;
  readonly proposeCalendarEditFn?: ProposeCalendarEditFn;
  readonly applyCalendarEditFn?: ApplyCalendarEditFn;
  readonly recordCompletion?: RecordCompletionFn;
  readonly lookupTask?: LookupTaskFn;
}
```

Then replace `runChatCli`'s parameter list (everything from `export async function runChatCli(` through the closing `): Promise<void> {`) — the function **body is completely unchanged**, since every default keeps its original local variable name:

```ts
export async function runChatCli({
  store,
  io,
  timeZone,
  llmClient,
  now = () => new Date(),
  readTasks = () => {
    throw new Error("chat-cli: no readTasks dependency configured — cannot re-flow the day");
  },
  setTaskStatus = async () => {
    throw new Error("chat-cli: no setTaskStatus dependency configured — cannot record Night Ritual close-out");
  },
  updateTaskField = async () => {
    throw new Error("chat-cli: no updateTaskField dependency configured — cannot record a Data-Completeness answer in Notion");
  },
  createNotionPage = async () => {
    throw new Error("chat-cli: no createNotionPage dependency configured — cannot create a Notion item");
  },
  validateNotionPageDraft = async () => {
    throw new Error("chat-cli: no validateNotionPageDraft dependency configured — cannot validate a Notion item draft");
  },
  searchFn = async () => {
    throw new Error("chat-cli: no searchFn dependency configured — cannot run a web search");
  },
  readCalendarEventsFn = async () => {
    throw new Error("chat-cli: no readCalendarEventsFn dependency configured — cannot look up today's Calendar events");
  },
  resolveCalendarEditRouteFn = async () => {
    throw new Error("chat-cli: no resolveCalendarEditRouteFn dependency configured — cannot route a Calendar edit");
  },
  proposeCalendarEditFn = async () => {
    throw new Error("chat-cli: no proposeCalendarEditFn dependency configured — cannot propose a Calendar edit");
  },
  applyCalendarEditFn = async () => {
    throw new Error("chat-cli: no applyCalendarEditFn dependency configured — cannot apply a Calendar edit");
  },
  recordCompletion = () => {
    throw new Error("chat-cli: no recordCompletion dependency configured — cannot record a Night Ritual close-out completion");
  },
  lookupTask = async () => {
    throw new Error("chat-cli: no lookupTask dependency configured — cannot snapshot a close-out completion's Task fields");
  },
}: ChatCliDeps): Promise<void> {
  // ...unchanged body, starting with `const chatHistory: ChatTurn[] = [];`
```

- [ ] **Step 4: Update `main()`'s call site, and pin the omitted-dependency default (Review Focus #4)**

In `main()`, replace the positional call:
```ts
// before:
// await runChatCli(store, io, timeZone, llmClient, () => new Date(), readTasks, setTaskStatus, updateTaskField,
//   createNotionPage, validateNotionPageDraft, searchFn, readCalendarEventsFn, resolveCalendarEditRouteFn,
//   proposeCalendarEditFn, applyCalendarEditFn, recordCompletion, lookupTask);
await runChatCli({
  store,
  io,
  timeZone,
  llmClient,
  now: () => new Date(),
  readTasks,
  setTaskStatus,
  updateTaskField,
  createNotionPage,
  validateNotionPageDraft,
  searchFn,
  readCalendarEventsFn,
  resolveCalendarEditRouteFn,
  proposeCalendarEditFn,
  applyCalendarEditFn,
  recordCompletion,
  lookupTask,
});
```

- [ ] **Step 5: Fix the 2 stale doc-comment cross-references to the old function name, inside this same file**

```ts
// module docstring, "Answering a Data-Completeness prompt" paragraph:
// before: that field (`parseFieldAnswer`) — re-prompting, not silently storing
that field (`parsePlanningFieldValue`, `core/planning-field-value.ts`) — re-prompting, not silently storing
```
```ts
// answerDataCompletenessRequest's own doc comment:
// before: payload, in order. Each answer is parsed via `parseFieldAnswer` and, once
payload, in order. Each answer is parsed via `parsePlanningFieldValue` and, once
```

- [ ] **Step 6: Typecheck (expect only test-file errors)**

```bash
npm run typecheck
```
Expected at this point: `src/` compiles clean; every remaining error is in `tests/chat-cli.test.ts` (still on the old positional-call shape) — Task 4 fixes those.

---

## Task 4: Convert `tests/chat-cli.test.ts`'s call sites, and pin the regression tests

**Files:**
- Modify: `tests/chat-cli.test.ts`

- [ ] **Step 1: Remove the moved import and test block**

Remove `parseFieldAnswer` from the `chat-cli.ts` import list (currently right after `runChatCli,`):
```ts
// before:
//   surfaceOpenInteractionRequests,
//   runChatCli,
//   parseFieldAnswer,
//   parseTimeBudgetCommand,
  surfaceOpenInteractionRequests,
  runChatCli,
  parseTimeBudgetCommand,
```

Replace the `// parseFieldAnswer — per-field parsing/validation...` section (the 10 tests at `tests/chat-cli.test.ts:404-465`, between the `// ====` banners) with a one-line pointer:
```ts
// ============================================================================
// parsePlanningFieldValue moved to core/planning-field-value.ts and its own
// tests/planning-field-value.test.ts (Epic 6 retro item 7, F8/F9).
// ============================================================================
```

- [ ] **Step 2: Run the call-site codemod**

`runChatCli`'s ~59 call sites in this file are positional (many with trailing `undefined` placeholders skipping an optional parameter — a hand-edit of all 59 risks a silent transposition, Review Focus #5). Write this one-off codemod script to the repo root as `_codemod-runchatcli-deps.mjs`:

```js
import fs from "node:fs";

const FILE = "tests/chat-cli.test.ts";
const FIELD_NAMES = [
  "store",
  "io",
  "timeZone",
  "llmClient",
  "now",
  "readTasks",
  "setTaskStatus",
  "updateTaskField",
  "createNotionPage",
  "validateNotionPageDraft",
  "searchFn",
  "readCalendarEventsFn",
  "resolveCalendarEditRouteFn",
  "proposeCalendarEditFn",
  "applyCalendarEditFn",
  "recordCompletion",
  "lookupTask",
];

function splitTopLevelArgs(inner) {
  const args = [];
  let depth = 0;
  let cur = "";
  let i = 0;
  let inString = null;
  while (i < inner.length) {
    const ch = inner[i];
    if (inString) {
      cur += ch;
      if (ch === "\\") {
        i++;
        if (i < inner.length) cur += inner[i];
      } else if (ch === inString) {
        inString = null;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      cur += ch;
      i++;
      continue;
    }
    if ("([{".includes(ch)) {
      depth++;
      cur += ch;
      i++;
      continue;
    }
    if (")]}".includes(ch)) {
      depth--;
      cur += ch;
      i++;
      continue;
    }
    if (ch === "," && depth === 0) {
      args.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim().length > 0) args.push(cur);
  return args.map((a) => a.trim());
}

function findMatchingClose(src, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("unbalanced parens");
}

function transformCall(inner) {
  const args = splitTopLevelArgs(inner);
  const props = [];
  args.forEach((arg, idx) => {
    if (arg === "undefined") return; // omit — let the ChatCliDeps default apply
    const field = FIELD_NAMES[idx];
    if (!field) throw new Error(`too many positional args (${args.length}) — no field for index ${idx}: ${arg}`);
    if (arg === field) {
      props.push(field); // shorthand
    } else {
      props.push(`${field}: ${arg}`);
    }
  });
  return `{ ${props.join(", ")} }`;
}

let src = fs.readFileSync(FILE, "utf8");
const re = /\brunChatCli\(/g;
const replacements = [];
let m;
while ((m = re.exec(src))) {
  const openIndex = m.index + m[0].length - 1;
  const closeIndex = findMatchingClose(src, openIndex);
  const inner = src.slice(openIndex + 1, closeIndex);
  const newInner = transformCall(inner);
  replacements.push({ start: m.index, end: closeIndex + 1, text: `runChatCli(${newInner})` });
}

console.log(`found ${replacements.length} call sites`);

for (let i = replacements.length - 1; i >= 0; i--) {
  const r = replacements[i];
  src = src.slice(0, r.start) + r.text + src.slice(r.end);
}

fs.writeFileSync(FILE, src);
console.log("done");
```

Run it once, then delete it:
```bash
node _codemod-runchatcli-deps.mjs
```
Expected output: `found 59 call sites` / `done` (verified while writing this plan — the codemod is deterministic and idempotent-per-file; running it twice on an already-converted file finds 0 `runChatCli(` matches with positional args to convert, since every remaining call already uses object-literal syntax matching none of the bare `FIELD_NAMES` positions... in practice just run it once and delete it):
```bash
rm _codemod-runchatcli-deps.mjs
```

Every skipped (`undefined`) positional argument is **omitted from the object literal** rather than written as `field: undefined` — required because `tsconfig.json` sets `exactOptionalPropertyTypes: true`, under which explicitly assigning `undefined` to an optional property (`field?: T`, not `field?: T | undefined`) is a type error. Omitting the key entirely lets `ChatCliDeps`'s destructuring default apply exactly as the old positional default did.

- [ ] **Step 3: Add the new regression-pinning test (Review Focus #4)**

Add this test immediately after the existing `"runChatCli: Mid-Day Re-Flow trigger says so plainly when no Plan exists yet for today"` test (both exercise the Mid-Day Re-Flow path against a stored Plan):

```ts
test("ChatCliDeps (Epic 6 retro item 7): an omitted optional dependency still defaults to its original throws-only-if-invoked stub, surfaced as an honest error rather than a raw TypeError", async () => {
  const store = tempStore();
  const REFLOW_NOW = new Date("2026-08-22T18:00:00.000Z");
  const today = localIsoDate(REFLOW_NOW, TEST_TIME_ZONE);
  putTimeBudget(store, { date: today, totalMinutes: 480, workMinutes: 70, breakMinutes: 15 });
  putPlan(store, reflowSamplePlan(today, REFLOW_NOW.toISOString()));
  const io = makeScriptedIo(["reflow my day"]);

  // `readTasks` is deliberately omitted from this ChatCliDeps object — the
  // conversion from positional params to one object must still leave its
  // default (a stub that throws only once actually invoked) in place.
  await runChatCli({ store, io, timeZone: TEST_TIME_ZONE, llmClient: makeFakeLlmClient(), now: () => REFLOW_NOW });

  assert.ok(
    io.written.some((line) => line.includes("no readTasks dependency configured")),
    `expected the original default-stub message to surface, got: ${io.written.join(" | ")}`,
  );
  store.close();
});
```

- [ ] **Step 4: Run, verify pass — full-suite parity check (Review Focus #5)**

```bash
node --test tests/chat-cli.test.ts
```
Expected: **147/147 pass, 0 fail** (156 pre-existing in this file, minus the 10 moved out to `tests/planning-field-value.test.ts`, plus the 1 new default-throw test = 147; verified while writing this plan) — every one of the ~59 rewritten call sites' own assertions still passes byte-for-byte, which is the structural proof that no positional argument landed in the wrong named field.

```bash
node --test tests/planning-field-value.test.ts tests/llm-adapter.test.ts tests/chat-cli.test.ts
```
Expected: all green, no skips.

---

## Task 5: Doc-comment cleanup, full gate, sprint-status.yaml, commit

**Files:**
- Modify: `src/core/derived-priority.ts`, `src/core/time-budget.ts`, `src/rituals/night-ritual.ts` (doc comments only)
- Modify: `_bmad-output/implementation-artifacts/sprint-status.yaml`

- [ ] **Step 1: Fix the remaining stale doc-comment cross-references (no logic change)**

`grep -rn "parseFieldAnswer\|parseSuggestedValue" src tests web` at this point returns exactly 3 hits outside `chat-cli.ts` (already fixed in Task 3) and the new files (which correctly describe the history) — three files each reference the old `chat-cli.ts`'s `parseFieldAnswer` by name in a doc comment explaining a duplication:

`src/core/derived-priority.ts`:
```ts
// before: // shell/chat-cli.ts's parseFieldAnswer).
// core/planning-field-value.ts's parsePlanningFieldValue).
```

`src/core/time-budget.ts`:
```ts
// before:
//  * check `shell/chat-cli.ts`'s `parseFieldAnswer`/`isRealCalendarDate`
//  * already performs for a Task's Due Date (Task 5); duplicated here rather
//  * than imported, since `core/*.ts` must not depend on `shell/*.ts` (AD-2).
 * check `core/planning-field-value.ts`'s `parsePlanningFieldValue` already
 * performs for a Task's Due Date; duplicated here rather than imported,
 * since `core/*.ts` files don't depend on each other's internals per
 * AD-2/AD-9's file-ownership discipline.
```

`src/rituals/night-ritual.ts`:
```ts
// before: exactly the role `parseFieldAnswer` + the per-field
exactly the role `core/planning-field-value.ts`'s `parsePlanningFieldValue` + the per-field
```

- [ ] **Step 2: Confirm no dangling reference remains**

```bash
grep -rn "parseFieldAnswer\|parseSuggestedValue" src tests web
```
Expected: 0 hits outside `tests/planning-field-value.test.ts` (which correctly narrates the history in its own module doc comment) and `src/core/planning-field-value.ts` (same).

- [ ] **Step 3: Full gate**

```bash
npm run check
```
Expected (verified while writing this plan): typecheck clean; web typecheck clean; web build succeeds; **node tests 968/968 pass** (964 baseline + 4 net: +10 moved into `planning-field-value.test.ts`, +2 new union tests there, −10 moved out of `chat-cli.test.ts`, +1 new default-throw test in `chat-cli.test.ts`, +1 new parseValue-seam test in `llm-adapter.test.ts`); **web tests 149/149 pass, unchanged** (this task touches no `web/` file). Playwright is untouched (not part of `npm run check`; nothing in this task affects it).

- [ ] **Step 4: Update `sprint-status.yaml`**

In `_bmad-output/implementation-artifacts/sprint-status.yaml`, under `action_items`, change the one entry:
```yaml
  - id: "epic-6-retro-item-7-before-next-chat-command-epic-replace-ru"
    epic: 6
    action: "Before next chat-command epic: replace runChatCli positional deps with
      a deps object; extract shared planning-field value parser for FR-4/FR-25 (F8,
      F9)"
    owner: "Dev (Amelia)"
    status: done
    ref: "_bmad-output/implementation-artifacts/epic-6-retro-2026-09-24.md"
```
(Only `status: open` → `status: done` changes; everything else on this entry is unchanged.)

- [ ] **Step 5: Commit**

```bash
git add src/core/planning-field-value.ts tests/planning-field-value.test.ts \
  src/adapters/llm-adapter.ts tests/llm-adapter.test.ts \
  src/shell/chat-cli.ts tests/chat-cli.test.ts \
  src/core/derived-priority.ts src/core/time-budget.ts src/rituals/night-ritual.ts \
  _bmad-output/implementation-artifacts/sprint-status.yaml
git commit -m "$(cat <<'EOF'
refactor(epic-6-retro): item 7 — runChatCli deps object, one planning-field value parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## AC → step/test traceability table

("ACs" here are the sprint-status.yaml action item's own clauses plus the SDD plan Task 1 "Owns" line — there is no `epics.md` story for this retro item.)

| AC / requirement | Step | Test(s) |
|---|---|---|
| Extract one shared planning-field value parser for FR-4/FR-25 (F8) | Task 1, Steps 1-3 | 10 moved + 2 new tests in `tests/planning-field-value.test.ts` |
| The parser is the union of both original parsers' accepted inputs; any disagreement is pinned and reported | Task 1, Step 1 | `"...accepts the same valid value whether raw carries surrounding whitespace..."`, `"...rejects the same invalid value..."` — **no disagreement found**, reported in this plan's Global Constraints/Review Focus #1 |
| `llm-adapter.ts` cannot import `core/` — `suggestFieldValue` takes the parser as an injected parameter | Task 2, Steps 1-3 | `"suggestFieldValue calls the injected parseValue with the trimmed claimed value, and trusts its result verbatim..."` |
| Callers pass a thin wrapper over `parsePlanningFieldValue` | Task 3, Step 1 (`suggestedFieldValueParser`); Task 2, Step 1 (`realParseValue` in tests) | The 4 pre-existing FR-25 end-to-end tests in `tests/chat-cli.test.ts` (lines 555-619) continue to pass unchanged |
| Replace `runChatCli`'s positional deps with a deps object (F9) | Task 3, Steps 3-4 | Full `tests/chat-cli.test.ts` suite (147/147) |
| `ChatCliDeps` keeps required `store`/`io`/`timeZone`/`llmClient`, optional everything else, same throwing defaults | Task 3, Step 3; Task 4, Step 3 | `"ChatCliDeps (Epic 6 retro item 7): an omitted optional dependency still defaults to its original throws-only-if-invoked stub..."` |
| Pure refactor: every existing test passes unchanged in behavior | Task 4, Step 4; Task 5, Step 3 | `npm run check` — 968/968 node, 149/149 web |
| `sprint-status.yaml` action item → `done` in the same commit | Task 5, Steps 4-5 | n/a (process requirement, verified by reading the file after the edit) |
