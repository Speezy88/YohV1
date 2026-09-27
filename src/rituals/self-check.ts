/**
 * src/rituals/self-check.ts
 *
 * Periodic Self-Check (Story 4.3 / Task 24, FR-17). As Spencer, I want Yoh to
 * periodically ask how well it's doing, and check in sooner if I tell it
 * something's wrong, so that it stays accountable without me having to bring
 * it up myself.
 *
 * Per this task's own Architecture context, this file lives under
 * `rituals/*.ts` (not a separate `core/self-check.ts`) — it both supplies its
 * own `EscalationCurve` to `core/escalate-under-strain.ts`'s shared
 * `computeEscalation` (AD-6) AND catches adapter throws, converting them to
 * `Result`/log lines (AD-1/AD-8), exactly the bundling
 * `rituals/night-ritual.ts` already established: pure helper functions and
 * the I/O-driving ritual entry points living side by side in one file, per
 * that file's own docstring precedent (`buildNightCloseOutPromptText`/
 * `buildNightEscalationEmail` are pure and sit directly alongside
 * `runNightPromptRitual`'s real I/O). `core/escalate-under-strain.ts` itself
 * stays the one place `computeEscalation`'s formula lives (AD-6) — this file
 * only supplies its own curve and consumes the shared function, never
 * re-derives the arithmetic.
 *
 * ============================================================================
 * Two halves, mirroring `night-ritual.ts`'s own split
 * ============================================================================
 *
 *  1. `runSelfCheckRitual` — what `ritual-cli.ts self-check` calls (AD-5):
 *     one-shot, OS-cron-triggered, never blocks for input. Decides whether
 *     TODAY is due for a Self-Check and, if so, persists one open
 *     interaction request (`requestKind: "self-check"`) and returns
 *     immediately — Spencer's answer only ever arrives later, interactively,
 *     in Chat (Story 8.9: `app/answer-self-check.ts`'s `answerSelfCheck`;
 *     originally `shell/chat-cli.ts`, since retired).
 *  2. `applySelfCheckAnswer` — what `app/answer-self-check.ts`'s
 *     `answerSelfCheck` calls once Spencer has given a complete answer (both
 *     a score AND a reason, UX-DR15): persists the answer and
 *     computes/stores the NEXT due schedule, via this file's own
 *     `scheduleNextSelfCheck` (which is what actually calls
 *     `computeEscalation`).
 *
 * ============================================================================
 * The interval: ~4 days by default, at a randomized time (documented,
 * concrete starting values — tunable, per this project's established style
 * for FR-2's even-split weights, FR-11's slip curve, Task 23's
 * deferral-streak threshold, etc.)
 * ============================================================================
 *
 * `SELF_CHECK_DEFAULT_INTERVAL_DAYS = 4` — the epics text's own number
 * ("approximately every 4 days").
 *
 * **Randomization mechanism.** `ritual-cli.ts self-check` is presumably
 * invoked by OS cron at some fixed granularity (e.g. hourly) — there is no
 * single moment "the ritual" runs that could itself be randomized. Instead,
 * the RITUAL decides whether "now" is close enough to its own randomized
 * target time for today: every time the NEXT check-in's due date is
 * scheduled (`scheduleNextSelfCheck`), a random target time-of-day
 * (`nextDueMinuteOfDay`, minutes since local midnight, 0-1439) is picked
 * alongside it, via an injected `random: () => number` (the same
 * `Math.random`-shaped seam `Math.random` itself provides, pinned in tests —
 * mirrors every other injected non-determinism in this codebase, e.g.
 * `now`). `isSelfCheckDueNow` then compares the ritual's own current local
 * time-of-day against that stored target: not due before it arrives on the
 * due date, but due immediately (regardless of time-of-day) on any LATER
 * date — a missed/delayed cron trigger catches up rather than silently
 * waiting for the exact minute to recur.
 *
 * **The low-score threshold.** `SELF_CHECK_LOW_SCORE_THRESHOLD = 3` (scores
 * are 1-10; a score strictly below 3 — i.e. 1 or 2 — counts as "low"). Per
 * the Architecture Spine's Deferred section and this task's own Implementer
 * note, this is deliberately biased toward UNDER-triggering: only genuinely
 * bad scores (the bottom ~20% of the scale) shorten the interval, not merely
 * mediocre ones. A tunable starting point, not a load-bearing constant to
 * over-engineer — easy to raise later once real Self-Check history exists to
 * tune against.
 *
 * **The curve, and why `strainCount` is binary here (0 or 1), not a
 * consecutive count.** `slip-bump.ts`/`tone.ts` both feed `computeEscalation`
 * a genuinely ACCUMULATING count (consecutive slip days). Self-Check's own
 * AC is explicit that this must NOT work that way: "triggered from that
 * single low score alone rather than waiting for a trend." So
 * `computeSelfCheckIntervalDays` passes `strainCount: 1` for "this one score
 * was low" and `strainCount: 0` for "it wasn't" — never an accumulated
 * streak across multiple check-ins. `SELF_CHECK_CURVE = { cap: 2, step: 2 }`
 * is chosen so a single low score reaches the cap immediately (`step ===
 * cap`): there is no partial/first-step shrink to wait out, exactly matching
 * "from that single low score alone." Worked arithmetic, via
 * `escalate-under-strain.ts`'s `value = min(strainCount * step, cap)`:
 *
 *   strainCount 0 (score not low) -> value 0, atCap false -> interval stays
 *                                     the default 4 days
 *   strainCount 1 (score low)     -> value min(2,2)=2, atCap true -> interval
 *                                     shortens to 4 - 2 = 2 days
 *
 * `nextIntervalDays = max(SELF_CHECK_MIN_INTERVAL_DAYS, DEFAULT - level.value)`
 * — floored at `SELF_CHECK_MIN_INTERVAL_DAYS = 1` so a curve retuned with a
 * larger cap later could never schedule a same-day (or negative) interval.
 *
 * ============================================================================
 * Cold start (this task's TDD requirement 1) — mirrors
 * `core/time-budget.ts`'s `resolveTodayTimeBudget` precedent
 * ============================================================================
 *
 * Spencer's very first day must not itself demand an immediate check-in —
 * there is nothing yet to score. `runSelfCheckRitual`'s first-ever run (no
 * `SelfCheckState` stored at all) initializes the schedule
 * (`scheduleNextSelfCheck({ today, score: undefined, random })`, which
 * resolves to the plain default interval since `computeSelfCheckIntervalDays
 * (undefined)` returns `SELF_CHECK_DEFAULT_INTERVAL_DAYS` unshortened) and
 * returns `"initialized"` WITHOUT opening an interaction request — the first
 * real prompt arrives on the newly-scheduled due date like any other. This
 * mirrors `resolveTodayTimeBudget`'s own "a stored value's absence is
 * reported, never force-defaulted into an action" spirit, applied here as
 * "establish the schedule, don't force today to be due."
 *
 * ============================================================================
 * No-op if today isn't due (this task's TDD requirement 2) — and no
 * `RITUAL_RUN_KIND` marker, unlike every other ritual in this codebase
 * ============================================================================
 *
 * `adapters/memory-store.ts`'s `RitualRun` marker (`getRitualRun`/
 * `putRitualRun`) answers "did this ritual already run TODAY" — the right
 * question for `morning`/`night-prompt`/`night-escalate`, which are
 * daily-cadence rituals. Self-Check runs on a ~4-day cadence, so that
 * question is the wrong one to ask; `SelfCheckState.nextDueDate`/
 * `nextDueMinuteOfDay` already answer the question this ritual actually
 * needs ("is TODAY the due day, and if so, has it arrived yet"), and the
 * open interaction request's own presence already prevents a duplicate
 * prompt once one has been persisted (see `"already-open"` below) — a
 * second, redundant `RitualRun` marker would track nothing this state
 * doesn't already cover, and risks drifting out of sync with it. See
 * `adapters/memory-store.ts`'s own `RITUAL_RUN_KIND` doc comment for the
 * matching note on the other side of this decision.
 *
 * A day that isn't due is therefore a GENUINE no-op: `runSelfCheckRitual`'s
 * `"not-due"` branch performs no `memory-store.ts` WRITE of any kind — only
 * reads (`getSelfCheckState`, `getOpenInteractionRequest`) — so a day that
 * isn't due leaves absolutely nothing behind that could look like a real
 * check-in (or even a schedule change) happened.
 *
 * ============================================================================
 * Idempotence once a request is open (a second same-day trigger before
 * Spencer answers)
 * ============================================================================
 *
 * If `ritual-cli.ts self-check` fires again (e.g. the next hourly cron tick)
 * before Spencer has answered the still-open request, `runSelfCheckRitual`
 * returns `"already-open"` without touching `memory-store.ts` at all — the
 * existing request (its own `createdAt`, its own version) is left completely
 * untouched, never replaced or re-persisted.
 *
 * ============================================================================
 * The push notification (review fix — present from the start, not a later
 * retrofit)
 * ============================================================================
 *
 * `runSelfCheckRitual`'s FIRST version persisted only the open interaction
 * request, with no active nudge — discoverable exclusively by opening Chat
 * (at the time, `chat-cli.ts`; since retired, Story 8.9). That is the exact
 * gap `rituals/night-ritual.ts`'s own
 * `runNightPromptRitual` had until Task 20's review fix added a Pushover
 * push for the identical reason (see that file's own "The first attempt's
 * own push notification" docstring section) — and the gap is genuinely
 * WORSE here, for two concrete reasons:
 *
 *  1. AD-7 itself presupposes a "normal Self-Check notification" already
 *     exists — its alert-wording rule requires a failure alert to be
 *     "worded distinctly from a normal Plan/close-out/Self-Check
 *     notification," naming Self-Check as one of exactly three ordinary
 *     notification categories. Without this fix, that category produced
 *     zero notifications, ever.
 *  2. Unlike a missed night-close-out prompt (which Story 3.2's
 *     `night-escalate` retries, once, via a second channel), an unanswered
 *     Self-Check request has NO escalation/retry channel at all — every
 *     subsequent cron tick just returns `"already-open"` and writes
 *     nothing. And unlike the nightly close-out, which fires at a
 *     predictable, habitual moment (every night), Self-Check fires at a
 *     RANDOMIZED time on a ~4-day cadence — there is no analogous daily
 *     habit that would make Spencer likely to open Chat and stumble onto an
 *     open prompt on his own. A silently-persisted request
 *     here can realistically sit unnoticed indefinitely, permanently
 *     freezing the whole feature (every later trigger keeps returning
 *     `"already-open"`, never re-prompting, never escalating).
 *
 * `SelfCheckRitualDeps.sendNotification` therefore mirrors
 * `NightPromptRitualDeps.sendNotification` exactly (same shape, same
 * "persist first, then notify" ordering, same AD-8 wrapping): the
 * interaction request is already persisted by the time the send is
 * attempted, so a delivery failure here surfaces as a `Result` failure
 * (`kind: "unreachable"`) but never loses the already-persisted request —
 * Spencer can still find it by opening Chat even without the push.
 */
import {
  getOpenInteractionRequest,
  getSelfCheckState,
  putOpenInteractionRequest,
  putSelfCheckState,
  type MemoryStore,
  type SelfCheckState,
  type StoredRecord,
} from "../adapters/memory-store.ts";
import type { LogEntry } from "../adapters/logger.ts";
import { computeEscalation } from "../core/escalate-under-strain.ts";
import { localIsoDate } from "./ritual-shared.ts";
import type { PlanNotification } from "./ritual-shared.ts";
import type { EscalationCurve, InteractionRequest, IsoDate, Result, YohError } from "../types/domain.ts";

// ============================================================================
// Shared ids / constants
// ============================================================================

/** The fixed, singleton interaction-request id the Self-Check prompt is stored under — mirrors `rituals/night-ritual.ts`'s `NIGHT_CLOSE_OUT_REQUEST_ID`/`rituals/data-completeness.ts`'s `DATA_COMPLETENESS_REQUEST_ID`. */
export const SELF_CHECK_REQUEST_ID = "self-check";

/** Minutes in a calendar day — the range `nextDueMinuteOfDay` is drawn from (0-1439). */
const MINUTES_PER_DAY = 1440;

/** The default Self-Check interval, in days, when no recent low score has shortened it — the epics text's own "approximately every 4 days." See the file docstring's "The interval" section. */
export const SELF_CHECK_DEFAULT_INTERVAL_DAYS = 4;

/** The floor no computed interval is ever allowed to go below, regardless of how the curve is tuned later — see the file docstring's "The curve" section. */
export const SELF_CHECK_MIN_INTERVAL_DAYS = 1;

/** A score strictly below this counts as "low" (scores are 1-10) — biased toward under-triggering, a tunable starting point. See the file docstring's "The low-score threshold" section. */
export const SELF_CHECK_LOW_SCORE_THRESHOLD = 3;

/** The lowest/highest valid Self-Check score. */
export const SELF_CHECK_SCORE_MIN = 1;
export const SELF_CHECK_SCORE_MAX = 10;

/**
 * Self-Check's own `EscalationCurve` (AD-6) — deliberately DISTINCT from
 * `slip-bump.ts`'s `{ cap: 3, step: 1 }` and `tone.ts`'s `{ cap: 4, step: 2
 * }`, even though all three consume the same shared `computeEscalation`. See
 * the file docstring's "The curve" section for the worked arithmetic and why
 * `step === cap` here (a single low score reaches the cap immediately — no
 * trend needed).
 */
export const SELF_CHECK_CURVE: EscalationCurve = { cap: 2, step: 2 };

/** The Self-Check prompt's fixed text — UX-DR15: both a numeric score AND a short written reason are required. Mentions both explicitly so a re-prompt after an incomplete answer (`app/answer-self-check.ts`) reads as a restatement of the same requirement, not a new/different question. */
export const SELF_CHECK_PROMPT_TEXT =
  "Quick Self-Check: on a scale of 1-10, how well is this working for you right now? Give me a number and a short written reason.";

/**
 * The `self-check` push notification's title (review fix — see the file
 * docstring's "The push notification" section). Plain text, like
 * `rituals/night-ritual.ts`'s own `NIGHT_PROMPT_NOTIFICATION_TITLE`: Pushover
 * titles carry no styling at all, so the cue is the wording itself, not
 * color (UX-DR20).
 */
export const SELF_CHECK_NOTIFICATION_TITLE = "Quick Self-Check";

// ============================================================================
// Pure helpers
// ============================================================================

/** Whether `score` is a valid Self-Check answer: a whole number from 1 to 10. */
export function isValidSelfCheckScore(score: number): boolean {
  return Number.isInteger(score) && score >= SELF_CHECK_SCORE_MIN && score <= SELF_CHECK_SCORE_MAX;
}

/**
 * Adds `deltaDays` (may be negative, though never called that way here) to
 * an `IsoDate` (`YYYY-MM-DD`), returning another `IsoDate`. Computed in UTC,
 * matching every other `IsoDate` arithmetic helper in this codebase (e.g.
 * `memory-store.ts`'s own private `addDaysToIsoDate`) — a small, deliberate
 * duplication across layers, the same convention `core/time-budget.ts`'s own
 * `isValidIsoDate` doc comment documents (`core/*.ts` cannot import from
 * `adapters/*.ts` per AD-1/AD-2; this file, while a `rituals/*.ts` file that
 * COULD import from `adapters/`, still doesn't reach into that file's
 * private, unexported helper).
 */
function addDaysToIsoDate(date: IsoDate, deltaDays: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Computes the NEXT Self-Check interval, in days, from the score just
 * answered (or `undefined` for a cold start — see the file docstring's "Cold
 * start" section). Genuinely flows through `escalate-under-strain.ts`'s
 * shared `computeEscalation` (AD-6): `strainCount` is `1` when `score` is
 * low, `0` otherwise — a binary "was THIS score low" signal, deliberately
 * never an accumulated streak (see the file docstring's "why `strainCount`
 * is binary here" section for the AC this reflects).
 */
export function computeSelfCheckIntervalDays(score: number | undefined): number {
  if (score === undefined) return SELF_CHECK_DEFAULT_INTERVAL_DAYS;
  const strainCount = score < SELF_CHECK_LOW_SCORE_THRESHOLD ? 1 : 0;
  const level = computeEscalation(strainCount, SELF_CHECK_CURVE);
  return Math.max(SELF_CHECK_MIN_INTERVAL_DAYS, SELF_CHECK_DEFAULT_INTERVAL_DAYS - level.value);
}

/** Picks a random minute-of-day (0-1439) from an injected `random: () => number` (a `Math.random`-shaped `[0, 1)` generator). Clamps a malformed/out-of-range generator's output defensively rather than propagating `NaN`/an out-of-range index. */
function pickRandomMinuteOfDay(random: () => number): number {
  const raw = random();
  const clamped = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1 - Number.EPSILON) : 0;
  return Math.floor(clamped * MINUTES_PER_DAY);
}

/** Input to `scheduleNextSelfCheck`. */
export interface ScheduleNextSelfCheckInput {
  /** The local calendar date this schedule is being computed FROM (ordinarily "today," as the caller's own `localIsoDate` computes it). */
  readonly today: IsoDate;
  /** The score just answered, or `undefined` for a cold-start initialization — see `computeSelfCheckIntervalDays`. */
  readonly score?: number | undefined;
  /** Injectable `[0, 1)` RNG — `Math.random` in production, pinned in tests. Used only to pick the randomized target time-of-day for the newly-scheduled due date. */
  readonly random: () => number;
}

/**
 * Computes the next `nextDueDate`/`nextDueMinuteOfDay` pair — what both
 * `runSelfCheckRitual`'s cold-start branch and `applySelfCheckAnswer` store.
 * Pure (no I/O): the caller persists the result.
 */
export function scheduleNextSelfCheck(input: ScheduleNextSelfCheckInput): Pick<SelfCheckState, "nextDueDate" | "nextDueMinuteOfDay"> {
  const intervalDays = computeSelfCheckIntervalDays(input.score);
  return {
    nextDueDate: addDaysToIsoDate(input.today, intervalDays),
    nextDueMinuteOfDay: pickRandomMinuteOfDay(input.random),
  };
}

/**
 * Whether a Self-Check is due right now, given the currently-stored schedule
 * (or `undefined`, cold start — never due; `runSelfCheckRitual` initializes
 * instead of prompting), today's local calendar date, and the ritual's
 * current local time-of-day (minutes since local midnight). See the file
 * docstring's "Randomization mechanism" section for the full reasoning,
 * including why a date AFTER `nextDueDate` is due regardless of
 * `nextDueMinuteOfDay` (a missed/delayed trigger catches up rather than
 * waiting for the exact minute to recur on some later day).
 */
export function isSelfCheckDueNow(state: SelfCheckState | undefined, today: IsoDate, nowMinuteOfDay: number): boolean {
  if (!state) return false;
  if (today < state.nextDueDate) return false;
  if (today > state.nextDueDate) return true;
  return nowMinuteOfDay >= state.nextDueMinuteOfDay;
}

/**
 * `instant`'s local wall-clock time in `timeZone`, expressed as minutes
 * since local midnight (0-1439). Computed via `Intl.DateTimeFormat`,
 * mirroring `rituals/morning-ritual.ts`'s own `localIsoDate`/private
 * `formatLocalTime` technique (that function is private to its file, so this
 * is a small, deliberate duplication of the same approach — see
 * `addDaysToIsoDate`'s own doc comment above for this codebase's established
 * convention for exactly this situation).
 */
function localMinuteOfDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

// ============================================================================
// runSelfCheckRitual — the persist-and-exit half (AD-5)
// ============================================================================

/**
 * Every input/I-O edge `runSelfCheckRitual` needs, injected — deliberately
 * has NO `io`/`readLine` seam at all, mirroring `NightPromptRitualDeps`:
 * AD-5 requires this half to never wait for input, and giving it no readable
 * input seam to begin with makes that impossible to violate by construction.
 */
export interface SelfCheckRitualDeps {
  readonly store: MemoryStore;
  /** Injectable clock — never `new Date()` inline, so a test can pin "now." */
  readonly now: () => Date;
  /** Spencer's IANA timezone, defining both "today" and the local time-of-day the randomized due time is compared against. */
  readonly timeZone: string;
  /** Injectable `[0, 1)` RNG — `Math.random` in production, pinned in tests. See `scheduleNextSelfCheck`. */
  readonly random: () => number;
  /**
   * `adapters/notification-adapter.ts`'s `sendPushoverNotification`,
   * pre-bound to its config — the SAME shape (and the same seam name) as
   * `NightPromptRitualDeps.sendNotification`/`MorningRitualDeps.sendNotification`.
   * Required (review fix — see the file docstring's "The push notification"
   * section for why this matters even more here than it did for
   * night-prompt). Throws on I/O failure (AD-8).
   */
  readonly sendNotification: (notification: PlanNotification) => Promise<void>;
  readonly log?: (entry: LogEntry) => void;
}

/** `InteractionRequest<SelfCheckRequestDetail>`'s `detail` payload — the structured half `app/answer-self-check.ts` reads to know which local date this check-in is about. */
export interface SelfCheckRequestDetail {
  readonly date: IsoDate;
}

/** What one `self-check` run did. Discriminated on `status`, mirroring `NightPromptOutcome`'s shape. */
export type SelfCheckOutcome =
  | {
      /** No `SelfCheckState` existed yet — a schedule was initialized for the first time; today is deliberately NOT treated as due (see the file docstring's "Cold start" section). */
      readonly status: "initialized";
      readonly date: IsoDate;
      readonly nextDueDate: IsoDate;
    }
  | {
      /** A schedule exists, but today hasn't reached its due date/time yet. A genuine no-op — no write of any kind (see the file docstring's "No-op if today isn't due" section). */
      readonly status: "not-due";
      readonly date: IsoDate;
      readonly nextDueDate: IsoDate;
    }
  | {
      /** Today is due, but an open request from an earlier trigger this same window is still waiting on Spencer's answer — not re-persisted. */
      readonly status: "already-open";
      readonly date: IsoDate;
    }
  | {
      /** Today is due, and no request was already open — the Self-Check prompt was persisted. */
      readonly status: "prompted";
      readonly date: IsoDate;
    };

function failure(kind: YohError["kind"], message: string, detail?: unknown): Result<never, YohError> {
  return { ok: false, error: detail === undefined ? { kind, message } : { kind, message, detail } };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The `self-check` half (AD-5): decides whether today is due for a
 * Self-Check and, if so, persists an open interaction request, sends a
 * Pushover notification, and returns immediately. See the file docstring
 * for the full design.
 *
 * Per AD-8, this is one of the layers allowed to catch an adapter's throw:
 * every `memory-store.ts` write below (which can throw `ConflictError` under
 * AD-10 concurrency with `server.ts`), and `deps.sendNotification` itself
 * (which can throw on I/O failure), are each wrapped and converted into a
 * `Result` failure plus a structured log line.
 */
export async function runSelfCheckRitual(deps: SelfCheckRitualDeps): Promise<Result<SelfCheckOutcome, YohError>> {
  const log = deps.log ?? ((): void => {});
  const nowDate = deps.now();
  const nowIso = nowDate.toISOString();
  const today = localIsoDate(nowDate, deps.timeZone);
  const nowMinuteOfDay = localMinuteOfDay(nowDate, deps.timeZone);

  const stored = getSelfCheckState(deps.store);

  // --- Cold start: no schedule exists yet — initialize, don't prompt --------
  if (!stored) {
    const schedule = scheduleNextSelfCheck({ today, score: undefined, random: deps.random });
    try {
      putSelfCheckState(deps.store, schedule);
    } catch (err) {
      log({ level: "error", event: "self-check.init-failed", detail: describeError(err) });
      return failure("conflict", `self-check: could not initialize the schedule — ${describeError(err)}`, err);
    }
    log({ level: "info", event: "self-check.initialized", detail: { date: today, nextDueDate: schedule.nextDueDate } });
    return { ok: true, value: { status: "initialized", date: today, nextDueDate: schedule.nextDueDate } };
  }

  // --- Already open: a still-unanswered request from an earlier trigger -----
  const open = getOpenInteractionRequest(deps.store, SELF_CHECK_REQUEST_ID);
  if (open) {
    log({ level: "info", event: "self-check.already-open", detail: { date: today } });
    return { ok: true, value: { status: "already-open", date: today } };
  }

  // --- Not due yet: genuine no-op, no write of any kind ----------------------
  if (!isSelfCheckDueNow(stored.data, today, nowMinuteOfDay)) {
    log({ level: "info", event: "self-check.not-due", detail: { date: today, nextDueDate: stored.data.nextDueDate } });
    return { ok: true, value: { status: "not-due", date: today, nextDueDate: stored.data.nextDueDate } };
  }

  // --- Due: persist the open interaction request ------------------------------
  const request: InteractionRequest<SelfCheckRequestDetail> = {
    requestKind: "self-check",
    promptText: SELF_CHECK_PROMPT_TEXT,
    detail: { date: today },
    createdAt: nowIso,
  };

  try {
    putOpenInteractionRequest(deps.store, SELF_CHECK_REQUEST_ID, request);
  } catch (err) {
    log({ level: "error", event: "self-check.persist-failed", detail: describeError(err) });
    return failure("conflict", `self-check: could not persist the Self-Check prompt — ${describeError(err)}`, err);
  }

  // --- Notify Spencer the Self-Check prompt is waiting (AD-8 boundary) -----
  // The interaction request is already persisted above, so a delivery
  // failure here never loses it — Spencer can still find it by opening
  // Chat even without the push. Mirrors `runNightPromptRitual`'s own
  // persist-then-send ordering (rituals/night-ritual.ts) — see the file
  // docstring's "The push notification" section for why this is required
  // from the start here rather than an optional/later addition.
  try {
    await deps.sendNotification({ title: SELF_CHECK_NOTIFICATION_TITLE, message: request.promptText });
  } catch (err) {
    log({ level: "error", event: "self-check.notify-failed", detail: describeError(err) });
    return failure("unreachable", `self-check: could not send the Self-Check notification — ${describeError(err)}`, err);
  }

  log({ level: "info", event: "self-check.prompted", detail: { date: today } });
  return { ok: true, value: { status: "prompted", date: today } };
}

// ============================================================================
// applySelfCheckAnswer — the answer-processing half app/answer-self-check.ts
// (`answerSelfCheck`) calls
// ============================================================================

/** Input to `applySelfCheckAnswer` — a complete, already-validated answer: a score in range, always present; `reason` may be `""` (Task 6: the score is required, the reason is optional), as decided by `core/open-item-answers.ts`'s `parseSelfCheckAnswer` before this is ever called. */
export interface ApplySelfCheckAnswerInput {
  /** The local calendar date this check-in is being recorded against — `app/answer-self-check.ts` passes its own current local date. */
  readonly today: IsoDate;
  readonly score: number;
  readonly reason: string;
  /** Injectable `[0, 1)` RNG — see `scheduleNextSelfCheck`. */
  readonly random: () => number;
}

/**
 * Records a complete Self-Check answer and computes/stores the NEXT
 * schedule in one write — `scheduleNextSelfCheck` (this file's own pure
 * helper, which is what actually calls `computeEscalation`, AD-6) decides
 * the new `nextDueDate`/`nextDueMinuteOfDay`; this function only persists
 * the result. `app/answer-self-check.ts` clears the open interaction
 * request itself, once this call succeeds (mirroring `rituals/night-ritual.ts`'s
 * `applyNightCloseOutConfirmation` / `clearNightCloseOutRequestIfOpen`
 * split).
 *
 * Per AD-8, this is one of the layers allowed to catch an adapter's throw:
 * `putSelfCheckState` (which can throw `ConflictError` under AD-10
 * concurrency) is wrapped and converted into a `Result` failure.
 */
export function applySelfCheckAnswer(
  store: MemoryStore,
  input: ApplySelfCheckAnswerInput,
): Result<StoredRecord<SelfCheckState>, YohError> {
  const schedule = scheduleNextSelfCheck({ today: input.today, score: input.score, random: input.random });

  try {
    const stored = putSelfCheckState(store, {
      ...schedule,
      lastCheckInDate: input.today,
      lastScore: input.score,
      lastReason: input.reason,
    });
    return { ok: true, value: stored };
  } catch (err) {
    return failure("conflict", `self-check: could not record this check-in — ${describeError(err)}`, err);
  }
}
