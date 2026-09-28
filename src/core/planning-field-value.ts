/**
 * src/core/planning-field-value.ts
 *
 * The ONE planning-field-value parser (Epic 6 retro item 7, findings F8/F9):
 * validates/coerces a raw string into the correctly-typed value for a given
 * `PlanningFieldNames` field, per each field's real type in
 * `types/domain.ts`. Used by BOTH:
 *  - `app/answer-data-completeness.ts`'s `answerDataCompleteness` (FR-4: a
 *    typed answer to a blind "what's the Due Date?" ask; Story 8.9:
 *    originally `shell/chat-cli.ts`'s `answerDataCompletenessRequest`) —
 *    which also wants the Spencer-facing rejection message this function
 *    returns.
 *  - `adapters/llm-adapter.ts`'s `suggestFieldValue` (FR-25: validating a
 *    value Claude claims to have confidently inferred from recent chat) —
 *    via an injected `parseValue` parameter, since AD-1 forbids `adapters/`
 *    importing from `core/`; `app/surface-open-items.ts` (Story 8.9:
 *    originally `chat-cli.ts`) passes a thin wrapper over this
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
 * Human-readable labels for `PlanningFieldNames`, used only in prompt/question
 * text (FR-4's blind ask, FR-25's suggest question, `rituals/data-
 * completeness.ts`'s combined prompt) — the gate itself
 * (`core/data-completeness-gate.ts`) stays presentation-agnostic per its
 * Implementer note. Single definition (Story 8.1 review fix): this used to
 * live in `rituals/data-completeness.ts`, which `core/open-item-questions.ts`
 * then had to import — violating "`core/` imports only `types/` and other
 * `core/`" (AD-1). Moved here so every `core/`/`app/`/`rituals/` consumer
 * shares the one definition; `rituals/data-completeness.ts` re-imports it
 * (`rituals -> core` is permitted).
 */
export const PLANNING_FIELD_LABELS: Record<PlanningFieldNames, string> = {
  estimatedDurationMinutes: "Estimated Duration",
  area: "Area",
  dueDate: "Due Date",
  status: "Status",
  energy: "Energy",
};

const PLANNING_FIELDS = Object.keys(PLANNING_FIELD_LABELS) as PlanningFieldNames[];

/**
 * Final-review MUST-FIX 1: the ONE predicate for "this Task is still open" —
 * used to be inlined as `task.status === "completed"` only inside
 * `taskMissingFields` below, but Epic 9's Data-Completeness Gate
 * (`core/data-completeness-gate.ts`) no longer treats Status as a gate
 * field, so `app/sandbox-queue.ts` and `rituals/morning-ritual.ts`'s
 * needs-data notification both need the same "exclude completed" rule the
 * Tasks-page badges already had, without duplicating it.
 */
export function isOpenTask(task: Task): boolean {
  return task.status !== "completed";
}

/**
 * Real-use fixes plan, Task 2: the ONE rule for "this open Task is missing
 * planning data" — a not-Completed Task with at least one undefined
 * planning field. `app/tasks-view.ts`'s `listTasks` calls this for every
 * row's `missing` list (the Tasks page's per-row "Add …" badges, and the
 * toolbar's "Missing data" toggle filters on the same list client-side) —
 * moved here, not kept in `app/tasks-view.ts` itself, since AD-16 requires
 * every `app/*.ts` export to be `(deps, input) => Promise<Result<…>>`, and
 * this is a plain, pure, synchronous helper.
 */
export function taskMissingFields(task: Task): readonly PlanningFieldNames[] {
  // A completed Task needs nothing more to be planned, so it carries no "Add …" badges.
  return isOpenTask(task) ? PLANNING_FIELDS.filter((field) => task[field] === undefined) : [];
}

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

/**
 * Task 7 (Priority field): the word part of a Notion select option label —
 * everything after any leading emoji/punctuation ("🔴 High" -> "High"),
 * lowercased and trimmed. Used both to build the match key for a live
 * option and to normalize `raw` the same way, so the emoji is optional on
 * either side and matching is case-insensitive.
 */
function priorityWordPart(label: string): string {
  return label.replace(/^[^\p{L}\p{N}]+/u, "").trim().toLowerCase();
}

/**
 * Parses `raw` into one of Priority's LIVE Notion select options (binding
 * ruling: Priority is not a `PlanningFieldNames` case — its value is a
 * string equal to the live option name, like Area, validated against
 * `options` rather than a fixed enum). Matches on the option's word part
 * only: the emoji is optional on `raw` and irrelevant on the option side,
 * and comparison is case-insensitive. Returns the REAL live option string
 * (with its emoji) on a match, never `raw` itself.
 */
export function parsePriorityValue(raw: string, options: readonly string[]): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "Priority can't be blank." };
  }
  const needle = priorityWordPart(trimmed);
  const match = options.find((option) => priorityWordPart(option) === needle);
  if (!match) {
    return {
      ok: false,
      message: `I didn't understand "${raw}" as a Priority — try one of: ${options.join(", ")}.`,
    };
  }
  return { ok: true, value: match };
}
