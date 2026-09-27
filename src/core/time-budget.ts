/**
 * src/core/time-budget.ts
 *
 * The Time Budget declare/persist story (Story 1.6 / FR-5, FR-7). Per AD-2
 * (core purity) and AD-8 (Result types), this is a pure `core/*.ts` module:
 * no I/O, no module-level mutable state, same inputs always produce the same
 * outputs, and it never throws — it always returns `Result<T, YohError>`. It
 * does NOT call `memory-store.ts` itself and does not persist anything —
 * per this task's Implementer note, the actual read/write against
 * `memory-store.ts` happens in `app/time-budget.ts`'s thin wiring function
 * (`declareTimeBudget`; Story 8.3: originally `shell/chat-cli.ts`'s), which
 * calls `shapeDeclaredTimeBudget` below and only
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
 *
 *  3. `nextTimeBudgetDeferralStreak` / `buildTimeBudgetChangeProposal` —
 *     Task 23 / Story 4.2 (AD-3, Propose-Don't-Impose) makes real what Task
 *     6's own AC explicitly deferred: "it is returned as a `Proposal<T>` ...
 *     rather than applied directly — this story only covers Spencer's own
 *     explicit declaration path, not proposal application (Epic 4)." The
 *     genuine signal is `core/work-break-fit.ts`'s `deferredTaskIds`, already
 *     computed every day by `rituals/morning-ritual.ts`: Tasks that keep
 *     getting deferred because they don't fit the declared budget, day after
 *     day, is real evidence the budget itself might be too small — not a
 *     guess about Spencer's unstated preferences (the kind of "learned
 *     behavioral pattern" this task's own brief explicitly scopes OUT).
 *
 *     Both functions stay pure (AD-2): `nextTimeBudgetDeferralStreak` turns
 *     "did today defer anything" plus yesterday's streak into today's streak
 *     (no I/O — the actual read/write of that streak against
 *     `memory-store.ts` is `rituals/morning-ritual.ts`'s job, mirroring this
 *     file's own `shapeDeclaredTimeBudget`/`declareTimeBudget` split), and
 *     `buildTimeBudgetChangeProposal` turns a streak that has met the
 *     threshold into a real `Proposal<Partial<TimeBudget>>` — never applies
 *     anything itself. Persisting that Proposal as an open interaction
 *     request is still `rituals/morning-ritual.ts`'s own job (its fixed
 *     `TIME_BUDGET_PROPOSAL_REQUEST_ID`, not `app/open-proposal.ts`'s
 *     generic path); the later confirm/apply pathway is
 *     `app/confirm-proposal.ts`'s `confirmProposal` (Story 8.2: originally
 *     `shell/chat-cli.ts`'s own `apply(proposal)`, per AD-3's "only
 *     `chat-cli.ts` ... calls `apply(proposal)`" — now the single confirm
 *     path for every surface).
 */
import type { IsoDate, IsoDateTime, Proposal, Result, TimeBudget, YohError } from "../types/domain.ts";

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
 * Raw input to `shapeDeclaredTimeBudget`: what a caller (`app/time-budget.ts`'s
 * `declareTimeBudget`, after `core/chat-commands.ts`'s
 * `parseTimeBudgetCommand` parses Spencer's chat command — Story 8.3:
 * originally `shell/chat-cli.ts`) has extracted from Spencer's
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
 * check `core/planning-field-value.ts`'s `parsePlanningFieldValue` already
 * performs for a Task's Due Date; duplicated here rather than imported,
 * since `core/*.ts` files don't depend on each other's internals per
 * AD-2/AD-9's file-ownership discipline.
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
 * caller (`app/time-budget.ts`; Story 8.3: originally `shell/chat-cli.ts`)
 * can surface a clear error instead of silently
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

// ============================================================================
// Time-Budget-change Proposal (Task 23 / Story 4.2, AD-3) — the real
// suggestion mechanism Task 6's own AC deferred. See the module docstring's
// item 3 above for the full design rationale.
// ============================================================================

/**
 * A day-over-day streak of "at least one Task got deferred because it
 * didn't fit the declared Time Budget" — the raw signal
 * `buildTimeBudgetChangeProposal` below decides whether to act on.
 * Deliberately the caller's own plain shape (not imported from
 * `adapters/memory-store.ts`, which structurally mirrors this exact shape as
 * its own `TimeBudgetDeferralStreak` — `core/*.ts` may import only from
 * `types/` per AD-1/AD-2, never from `adapters/`) — the same "small,
 * deliberate duplication" convention `resolveTodayTimeBudget`'s own doc
 * comment already documents for `isValidIsoDate`.
 */
export interface TimeBudgetDeferralStreakSnapshot {
  /** How many days in a row (see `nextTimeBudgetDeferralStreak`'s own doc comment for exactly what "in a row" means here) at least one Task has been deferred for not fitting the budget. */
  readonly consecutiveDeferralDays: number;
  /** The most recent date this streak advanced on. */
  readonly lastDeferralDate: IsoDate;
}

/**
 * Computes today's deferral streak from yesterday's (or `undefined`, if none
 * is stored yet) and whether today's own run deferred at least one Task.
 *
 * **What "consecutive" means here (a documented simplifying choice).** This
 * function does NOT check that `previous.lastDeferralDate` is the calendar
 * day immediately before `today` — it only checks whether `today` already
 * matches it (the idempotent-re-entry case below). `rituals/morning-ritual.ts`
 * calls this at most once per calendar day, guarded by its own "already ran
 * today" idempotence check, so under NORMAL operation (the ritual actually
 * running once a day, every day) "consecutive calls that each found a
 * deferral" and "consecutive calendar days" are the same thing. If the
 * ritual genuinely misses a day (the cron didn't fire, a prior step failed
 * before reaching this one), this function has no way to distinguish that
 * from a day with no deferrals — and, per the "reasonable-default" spirit
 * FR-2/FR-11's own tunables document, counting "consecutive triggered runs"
 * rather than attempting (and getting subtly wrong) calendar-adjacency
 * arithmetic is the honest, defensible choice: it never OVERcounts a streak
 * across a genuine gap, since a day with `hadDeferralsToday: false` always
 * resets to `undefined` regardless of dates.
 *
 * A day with `hadDeferralsToday: false` clears the streak entirely
 * (returns `undefined`) rather than pausing or decrementing it — mirroring
 * `adapters/memory-store.ts`'s `clearSlip` precedent for "a Task slipped once
 * and then completes ... cleared, not carried indefinitely": one day where
 * everything fit is real evidence the budget is (at least for that day)
 * sufficient, so an old streak should not silently resume counting from
 * where it left off if deferrals start again later — a fresh streak is more
 * honest than a stale one.
 *
 * Calling this again for the SAME `today` it already advanced to (e.g. a
 * second Morning Ritual trigger the same day, before the ran-today marker
 * was written) is a no-op — returns `previous` unchanged rather than
 * double-incrementing — the same idempotent-per-date guarantee
 * `memory-store.ts`'s `recordSlip` already documents for its own
 * once-per-date primitive.
 */
export function nextTimeBudgetDeferralStreak(
  previous: TimeBudgetDeferralStreakSnapshot | undefined,
  today: IsoDate,
  hadDeferralsToday: boolean,
): TimeBudgetDeferralStreakSnapshot | undefined {
  if (!hadDeferralsToday) return undefined;
  if (previous?.lastDeferralDate === today) return previous;
  return { consecutiveDeferralDays: (previous?.consecutiveDeferralDays ?? 0) + 1, lastDeferralDate: today };
}

/**
 * Starting threshold (a tunable, documented default, consistent with this
 * project's established style for FR-2's even-split weights and FR-11's
 * slip curve): once a Time-Budget-deferral streak reaches this many
 * consecutive days, it is a real enough pattern to propose raising the
 * budget — rather than reacting to a single unlucky day (an unusually large
 * Task, a one-off busy day), which is normal and not itself evidence the
 * DECLARED budget is wrong.
 */
export const DEFERRAL_STREAK_PROPOSAL_THRESHOLD_DAYS = 3;

/**
 * How much larger a suggested Time Budget is than the current one: +20%,
 * rounded UP to the nearest 5 minutes (so the suggestion is never smaller
 * than a genuine 20% increase, and always lands on a "round" number Spencer
 * can read at a glance) — another documented starting value in this
 * project's established tunable-constant style, not derived from any
 * formula. A flat percentage (rather than a fixed-minutes bump) scales
 * proportionally with however large Spencer's declared day already is,
 * mirroring `core/work-break-fit.ts`'s own choice to keep the work/break
 * RATIO fixed while `totalMinutes` varies.
 */
export const TIME_BUDGET_PROPOSAL_INCREASE_RATIO = 0.2;

/**
 * The fixed entity id every Time-Budget-change `Proposal` names —
 * duplicated from `adapters/memory-store.ts`'s own `TIME_BUDGET_ID`
 * constant (`"current"`) rather than imported, for the same AD-1/AD-2
 * layering reason `TimeBudgetDeferralStreakSnapshot`'s own doc comment
 * gives: `core/*.ts` may not import from `adapters/*.ts`. `Proposal.entityId`
 * itself is documentation only in this codebase's actual usage —
 * `confirmProposal`'s `TimeBudget` accessor (`app/confirm-proposal.ts`;
 * Story 8.2: originally `shell/chat-cli.ts`'s `apply`) re-reads the live
 * singleton Time Budget row directly, never by parsing this id back apart —
 * but it is
 * exported here so a test (or a future caller) can assert on it without
 * hardcoding the literal string a second time.
 */
export const TIME_BUDGET_PROPOSAL_ENTITY_ID = "current";

function formatMinutesLabel(totalMinutes: number): string {
  const hours = totalMinutes / 60;
  const hoursLabel = Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}h`;
  return `${totalMinutes} minutes (${hoursLabel})`;
}

/**
 * `currentBudget.totalMinutes` increased by `TIME_BUDGET_PROPOSAL_INCREASE_RATIO`,
 * rounded up to the nearest 5 minutes, and capped at `MAX_TOTAL_MINUTES` (24
 * hours — the same ceiling `shapeDeclaredTimeBudget` enforces on Spencer's
 * own explicit declarations, so a Proposal this function builds can never
 * suggest a value `shapeDeclaredTimeBudget`/`apply` would itself reject).
 */
function computeIncreasedTotalMinutes(currentTotalMinutes: number): number {
  const raw = currentTotalMinutes * (1 + TIME_BUDGET_PROPOSAL_INCREASE_RATIO);
  const roundedUpToFive = Math.ceil(raw / 5) * 5;
  return Math.min(roundedUpToFive, MAX_TOTAL_MINUTES);
}

/** Input to `buildTimeBudgetChangeProposal`. */
export interface BuildTimeBudgetChangeProposalInput {
  /** Today's currently-stored `TimeBudget` (per `memory-store.ts`'s `getCurrentTimeBudget`) — the entity a resulting Proposal would change. */
  readonly currentBudget: TimeBudget;
  /** That same stored record's `StoredRecord.version` (a plain `number` in `memory-store.ts`) — snapshotted into `Proposal.entityVersion` (a `string`, per that field's own type) for `apply`'s later staleness check. */
  readonly currentBudgetVersion: number;
  /** Today's deferral streak, per `nextTimeBudgetDeferralStreak` above. */
  readonly streak: TimeBudgetDeferralStreakSnapshot;
  /** Stamped onto the resulting `Proposal.createdAt` verbatim — threaded in explicitly (never `new Date()` internally) per this file's own I/O-free contract. */
  readonly createdAt: IsoDateTime;
}

/**
 * Builds a `Proposal<Partial<TimeBudget>>` suggesting a larger Time Budget,
 * once `input.streak.consecutiveDeferralDays` has reached
 * `DEFERRAL_STREAK_PROPOSAL_THRESHOLD_DAYS` — never applies anything itself
 * (AD-3): the caller (`rituals/morning-ritual.ts`) persists the result as an
 * open interaction request, and only `app/confirm-proposal.ts`'s
 * `confirmProposal` (Story 8.2: originally `shell/chat-cli.ts`'s
 * `apply(proposal)`), after Spencer's explicit yes/no, ever changes the
 * real stored Time Budget.
 *
 * Returns `undefined` — not a Proposal — in either of two cases:
 *  - the streak hasn't met the threshold yet (nothing to propose), or
 *  - the computed suggestion would not actually be larger than the current
 *    budget (`computeIncreasedTotalMinutes` clamped at the 24-hour ceiling
 *    `MAX_TOTAL_MINUTES` already enforces on any declared budget) — a
 *    Proposal offering no real change would be a hollow confirmation prompt,
 *    which UX-DR16 (silence is never consent, but an empty choice is worse)
 *    gives no reason to ever surface.
 *
 * `suggested` is deliberately `{ totalMinutes: ... }` only — a
 * `Partial<TimeBudget>`, not a full replacement — since the work/break
 * RHYTHM (`workMinutes`/`breakMinutes`) is a separate, Spencer-set
 * preference this signal says nothing about; `apply`'s accessor merges this
 * onto the live entity rather than replacing it wholesale.
 */
export function buildTimeBudgetChangeProposal(
  input: BuildTimeBudgetChangeProposalInput,
): Proposal<Partial<TimeBudget>> | undefined {
  const { currentBudget, currentBudgetVersion, streak, createdAt } = input;

  if (streak.consecutiveDeferralDays < DEFERRAL_STREAK_PROPOSAL_THRESHOLD_DAYS) return undefined;

  const suggestedTotalMinutes = computeIncreasedTotalMinutes(currentBudget.totalMinutes);
  if (suggestedTotalMinutes <= currentBudget.totalMinutes) return undefined;

  const dayWord = streak.consecutiveDeferralDays === 1 ? "day" : "days";
  return {
    id: `time-budget-change-${streak.lastDeferralDate}`,
    kind: "time-budget-change",
    entityId: TIME_BUDGET_PROPOSAL_ENTITY_ID,
    entityVersion: String(currentBudgetVersion),
    suggested: { totalMinutes: suggestedTotalMinutes },
    reason: `Tasks have been deferred for ${streak.consecutiveDeferralDays} consecutive ${dayWord} because they don't fit your declared Time Budget of ${formatMinutesLabel(currentBudget.totalMinutes)} — raising it to ${formatMinutesLabel(suggestedTotalMinutes)} might let more of your day actually fit.`,
    createdAt,
  };
}
