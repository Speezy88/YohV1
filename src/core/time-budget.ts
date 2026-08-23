/**
 * src/core/time-budget.ts
 *
 * The Time Budget declare/persist story (Story 1.6 / FR-5, FR-7). Per AD-2
 * (core purity) and AD-8 (Result types), this is a pure `core/*.ts` module:
 * no I/O, no module-level mutable state, same inputs always produce the same
 * outputs, and it never throws — it always returns `Result<T, YohError>`. It
 * does NOT call `memory-store.ts` itself and does not persist anything —
 * per this task's Implementer note, the actual read/write against
 * `memory-store.ts` happens in `shell/chat-cli.ts`'s thin wiring function
 * (`declareTimeBudget`), which calls `shapeDeclaredTimeBudget` below and only
 * then persists the result.
 *
 * Two pure responsibilities live here:
 *
 *  1. `shapeDeclaredTimeBudget` — validates and shapes a raw declared value
 *     (a total number of minutes, plus optional work/break rhythm overrides)
 *     into a full `TimeBudget` per `types/domain.ts`, defaulting the
 *     work/break rhythm to 70/15 (that type's own documented default,
 *     FR-6–FR-8) when Spencer only declares a total.
 *
 *  2. `resolveTodayTimeBudget` — the Implementer note's "computes 'does
 *     today already have one carried forward'": given whatever `TimeBudget`
 *     is currently stored (or none) and today's date, reports whether that
 *     stored value was declared on a prior day (`carriedForward: true`) or
 *     freshly declared today (`carriedForward: false`) — without ever
 *     changing, resetting, or expiring the value itself. This is what makes
 *     "persists day-to-day, including weekends, until explicitly changed
 *     again" hold: this function only *reports* staleness-by-date, it never
 *     acts on it. See `adapters/memory-store.ts`'s Time Budget section for
 *     why the storage layer itself has no per-day expiry to report against
 *     in the first place.
 */
import type { IsoDate, Result, TimeBudget, YohError } from "../types/domain.ts";

// ============================================================================
// Defaults (FR-6–FR-8's documented 70/15 work/break rhythm)
// ============================================================================

/** Default per-block work-segment length (minutes), per `TimeBudget`'s own doc comment in `types/domain.ts` ("defaulting to 70/15"). */
export const DEFAULT_WORK_MINUTES = 70;

/** Default per-block break-segment length (minutes), per `TimeBudget`'s own doc comment in `types/domain.ts` ("defaulting to 70/15"). */
export const DEFAULT_BREAK_MINUTES = 15;

/**
 * Upper bound on a single day's declared Time Budget: 24 hours. Documented
 * choice (not dictated by the spine) — a Time Budget is "available time
 * today" (FR-5), and no single calendar day has more than 1440 minutes in
 * it, so anything above that is a mis-declaration (e.g. an accidental extra
 * digit) rather than a legitimate value worth persisting.
 */
const MAX_TOTAL_MINUTES = 24 * 60;

// ============================================================================
// shapeDeclaredTimeBudget — validate/shape a declared Time Budget value
// ============================================================================

/**
 * Raw input to `shapeDeclaredTimeBudget`: what a caller (`shell/chat-cli.ts`,
 * after parsing Spencer's chat command) has extracted from Spencer's
 * declaration, before it's validated/shaped into a real `TimeBudget`.
 */
export interface DeclareTimeBudgetInput {
  /** Spencer's declared total available minutes for `date`. */
  readonly totalMinutes: number;
  /** The calendar date this declaration is for (ISO-8601, `YYYY-MM-DD`) — ordinarily "today" as the caller computes it, threaded in explicitly here since this module must stay I/O-free (no reading the system clock itself). */
  readonly date: IsoDate;
  /** Overrides `DEFAULT_WORK_MINUTES` if provided; no later task currently lets Spencer set this via chat, but the shape supports it. */
  readonly workMinutes?: number;
  /** Overrides `DEFAULT_BREAK_MINUTES` if provided; see `workMinutes` above. */
  readonly breakMinutes?: number;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether `value` is both `YYYY-MM-DD`-shaped and a calendar date that
 * actually exists — rejects e.g. `"2026-02-30"`, which `Date.UTC` alone
 * would silently roll over into March rather than reject. Mirrors the same
 * check `shell/chat-cli.ts`'s `parseFieldAnswer`/`isRealCalendarDate`
 * already performs for a Task's Due Date (Task 5); duplicated here rather
 * than imported, since `core/*.ts` must not depend on `shell/*.ts` (AD-2).
 */
function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validationError(message: string, detail?: unknown): Result<never, YohError> {
  return { ok: false, error: { kind: "validation", message, detail } };
}

/**
 * Validates and shapes a raw declared Time Budget into the real `TimeBudget`
 * shape `types/domain.ts` defines. Rejects (rather than clamps or guesses
 * at) anything that doesn't parse cleanly — a whole positive number of
 * minutes no greater than 24 hours, a real ISO calendar date, and (if
 * overridden) positive whole-minute work/break segment lengths — so the
 * caller (`shell/chat-cli.ts`) can surface a clear error instead of silently
 * persisting a nonsensical budget (e.g. a negative or fractional-minute
 * value).
 */
export function shapeDeclaredTimeBudget(input: DeclareTimeBudgetInput): Result<TimeBudget, YohError> {
  const { totalMinutes, date } = input;

  if (!Number.isInteger(totalMinutes) || totalMinutes <= 0) {
    return validationError(
      `time-budget: totalMinutes must be a positive whole number of minutes, got ${totalMinutes}`,
      { totalMinutes },
    );
  }
  if (totalMinutes > MAX_TOTAL_MINUTES) {
    return validationError(
      `time-budget: totalMinutes cannot exceed ${MAX_TOTAL_MINUTES} (24 hours), got ${totalMinutes}`,
      { totalMinutes },
    );
  }
  if (!isValidIsoDate(date)) {
    return validationError(`time-budget: "${date}" is not a valid ISO-8601 calendar date (YYYY-MM-DD)`, { date });
  }

  const workMinutes = input.workMinutes ?? DEFAULT_WORK_MINUTES;
  if (!Number.isInteger(workMinutes) || workMinutes <= 0) {
    return validationError(`time-budget: workMinutes must be a positive whole number of minutes, got ${workMinutes}`, {
      workMinutes,
    });
  }

  const breakMinutes = input.breakMinutes ?? DEFAULT_BREAK_MINUTES;
  if (!Number.isInteger(breakMinutes) || breakMinutes <= 0) {
    return validationError(
      `time-budget: breakMinutes must be a positive whole number of minutes, got ${breakMinutes}`,
      { breakMinutes },
    );
  }

  return { ok: true, value: { date, totalMinutes, workMinutes, breakMinutes } };
}

// ============================================================================
// resolveTodayTimeBudget — "does today already have a carried-forward value"
// ============================================================================

/**
 * Result of `resolveTodayTimeBudget`: `budget` is always the stored value
 * verbatim (never altered by crossing a day boundary — no different default,
 * no reset), and `carriedForward` reports whether `budget.date` is a day
 * other than `today` — i.e. Spencer declared it on some earlier day (maybe
 * across a weekend) and hasn't changed it since.
 */
export interface TimeBudgetCarryForwardStatus {
  readonly budget: TimeBudget;
  readonly carriedForward: boolean;
}

/**
 * Given whatever `TimeBudget` `memory-store.ts` currently has on file (or
 * `undefined`, if Spencer has never declared one) and today's date, reports
 * today's effective Time Budget and whether it's a carried-forward value
 * from a prior day. This function only classifies — it never mutates,
 * resets, or expires anything; per this story's acceptance criteria, a
 * declared value "persists as today's Time Budget until Spencer explicitly
 * changes it again — it never silently reverts to a different default," so
 * there is deliberately no "too old, fall back to a default" branch here.
 */
export function resolveTodayTimeBudget(
  stored: TimeBudget | undefined,
  today: IsoDate,
): TimeBudgetCarryForwardStatus | undefined {
  if (!stored) return undefined;
  return { budget: stored, carriedForward: stored.date !== today };
}
