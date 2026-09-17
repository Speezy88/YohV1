/**
 * src/shell/ritual-cli.ts
 *
 * The one-shot, OS-cron-triggered ritual entry point (AD-5). Where
 * `chat-cli.ts` is a REPL that blocks indefinitely for Spencer's answers,
 * this file is its opposite in every respect: it runs one subcommand, prints
 * what happened, and exits. It NEVER waits for input — not even when the
 * Data-Completeness Gate finds a missing field. In that case the Morning
 * Ritual persists an open interaction request in `memory-store.ts` and the
 * process exits; Spencer answers it the next time he opens `chat-cli.ts`,
 * which is the only place an open interaction request is ever resolved
 * (AD-5). A test in `tests/ritual-cli.test.ts` enforces that by scanning this
 * file's own source for any stdin/readline use.
 *
 * Task 10 introduces this file with ONE subcommand, `morning`. AD-5 names
 * three more — `night-prompt` (Task 19), `night-escalate` (Task 20), and
 * `self-check` (Task 24). All four are now built (see the per-task update
 * paragraphs below) — `SUBCOMMANDS` reflects that, rather than any
 * subcommand falling through to "unknown subcommand" or a "not implemented
 * yet" placeholder.
 *
 * Task 19 update (Story 3.1): adds the `night-prompt` subcommand
 * (`handleNightPromptResult`, `createNightPromptRitualDeps`) with the exact
 * same one-shot/never-blocks contract `morning` already has, and closes
 * `createMorningRitualDeps`'s `bumpLevels` bridge — see that function's own
 * doc comment.
 *
 * Task 20 update (Story 3.2): adds the `night-escalate` subcommand
 * (`handleNightEscalateResult`, `createNightEscalateRitualDeps`), scheduled
 * (by OS cron, outside this codebase) some hours after `night-prompt`. Same
 * one-shot/never-blocks contract; binds only `adapters/email-adapter.ts`'s
 * `sendEmail` (via `loadEmailConfigFromEnv`) plus the `MemoryStore` — no
 * Notion/Calendar/Pushover credentials are needed for THIS subcommand.
 *
 * Task 20 review-fix update: `createNightPromptRitualDeps` now ALSO wires
 * `adapters/notification-adapter.ts`'s `sendPushoverNotification` (see
 * `rituals/night-ritual.ts`'s own "The first attempt's own push
 * notification" docstring section for why) — `night-prompt` now requires
 * `PUSHOVER_APP_TOKEN`/`PUSHOVER_USER_KEY` to be configured, same as
 * `morning`.
 *
 * Task 21 (Story 3.3, unchecked-day handling) touches no wiring in this
 * file at all: `night-escalate` (above) now writes the durable
 * `UncheckedDay` record itself, at cap-spend time, entirely inside
 * `rituals/night-ritual.ts`; `morning` (`rituals/morning-ritual.ts`) reads
 * it back via plain `memory-store.ts` calls it already has access to
 * through its own `store`. No new subcommand, no new dep to bind here —
 * see both ritual files' own docstrings for the design.
 *
 * Task 24 update (Story 4.3, FR-17, AD-6): adds the FOURTH and final AD-5
 * subcommand, `self-check` (`handleSelfCheckResult`,
 * `createSelfCheckRitualDeps`) — the last of AD-5's four named subcommands
 * is now built; `SUBCOMMANDS` no longer names anything as "planned but not
 * yet built." No Notion, Calendar, or SMTP credentials are needed for THIS
 * subcommand, but — per the Task 24 review fix below — Pushover IS: it
 * needs `YOH_TIMEZONE` (defining "today" and the local time-of-day its
 * randomized due time compares against) plus `PUSHOVER_APP_TOKEN`/
 * `PUSHOVER_USER_KEY`, the same credentials `morning`/`night-prompt`
 * already require.
 *
 * Task 24 review-fix update: `createSelfCheckRitualDeps` now ALSO wires
 * `adapters/notification-adapter.ts`'s `sendPushoverNotification` — mirroring
 * `createNightPromptRitualDeps`'s own Task 20 review-fix precedent exactly
 * (see that function's own doc comment, and `rituals/self-check.ts`'s own
 * "The push notification" docstring section for why this matters even MORE
 * for Self-Check than it did for night-prompt: a randomized ~4-day cadence
 * gives Spencer no habitual daily moment to stumble onto an open prompt, and
 * unlike night-close-out there is no second, escalating retry channel if a
 * silently-persisted request goes unnoticed).
 *
 * Task 25 update (Story 5.1, AD-7/AD-9, Epic 5's first task — the epic hardens
 * all four subcommands at once rather than piecemeal per-epic, per the epic
 * note): every failure branch below used to end with just the structured
 * stderr line ("AD-7's real failure alerting is Epic 5" — that comment is now
 * gone from each `handle*Result` function, replaced by this). Now a single
 * shared wrapper, `withFailureAlert` (factored once per AD-9, applied
 * identically to all four dispatch branches in `runRitualCli`), sends ONE
 * Pushover alert — worded distinctly from a normal Plan/close-out/Self-Check
 * notification, naming the failing subcommand and the error — before any
 * subcommand's invocation (a `Result` failure OR a thrown error escaping it
 * entirely) returns a non-zero exit code. The channel it sends on
 * (`RitualCliDeps.sendFailureAlert`, wired to the real Pushover adapter by
 * `createFailureAlertSender` in `main`, below) is deliberately its OWN seam,
 * separate from any ritual's own `sendNotification` — this is why
 * `night-escalate` now also requires `PUSHOVER_APP_TOKEN`/`PUSHOVER_USER_KEY`
 * to run, even though its own ritual (`runNightEscalateRitual`) still only
 * ever sends email and has no Pushover seam of its own; see
 * `createFailureAlertSender`'s own doc comment.
 *
 * Task 26 update (Story 5.2, AD-7/AD-9): adds the dead-man's-switch —
 * "has this subcommand actually been INVOKED (its process ran to
 * completion) recently enough" — alongside Task 25's "did THIS invocation
 * fail" check, both funneled through the SAME `sendFailureAlert` channel
 * (`withFailureAlert`, below, now calls `RitualCliDeps.checkMissedRun` —
 * pre-bound per subcommand exactly like the four `run*` seams — before
 * `runSubcommand`).
 *
 * **Self-healing, not cascading — the one property that matters most here.**
 * The missed-run check is purely ADDITIVE: it can only ever cause an EXTRA
 * alert to be sent. It never gates, delays, or skips `runSubcommand` — that
 * call happens unconditionally, on the very next line, whether or not a
 * miss was just flagged. This is deliberate: if a missed PRIOR run instead
 * caused THIS run to also abort before doing its own work, a single missed
 * day would cascade forever. Check-then-alert-then-proceed-regardless is
 * what makes a single missed occurrence self-correcting the very next time
 * the ritual runs, instead of permanent.
 *
 * **Cold start is not a miss.** `getRitualInvocation` returning `undefined`
 * — this subcommand has never been invoked at all yet — is the expected,
 * ordinary state of a brand-new install, not a failure; both check
 * functions return `{ missed: false }` for it.
 *
 * **Grace thresholds** (`DAILY_RITUAL_MISSED_RUN_GRACE_HOURS = 36`,
 * `SELF_CHECK_MISSED_RUN_GRACE_DAYS = 5`) are documented, concrete starting
 * values, not load-bearing constants — see each constant's own doc comment
 * for the reasoning, mirroring this project's established pattern for
 * FR-2's even-split weights, FR-11's slip curve, Self-Check's own interval/
 * low-score threshold, etc.
 *
 * **Documented scope boundary (required by this task's own brief, AC 3):
 * this check is self-referential ONLY.** Every check above runs from
 * INSIDE a live `ritual-cli.ts` invocation — it can only ever detect a
 * missed PRIOR occurrence from a LATER invocation that itself still gets to
 * run. A TOTAL host/scheduler outage spanning EVERY future invocation
 * (cron itself dies, the host is off, permanently) has NO detection from
 * inside Yoh: there is no later invocation left to run this check at all.
 * That gap is an explicitly accepted, out-of-scope limitation of this
 * story — not silently claimed as solved. Closing it would require an
 * external, off-host monitor (e.g. a third-party heartbeat/dead-man's-
 * switch service Yoh pings on every run, checked from OUTSIDE this
 * process) — deliberately not built here.
 *
 * Task 26 review-fix update: two problems, both since fixed.
 *
 * (1) **`checkMissedRun()` now has its own try/catch** (`safeCheckMissedRun`
 * below), separate from and BEFORE the region Task 25's own try/catch
 * covers. The real checks do a live `MemoryStore` read that CAN throw (a
 * `SQLITE_BUSY` under the exact cross-process concurrency AD-10 documents,
 * a malformed stored blob, a disk I/O error) — left unguarded, that throw
 * used to escape `withFailureAlert` entirely: `runSubcommand` never ran (no
 * Plan/notification/marker), and Task 25's OWN alert never fired either
 * (the throw never reached ITS try/catch), regressing the exact guarantee
 * Task 25 built — silently, and for a persistent cause, on every future
 * invocation. A throwing check is now logged (a structured stderr line)
 * and treated as `{ missed: false }`; `runSubcommand` still runs next.
 *
 * (2) **The dead-man's-switch now reads a dedicated `RitualInvocation`
 * marker (`memory-store.ts`), not `RitualRun`/`SelfCheckState`.** Those two
 * only advance on specific ritual-DOMAIN outcomes (`RitualRun`: `morning`'s
 * `delivered` / `night-prompt`'s `prompted` / `night-escalate`'s
 * `escalated`; `SelfCheckState.nextDueDate`: cold-start init or a genuine
 * answer) — an ordinary, CORRECT no-op success (`nothing-to-plan`,
 * `no-plan-today`, `not-prompted-yet`, an unanswered-but-normal
 * `already-open` Self-Check prompt, etc.) wrote nothing at all, so reading
 * either as "was this subcommand invoked" produced false alarms on
 * perfectly healthy quiet days — the opposite of what a dead-man's-switch
 * should ever do. `RitualInvocation` answers a narrower, different
 * question instead ("did the scheduler actually invoke this process and
 * let it run to completion — crash or success, `Result` failure or not"):
 * `withFailureAlert` itself writes it (via `RitualCliDeps.recordInvocation`,
 * pre-bound per subcommand) unconditionally after `runSubcommand` resolves,
 * whether that returned `Result` was `ok` or a failure, and also after a
 * CAUGHT throw (the scheduler DID fire; the ritual crashing is Task 25's
 * own, separate failure category — this marker's only job is "was I
 * invoked at all," not "did I succeed"). Still AD-9-compliant reuse: one
 * more typed kind in the same `MemoryStore`, the same `getRecord`/
 * `readModifyWrite` primitive every other kind in `memory-store.ts` uses —
 * not a parallel storage mechanism.
 *
 * Task 27 update (Story 5.3, AD-7/AD-9, the plan's final task — it hardens
 * ALL FOUR subcommands' structured logging at once, and adds a THIRD AD-7
 * signal for `morning` specifically): (1) the four `create*RitualDeps`
 * functions below now each call `adapters/logger.ts`'s `writeStructuredLog`
 * instead of independently repeating the same `process.stderr.write`
 * closure — see that new file's own doc comment for the full duplication
 * this consolidates (AD-9), across this file and all four `rituals/*.ts`
 * files at once. (2) `withFailureAlert` now ALSO accepts an optional
 * `checkDegraded` (only `morning` passes one,
 * `checkMorningPlanGenerationDegraded` below): when Plan generation
 * (the Data-Completeness Gate through Work/Break fitting,
 * `morning-ritual.ts`'s `PLAN_GENERATION_DEGRADED_THRESHOLD_MS`) takes
 * longer than that threshold, the run is treated as DEGRADED-not-failed and
 * raised through the SAME `sendFailureAlert` channel Story 5.1/5.2 built,
 * worded distinctly from both the "failed" and "missed a run" alerts — the
 * Plan itself is still generated and delivered normally either way; this is
 * purely an additional observability signal, never a `Result` failure.
 *
 * Per AD-1 this shell file contains no ritual logic of its own. It does two
 * things: bind the real adapters/stores to `rituals/morning-ritual.ts`'s
 * injected seams (`createMorningRitualDeps`, below), and translate the
 * `Result` that comes back into terminal output and a process exit code. The
 * AD-8 catching of adapter throws happens inside the ritual, not here — this
 * file's own `withFailureAlert` (Task 25, above) is a defensive layer
 * further out still, for whatever might nonetheless escape that boundary.
 *
 * Exit codes: `0` the subcommand ran (including the "already ran today" and
 * "nothing to plan" no-ops, which are outcomes, not errors), `1` the ritual
 * returned a `Result` failure (or threw — Task 25's `withFailureAlert`
 * treats both the same for exit-code purposes), `2` a usage problem (no
 * subcommand, unknown subcommand, an unbuilt subcommand, or missing
 * configuration).
 */
import { createMemoryStore, getRitualInvocation, listSlipHistories, putRitualInvocation, type MemoryStore } from "../adapters/memory-store.ts";
import {
  createCalendarReadClient,
  createCalendarWriteClient,
  readCalendarEvents,
  writeTodaysPlanToCalendar,
} from "../adapters/calendar-adapter.ts";
import { loadEmailConfigFromEnv, sendEmail } from "../adapters/email-adapter.ts";
import { writeStructuredLog } from "../adapters/logger.ts";
import { loadPushoverConfigFromEnv, sendPushoverNotification } from "../adapters/notification-adapter.ts";
import { loadTaskPropertyNamesFromEnv, readNotionTasks } from "../adapters/notion-adapter.ts";
import { createTokenStore, loadGoogleOAuthConfigFromEnv } from "../adapters/token-store.ts";
import { computeSlipBumpLevels } from "../core/slip-bump.ts";
import {
  PLAN_GENERATION_DEGRADED_THRESHOLD_MS,
  runMorningRitual,
  type MorningRitualDeps,
  type MorningRitualOutcome,
} from "../rituals/morning-ritual.ts";
import type { PlanNotification } from "../rituals/ritual-shared.ts";
import {
  renderNightEscalateNotice,
  runNightEscalateRitual,
  runNightPromptRitual,
  type NightEscalateRitualDeps,
  type NightEscalateOutcome,
  type NightPromptRitualDeps,
  type NightPromptOutcome,
} from "../rituals/night-ritual.ts";
import { runSelfCheckRitual, type SelfCheckOutcome, type SelfCheckRitualDeps } from "../rituals/self-check.ts";
import { Client } from "@notionhq/client";
import type { ExternalId, Result, YohError } from "../types/domain.ts";

// ============================================================================
// Injectable IO / ritual seams
// ============================================================================

export interface RitualCliIo {
  readonly writeLine: (line: string) => void;
  readonly writeError: (line: string) => void;
}

/**
 * The result of one dead-man's-switch check (Task 26 / Story 5.2, AD-7):
 * `missed: true` means this subcommand's own previous scheduled occurrence
 * did NOT record a successful run within its grace threshold — `detail` is
 * a short human-readable explanation (naming roughly how long it's been)
 * for the alert body; ignored when `missed` is `false`.
 */
export interface MissedRunCheckResult {
  readonly missed: boolean;
  readonly detail?: string;
}

/**
 * The result of Task 27 / Story 5.3's degraded-performance check
 * (`checkMorningPlanGenerationDegraded`, below): `degraded: true` means the
 * subcommand's own OUTCOME — genuinely `Result`-ok, not a failure — reports
 * running unusually slow. Distinct from `MissedRunCheckResult` (an EXTERNAL
 * "was this subcommand invoked recently enough" check, run BEFORE the
 * subcommand) and from a `Result` failure (the run genuinely succeeded and
 * delivered normally): this is a THIRD, independent signal, read from a
 * successful outcome's own data. `detail` is a short human-readable
 * explanation for the alert body, ignored when `degraded` is `false`.
 */
export interface DegradedCheckResult {
  readonly degraded: boolean;
  readonly detail?: string;
}

/**
 * What `runRitualCli` needs, injected so the dispatch/exit-code logic is
 * testable without adapters, credentials, or a network. `main` below builds
 * the real one.
 */
export interface RitualCliDeps {
  readonly io: RitualCliIo;
  readonly runMorning: () => Promise<Result<MorningRitualOutcome, YohError>>;
  /** `rituals/night-ritual.ts`'s `runNightPromptRitual`, pre-bound to its deps (Task 19 / Story 3.1). */
  readonly runNightPrompt: () => Promise<Result<NightPromptOutcome, YohError>>;
  /** `rituals/night-ritual.ts`'s `runNightEscalateRitual`, pre-bound to its deps (Task 20 / Story 3.2). */
  readonly runNightEscalate: () => Promise<Result<NightEscalateOutcome, YohError>>;
  /** `rituals/self-check.ts`'s `runSelfCheckRitual`, pre-bound to its deps (Task 24 / Story 4.3). */
  readonly runSelfCheck: () => Promise<Result<SelfCheckOutcome, YohError>>;
  /**
   * AD-7's failure-alert channel (Task 25 / Story 5.1): sends ONE Pushover
   * alert, worded distinctly from a normal Plan/close-out/Self-Check
   * notification. Deliberately separate from any of the four `run*`
   * functions above and from each ritual's OWN `sendNotification` seam (see
   * `createMorningRitualDeps` etc.) — this must work regardless of which
   * subcommand failed, or whether that subcommand's own ritual has a
   * notification seam at all (`night-escalate`'s does not; it uses email).
   * `withFailureAlert`, below, is the sole caller.
   */
  readonly sendFailureAlert: (notification: PlanNotification) => Promise<void>;
  /**
   * Task 26 / Story 5.2, AD-7's dead-man's-switch: has this subcommand
   * actually been INVOKED recently enough? Pre-bound per subcommand exactly
   * like the four `run*` seams above (`checkDailyRitualMissedRun`/
   * `checkSelfCheckMissedRun`, below, are what `main` wires up as the real
   * ones — reading the `RitualInvocation` marker, `memory-store.ts`). May
   * THROW (the real ones do a live store read) — `withFailureAlert` wraps
   * the call in its own try/catch (`safeCheckMissedRun`, review fix) and
   * treats a throw as `{ missed: false }`, never letting it escape or block
   * `runSubcommand`. When it reports a miss, `withFailureAlert` sends its
   * own distinctly-worded alert via `sendFailureAlert` — but this check is
   * PURELY ADDITIVE either way: see the file docstring's "Self-healing, not
   * cascading" section for why it must never gate or skip the `run*` call
   * that follows.
   */
  readonly checkMissedRun: () => MissedRunCheckResult;
  /**
   * Task 26 / Story 5.2 review-fix: records that this subcommand was
   * invoked and ran to completion — pre-bound per subcommand, writing
   * `memory-store.ts`'s `RitualInvocation` marker via `putRitualInvocation`.
   * `withFailureAlert` is the SOLE caller, unconditionally, after
   * `runSubcommand` resolves (whether the returned `Result` was `ok` or a
   * failure) and after a caught throw from `runSubcommand` itself — see
   * that function's own doc comment for why both paths write it. May
   * THROW (a live store write); `withFailureAlert` wraps this call too
   * (`safeRecordInvocation`), logging and swallowing a failure rather than
   * letting it prevent `handleResult`'s own exit-code logic from running.
   */
  readonly recordInvocation: () => void;
}

/** AD-5's full subcommand set — all four are now built. */
const SUBCOMMANDS = {
  morning: "built",
  "night-prompt": "built",
  "night-escalate": "built",
  "self-check": "built",
} as const;

// Final whole-branch review, Finding 2: there is no `yoh` binary and no
// `ritual` subcommand — the real invocation is positional, running this file
// directly via `node`. See SETUP.md's "Running Yoh" section for the full
// invocation, including the interactive chat CLI and a sample crontab.
const USAGE = "usage: node src/shell/ritual-cli.ts <morning|night-prompt|night-escalate|self-check>";

// ============================================================================
// runRitualCli
// ============================================================================

/**
 * Dispatches one subcommand and returns the process exit code. Never reads
 * input, never loops, never waits (AD-5).
 */
export async function runRitualCli(argv: readonly string[], deps: RitualCliDeps): Promise<number> {
  const subcommand = argv[0];

  if (subcommand === undefined) {
    deps.io.writeError(`ritual-cli: no subcommand given. ${USAGE}`);
    return 2;
  }

  if (subcommand === "morning") {
    // Task 27 / Story 5.3: `morning` is the ONLY subcommand that passes a
    // `checkDegraded` function — see `checkMorningPlanGenerationDegraded`'s
    // own doc comment for why this check is specific to Plan generation and
    // not something the other three subcommands have an equivalent of.
    return withFailureAlert(
      "morning",
      deps.runMorning,
      handleMorningResult,
      deps.io,
      deps.sendFailureAlert,
      deps.checkMissedRun,
      deps.recordInvocation,
      checkMorningPlanGenerationDegraded,
    );
  }

  if (subcommand === "night-prompt") {
    return withFailureAlert("night-prompt", deps.runNightPrompt, handleNightPromptResult, deps.io, deps.sendFailureAlert, deps.checkMissedRun, deps.recordInvocation);
  }

  if (subcommand === "night-escalate") {
    return withFailureAlert("night-escalate", deps.runNightEscalate, handleNightEscalateResult, deps.io, deps.sendFailureAlert, deps.checkMissedRun, deps.recordInvocation);
  }

  if (subcommand === "self-check") {
    return withFailureAlert("self-check", deps.runSelfCheck, handleSelfCheckResult, deps.io, deps.sendFailureAlert, deps.checkMissedRun, deps.recordInvocation);
  }

  const planned = Object.hasOwn(SUBCOMMANDS, subcommand)
    ? SUBCOMMANDS[subcommand as keyof typeof SUBCOMMANDS]
    : undefined;
  deps.io.writeError(
    planned === undefined
      ? `ritual-cli: unknown subcommand "${subcommand}". ${USAGE}`
      : `ritual-cli: "${subcommand}" is not implemented yet — it arrives with ${planned}. ${USAGE}`,
  );
  return 2;
}

/**
 * AD-7's top-level failure-alert wrapper (Task 25 / Story 5.1), factored
 * ONCE (AD-9's spirit) and applied identically to all four subcommands from
 * `runRitualCli` above — not the same try/catch-plus-alert hand-rolled four
 * times.
 *
 * Wraps a subcommand's ENTIRE invocation, covering BOTH failure modes AD-7
 * names:
 *  (a) a `Result` failure returned by `runSubcommand` — the ordinary,
 *      expected-shape failure `rituals/*.ts` produces per AD-8; and
 *  (b) a thrown error escaping `runSubcommand` entirely. `rituals/*.ts`
 *      shouldn't normally throw (AD-8: it's the layer that catches adapter
 *      throws and converts them to `Result` failures) — this `try/catch` is
 *      the defensive outer layer AD-7's "wraps its entire invocation" calls
 *      for, one boundary further out than that AD-8 guarantee.
 *
 * On either, exactly one Pushover alert is sent (via `sendAlertSafely`,
 * below) BEFORE this returns a non-zero exit code, worded distinctly from a
 * normal Plan/close-out/Self-Check notification. `handleResult` still owns
 * the existing structured-stderr-line/exit-code logic for the
 * `Result`-failure case unchanged (this task keeps those lines as-is per its
 * own scope note) — this wrapper only adds the alert send in front of it,
 * and adds an equivalent structured line of its own for the thrown case,
 * which previously had no handler at all.
 *
 * Task 26 update (Story 5.2, AD-7): now ALSO runs `checkMissedRun` FIRST,
 * before any of the above — the dead-man's-switch check for whether this
 * subcommand has actually been invoked recently enough. When it reports a
 * miss, exactly one further Pushover alert is sent (via
 * `sendMissedRunAlertSafely`, worded distinctly from BOTH a normal
 * notification AND the "failed" alert above). Critically, this check is
 * PURELY ADDITIVE: whether or not it fires, `runSubcommand` below still
 * runs — see the file docstring's "Self-healing, not cascading" section for
 * why a missed-run alert must never gate or skip the subcommand's own work.
 *
 * Task 26 review-fix update: `checkMissedRun()` is now called through
 * `safeCheckMissedRun` (its own try/catch, entirely separate from — and
 * BEFORE — the try/catch below) so a throwing check can never escape this
 * function, never skips `runSubcommand`, and never suppresses the failure
 * alert below either (all three of which happened before this fix, since
 * an unguarded throw here used to propagate straight out of
 * `withFailureAlert` entirely). `recordInvocation()` (also wrapped,
 * `safeRecordInvocation`) is now called unconditionally after
 * `runSubcommand` resolves — in the caught-throw branch AND the normal
 * return branch, `Result` success or failure alike — writing the
 * `RitualInvocation` marker `checkDailyRitualMissedRun`/
 * `checkSelfCheckMissedRun` read on the NEXT invocation. See both
 * functions' own doc comments and the file docstring's "Task 26 review-fix
 * update" section for the full reasoning.
 *
 * Task 27 update (Story 5.3, AD-7/AD-9): now ALSO accepts an optional
 * `checkDegraded`, run ONLY when `runSubcommand` returns an OK `Result` —
 * this is the third AD-7 signal (alongside Task 25's "did this invocation
 * fail" and Task 26's "was a PRIOR occurrence missed"), and the only one of
 * the three that reads the subcommand's own successful OUTCOME rather than
 * its absence or its failure. `morning` is currently the only caller that
 * passes one (`checkMorningPlanGenerationDegraded`, below) — every other
 * subcommand omits it, so `checkDegraded` stays `undefined` and this branch
 * never runs for them. When it reports `degraded: true`, exactly one further
 * Pushover alert is sent (`sendDegradedAlertSafely`, worded distinctly from
 * BOTH the "failed" and "missed a run" alerts) — but, like the missed-run
 * check, this is PURELY ADDITIVE: it never changes `result` or the exit code
 * `handleResult` computes from it. The Plan (or whatever the subcommand
 * produced) was already generated and delivered by the time this check
 * runs; this can only ever add an extra, distinctly-worded signal alongside
 * that success, never turn it into a failure.
 */
async function withFailureAlert<T>(
  subcommand: string,
  runSubcommand: () => Promise<Result<T, YohError>>,
  handleResult: (result: Result<T, YohError>, io: RitualCliIo) => number,
  io: RitualCliIo,
  sendFailureAlert: (notification: PlanNotification) => Promise<void>,
  checkMissedRun: () => MissedRunCheckResult,
  recordInvocation: () => void,
  checkDegraded?: (value: T) => DegradedCheckResult,
): Promise<number> {
  const missedRunCheck = safeCheckMissedRun(checkMissedRun, subcommand, io);
  if (missedRunCheck.missed) {
    await sendMissedRunAlertSafely(subcommand, missedRunCheck.detail ?? "no further detail available", io, sendFailureAlert);
  }

  let result: Result<T, YohError>;
  try {
    result = await runSubcommand();
  } catch (err) {
    safeRecordInvocation(recordInvocation, subcommand, io);
    const message = err instanceof Error ? err.message : String(err);
    await sendAlertSafely(subcommand, `thrown error — ${message}`, io, sendFailureAlert);
    io.writeError(
      JSON.stringify({
        level: "error",
        event: `ritual-cli.${subcommand}-failed`,
        kind: "thrown",
        message,
      }),
    );
    return 1;
  }

  safeRecordInvocation(recordInvocation, subcommand, io);

  if (!result.ok) {
    await sendAlertSafely(subcommand, `${result.error.kind} — ${result.error.message}`, io, sendFailureAlert);
  } else if (checkDegraded) {
    const degradedCheck = checkDegraded(result.value);
    if (degradedCheck.degraded) {
      await sendDegradedAlertSafely(subcommand, degradedCheck.detail ?? "no further detail available", io, sendFailureAlert);
    }
  }

  return handleResult(result, io);
}

/**
 * Task 26 review-fix: wraps `checkMissedRun()` in its OWN try/catch,
 * SEPARATE from and BEFORE the region the try/catch inside
 * `withFailureAlert` covers. The real checks (`checkDailyRitualMissedRun`/
 * `checkSelfCheckMissedRun`) do a live `MemoryStore` read that CAN throw (a
 * `SQLITE_BUSY` under the exact cross-process concurrency AD-10 documents
 * — e.g. `chat-cli.ts` writing while `ritual-cli.ts` reads — a malformed
 * stored blob, a disk I/O error). Left unguarded, that throw used to
 * escape `withFailureAlert` entirely: `runSubcommand` never ran (no
 * Plan/notification/marker for THIS invocation), and — worse — Task 25's
 * own failure alert never fired either, since the throw never reached ITS
 * try/catch, regressing the "any failure sends exactly one alert"
 * guarantee Task 25 built. For a persistent cause this would cascade
 * silently, alarm suppressed, forever — precisely the harm profile this
 * epic exists to prevent. A throwing check is now logged here (a
 * structured stderr line, this file's existing convention) and treated as
 * `{ missed: false }` — `runSubcommand` still runs next, unconditionally.
 */
function safeCheckMissedRun(checkMissedRun: () => MissedRunCheckResult, subcommand: string, io: RitualCliIo): MissedRunCheckResult {
  try {
    return checkMissedRun();
  } catch (err) {
    io.writeError(
      JSON.stringify({
        level: "error",
        event: "ritual-cli.missed-run-check-failed",
        subcommand,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { missed: false };
  }
}

/**
 * Task 26 review-fix: wraps `recordInvocation()` the same way
 * `safeCheckMissedRun` wraps `checkMissedRun()` above — a failure to WRITE
 * the `RitualInvocation` marker (also a live store write, also capable of
 * throwing) must not itself crash `withFailureAlert` or prevent
 * `handleResult`'s own structured-log-line/exit-code logic from still
 * running afterward. Logged and swallowed, same convention as
 * `sendPushoverAlertSafely`.
 */
function safeRecordInvocation(recordInvocation: () => void, subcommand: string, io: RitualCliIo): void {
  try {
    recordInvocation();
  } catch (err) {
    io.writeError(
      JSON.stringify({
        level: "error",
        event: "ritual-cli.record-invocation-failed",
        subcommand,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Generic "send one alert through the shared `sendFailureAlert` Pushover
 * channel, swallowing (but logging) a failure of the SEND itself" primitive
 * — `sendAlertSafely` (the "failed" wording, below) and
 * `sendMissedRunAlertSafely` (the "missed a run" wording, Task 26 / Story
 * 5.2) are both just this with a different `event`/title/message, per AD-9:
 * ONE alert-sending mechanism reused for both AD-7 signals, never two
 * parallel ones. The send failing must not prevent the existing
 * `handleResult` structured-log-line/exit-code path (or, for the missed-run
 * case, the subsequent `runSubcommand` call) from still running — that is
 * the one guarantee that MUST survive even if Pushover itself is
 * unreachable.
 */
async function sendPushoverAlertSafely(
  event: string,
  title: string,
  message: string,
  subcommand: string,
  io: RitualCliIo,
  sendFailureAlert: (notification: PlanNotification) => Promise<void>,
): Promise<void> {
  try {
    await sendFailureAlert({ title, message });
  } catch (err) {
    io.writeError(
      JSON.stringify({
        level: "error",
        event,
        subcommand,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Builds the "this run failed" alert's title/body (worded distinctly from a
 * normal Plan/close-out/Self-Check notification — see `handleMorningResult`'s
 * `NOTIFICATION_TITLE`, `NIGHT_PROMPT_NOTIFICATION_TITLE`, and
 * `SELF_CHECK_NOTIFICATION_TITLE`, none of which mention the word "failed"
 * or the subcommand's own name) and sends it via `sendPushoverAlertSafely`.
 */
async function sendAlertSafely(
  subcommand: string,
  detail: string,
  io: RitualCliIo,
  sendFailureAlert: (notification: PlanNotification) => Promise<void>,
): Promise<void> {
  return sendPushoverAlertSafely(
    "ritual-cli.failure-alert-send-failed",
    `Yoh: ${subcommand} failed`,
    `The "${subcommand}" ritual failed and needs attention: ${detail}`,
    subcommand,
    io,
    sendFailureAlert,
  );
}

/**
 * Builds the dead-man's-switch "this subcommand's own previous scheduled
 * occurrence never recorded a successful run" alert's title/body (Task 26 /
 * Story 5.2, AD-7) — worded distinctly from BOTH a normal notification AND
 * `sendAlertSafely`'s "failed" wording above (this run itself hasn't failed
 * — or even started yet — a PRIOR one appears to have never happened) and
 * sends it via the same `sendPushoverAlertSafely` primitive. Names the
 * subcommand and `detail` (roughly how long it's been, built by
 * `checkDailyRitualMissedRun`/`checkSelfCheckMissedRun`) in the body, per
 * this task's own brief.
 */
async function sendMissedRunAlertSafely(
  subcommand: string,
  detail: string,
  io: RitualCliIo,
  sendFailureAlert: (notification: PlanNotification) => Promise<void>,
): Promise<void> {
  return sendPushoverAlertSafely(
    "ritual-cli.missed-run-alert-send-failed",
    `Yoh: ${subcommand} missed a run`,
    `The "${subcommand}" ritual's previous scheduled occurrence does not show a successful run recently enough: ${detail}. This run is proceeding with its own normal work regardless (self-healing, per AD-7) — this alert is only a signal, not a block.`,
    subcommand,
    io,
    sendFailureAlert,
  );
}

/**
 * Builds the "Plan generation is running degraded" alert's title/body (Task
 * 27 / Story 5.3, AD-7) and sends it via the same `sendPushoverAlertSafely`
 * primitive (AD-9: one alert-sending mechanism reused for all THREE AD-7
 * signals now — a failed run, a missed prior run, and a degraded-but-
 * successful one — never a parallel one). Worded distinctly from BOTH
 * `sendAlertSafely`'s "failed" wording and `sendMissedRunAlertSafely`'s
 * "missed a run" wording: this run neither failed nor was skipped — it
 * completed and its own Plan/notification was delivered normally, it just
 * took unusually long. `detail` (built by `checkMorningPlanGenerationDegraded`)
 * names roughly how long it took and against what threshold.
 */
async function sendDegradedAlertSafely(
  subcommand: string,
  detail: string,
  io: RitualCliIo,
  sendFailureAlert: (notification: PlanNotification) => Promise<void>,
): Promise<void> {
  return sendPushoverAlertSafely(
    "ritual-cli.degraded-alert-send-failed",
    `Yoh: ${subcommand} running slow`,
    `The "${subcommand}" ritual completed and delivered normally, but is running degraded: ${detail}. This is a performance signal only, not a failure — nothing needs recovering.`,
    subcommand,
    io,
    sendFailureAlert,
  );
}

// ============================================================================
// Dead-man's-switch — missed-run detection (Task 26 / Story 5.2, AD-7/AD-9)
// ============================================================================

/**
 * Grace threshold for the three DAILY rituals' missed-run check
 * (`checkDailyRitualMissedRun`, below): more than this many hours since
 * `subcommand`'s own last-recorded `RitualInvocation.at` is treated as a
 * missed prior occurrence. A documented, concrete starting value (tunable —
 * mirrors this project's established pattern for FR-2's even-split
 * weights, FR-11's slip curve, Self-Check's own interval/low-score
 * threshold, etc.), not derived from anything else.
 *
 * Reasoning: normal daily cadence produces roughly a 24h gap between
 * consecutive invocations. `36` gives ~12h of slack above that for
 * ordinary schedule jitter (a cron trigger running an hour or two early or
 * late, a DST transition, a slow morning) while still catching a single
 * FULLY missed day (~48h gap) well before a SECOND day could also go
 * missed — the very next run after the miss is what raises the alert, per
 * the file docstring's "Self-healing, not cascading" section.
 */
export const DAILY_RITUAL_MISSED_RUN_GRACE_HOURS = 36;

/**
 * Grace threshold for `self-check`'s missed-run check
 * (`checkSelfCheckMissedRun`, below), expressed in DAYS (converted to hours
 * internally — `checkInvocationStaleness` only ever takes hours) for
 * readability against Self-Check's own ~4-day cadence: more than this many
 * days since `self-check`'s own last-recorded `RitualInvocation.at` is
 * treated as a missed run. A documented, concrete starting value, chosen
 * the same way as `DAILY_RITUAL_MISSED_RUN_GRACE_HOURS` above.
 *
 * Reasoning: `ritual-cli.ts self-check` is presumably invoked by OS cron at
 * some fixed granularity independent of Self-Check's own ~4-day due-date
 * cadence (`SELF_CHECK_DEFAULT_INTERVAL_DAYS`, `rituals/self-check.ts` —
 * see that file's own "Randomization mechanism" docstring section: the
 * RITUAL decides whether "now" is due, not the trigger frequency itself).
 * `5` stays deliberately generous relative to that assumed cadence — large
 * enough that no plausible trigger frequency's ordinary jitter could ever
 * cross it, small enough that a genuine scheduler/host outage is still
 * caught within roughly one Self-Check cadence-length, not silently
 * forever.
 */
export const SELF_CHECK_MISSED_RUN_GRACE_DAYS = 5;

/**
 * Shared staleness check underlying BOTH `checkDailyRitualMissedRun` and
 * `checkSelfCheckMissedRun` below: has `subcommand` been INVOKED — its
 * process ran to completion, `Result` success or failure, crash or not —
 * within `graceHours`? Reads `memory-store.ts`'s `RitualInvocation` marker
 * (Task 26 review fix), written unconditionally by `withFailureAlert`
 * after EVERY invocation of `subcommand` — unlike `RitualRun`/
 * `SelfCheckState`, which only advance on specific ritual-DOMAIN outcomes
 * and so produced false alarms on ordinary, correct no-op days (see the
 * file docstring's "Task 26 review-fix update" section for the full
 * history).
 *
 * **Cold start exemption.** `getRitualInvocation` returning `undefined`
 * means `subcommand` has NEVER been invoked at all yet — the expected,
 * ordinary state of a brand-new install, not a missed occurrence; this
 * returns `{ missed: false }` for it, never an alert.
 */
function checkInvocationStaleness(store: MemoryStore, subcommand: string, now: () => Date, graceHours: number): MissedRunCheckResult {
  const lastInvocation = getRitualInvocation(store, subcommand);
  if (!lastInvocation) {
    return { missed: false };
  }
  const hoursSince = (now().getTime() - new Date(lastInvocation.data.at).getTime()) / (60 * 60 * 1000);
  if (hoursSince <= graceHours) {
    return { missed: false };
  }
  return {
    missed: true,
    detail: `no invocation of "${subcommand}" has been observed since ${lastInvocation.data.at} (~${(hoursSince / 24).toFixed(1)} days ago; grace: ${graceHours}h)`,
  };
}

/**
 * Task 26 / Story 5.2's dead-man's-switch check for the three DAILY rituals
 * (`morning`, `night-prompt`, `night-escalate`) — `checkInvocationStaleness`
 * with `DAILY_RITUAL_MISSED_RUN_GRACE_HOURS`. Exported (like
 * `checkSelfCheckMissedRun` below) so the threshold and the cold-start
 * exemption are each independently unit-testable against a real
 * `MemoryStore`, separately from the `withFailureAlert`/`runRitualCli`
 * wiring that actually calls it.
 */
export function checkDailyRitualMissedRun(store: MemoryStore, subcommand: string, now: () => Date): MissedRunCheckResult {
  return checkInvocationStaleness(store, subcommand, now, DAILY_RITUAL_MISSED_RUN_GRACE_HOURS);
}

/**
 * Task 26 / Story 5.2's dead-man's-switch check for `self-check` —
 * `checkInvocationStaleness` with `SELF_CHECK_MISSED_RUN_GRACE_DAYS * 24`
 * hours, keyed by the `"self-check"` subcommand name. Prior to the Task 26
 * review fix this read `SelfCheckState.nextDueDate` instead (a genuinely
 * different mechanism, since Self-Check's own cadence is variable and
 * randomized) — that produced a false alarm from an unanswered-but-normal
 * `already-open` Self-Check prompt (a state `nextDueDate` never advances
 * past). Reading the SAME `RitualInvocation` marker
 * `checkDailyRitualMissedRun` reads (just with `self-check`'s own grace)
 * fixes that: the marker updates on every invocation regardless of what
 * Self-Check's own ritual-domain logic decided to do this time.
 */
export function checkSelfCheckMissedRun(store: MemoryStore, now: () => Date): MissedRunCheckResult {
  return checkInvocationStaleness(store, "self-check", now, SELF_CHECK_MISSED_RUN_GRACE_DAYS * 24);
}

// ============================================================================
// Plan-generation performance threshold (Task 27 / Story 5.3, AD-7)
// ============================================================================

/**
 * `morning`'s degraded-performance check (Task 27 / Story 5.3): did Plan
 * generation (the Data-Completeness Gate through Work/Break fitting — see
 * `morning-ritual.ts`'s `PLAN_GENERATION_DEGRADED_THRESHOLD_MS` doc comment
 * for the exact span and the threshold's own reasoning) take longer than
 * that threshold? Exported (like `checkDailyRitualMissedRun`/
 * `checkSelfCheckMissedRun` above) so it is independently unit-testable
 * against a plain `MorningRitualOutcome` value, separately from the
 * `withFailureAlert`/`runRitualCli` wiring that actually calls it.
 *
 * Only the two outcomes that genuinely complete that span —
 * `"delivered"`/`"nothing-fits"`, both of which carry an optional
 * `planGenerationMs` — have anything to check at all; every other outcome
 * (`"already-ran"`/`"nothing-to-plan"`, an early no-op that never reaches
 * Work/Break fitting) is never degraded by definition, since no
 * Plan-generation span ran to completion for it. Passing `undefined` here
 * has the SAME effect as passing a value at/under the threshold — both
 * resolve to `{ degraded: false }` — since a run with nothing measured is
 * exactly as un-degraded as a run that measured comfortably fast.
 *
 * This never turns a successful `Result` into a failure — the Plan was
 * already generated and delivered by the time this runs; it only decides
 * whether `withFailureAlert` raises an ADDITIONAL, distinctly-worded alert
 * alongside the normal exit-code-0 success path `handleMorningResult`
 * already produces.
 */
export function checkMorningPlanGenerationDegraded(outcome: MorningRitualOutcome): DegradedCheckResult {
  const ms = outcome.status === "delivered" || outcome.status === "nothing-fits" ? outcome.planGenerationMs : undefined;
  if (ms === undefined || ms <= PLAN_GENERATION_DEGRADED_THRESHOLD_MS) {
    return { degraded: false };
  }
  return {
    degraded: true,
    detail: `Plan generation (Data-Completeness Gate through Work/Break fitting) took ${(ms / 1000).toFixed(1)}s, over the ${(PLAN_GENERATION_DEGRADED_THRESHOLD_MS / 1000).toFixed(1)}s threshold`,
  };
}

function handleMorningResult(result: Result<MorningRitualOutcome, YohError>, io: RitualCliIo): number {
  if (!result.ok) {
    // The structured log line AD-7's real failure alerting (Task 25 /
    // Story 5.1, `withFailureAlert` above) reads before this function ever
    // runs — the alert is already sent by the time control reaches here.
    // One JSON object per line so a cron mail/log aggregator can parse it
    // without guessing at prose.
    io.writeError(
      JSON.stringify({
        level: "error",
        event: "ritual-cli.morning-failed",
        kind: result.error.kind,
        message: result.error.message,
      }),
    );
    return 1;
  }

  switch (result.value.status) {
    case "already-ran":
      io.writeLine(`The Morning Ritual already ran today (${result.value.date}) — nothing more to send.`);
      return 0;
    case "nothing-to-plan":
      io.writeLine(
        `Nothing could be planned for ${result.value.date} yet — ${result.value.incompleteTaskIds.length} Task(s) are still missing planning fields. I've left a note for you in chat.`,
      );
      return 0;
    case "nothing-fits":
      io.writeLine(
        `Nothing fits ${result.value.date}'s Time Budget — all ${result.value.deferredTaskIds.length} Task(s) were deferred. Declare more time in chat and run this again.`,
      );
      return 0;
    case "delivered":
      io.writeLine(result.value.rendered);
      return 0;
  }
}

/** Mirrors `handleMorningResult`'s shape/exit-code conventions for the `night-prompt` subcommand's outcomes (Task 19 / Story 3.1). */
function handleNightPromptResult(result: Result<NightPromptOutcome, YohError>, io: RitualCliIo): number {
  if (!result.ok) {
    io.writeError(
      JSON.stringify({
        level: "error",
        event: "ritual-cli.night-prompt-failed",
        kind: result.error.kind,
        message: result.error.message,
      }),
    );
    return 1;
  }

  switch (result.value.status) {
    case "already-ran":
      io.writeLine(`The Night Ritual close-out already ran today (${result.value.date}) — nothing more to send.`);
      return 0;
    case "no-plan-today":
      io.writeLine(`No Plan has been generated for ${result.value.date} yet — nothing to close out.`);
      return 0;
    case "nothing-to-confirm":
      io.writeLine(`Nothing to confirm for ${result.value.date} — today's Plan has no work blocks.`);
      return 0;
    case "prompted":
      io.writeLine(
        `Asked Spencer to confirm ${result.value.tasks.length} Task${result.value.tasks.length === 1 ? "" : "s"} from today — check chat to answer.`,
      );
      return 0;
  }
}

/** Mirrors `handleNightPromptResult`'s shape/exit-code conventions for the `night-escalate` subcommand's outcomes (Task 20 / Story 3.2). */
function handleNightEscalateResult(result: Result<NightEscalateOutcome, YohError>, io: RitualCliIo): number {
  if (!result.ok) {
    io.writeError(
      JSON.stringify({
        level: "error",
        event: "ritual-cli.night-escalate-failed",
        kind: result.error.kind,
        message: result.error.message,
      }),
    );
    return 1;
  }

  switch (result.value.status) {
    case "already-ran":
      io.writeLine(`The Night Ritual escalation already ran today (${result.value.date}) — nothing more to send.`);
      return 0;
    case "not-prompted-yet":
      io.writeLine(
        `Nothing to escalate for ${result.value.date} yet — night-prompt hasn't run tonight. Try again after it does.`,
      );
      return 0;
    case "no-open-request":
      io.writeLine(`Nothing to escalate for ${result.value.date} — the close-out was already answered. No-op.`);
      return 0;
    case "escalated":
      io.writeLine(renderNightEscalateNotice(result.value.tasks.length, result.value.date));
      return 0;
  }
}

/** Mirrors `handleNightPromptResult`'s shape/exit-code conventions for the `self-check` subcommand's outcomes (Task 24 / Story 4.3). */
function handleSelfCheckResult(result: Result<SelfCheckOutcome, YohError>, io: RitualCliIo): number {
  if (!result.ok) {
    io.writeError(
      JSON.stringify({
        level: "error",
        event: "ritual-cli.self-check-failed",
        kind: result.error.kind,
        message: result.error.message,
      }),
    );
    return 1;
  }

  switch (result.value.status) {
    case "initialized":
      io.writeLine(`Self-Check schedule initialized for the first time — next check-in around ${result.value.nextDueDate}.`);
      return 0;
    case "not-due":
      io.writeLine(`Not due for a Self-Check yet — next one around ${result.value.nextDueDate}.`);
      return 0;
    case "already-open":
      io.writeLine(`Already waiting on Spencer's answer to the last Self-Check prompt — check chat.`);
      return 0;
    case "prompted":
      io.writeLine(`Asked Spencer for a Self-Check — check chat to answer.`);
      return 0;
  }
}

// ============================================================================
// Real adapter wiring
// ============================================================================

/**
 * Binds the real Notion, Google Calendar, and Pushover adapters (plus the
 * `MemoryStore`) to `runMorningRitual`'s injected seams. Every credential
 * and workspace id is read from the environment once, here, at process start
 * (AD-10) — nothing below this line reads `process.env` again.
 *
 * Note the two adapters are wrapped as zero-argument thunks: the ritual
 * deliberately knows nothing about a Notion `Client` or a Calendar
 * `OAuth2Client`, only "give me today's Tasks" and "give me today's events."
 * Both still throw on I/O failure exactly as AD-8 requires; the ritual is
 * what catches them.
 *
 * **The `bumpLevels` bridge (Task 19 — Task 17's deferred item, closed
 * here).** Task 17 built `slip-bump.ts`'s computation and
 * `memory-store.ts`'s `SlipHistory` storage, but nothing populated a
 * `SlipHistory` row until Task 19's Night Ritual close-out
 * (`applyNightCloseOutConfirmation`, `rituals/night-ritual.ts`) exists, and
 * nothing here ever read `listSlipHistories` to build the `bumpLevels` map
 * `MorningRitualDeps` has always accepted. Both halves now exist: every
 * currently-stored `SlipHistory` row is read (`listSlipHistories`) and
 * turned into the `taskId -> bump level` map `orderByDerivedPriority`/
 * `generatePlanReasoning` expect via the SAME `core/slip-bump.ts`
 * computation (`computeSlipBumpLevels`) the rest of the system uses — not a
 * re-derivation of that arithmetic here. So tomorrow's Morning Ritual now
 * genuinely reflects tonight's close-out: a Task confirmed slipped tonight
 * shows up bumped in tomorrow's Plan ordering, exactly as a mid-day-reported
 * slip already did before this task existed.
 */
export function createMorningRitualDeps(
  store: MemoryStore,
  env: Readonly<Record<string, string | undefined>> = process.env,
): MorningRitualDeps {
  const timeZone = env["YOH_TIMEZONE"];
  if (!timeZone) {
    // calendar-adapter.ts deliberately refuses to default this to UTC (a
    // silent default silently drops late-evening events); so does this.
    throw new Error("ritual-cli: missing required environment variable YOH_TIMEZONE (e.g. America/New_York)");
  }
  const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
  const projectsDataSourceId = env["NOTION_PROJECTS_DATA_SOURCE_ID"];
  const notionToken = env["NOTION_TOKEN"];
  if (!tasksDataSourceId || !projectsDataSourceId || !notionToken) {
    throw new Error(
      "ritual-cli: missing required environment variable(s) NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID / NOTION_PROJECTS_DATA_SOURCE_ID",
    );
  }
  const taskPropertyNames = loadTaskPropertyNamesFromEnv(env);

  const notionClient = new Client({
    auth: notionToken,
    ...(env["NOTION_API_VERSION"] ? { notionVersion: env["NOTION_API_VERSION"] } : {}),
  });
  const tokenStore = createTokenStore(loadGoogleOAuthConfigFromEnv(env));
  // `@googleapis/calendar` reaches its Google auth-client types through a
  // transitively-pinned COPY of that library (10.5.0, nested under
  // `googleapis-common`) while `token-store.ts` — AD-10's sole holder of the
  // real client — constructs one from the top-level copy (11.0.2). The two
  // classes are structurally identical at runtime but declare separate
  // private fields, so TypeScript treats them as unrelated nominal types.
  // This one documented cast, at the single seam where the two meet, is the
  // narrowest possible place to reconcile that; the alternative (importing
  // the auth library's own types here to line them up) is forbidden outright
  // by AD-10 and enforced by the repo scan in `tests/token-store.test.ts`.
  // The cast is expressed via `createCalendarReadClient`'s own parameter type
  // rather than by naming the package, for that same reason.
  const calendarClient = createCalendarReadClient(
    tokenStore.getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0],
  );
  // Final whole-branch review, Finding 1: the "Yoh Plan" Calendar-write
  // surface (Task 12 / Story 1.12, AD-4) was built, tested, and reviewed but
  // never wired to a caller. Same `authClient` source and the same
  // documented cast as the read client just above (see that call's own
  // comment for the two-copies-of-the-auth-library reasoning). `tokenStore`
  // already structurally satisfies `CalendarIdStore`
  // (`getCalendarId`/`setCalendarId`, `token-store.ts` lines ~190-195), so it
  // is passed directly — no adapter import of `token-store.ts` (AD-1).
  const calendarWriteClient = createCalendarWriteClient(
    tokenStore.getOAuth2Client() as unknown as Parameters<typeof createCalendarWriteClient>[0],
  );
  const pushoverConfig = loadPushoverConfigFromEnv(env);

  // The bumpLevels bridge (see the doc comment above): every currently-
  // stored SlipHistory row, turned into a `taskId -> consecutiveSlipCount`
  // map, then the REAL `core/slip-bump.ts` computation over it — never a
  // parallel/hand-rolled escalation here.
  const slipCounts: Record<ExternalId, number> = {};
  for (const record of listSlipHistories(store)) {
    slipCounts[record.id] = record.data.consecutiveSlipCount;
  }
  const bumpLevels = computeSlipBumpLevels(slipCounts);

  return {
    store,
    readTasks: async () =>
      (await readNotionTasks(notionClient, { tasksDataSourceId, projectsDataSourceId, taskPropertyNames })).tasks,
    readCalendarEvents: () => readCalendarEvents(calendarClient, { timeZone }),
    // Final whole-branch review, Finding 1: mirrors `readCalendarEvents`
    // above — bound to the same `tokenStore`, which structurally satisfies
    // `CalendarIdStore`. `blocks` is already `"calendar-anchor"`-filtered by
    // the caller (`runMorningRitual`'s step 12a.5) before this is invoked.
    writeCalendarPlan: (blocks) => writeTodaysPlanToCalendar(calendarWriteClient, tokenStore, blocks, { timeZone }),
    sendNotification: (notification) => sendPushoverNotification(pushoverConfig, notification),
    now: () => new Date(),
    timeZone,
    bumpLevels,
    // Task 27 / Story 5.3 (AD-9): delegates to the ONE shared writer in
    // `adapters/logger.ts` instead of repeating this closure per subcommand
    // (all four `create*RitualDeps` functions used to have their own
    // byte-identical copy of it).
    log: (entry) => writeStructuredLog(entry),
  };
}

/**
 * Binds the real `MemoryStore` and Pushover adapter to
 * `runNightPromptRitual`'s injected seams (Task 19 / Story 3.1; Pushover
 * added by Task 20's review fix — see `rituals/night-ritual.ts`'s "The first
 * attempt's own push notification" docstring section). Still lighter than
 * `createMorningRitualDeps`: `night-prompt` reads the already-stored Plan,
 * persists an interaction request, and sends one Pushover push — no Notion
 * or Calendar credentials are needed, so running it must not require THOSE
 * to be configured (mirrors `shell/chat-cli.ts`'s own "don't force unrelated
 * config" convention for its lazily-constructed `readTasks`). Pushover
 * credentials ARE required now, same as `morning`.
 */
export function createNightPromptRitualDeps(
  store: MemoryStore,
  env: Readonly<Record<string, string | undefined>> = process.env,
): NightPromptRitualDeps {
  const timeZone = env["YOH_TIMEZONE"];
  if (!timeZone) {
    throw new Error("ritual-cli: missing required environment variable YOH_TIMEZONE (e.g. America/New_York)");
  }
  const pushoverConfig = loadPushoverConfigFromEnv(env);

  return {
    store,
    sendNotification: (notification) => sendPushoverNotification(pushoverConfig, notification),
    now: () => new Date(),
    timeZone,
    // Task 27 / Story 5.3 (AD-9): delegates to the ONE shared writer in
    // `adapters/logger.ts` instead of repeating this closure per subcommand
    // (all four `create*RitualDeps` functions used to have their own
    // byte-identical copy of it).
    log: (entry) => writeStructuredLog(entry),
  };
}

/**
 * Binds the real `MemoryStore` and `adapters/email-adapter.ts`'s `sendEmail`
 * to `runNightEscalateRitual`'s injected seams (Task 20 / Story 3.2). Like
 * `createNightPromptRitualDeps`, deliberately far lighter than
 * `createMorningRitualDeps`: `night-escalate` needs only the SMTP
 * credentials `email-adapter.ts` reads (`loadEmailConfigFromEnv`) — no
 * Notion, Calendar, or Pushover config is required BY THIS FUNCTION, so
 * building THESE deps must not fail at startup for lack of them.
 *
 * Task 25 update (Story 5.1): running `night-escalate` as a whole now DOES
 * require Pushover credentials anyway — not through this function, but
 * through `main`'s separate `createFailureAlertSender` call for AD-7's
 * failure-alert channel (see that function's own doc comment). This
 * function's own scope is deliberately unchanged by that: it still knows
 * nothing about Pushover, keeping the "one seam, one concern" shape AD-9
 * wants even though the two are now both required to actually run.
 */
export function createNightEscalateRitualDeps(
  store: MemoryStore,
  env: Readonly<Record<string, string | undefined>> = process.env,
): NightEscalateRitualDeps {
  const timeZone = env["YOH_TIMEZONE"];
  if (!timeZone) {
    throw new Error("ritual-cli: missing required environment variable YOH_TIMEZONE (e.g. America/New_York)");
  }
  const emailConfig = loadEmailConfigFromEnv(env);

  return {
    store,
    sendEscalationEmail: (message) => sendEmail(emailConfig, message),
    now: () => new Date(),
    timeZone,
    // Task 27 / Story 5.3 (AD-9): delegates to the ONE shared writer in
    // `adapters/logger.ts` instead of repeating this closure per subcommand
    // (all four `create*RitualDeps` functions used to have their own
    // byte-identical copy of it).
    log: (entry) => writeStructuredLog(entry),
  };
}

/**
 * Binds the real `MemoryStore` and Pushover adapter to
 * `runSelfCheckRitual`'s injected seams (Task 24 / Story 4.3; Pushover added
 * by this task's own review fix — see `rituals/self-check.ts`'s "The push
 * notification" docstring section for why this is required from the start,
 * unlike `night-prompt`'s Task 20 review-fix retrofit). Still lighter than
 * `createMorningRitualDeps`: no Notion, Calendar, or SMTP credentials are
 * needed — only `YOH_TIMEZONE` plus Pushover's own
 * `PUSHOVER_APP_TOKEN`/`PUSHOVER_USER_KEY`. `random` binds to the real
 * `Math.random`, injected the same way every other non-deterministic seam in
 * this codebase is.
 */
export function createSelfCheckRitualDeps(
  store: MemoryStore,
  env: Readonly<Record<string, string | undefined>> = process.env,
): SelfCheckRitualDeps {
  const timeZone = env["YOH_TIMEZONE"];
  if (!timeZone) {
    throw new Error("ritual-cli: missing required environment variable YOH_TIMEZONE (e.g. America/New_York)");
  }
  const pushoverConfig = loadPushoverConfigFromEnv(env);

  return {
    store,
    now: () => new Date(),
    timeZone,
    random: Math.random,
    sendNotification: (notification) => sendPushoverNotification(pushoverConfig, notification),
    // Task 27 / Story 5.3 (AD-9): delegates to the ONE shared writer in
    // `adapters/logger.ts` instead of repeating this closure per subcommand
    // (all four `create*RitualDeps` functions used to have their own
    // byte-identical copy of it).
    log: (entry) => writeStructuredLog(entry),
  };
}

/** A `RitualCliDeps` runner that throws if called — used for the OTHER subcommand's slot below, mirroring `shell/chat-cli.ts`'s "throws only if actually invoked" convention for a seam a given run never exercises. */
function unreachableRunner(label: string): () => Promise<never> {
  return () => {
    throw new Error(`ritual-cli: ${label} should not be invoked for this subcommand`);
  };
}

/**
 * Builds `RitualCliDeps.sendFailureAlert` (Task 25 / Story 5.1): binds the
 * real `adapters/notification-adapter.ts` Pushover adapter to AD-7's
 * failure-alert channel. Loaded SEPARATELY from any subcommand's own
 * `sendNotification` wiring above — see `RitualCliDeps.sendFailureAlert`'s
 * own doc comment for why. Consequence: every subcommand now needs
 * `PUSHOVER_APP_TOKEN`/`PUSHOVER_USER_KEY` configured for THIS reason alone
 * — even `night-escalate`, whose own ritual has no Pushover seam of its own
 * (it uses email; see `createNightEscalateRitualDeps`'s doc comment) and,
 * before this task, needed no Pushover credentials to run at all. That is
 * this task's intended scope: AD-7's alert channel must work "regardless of
 * whether that subcommand's own ritual has a notification seam at all."
 */
function createFailureAlertSender(
  env: Readonly<Record<string, string | undefined>>,
): (notification: PlanNotification) => Promise<void> {
  const pushoverConfig = loadPushoverConfigFromEnv(env);
  return (notification) => sendPushoverNotification(pushoverConfig, notification);
}

/**
 * Real entrypoint: opens the `MemoryStore` (per `MEMORY_DB_PATH`, defaulting
 * to `./data/yoh-memory.db` — the same default `.env.example` documents and
 * `chat-cli.ts` uses), wires ONLY the real adapters the requested subcommand
 * actually needs, dispatches, and always closes the store. Returns the exit
 * code rather than setting it, so it stays callable from a test.
 *
 * Deliberately branches on `argv[0]` BEFORE constructing any ritual's deps
 * (Task 19 review note, extended by Task 20): `createMorningRitualDeps`
 * requires Notion/Calendar/Pushover credentials that neither `night-prompt`
 * nor `night-escalate` has any use for (see `createNightPromptRitualDeps`'s
 * and `createNightEscalateRitualDeps`'s own doc comments), and
 * `createNightEscalateRitualDeps` requires SMTP credentials the other two
 * have no use for — running any one subcommand must not fail at startup
 * just because a DIFFERENT subcommand's credentials happen to be
 * unconfigured.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  const io: RitualCliIo = {
    writeLine: (line) => {
      process.stdout.write(`${line}\n`);
    },
    writeError: (line) => {
      process.stderr.write(`${line}\n`);
    },
  };

  const store = createMemoryStore({ databasePath: env["MEMORY_DB_PATH"] || "./data/yoh-memory.db" });
  try {
    if (argv[0] === "night-prompt") {
      let deps: NightPromptRitualDeps;
      let sendFailureAlert: (notification: PlanNotification) => Promise<void>;
      try {
        deps = createNightPromptRitualDeps(store, env);
        sendFailureAlert = createFailureAlertSender(env);
      } catch (err) {
        io.writeError(`ritual-cli: ${err instanceof Error ? err.message : String(err)}`);
        return 2;
      }
      return await runRitualCli(argv, {
        io,
        runMorning: unreachableRunner("runMorning"),
        runNightPrompt: () => runNightPromptRitual(deps),
        runNightEscalate: unreachableRunner("runNightEscalate"),
        runSelfCheck: unreachableRunner("runSelfCheck"),
        sendFailureAlert,
        checkMissedRun: () => checkDailyRitualMissedRun(store, "night-prompt", () => new Date()),
        recordInvocation: () => putRitualInvocation(store, "night-prompt", { at: new Date().toISOString() }),
      });
    }

    if (argv[0] === "night-escalate") {
      let deps: NightEscalateRitualDeps;
      let sendFailureAlert: (notification: PlanNotification) => Promise<void>;
      try {
        deps = createNightEscalateRitualDeps(store, env);
        sendFailureAlert = createFailureAlertSender(env);
      } catch (err) {
        io.writeError(`ritual-cli: ${err instanceof Error ? err.message : String(err)}`);
        return 2;
      }
      return await runRitualCli(argv, {
        io,
        runMorning: unreachableRunner("runMorning"),
        runNightPrompt: unreachableRunner("runNightPrompt"),
        runNightEscalate: () => runNightEscalateRitual(deps),
        runSelfCheck: unreachableRunner("runSelfCheck"),
        sendFailureAlert,
        checkMissedRun: () => checkDailyRitualMissedRun(store, "night-escalate", () => new Date()),
        recordInvocation: () => putRitualInvocation(store, "night-escalate", { at: new Date().toISOString() }),
      });
    }

    if (argv[0] === "self-check") {
      let deps: SelfCheckRitualDeps;
      let sendFailureAlert: (notification: PlanNotification) => Promise<void>;
      try {
        deps = createSelfCheckRitualDeps(store, env);
        sendFailureAlert = createFailureAlertSender(env);
      } catch (err) {
        io.writeError(`ritual-cli: ${err instanceof Error ? err.message : String(err)}`);
        return 2;
      }
      return await runRitualCli(argv, {
        io,
        runMorning: unreachableRunner("runMorning"),
        runNightPrompt: unreachableRunner("runNightPrompt"),
        runNightEscalate: unreachableRunner("runNightEscalate"),
        runSelfCheck: () => runSelfCheckRitual(deps),
        sendFailureAlert,
        checkMissedRun: () => checkSelfCheckMissedRun(store, () => new Date()),
        recordInvocation: () => putRitualInvocation(store, "self-check", { at: new Date().toISOString() }),
      });
    }

    let deps: MorningRitualDeps;
    let sendFailureAlert: (notification: PlanNotification) => Promise<void>;
    try {
      deps = createMorningRitualDeps(store, env);
      sendFailureAlert = createFailureAlertSender(env);
    } catch (err) {
      io.writeError(`ritual-cli: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
    return await runRitualCli(argv, {
      io,
      runMorning: () => runMorningRitual(deps),
      runNightPrompt: unreachableRunner("runNightPrompt"),
      runNightEscalate: unreachableRunner("runNightEscalate"),
      runSelfCheck: unreachableRunner("runSelfCheck"),
      sendFailureAlert,
      checkMissedRun: () => checkDailyRitualMissedRun(store, "morning", () => new Date()),
      recordInvocation: () => putRitualInvocation(store, "morning", { at: new Date().toISOString() }),
    });
  } finally {
    store.close();
  }
}

if (import.meta.main) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`ritual-cli: fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
