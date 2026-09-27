/**
 * src/app/quick-add-normalize.ts
 *
 * Polish 4 Task 1: the app-layer orchestration around `adapters/llm-
 * adapter.ts`'s `normalizeQuickAddLine` — Spencer's actual raw quick-add
 * line, called ONLY by `app/create-task.ts`'s `createTask`, ONLY on submit
 * (never while typing), and ONLY when `core/quick-add.ts`'s deterministic
 * parse still left a field-like word sitting in the title
 * (`hasUnresolvedFieldWords`). This file owns everything the adapter call
 * itself can't (AD-1 forbids `adapters/*.ts` importing `core/*.ts`
 * directly — exactly the reason `adapters/llm-adapter.ts`'s own
 * `suggestFieldValue` takes an injected validator too):
 *
 *  - a hard 4-second timeout (`deps.timeoutMs`), so one slow Claude call
 *    never holds up creating the Task;
 *  - validating every claimed field against the REAL, live options
 *    (`core/planning-field-value.ts`'s `parsePlanningFieldValue`, plus an
 *    exact-option-name check for Area/Status) — an invalid or
 *    not-actually-live value is dropped, never guessed;
 *  - the one hard rule the deterministic parser also enforces: quick-add
 *    NEVER sets Status to Completed (or Slipped, which isn't a submit-time
 *    concept either) — dropped even if Claude answered it anyway.
 *
 * `deps.normalize` is the injection seam (AD-16's `(deps, input)` shape
 * still holds — this is a field ON `deps`, not a second parameter): tests
 * supply a fake here so this file's own tests, and `createTask`'s, never
 * make a real network call. A missing `deps.llmClient` (Claude not
 * configured) or ANY thrown error/timeout resolves to `{ok: false}` —
 * exactly the signal `createTask` reads to fall back to the deterministic
 * parse alone; the Task is still created either way.
 */
import { normalizeQuickAddLine, type AnthropicMessagesClient, type QuickAddLiveOptions } from "../adapters/llm-adapter.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { parsePlanningFieldValue } from "../core/planning-field-value.ts";
import { hasUnresolvedFieldWords, type QuickAddFields } from "../core/quick-add.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { Energy, IsoDate, Result, TaskFieldOptions, TaskStatus, YohError } from "../types/domain.ts";

export interface NormalizeQuickAddDeps {
  /** Absent: Claude isn't configured for this process — resolves to `{ok: false}` immediately, no call attempted. */
  readonly llmClient?: AnthropicMessagesClient;
  readonly connection?: SqliteConnection;
  readonly now: () => Date;
  readonly timeZone: string;
  /** Milliseconds before this gives up and falls back. Defaults to 4000 (the brief's "4s"). */
  readonly timeoutMs?: number;
  /** Injectable seam (tests only) — defaults to the real `normalizeQuickAddLine`. */
  readonly normalize?: typeof normalizeQuickAddLine;
}

export interface NormalizeQuickAddInput {
  readonly text: string;
  readonly options: TaskFieldOptions;
}

export interface NormalizeQuickAddOutput {
  /** `undefined` when Haiku's claimed title fails validation (empty, too long, or still carrying a field-like word) — `createTask` then keeps its own deterministic title untouched. */
  readonly title: string | undefined;
  readonly fields: QuickAddFields;
}

const DEFAULT_TIMEOUT_MS = 4000;
/** Never let quick-add's Haiku fallback set these — the same rule the deterministic parser enforces (`core/quick-add.ts`'s status-phrase rule never matches "done"/"completed" either). */
const DISALLOWED_HAIKU_STATUSES = new Set(["completed", "slipped"]);
/** Fix round 1: a title this long is almost certainly not a real title Claude read out of one quick-add line — reject rather than trust it verbatim. */
const MAX_HAIKU_TITLE_LENGTH = 200;

/**
 * Fix round 1: Haiku's claimed title was previously trusted verbatim on any
 * success — a model slip (over-trimming, rewording, or a field value it
 * just extracted left sitting in the title, e.g. "60 minutes" or "due
 * friday") would silently rename the Task with no check at all. Now:
 * trimmed, required non-blank and at most `MAX_HAIKU_TITLE_LENGTH` chars,
 * and required to contain none of the SAME field-like words the
 * deterministic parser's own trigger heuristic
 * (`core/quick-add.ts`'s `hasUnresolvedFieldWords`) watches for — reusing
 * that one detector rather than a second, separately-maintained pattern
 * list. Any failure returns `undefined`; `createTask` keeps its own
 * deterministic title in that case.
 */
function validatedHaikuTitle(rawTitle: string | undefined): string | undefined {
  if (rawTitle === undefined) return undefined;
  const trimmed = rawTitle.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_HAIKU_TITLE_LENGTH) return undefined;
  if (hasUnresolvedFieldWords(trimmed)) return undefined;
  return trimmed;
}

function timeoutAfter(ms: number): Promise<undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    // Never keeps the process alive on its own — this is a fallback race, not a scheduled job.
    timer.unref?.();
  });
}

/** Exact, case-insensitive match against a live option list — never a prefix/typo match (Claude already saw the exact live names in its own prompt). */
function matchLiveOption(raw: string, liveOptions: readonly string[]): string | undefined {
  const needle = raw.trim().toLowerCase();
  return liveOptions.find((o) => o.trim().toLowerCase() === needle);
}

export async function normalizeQuickAdd(deps: NormalizeQuickAddDeps, input: NormalizeQuickAddInput): Promise<Result<NormalizeQuickAddOutput, YohError>> {
  if (!deps.llmClient) {
    return { ok: false, error: { kind: "missing-field", message: "quick-add-normalize: no LLM client configured" } };
  }

  const normalize = deps.normalize ?? normalizeQuickAddLine;
  const today = localIsoDate(deps.now(), deps.timeZone);
  const liveOptions: QuickAddLiveOptions = {
    energy: input.options.energy.map((o) => o.label),
    status: input.options.status.map((o) => o.label),
    ...(input.options.area ? { area: input.options.area } : {}),
    ...(input.options.priority && input.options.priority.length > 0 ? { priority: input.options.priority } : {}),
  };
  const llmClient = deps.llmClient;

  let raw;
  try {
    raw = await Promise.race([normalize(llmClient, input.text, today, deps.timeZone, liveOptions, deps.connection), timeoutAfter(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)]);
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: `quick-add-normalize: ${err instanceof Error ? err.message : String(err)}` } };
  }
  if (raw === undefined) {
    return { ok: false, error: { kind: "unreachable", message: "quick-add-normalize: no usable response (timeout or empty)" } };
  }

  const fields: { -readonly [K in keyof QuickAddFields]?: QuickAddFields[K] } = {};

  if (raw.dueDate !== undefined) {
    const parsed = parsePlanningFieldValue("dueDate", raw.dueDate);
    if (parsed.ok && parsed.value !== undefined) fields.dueDate = parsed.value as IsoDate;
  }
  if (raw.estimatedDurationMinutes !== undefined) {
    const parsed = parsePlanningFieldValue("estimatedDurationMinutes", raw.estimatedDurationMinutes);
    if (parsed.ok && parsed.value !== undefined) fields.estimatedDurationMinutes = parsed.value as number;
  }
  if (raw.energy !== undefined) {
    const parsed = parsePlanningFieldValue("energy", raw.energy);
    if (parsed.ok && parsed.value !== undefined) fields.energy = parsed.value as Energy;
  }
  if (raw.status !== undefined) {
    const parsed = parsePlanningFieldValue("status", raw.status);
    if (parsed.ok && parsed.value !== undefined && !DISALLOWED_HAIKU_STATUSES.has(parsed.value)) fields.status = parsed.value as TaskStatus;
  }
  if (raw.area !== undefined) {
    if (liveOptions.area === undefined) {
      // Area is a free-text property on this workspace — no live option list to check against.
      fields.area = raw.area;
    } else {
      const matched = matchLiveOption(raw.area, liveOptions.area);
      if (matched !== undefined) fields.area = matched;
    }
  }
  if (raw.priority !== undefined && liveOptions.priority !== undefined) {
    // Task 7 binding ruling: Priority is a string equal to the live option
    // name, validated the SAME exact/case-insensitive way Area is above —
    // never a `PlanningFieldNames`/parsePlanningFieldValue case.
    const matched = matchLiveOption(raw.priority, liveOptions.priority);
    if (matched !== undefined) fields.priority = matched;
  }

  return { ok: true, value: { title: validatedHaikuTitle(raw.title), fields } };
}
