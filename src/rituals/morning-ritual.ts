/**
 * src/rituals/morning-ritual.ts
 *
 * The Morning Ritual (Story 1.10 / FR-1, FR-3): the first `rituals/*.ts`
 * file, and the place every `core/` + `adapters/` piece built so far is
 * finally assembled into one delivered artifact — a single ordered Plan,
 * rendered per DESIGN.md, pushed to Spencer's phone exactly once a day.
 *
 * ============================================================================
 * Orchestration (the shape this file commits to)
 * ============================================================================
 *
 * `runMorningRitual` runs these steps in order, short-circuiting on the
 * first that can't proceed. Every I/O edge is injected (`MorningRitualDeps`)
 * so the whole ritual is testable without a network, a clock, or a TTY;
 * `shell/ritual-cli.ts` is what binds the real adapters to these seams.
 *
 *  1. **Idempotence guard.** Read the `"morning"` ritual-run marker from
 *     `memory-store.ts`. If it already records today's LOCAL date, return
 *     `already-ran` immediately — no re-read, no re-plan, and above all no
 *     second notification (Story 1.10's second acceptance criterion). This
 *     is first so a duplicate cron trigger costs two SQLite reads and zero
 *     API calls.
 *  2. **Read Notion Tasks** (`readTasks`, may throw — AD-8).
 *  3. **Merge stored `TaskFieldOverride`s, run the Data-Completeness Gate,
 *     and sync the open interaction request** (`runDataCompletenessGate`,
 *     below — the same wiring Task 5 originally built inside
 *     `shell/chat-cli.ts` (since retired, Story 8.9), which now lives here;
 *     see "Where the gate wiring lives" below).
 *  4. **Decide whether there is anything to plan.** Per AD-11 an incomplete
 *     Task simply never becomes a `CompleteTask`, so it is absent from the
 *     Plan while every complete Task is planned normally — an incomplete
 *     Task never blocks the rest of the day (UX-DR10: "gate what you can,
 *     prompt for the rest"). Only when NO Task is complete is there nothing
 *     to build: that run returns `nothing-to-plan`, sends no notification,
 *     and deliberately does NOT write the ran-today marker, so a later
 *     trigger (after Spencer answers the open prompt in Chat) can
 *     still produce the morning Plan rather than the day being burned by a
 *     run that produced nothing.
 *  5. **Read today's Calendar events** (`readCalendarEvents`, may throw).
 *     Deliberately after the gate, so a day with nothing plannable costs no
 *     Calendar API call.
 *  6. **Read today's declared Time Budget** (`getCurrentTimeBudget` +
 *     `core/time-budget.ts`'s `resolveTodayTimeBudget`, which reports a
 *     carried-forward value without ever expiring it). If Spencer has never
 *     declared one, this fails with `YohError.kind: "missing-field"` rather
 *     than inventing a total — `core/time-budget.ts` deliberately defines no
 *     default total (only the 70/15 work/break rhythm), and quietly guessing
 *     one would fabricate the single input FR-5 exists to get from Spencer.
 *  7. **Order by Derived Priority** (`core/derived-priority.ts`).
 *  8. **Fit into Work/Break blocks around the Calendar anchors**
 *     (`core/work-break-fit.ts`), starting at the instant the ritual runs.
 *  9. **Generate the reasoning line** (`core/plan-reasoning.ts`) — see the
 *     contract note below.
 * 10. **Assemble the `Plan`** per `types/domain.ts` (no new/parallel type;
 *     AD-9), stamping `version` as one past whatever Plan is already stored
 *     for the date (ordinarily none, given step 1).
 * 11. **Render it** (`renderPlan`, from `ritual-shared.ts` — DESIGN.md's layout/color rules).
 *     If step 1.5 (below) found a pending unchecked night to display, its
 *     notice is prepended as a leading unit ahead of the Plan (Task 21).
 * 12. **Persist the Plan**, then **send exactly one Pushover notification**
 *     (`buildNotificationBody` keeps it inside Pushover's real size limit,
 *     budgeted around the unchecked-night notice's own length when one is
 *     present), then **write the ran-today marker**, then — only once that
 *     marker write succeeds — **stamp the displayed unchecked night as
 *     shown** (Task 21's `UncheckedDay.shownAt`, so UX-DR14's "shown once"
 *     holds). The order is deliberate — see the comments at each step: the
 *     Plan is saved before the send so a delivery failure can't lose it, the
 *     ran-today marker is written after the send so a transient Pushover
 *     failure is retried by the next trigger instead of permanently burning
 *     the day, and `shownAt` is stamped LAST of all so a failed send never
 *     burns Spencer's one guaranteed look at it either. The `Result` failure
 *     and structured log line this returns are what Epic 5's AD-7 failure
 *     alerting will hang off; this task builds the shape, not the alert.
 *
 * Between 8 and 9 there is one more gate: if `fitWorkBreakBlocks` deferred
 * EVERY Task (nothing fit the budget), the run returns `nothing-fits` rather
 * than a Plan with no Tasks in it — see that outcome's own doc comment.
 *
 * ----------------------------------------------------------------------------
 * Step 1.5 — the unchecked-day flag (Task 21 / Story 3.3, FR-14, UX-DR14)
 * ----------------------------------------------------------------------------
 *
 * **Post-review redesign.** The first version of this step DETECTED
 * "was yesterday unchecked" here, by re-reading `rituals/night-ritual.ts`'s
 * `night-escalate` marker and the close-out request singleton. That was
 * wrong on two counts a code review caught: (1) it violated AC1's own
 * wording ("marks the day as unchecked ... when the cap is reached") by
 * deferring the actual marking to the following morning instead of the
 * moment the cap was spent, and (2) both of the singletons it re-read get
 * silently overwritten by the very NEXT night's own `night-prompt`/
 * `night-escalate` runs — so if THIS run didn't happen to reach
 * `"delivered"` on the one morning the inference was still valid, the
 * unchecked night was never recorded anywhere and was gone for good.
 *
 * Detection now happens in `rituals/night-ritual.ts`'s
 * `runNightEscalateRitual`, at the moment it confirms the cap is genuinely
 * spent — see that function's own "Recording the unchecked day" doc
 * comment. This file's job is DISPLAY ONLY: right after the idempotence
 * guard, `listUncheckedDays(deps.store)` (a plain `memory-store.ts` read —
 * no injected seam needed, no cross-file import of `night-ritual.ts`
 * either, since detection no longer lives here at all) is scanned for the
 * OLDEST record with no `shownAt` yet. If one exists, the eventual
 * `"delivered"` outcome carries its notice, and ONLY once that outcome's
 * notification genuinely sends does this file stamp `shownAt`
 * (`markUncheckedDayShown`) so it never shows again.
 *
 * Because the lookup is "oldest not-yet-shown," not "yesterday
 * specifically," a run that never reaches `"delivered"`
 * (`nothing-to-plan`/`nothing-fits`, any failure, or simply not running
 * that day) DELAYS the display rather than losing it: the very next
 * `"delivered"` run, however many days later, still finds the same
 * still-unshown record and shows it. A later night ALSO going unchecked in
 * the meantime does not supersede or lose the earlier one either — it is
 * simply a second row in the same `listUncheckedDays` scan, shown in its
 * own turn (oldest first) on a subsequent delivered morning. Nothing about
 * this design can silently drop an already-recorded unchecked night; the
 * only remaining "gap" is honest and bounded to the delay itself.
 *
 * ----------------------------------------------------------------------------
 * The `plan-reasoning.ts` contract
 * ----------------------------------------------------------------------------
 *
 * `generatePlanReasoning` re-derives the Derived Priority ordering itself,
 * and its doc comment requires being handed the exact same candidate
 * `tasks` set and the exact same `bumpLevels` that produced this Plan's
 * ordering — otherwise the sentence under the block list can describe a
 * different ordering than the one rendered above it. This file therefore
 * builds ONE `candidates` array (the gate's `completeTasks`) and ONE
 * `bumpLevels` reference (`deps.bumpLevels`), and passes those same two
 * values to `orderByDerivedPriority` and `generatePlanReasoning` alike;
 * `fitWorkBreakBlocks` receives the ordering derived from them. There is no
 * second, separately-filtered task list anywhere in this function.
 *
 * Deferral is handled WITHOUT breaking that contract. `fitWorkBreakBlocks`
 * may defer a Task that cannot fit the remaining budget, leaving it out of
 * the Plan; naming such a Task as "leading today's Plan" would describe a
 * position that doesn't exist. Re-deriving over a filtered array would fix
 * the sentence but break the contract above — and could change the ordering
 * itself, since `derived-priority.ts`'s secondary sub-scores are normalized
 * across the candidate set, so removing a member can reorder the survivors.
 * Instead, `generatePlanReasoning`'s `eligibleTaskIds` parameter (added by
 * this task, additively) narrows only WHICH Task the sentence may describe,
 * leaving the derivation over the full set exactly as the contract requires.
 * This file passes the ids that actually got a `work` PlanBlock.
 *
 * ----------------------------------------------------------------------------
 * Where the gate wiring lives
 * ----------------------------------------------------------------------------
 *
 * NOT here. The merge-then-gate-then-sync sequence is its own capability —
 * today (Story 8.9) it has two callers, this file and
 * `rituals/mid-day-reflow.ts`; originally (Task 5) it was `shell/chat-cli.ts`
 * and this file, in two different layers, since retired — so per AD-9 it
 * lives in its own file, `rituals/data-completeness.ts`, which every caller
 * imports directly. See that file's docstring for the full history.
 *
 * ----------------------------------------------------------------------------
 * Rendering, color tokens, and `localIsoDate` live in `ritual-shared.ts`
 * ----------------------------------------------------------------------------
 *
 * `renderPlan` is presentation, not business logic, so it must not go in
 * `core/` (AD-2). It also must not be private to `shell/ritual-cli.ts`:
 * `app/plan-view.ts` (Story 8.9: moved from `shell/chat-cli.ts`) has its own
 * on-demand "what's my plan" view that has to render the identical thing,
 * and `mid-day-reflow.ts` renders a remainder-of-day view with it too. It is
 * therefore a pure
 * `(plan, options) => string` — along with the DESIGN.md color tokens
 * (`ACCENT`, `MUTED`, `ATTENTION`, `RESET`, `shouldUseColor`) and the
 * `localIsoDate` local-calendar-date helper — exported from
 * `rituals/ritual-shared.ts` (final whole-branch review, Finding 3), which
 * this file and every other `rituals/*.ts` file import from (AD-1:
 * `shell -> rituals`, and within `rituals/*.ts` itself, every sibling ritual
 * -> `ritual-shared.ts`, never the reverse). These pieces used to live
 * directly in this file — `night-ritual.ts`/`self-check.ts`/
 * `mid-day-reflow.ts` importing them from a file literally named for the
 * Morning Ritual was exactly the "shared utils file becomes a bottleneck"
 * anti-pattern AD-9 itself warns against, so they were extracted into their
 * own neutral home. This file still imports them back where it needs them
 * (`renderPlan`/`localIsoDate` in `runMorningRitual`,
 * `renderBlockLine`/`paint`/`formatPlanDate`/`ATTENTION`/`shouldUseColor` in
 * `buildNotificationBody`/`renderUncheckedNightNotice` below) — see
 * `ritual-shared.ts`'s own module docstring for the full rationale.
 */
import {
  clearInteractionRequest,
  clearTimeBudgetDeferralStreak,
  getCurrentTimeBudget,
  getOpenInteractionRequest,
  getPlan,
  getRitualRun,
  getTimeBudgetDeferralStreak,
  listUncheckedDays,
  markUncheckedDayShown,
  putOpenInteractionRequest,
  putPlan,
  putRitualRun,
  putTimeBudgetDeferralStreak,
  type MemoryStore,
  type UncheckedDay,
} from "../adapters/memory-store.ts";
import type { LogEntry } from "../adapters/logger.ts";
import { PUSHOVER_MESSAGE_LIMIT, PUSHOVER_TITLE_LIMIT } from "../adapters/notification-adapter.ts";
import { appendOutboxInTx, createNotificationInTx } from "../adapters/notification-store.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import type { DataCompletenessGateResult } from "../core/data-completeness-gate.ts";
import { orderByDerivedPriority } from "../core/derived-priority.ts";
import { generatePlanReasoning } from "../core/plan-reasoning.ts";
import { isOpenTask } from "../core/planning-field-value.ts";
import { buildTimeBudgetChangeProposal, nextTimeBudgetDeferralStreak, resolveTodayTimeBudget } from "../core/time-budget.ts";
import { fitWorkBreakBlocks } from "../core/work-break-fit.ts";
import { runDataCompletenessGate } from "./data-completeness.ts";
import {
  ATTENTION,
  formatPlanDate,
  localIsoDate,
  missingRefiningFor,
  paint,
  renderBlockLine,
  renderPlan,
  shouldUseColor,
  type PlanNotification,
} from "./ritual-shared.ts";
import type {
  CalendarEvent,
  CompleteTask,
  ExternalId,
  IsoDate,
  Plan,
  PlanBlock,
  Proposal,
  Result,
  Task,
  TimeBudget,
  YohError,
} from "../types/domain.ts";

// ============================================================================
// The unchecked-day flag (Task 21 / Story 3.3, FR-14, UX-DR14)
// ============================================================================

/**
 * Plain-text degradation of `{colors.attention}` for the unchecked-day
 * flag, for the one destination in this file that cannot render ANSI color
 * at all: the Pushover push-notification body (`buildNotificationBody`'s
 * own contract: "the notification body is always plain"). This is the same
 * literal marker `rituals/night-ritual.ts`'s `ATTENTION_TEXT_MARKER` uses
 * for its own un-stylable SMTP escalation email, duplicated here rather
 * than imported — the two files' own literal constants stay independent so
 * neither file needs a value-level import of the other. Mirrors the
 * "small, deliberate duplications" precedent this codebase already uses
 * (`ritual-shared.ts`'s `localIsoDate` doc comment).
 */
export const UNCHECKED_NIGHT_TEXT_MARKER = "ATTENTION:";

/**
 * Renders the "last night wasn't closed out" notice — UX-DR6's `ATTENTION`
 * color marker (DESIGN.md reserves it for exactly two moments: Night
 * Ritual's second, escalated close-out attempt, Task 20; and this, the
 * unchecked-day flag, Task 21), paired with the plain-text
 * `UNCHECKED_NIGHT_TEXT_MARKER` wording per UX-DR20 so the meaning survives
 * with color off. Names every rolled-forward Task by title (this story's
 * own resolution of "mandatory Blocker(s)" — see
 * `rituals/night-ritual.ts`'s `runNightEscalateRitual` doc comment for the
 * full reasoning; `day` here is the exact `UncheckedDay` record that
 * function wrote, read back via `memory-store.ts`). Pure formatting, no
 * I/O — mirrors `night-ritual.ts`'s own `renderNightEscalateNotice`. Takes
 * only the two fields it actually needs (`Pick`, not the full
 * `UncheckedDay`) so a caller doesn't need to fabricate `recordedAt`/
 * `shownAt` just to render a notice.
 */
export function renderUncheckedNightNotice(
  day: Pick<UncheckedDay, "date" | "rolledForwardTasks">,
  options: { readonly color?: boolean } = {},
): string {
  const color = options.color ?? shouldUseColor();
  const titles = day.rolledForwardTasks.map((t) => t.taskTitle).join(", ");
  const text = `${UNCHECKED_NIGHT_TEXT_MARKER} ${formatPlanDate(day.date)} wasn't closed out — rolled forward: ${
    titles.length > 0 ? titles : "nothing named"
  }.`;
  return paint(text, ATTENTION, color);
}

// ============================================================================
// runMorningRitual — the orchestration itself
// ============================================================================

/** The ritual id the "already ran today" marker is stored under in `memory-store.ts`. */
export const MORNING_RITUAL_ID = "morning";

/**
 * Degraded-performance threshold for Plan generation, in milliseconds (Task
 * 27 / Story 5.3, AD-7): the timed span (see `MorningRitualOutcome`'s own
 * `planGenerationMs` doc comment for exactly what it covers — the
 * Data-Completeness Gate through everything up to, but excluding,
 * `deps.sendNotification`) genuinely taking longer than this does NOT fail
 * the run — the Plan is still generated and delivered normally — but
 * `shell/ritual-cli.ts` treats it as DEGRADED-NOT-FAILED and raises it
 * through the SAME alert path Story 5.1/5.2 built
 * (`RitualCliDeps.sendFailureAlert`, see that file's own
 * `checkMorningPlanGenerationDegraded`), rather than silently accepting a
 * technically-successful-but-unusually-slow run as normal.
 *
 * A documented, concrete starting value — the Architecture Spine's own
 * Deferred section explicitly leaves the exact number to build time, per
 * this project's established pattern for exactly this situation (FR-2's
 * even-split weights, FR-11's slip curve, Self-Check's own interval/
 * low-score threshold, Task 23's deferral-streak threshold, Task 26's own
 * missed-run grace windows, etc. — see each constant's own doc comment for
 * the same "tunable, not load-bearing" framing). `5000` (5 seconds, a
 * "low-seconds value" per this task's own implementer note) is chosen as
 * comfortably above what this whole span's own work — local computation
 * (`data-completeness-gate.ts`, `derived-priority.ts`, `work-break-fit.ts`,
 * `plan-reasoning.ts`), one bounded Calendar HTTP round trip
 * (`readCalendarEvents`), and a handful of local SQLite reads/writes
 * (the Time-Budget-deferral-streak/Proposal sync, `putPlan`'s own
 * persistence) — should ever normally take, even against a large Notion
 * Task list, while still tight enough to catch a genuine regression (a
 * pathological `O(n^2)`-or-worse slice introduced later, an unexpectedly
 * huge candidate set, a slow Calendar API response, or a SQLite write stuck
 * behind real lock contention — AD-10's cross-process concurrency with
 * `server.ts`) well before it would be noticeable to Spencer as "my Plan
 * is late."
 */
export const PLAN_GENERATION_DEGRADED_THRESHOLD_MS = 5_000;

// ============================================================================
// Time-Budget-change Proposal (Task 23 / Story 4.2, AD-3) — see step 8.5
// inside `runMorningRitual` below for where this is actually generated and
// persisted, and `core/time-budget.ts`'s module docstring (item 3) for the
// full design rationale.
// ============================================================================

/**
 * The fixed singleton interaction-request id a Time-Budget-change `Proposal`
 * is persisted under — mirrors `DATA_COMPLETENESS_REQUEST_ID`/
 * `NIGHT_CLOSE_OUT_REQUEST_ID`'s own "fixed id chosen by the requester"
 * convention (`InteractionRequest`'s own doc comment in `types/domain.ts`).
 * `app/surface-open-items.ts`'s `surfaceOpenItems` (Story 8.9: moved from
 * `shell/chat-cli.ts`'s `surfaceOpenInteractionRequests`) surfaces an open
 * Proposal by its `requestKind: "proposal"` alone, deliberately not by this
 * id — keeping `apply(proposal)` generic for a future Proposal kind with its
 * own id — but THIS file still needs a stable id to check "is one already
 * open" before generating a new one each day, and to know which exact row to
 * treat as the Time Budget proposal if it ever needs to reason about it
 * again.
 */
export const TIME_BUDGET_PROPOSAL_REQUEST_ID = "time-budget-proposal";

/**
 * The prompt line Chat shows for an open Time-Budget-change Proposal (AD-3,
 * UX-DR16; Story 8.9: plain text, never ANSI — `chat-cli.ts`, since
 * retired, was the one caller that applied accent-color wrapping): states
 * what Yoh wants to do and why (`proposal.reason`, already a complete
 * sentence — see
 * `core/time-budget.ts`'s `buildTimeBudgetChangeProposal`), then names the
 * explicit yes/no answer it's waiting for — silence is never treated as
 * consent.
 */
export function buildTimeBudgetProposalPromptText(proposal: Proposal<Partial<TimeBudget>>): string {
  return `${proposal.reason} Reply "yes" to apply this change, or "no" to dismiss it.`;
}

/**
 * The notification's title. Plain text: DESIGN.md's
 * `{components.notification}` asks for `{colors.accent}` emphasis "where the
 * platform supports styled notification text", and Pushover titles support
 * no styling at all — so per UX-DR20 the cue is carried by the wording
 * itself, which names the Plan as plainly as the color would have.
 */
export const NOTIFICATION_TITLE = "Today's Plan";

/**
 * Builds the push-notification body: the Plan's block list plus its
 * reasoning line, plain text, guaranteed to fit `limit` characters.
 *
 * `width` is unbounded on purpose — DESIGN.md's 80-column wrap exists so
 * TERMINAL output stays readable without resizing, but a phone reflows text
 * to its own screen width, so pre-wrapping at 80 would only produce ragged
 * double-wrapped lines (and would split the reasoning line mid-sentence).
 *
 * Length, though, is a hard external constraint: Pushover rejects a message
 * over `PUSHOVER_MESSAGE_LIMIT` outright, and a busy day (a dozen blocks
 * carrying full Notion titles) genuinely reaches it. A rejected send is
 * especially costly here because it means the day's ONLY notification is
 * lost, so this function never hands the adapter something over the limit:
 * it drops whole block lines from the END (the latest blocks — the ones
 * furthest from "what do I do next") and says plainly how many it dropped.
 *
 * The reasoning line is preserved in preference to blocks, because DESIGN.md
 * names it as the notification body's required content
 * (`{components.notification}`); only if it alone still doesn't fit is it
 * itself truncated with an ellipsis, which is the last resort.
 */
export function buildNotificationBody(
  plan: Plan,
  timeZone: string,
  limit: number = PUSHOVER_MESSAGE_LIMIT,
): string {
  const blockLines = plan.blocks.flatMap((block) =>
    renderBlockLine(block, timeZone, Number.POSITIVE_INFINITY),
  );
  const tail = plan.reasoning.length > 0 ? `\n\n${plan.reasoning}` : "";

  const full = `${blockLines.join("\n")}${tail}`;
  if (full.length <= limit) return full;

  // Drop block lines from the end until the body (plus an honest "and N
  // more" note) fits. `kept` counts down rather than searching, so this
  // always terminates and always lands under the limit.
  for (let kept = blockLines.length - 1; kept >= 0; kept--) {
    const dropped = blockLines.length - kept;
    const note = `... and ${dropped} more block${dropped === 1 ? "" : "s"} — see the terminal for the full Plan.`;
    const candidate = `${[...blockLines.slice(0, kept), note].join("\n")}${tail}`;
    if (candidate.length <= limit) return candidate;
  }

  // Even zero blocks plus the reasoning line is too long — truncate the
  // reasoning itself rather than emit something the adapter will refuse.
  return `${plan.reasoning.slice(0, Math.max(0, limit - 1))}…`.slice(0, limit);
}

/**
 * Every input and I/O edge the Morning Ritual needs, injected rather than
 * constructed here: `shell/ritual-cli.ts` binds the real Notion, Calendar,
 * and Pushover adapters to these seams, and tests bind fakes. `readTasks`
 * and `readCalendarEvents` are expected to throw on I/O failure (AD-8) —
 * catching that is this file's job, not theirs.
 */
export interface MorningRitualDeps {
  readonly store: MemoryStore;
  /** `adapters/notion-adapter.ts`'s `readNotionTasks`, pre-bound to its client/config. Throws on I/O failure. */
  readonly readTasks: () => Promise<readonly Task[]>;
  /** `adapters/calendar-adapter.ts`'s `readCalendarEvents`, pre-bound to its client/config. Throws on I/O failure. */
  readonly readCalendarEvents: () => Promise<readonly CalendarEvent[]>;
  /** `adapters/notification-adapter.ts`'s `sendPushoverNotification`, pre-bound to its config. Throws on I/O failure. */
  readonly sendNotification: (notification: PlanNotification) => Promise<void>;
  /** Injectable clock — never `new Date()` inline, so a test can pin the day. */
  readonly now: () => Date;
  /** Spencer's IANA timezone, defining both "today" and the rendered wall-clock times. */
  readonly timeZone: string;
  /** Slip-Bump levels (Task 17 / FR-11). Threaded through to BOTH the ordering and the reasoning line so they can never disagree. */
  readonly bumpLevels?: Readonly<Record<ExternalId, number>>;
  /**
   * `adapters/calendar-adapter.ts`'s `writeTodaysPlanToCalendar`, pre-bound
   * to its write client/calendarIdStore/config. Throws on I/O failure — this
   * ritual treats a failure here as non-fatal (see the call site in
   * `runMorningRitual`, step 12a.5). Optional so a test that doesn't care
   * about Calendar-write behavior need not stub it.
   *
   * Final whole-branch review, Finding 1: this was the wired-in fix for a
   * Critical finding — `writeTodaysPlanToCalendar` (Task 12) existed and was
   * tested but nothing ever called it, so a real run never touched Google
   * Calendar. The caller is responsible for excluding `"calendar-anchor"`
   * blocks before calling this (see the call site) — see
   * `writeTodaysPlanToCalendar`'s own doc comment for why.
   */
  readonly writeCalendarPlan?: (blocks: readonly PlanBlock[]) => Promise<void>;
  /**
   * Story 9.4 (FR-34, AD-5): the process's shared SQLite connection,
   * threaded through ONLY so this ritual can raise its own `needs-data`
   * in-app notification (`createNotificationInTx`) the same way
   * `app/check-off.ts` raises its own `operational` notification. Never
   * used to open a second connection (AD-10) — this file writes through it
   * exactly once, inside its own `writeTx`. Optional, mirroring
   * `writeCalendarPlan` immediately above: a test that doesn't care about
   * the needs-data notification need not stub it, and the step below is
   * simply skipped when it's absent — every existing call site and test
   * that predates this story keeps compiling and passing unchanged.
   */
  readonly connection?: SqliteConnection;
  readonly log?: (entry: LogEntry) => void;
  /** Forces color on/off for the returned `rendered` text; defaults to `shouldUseColor()`. The notification body is always plain. */
  readonly color?: boolean;
}

/** What one Morning Ritual run did. Discriminated on `status` so a caller can't confuse "delivered" with "skipped". */
export type MorningRitualOutcome =
  | {
      readonly status: "already-ran";
      readonly date: IsoDate;
      readonly planId: string | undefined;
    }
  | {
      readonly status: "nothing-to-plan";
      readonly date: IsoDate;
      readonly incompleteTaskIds: readonly ExternalId[];
    }
  | {
      /**
       * Every plannable Task was deferred — nothing fit today's Time Budget,
       * so there is no ordered Plan to send. Deliberately its own outcome
       * rather than a `delivered` Plan with an empty block list: a
       * notification reading "Nothing is scheduled" above a sentence about
       * which Task "leads today's Plan" would be self-contradictory, and
       * FR-3's reasoning line has no lead item's position to explain when no
       * item has a position. Like `nothing-to-plan`, this writes no
       * ran-today marker, so raising the Time Budget and re-triggering can
       * still produce a real Plan today.
       */
      readonly status: "nothing-fits";
      readonly date: IsoDate;
      readonly deferredTaskIds: readonly ExternalId[];
      readonly incompleteTaskIds: readonly ExternalId[];
      /**
       * See the `"delivered"` variant's own `planGenerationMs` doc comment
       * for the general design. This outcome never reaches a notification
       * step, so ITS OWN span simply runs through everything this run did —
       * the Data-Completeness Gate through the Time-Budget-deferral-streak/
       * Proposal sync (step 8.5), the last step a `"nothing-fits"` run
       * reaches before returning.
       */
      readonly planGenerationMs?: number;
    }
  | {
      readonly status: "delivered";
      readonly date: IsoDate;
      readonly plan: Plan;
      /**
       * The Plan as `renderPlan` produced it, for `shell/ritual-cli.ts` to
       * print — with the unchecked-night notice (Task 21), when present,
       * prepended ahead of it as its own leading unit. See the "Task 21"
       * comments inside `runMorningRitual` below for why this is folded
       * into `rendered` rather than kept as a fully separate field: it is
       * the one string that reaches the terminal/log verbatim, so the flag
       * shows exactly where it would otherwise be missed if a caller forgot
       * to check `uncheckedNight` separately.
       */
      readonly rendered: string;
      /** Tasks that could not fit today's Time Budget and were left for a future Plan (never force-fit). */
      readonly deferredTaskIds: readonly ExternalId[];
      /** Tasks the Data-Completeness Gate held back; an open interaction request names them. */
      readonly incompleteTaskIds: readonly ExternalId[];
      /**
       * Present exactly when this run found a pending unchecked night
       * (`memory-store.ts`'s `UncheckedDay`, `shownAt` still unset — the
       * OLDEST such record, not necessarily last night specifically, see
       * step 1.5's own doc comment) and is displaying it for the first (and
       * only) time (UX-DR14: "shown once, not a standing repeating
       * reminder") — `undefined` on every ordinary morning, including every
       * one before this task and every subsequent morning after the one
       * that showed it. Exposed as its own field (in addition to being
       * folded into `rendered`/the notification body) so a caller — and
       * this file's own tests — can assert on it directly rather than
       * parsing rendered text.
       */
      readonly uncheckedNight?: UncheckedDay;
      /**
       * Task 27 / Story 5.3 (post-review-fix, widened): how long Plan
       * generation genuinely took, in milliseconds — measured via
       * `performance.now()` from right before the Data-Completeness Gate
       * through right before `deps.sendNotification` (see
       * `runMorningRitual` below, where the timer starts and stops), never
       * hardcoded or estimated. That span is deliberately WIDER than just
       * "gate through fitting": per the AC's own "excluding notification
       * delivery" wording, it also covers step 8.5's
       * Time-Budget-deferral-streak/Proposal sync, `generatePlanReasoning`,
       * Plan assembly, `renderPlan`, `putPlan`'s own persistence I/O, and
       * (final whole-branch review, Finding 1) the "Yoh Plan" Calendar sync
       * (`deps.writeCalendarPlan`, when bound), since none of those are
       * "notification delivery" either. Optional (rather than required) purely so a `Result`
       * failure inside the SAME span, or a caller/test that doesn't care
       * about timing, need not fabricate a value — every real "delivered"
       * run always sets it. Compared against `PLAN_GENERATION_DEGRADED_THRESHOLD_MS`
       * by `shell/ritual-cli.ts`'s `checkMorningPlanGenerationDegraded`,
       * which raises a DEGRADED-not-failed alert through the same channel
       * Story 5.1/5.2 built when it's exceeded — this field is what makes
       * that check possible without `ritual-cli.ts` re-deriving its own
       * measurement.
       */
      readonly planGenerationMs?: number;
    };

function failure(kind: YohError["kind"], message: string, detail?: unknown): Result<never, YohError> {
  return { ok: false, error: detail === undefined ? { kind, message } : { kind, message, detail } };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Generates and delivers today's Morning Plan. See the module docstring for
 * the full step-by-step orchestration and the reasoning behind each ordering
 * choice.
 *
 * Per AD-8 this is one of the two layers allowed to catch an adapter's
 * throw: every `deps.readTasks` / `deps.readCalendarEvents` /
 * `deps.sendNotification` call, and every `memory-store.ts` write (which can
 * throw `ConflictError` under AD-10 concurrency with `server.ts`), is
 * wrapped and converted into a `Result` failure plus a structured log line.
 * Nothing thrown from an adapter escapes this function.
 */
export async function runMorningRitual(deps: MorningRitualDeps): Promise<Result<MorningRitualOutcome, YohError>> {
  const log = deps.log ?? ((): void => {});
  const nowDate = deps.now();
  const nowIso = nowDate.toISOString();
  const today = localIsoDate(nowDate, deps.timeZone);

  // --- 1. Idempotence guard -------------------------------------------------
  const lastRun = getRitualRun(deps.store, MORNING_RITUAL_ID);
  if (lastRun?.data.date === today) {
    log({ level: "info", event: "morning-ritual.already-ran", detail: { date: today } });
    return { ok: true, value: { status: "already-ran", date: today, planId: lastRun.data.planId } };
  }

  // --- 1.5. Find the oldest not-yet-shown unchecked night (Task 21 review
  // fix / Story 3.3, FR-14, UX-DR14) -----------------------------------------
  // A pure read, done early and cheaply (no Notion/Calendar call needed).
  // DETECTION already happened elsewhere and earlier — rituals/
  // night-ritual.ts's runNightEscalateRitual writes the durable
  // `UncheckedDay` record itself, at the moment it confirms the escalation
  // cap is genuinely spent (see that function's own doc comment). This
  // file's only job is DISPLAY: scan every currently-recorded UncheckedDay
  // for the oldest one whose `shownAt` is still unset. Nothing is WRITTEN
  // yet here — whether this run ultimately reaches "delivered" (the only
  // outcome that actually shows Spencer anything) is decided by everything
  // below; `shownAt` is only ever stamped once a Plan carrying this notice
  // is actually sent (see step 12 below). A run that ends in
  // `nothing-to-plan`/`nothing-fits` (or fails outright) therefore shows
  // nothing this trigger, but writes nothing either — the SAME
  // still-unshown record is found again by whichever LATER run finally
  // reaches "delivered," however many days that takes. This is what turns
  // a multi-day gap into a delay rather than the permanent loss the first
  // version of this task had (see the module docstring's own "Step 1.5"
  // section for the full post-review story).
  const oldestUnshown = listUncheckedDays(deps.store)
    .filter((r) => r.data.shownAt === undefined)
    .sort((a, b) => a.data.date.localeCompare(b.data.date))[0];
  const uncheckedNight = oldestUnshown?.data;
  if (uncheckedNight) {
    log({
      level: "info",
      event: "morning-ritual.unchecked-night-pending",
      detail: { date: uncheckedNight.date, taskCount: uncheckedNight.rolledForwardTasks.length },
    });
  }

  // --- 2. Read Notion Tasks (AD-8 boundary) ---------------------------------
  let rawTasks: readonly Task[];
  try {
    rawTasks = await deps.readTasks();
  } catch (err) {
    log({ level: "error", event: "morning-ritual.read-tasks-failed", detail: describeError(err) });
    return failure("unreachable", `morning-ritual: could not read Notion Tasks — ${describeError(err)}`, err);
  }

  // Polish-5 Task 1: a completed Task is dropped here, BEFORE the
  // Data-Completeness Gate ever sees it — the SAME `isOpenTask` rule
  // `app/sandbox-queue.ts` applies, now applied at the earliest possible
  // point rather than filtered back out of the gate's outputs afterward
  // (Final-review MUST-FIX 1 had only reached the needs-data count; this
  // closes the same gap for `candidates`/`missingRefining` too). A
  // completed Task is therefore never a plan candidate, never counted
  // incomplete, and never tagged `missingRefining`.
  const openTasks = rawTasks.filter(isOpenTask);

  // --- 3. Merge overrides, gate, sync the interaction request ---------------
  // Task 27 / Story 5.3: the Plan-generation timer starts here — right
  // before the Data-Completeness Gate. Per this story's own AC wording,
  // "Data-Completeness Gate through Work/Break fitting, excluding
  // notification delivery": "excluding notification delivery" is the AC's
  // one deliberate, operative carve-out (if fitting itself were meant as the
  // literal stop point, that clause would be redundant — fitting already
  // ends well before the notification step). So the span timed is
  // everything from here through whatever this run's own work is, up to
  // (never including) `deps.sendNotification` — for a `"delivered"` run that
  // means steps 3 through 12a.5 (gate, calendar read, budget resolution,
  // order, fit, the Time-Budget-deferral-streak/Proposal sync, reasoning
  // generation, Plan assembly/render, `putPlan`'s own persistence I/O, and
  // (final whole-branch review, Finding 1) the "Yoh Plan" Calendar sync are
  // ALL measured); for a `"nothing-fits"` run — which never reaches a
  // notification step at all — it's everything through that run's own
  // completion (steps 3 through 8.5). See `planGenerationMs`'s two
  // computation sites below (post-review-fix) for exactly where each stops.
  // Measured with `performance.now()` — genuine elapsed wall time, never
  // hardcoded. A run that exits before reaching fitting (the early
  // "nothing-to-plan" branch just below, or any `Result` failure inside this
  // span) never computes a `planGenerationMs` at all — there is no
  // completed Plan-generation run yet to time.
  const planGenerationStartMs = performance.now();
  let gate: Result<DataCompletenessGateResult, YohError>;
  try {
    gate = runDataCompletenessGate(deps.store, openTasks);
  } catch (err) {
    log({ level: "error", event: "morning-ritual.gate-sync-failed", detail: describeError(err) });
    return failure("conflict", `morning-ritual: could not record the Data-Completeness prompt — ${describeError(err)}`, err);
  }
  if (!gate.ok) {
    log({ level: "error", event: "morning-ritual.gate-rejected", detail: gate.error });
    return gate;
  }

  const candidates = gate.value.completeTasks;
  const incompleteTaskIds = gate.value.incomplete.map((report) => report.taskId);

  // --- 3.5. Needs-data notification (Story 9.4, FR-34, AD-5) ----------------
  // `needs-data` and `operational` are the only two notification kinds a
  // ritual may raise (AD-5) — this is the one place this file raises one of
  // its own. Fires at most once per run, whenever THIS run's own
  // Data-Completeness Gate call (just above) found at least one Task
  // missing a Required field — deliberately placed before every branch
  // below, so it applies uniformly whether this run goes on to
  // `nothing-to-plan`, `nothing-fits`, or `delivered`: a Task missing a
  // Required field is exactly as real on a day nothing else could be
  // planned as on an ordinary one. The count is read straight off
  // `gate.value.incomplete` — the very rule `app/sandbox-queue.ts`'s own
  // `sandboxQueue` (Story 9.2) applies to answer the identical question, so
  // the two can never disagree on the RULE, even though each takes its own
  // fresh Notion read at its own moment (AD-1 forbids this file importing
  // `app/` outright). Wrapped exactly like the Time-Budget-deferral-streak
  // sync elsewhere in this file: non-fatal, logged as a warn, never turned
  // into a failure `Result` — a notification write must never block
  // reporting today's actual Plan outcome.
  // Polish-5 Task 1: `gate.value.incomplete` is already open-only, since
  // `openTasks` (completed Tasks dropped) is what was fed into the gate
  // above — so `incompleteTaskIds.length` IS the open-incomplete count
  // directly, with no second completed-Task filter needed here any more
  // (Final-review MUST-FIX 1's `rawTaskById`/`isOpenTask` re-filter is gone;
  // the exclusion now happens once, upstream, for candidates/incomplete/
  // missingRefining alike).
  const openIncompleteCount = incompleteTaskIds.length;

  if (openIncompleteCount > 0 && deps.connection) {
    try {
      const count = openIncompleteCount;
      // Pluralizes both the noun and the verb: "1 Task needs data to be
      // placed" / "N Tasks need data to be placed".
      const body = count === 1 ? "1 Task needs data to be placed" : `${count} Tasks need data to be placed`;
      deps.connection.writeTx((db) => {
        createNotificationInTx(db, { kind: "needs-data", title: body, body, deepLink: "chat:/sandbox", createdAt: nowIso });
      });
      log({ level: "info", event: "morning-ritual.needs-data-notification-created", detail: { count } });
    } catch (err) {
      log({ level: "warn", event: "morning-ritual.needs-data-notification-failed", detail: describeError(err) });
    }
  }

  // --- 4. Anything to plan? (AD-11 / UX-DR10) -------------------------------
  if (candidates.length === 0) {
    log({ level: "info", event: "morning-ritual.nothing-to-plan", detail: { date: today, incompleteTaskIds } });
    return { ok: true, value: { status: "nothing-to-plan", date: today, incompleteTaskIds } };
  }

  // --- 5. Read today's Calendar events (AD-8 boundary) ----------------------
  let calendarEvents: readonly CalendarEvent[];
  try {
    calendarEvents = await deps.readCalendarEvents();
  } catch (err) {
    log({ level: "error", event: "morning-ritual.read-calendar-failed", detail: describeError(err) });
    return failure("unreachable", `morning-ritual: could not read today's Calendar events — ${describeError(err)}`, err);
  }

  // --- 6. Today's declared Time Budget --------------------------------------
  const storedBudget = getCurrentTimeBudget(deps.store);
  const resolvedBudget = resolveTodayTimeBudget(storedBudget?.data, today);
  if (!resolvedBudget) {
    log({ level: "warn", event: "morning-ritual.no-time-budget", detail: { date: today } });
    return failure(
      "missing-field",
      "morning-ritual: no Time Budget has been declared yet — tell Yoh how much time you have (e.g. `time budget 6 hours` in chat) and re-run the Morning Ritual",
    );
  }
  if (resolvedBudget.carriedForward) {
    log({
      level: "info",
      event: "morning-ritual.time-budget-carried-forward",
      detail: { declaredOn: resolvedBudget.budget.date, today },
    });
  }

  // --- 7-9. Order, fit, and explain — from ONE candidates/bumpLevels pair ---
  const ordered = orderByDerivedPriority(candidates, today, deps.bumpLevels);
  if (!ordered.ok) {
    log({ level: "error", event: "morning-ritual.ordering-rejected", detail: ordered.error });
    return ordered;
  }

  const fitted = fitWorkBreakBlocks({
    tasks: ordered.value,
    budget: resolvedBudget.budget,
    calendarEvents,
    startTime: nowIso,
  });
  if (!fitted.ok) {
    log({ level: "error", event: "morning-ritual.fitting-rejected", detail: fitted.error });
    return fitted;
  }

  // Story 9.1 (AD-11 amended): tag every assembled "work" block with
  // whichever Refining Field(s) its own CompleteTask is missing —
  // `fitWorkBreakBlocks` itself has no Refining-field awareness, so this is
  // the one place it's read back off `candidates` (the SAME CompleteTask[]
  // that produced `ordered`/`fitted`, per the module docstring's "ONE
  // candidates array" contract) and attached before the Plan is assembled.
  const candidatesById = new Map<ExternalId, CompleteTask>(candidates.map((t) => [t.id, t]));
  const blocksWithMissingRefining: readonly PlanBlock[] = fitted.value.blocks.map((block) => {
    if (block.kind !== "work" || block.taskId === undefined) return block;
    const missing = missingRefiningFor(candidatesById.get(block.taskId)!);
    return missing ? { ...block, missingRefining: missing } : block;
  });

  // --- 8.5. Time-Budget-deferral streak + Proposal (Task 23 / Story 4.2,
  // AD-3) --------------------------------------------------------------------
  // `deferredTaskIds` is already computed above by every single Morning
  // Ritual run — the genuine signal Task 6's own AC deferred acting on
  // ("this story only covers Spencer's own explicit declaration path, not
  // proposal application"). Runs on BOTH a `"nothing-fits"` day (below) and a
  // `"delivered"` one: a day where literally everything got deferred is if
  // anything the strongest version of this same signal, not an exception to
  // tracking it.
  //
  // The streak itself (`core/time-budget.ts`'s pure `nextTimeBudgetDeferralStreak`)
  // is recomputed every run; a day with zero deferrals clears it entirely
  // (`clearTimeBudgetDeferralStreak`) rather than pausing it — see that pure
  // function's own doc comment. Once the streak meets the threshold, a real
  // `Proposal<Partial<TimeBudget>>` (`buildTimeBudgetChangeProposal`) is
  // persisted as an open interaction request — but only when none is already
  // open: an existing unanswered Proposal is left exactly as Spencer last
  // saw it (same snapshot, same reason) rather than silently replaced by a
  // fresher one every day the pattern continues. Once Spencer answers it
  // (`app/confirm-proposal.ts`'s `confirmProposal`, which clears the
  // request AND resets the streak — review fix, Important #1; Story 8.2:
  // moved from `shell/chat-cli.ts`'s `answerProposalRequest`), a later run
  // is free to propose again if the pattern is still happening.
  //
  // **Review fix, Important #3.** When the streak resets to zero (the
  // `else` branch just below), any Proposal already open on the OLD streak
  // is invalidated too — its `reason` names a "consecutive days" count that
  // this very run just confirmed is no longer true, so leaving it open
  // would show Spencer stale justification for a live decision. Cleared,
  // not re-surfaced: a fresh streak must accumulate again before the same
  // kind of Proposal is worth proposing.
  //
  // Deliberately NON-FATAL: this whole step is wrapped so that a failure to
  // record the streak or persist a Proposal (e.g. a genuine `ConflictError`
  // racing `server.ts`) never blocks delivering today's actual Plan — this
  // is a secondary, propose-only signal, not part of the Plan's own critical
  // path.
  try {
    const hadDeferralsToday = fitted.value.deferredTaskIds.length > 0;
    const previousStreak = getTimeBudgetDeferralStreak(deps.store)?.data;
    const nextStreak = nextTimeBudgetDeferralStreak(previousStreak, today, hadDeferralsToday);

    if (nextStreak) {
      putTimeBudgetDeferralStreak(deps.store, nextStreak);
    } else {
      clearTimeBudgetDeferralStreak(deps.store);
      // Review fix, Important #3: the signal that justified any currently
      // open Proposal just went away — don't leave it dangling.
      const staleOpenProposal = getOpenInteractionRequest(deps.store, TIME_BUDGET_PROPOSAL_REQUEST_ID);
      if (staleOpenProposal) {
        clearInteractionRequest(deps.store, TIME_BUDGET_PROPOSAL_REQUEST_ID, staleOpenProposal.version);
        log({ level: "info", event: "morning-ritual.time-budget-proposal-invalidated", detail: { date: today } });
      }
    }

    if (nextStreak && storedBudget && !getOpenInteractionRequest(deps.store, TIME_BUDGET_PROPOSAL_REQUEST_ID)) {
      const proposal = buildTimeBudgetChangeProposal({
        currentBudget: storedBudget.data,
        currentBudgetVersion: storedBudget.version,
        streak: nextStreak,
        createdAt: nowIso,
      });
      if (proposal) {
        putOpenInteractionRequest(deps.store, TIME_BUDGET_PROPOSAL_REQUEST_ID, {
          requestKind: "proposal",
          promptText: buildTimeBudgetProposalPromptText(proposal),
          detail: { proposal },
          createdAt: nowIso,
        });
        log({
          level: "info",
          event: "morning-ritual.time-budget-proposal-created",
          detail: { proposalId: proposal.id, consecutiveDeferralDays: nextStreak.consecutiveDeferralDays },
        });
      }
    }
  } catch (err) {
    log({ level: "warn", event: "morning-ritual.time-budget-proposal-sync-failed", detail: describeError(err) });
  }

  // Which Tasks actually made it into the Plan. Read off the emitted blocks
  // rather than inverting `deferredTaskIds`, so this is direct evidence of
  // "has a block in this Plan" rather than a second derivation that could
  // disagree with the rendered output.
  const plannedTaskIds = new Set<ExternalId>(
    blocksWithMissingRefining.flatMap((block) =>
      block.kind === "work" && block.taskId !== undefined ? [block.taskId] : [],
    ),
  );

  // Every plannable Task was deferred — see `"nothing-fits"`'s doc comment.
  if (plannedTaskIds.size === 0) {
    // Task 27 / Story 5.3 (post-review fix): a `"nothing-fits"` run never
    // reaches a notification step at all, so its own widened span simply
    // ends where ITS OWN work ends — right here, which now also includes
    // step 8.5's Time-Budget-deferral-streak/Proposal sync (a real
    // MemoryStore read/write) above, not just gate-through-fit.
    const planGenerationMs = Math.round(performance.now() - planGenerationStartMs);
    log({
      level: "info",
      event: "morning-ritual.nothing-fits",
      detail: { date: today, deferred: fitted.value.deferredTaskIds.length, budget: resolvedBudget.budget.totalMinutes, planGenerationMs },
    });
    return {
      ok: true,
      value: {
        status: "nothing-fits",
        date: today,
        deferredTaskIds: fitted.value.deferredTaskIds,
        incompleteTaskIds,
        planGenerationMs,
      },
    };
  }

  // The SAME `candidates` array and the SAME `bumpLevels` reference that
  // produced `ordered` above — see the module docstring's contract note.
  // `eligibleTaskIds` narrows only WHICH Task the sentence describes, never
  // the scoring: a Task that got deferred must not be described as leading
  // a Plan it has no block in.
  const reasoning = generatePlanReasoning({
    tasks: candidates,
    today,
    eligibleTaskIds: plannedTaskIds,
    ...(deps.bumpLevels ? { bumpLevels: deps.bumpLevels } : {}),
  });
  if (!reasoning.ok) {
    log({ level: "error", event: "morning-ritual.reasoning-rejected", detail: reasoning.error });
    return reasoning;
  }

  // --- 10. Assemble the Plan (AD-9: domain.ts's own shape) ------------------
  const existingPlan = getPlan(deps.store, today);
  const plan: Plan = {
    id: `plan-${today}`,
    date: today,
    blocks: blocksWithMissingRefining,
    reasoning: reasoning.value,
    version: (existingPlan?.data.version ?? 0) + 1,
    createdAt: existingPlan?.data.createdAt ?? nowIso,
    updatedAt: nowIso,
  };

  // --- 11. Render -------------------------------------------------------------
  // Task 21: the unchecked-night notice (when present) is prepended as its
  // own leading unit, ahead of the Plan itself — see `MorningRitualOutcome`'s
  // `"delivered"` variant doc comment for why it is folded into `rendered`
  // rather than left as a field callers must remember to check separately.
  const planRendered = renderPlan(plan, {
    timeZone: deps.timeZone,
    ...(deps.color === undefined ? {} : { color: deps.color }),
  });
  const noticeColor = deps.color ?? shouldUseColor();
  const rendered = uncheckedNight
    ? `${renderUncheckedNightNotice(uncheckedNight, { color: noticeColor })}\n\n${planRendered}`
    : planRendered;

  // --- 12a. Persist the generated Plan --------------------------------------
  // Before the send, so a delivery failure never loses the Plan itself.
  try {
    // Story 7.8, Ruling R4: appends a Plan-change outbox hint in the SAME
    // writeTx as this Plan write, so the web client's SSE stream (AD-18)
    // announces it atomically — never a separate transaction that could
    // commit the Plan but lose the hint (or vice versa).
    putPlan(deps.store, plan, (db) => appendOutboxInTx(db, { topic: "plan", entityId: plan.date }));
  } catch (err) {
    log({ level: "error", event: "morning-ritual.persist-failed", detail: describeError(err) });
    return failure("conflict", `morning-ritual: could not persist today's Plan — ${describeError(err)}`, err);
  }

  // --- 12a.5. Sync today's Plan to the "Yoh Plan" Calendar (final
  // whole-branch review, Finding 1 / Task 12, AD-4) --------------------------
  // `writeTodaysPlanToCalendar` (adapters/calendar-adapter.ts) was built,
  // tested, and independently reviewed under Task 12 but never wired to any
  // caller — a real run reported success and never touched Google Calendar
  // at all. Wired here, right after the Plan is persisted, so Calendar-sync
  // latency is included in the SAME timed `planGenerationMs` span
  // `putPlan`'s own persistence I/O already is (both are "generation," not
  // "notification delivery," under Story 5.3's AC wording — see
  // `planGenerationStartMs`'s own comment above).
  //
  // Which blocks: `"calendar-anchor"` blocks are excluded (Finding 1's own
  // resolution of the open design question Task 12's review left
  // unanswered) — those already exist as real events on Spencer's PRIMARY
  // calendar (that's where they were read FROM, step 5 above); writing them
  // again into the separate "Yoh Plan" calendar would create confusing
  // duplicate-looking events for something that was never Yoh's own
  // scheduling decision. See `writeTodaysPlanToCalendar`'s own doc comment
  // for the same note from the adapter side.
  //
  // Wrapped exactly like step 8.5's Time-Budget-deferral-streak sync above:
  // non-fatal, logged as a warn, never turned into a failure `Result` — a
  // Calendar-write failure must never block delivering today's Plan
  // notification, matching this file's established pattern for secondary,
  // non-critical-path effects. Only called when `deps.writeCalendarPlan` is
  // defined, so every existing test that doesn't stub it keeps passing
  // unchanged.
  if (deps.writeCalendarPlan) {
    try {
      await deps.writeCalendarPlan(plan.blocks.filter((block) => block.kind !== "calendar-anchor"));
    } catch (err) {
      log({ level: "warn", event: "morning-ritual.calendar-sync-failed", detail: describeError(err) });
    }
  }

  // Task 27 / Story 5.3 (post-review fix): the timed span for a `"delivered"`
  // run ends HERE — immediately before `deps.sendNotification` below, per
  // this story's AC's own "excluding notification delivery" carve-out (see
  // `planGenerationStartMs`'s own comment for the full reasoning this
  // widened boundary follows). Everything from the Data-Completeness Gate
  // through this line — including step 8.5's Time-Budget-deferral-streak/
  // Proposal sync, `generatePlanReasoning`, Plan assembly, `renderPlan`,
  // `putPlan`'s own persistence I/O, and the "Yoh Plan" Calendar sync
  // (step 12a.5, final whole-branch review Finding 1) just above — is
  // genuinely measured, not just gate-through-fit.
  const planGenerationMs = Math.round(performance.now() - planGenerationStartMs);

  // --- 12b. Send exactly one notification -----------------------------------
  // The unchecked-night notice (Task 21), when present, is prepended to the
  // plain-text notification body too — the ONE destination in this function
  // that cannot render ANSI at all, hence `renderUncheckedNightNotice`'s own
  // `color: false` here rather than `noticeColor` above. Its length is
  // subtracted from `buildNotificationBody`'s own limit budget FIRST, so the
  // combined body still never exceeds Pushover's real size limit — a
  // silently-too-long combined message would risk losing the whole
  // notification, notice included, exactly the failure mode
  // `buildNotificationBody`'s own doc comment already guards against for the
  // Plan body alone.
  const noticePlain = uncheckedNight ? renderUncheckedNightNotice(uncheckedNight, { color: false }) : undefined;
  const planBodyLimit = noticePlain
    ? Math.max(0, PUSHOVER_MESSAGE_LIMIT - noticePlain.length - 2)
    : PUSHOVER_MESSAGE_LIMIT;
  const notificationBody = noticePlain
    ? `${noticePlain}\n\n${buildNotificationBody(plan, deps.timeZone, planBodyLimit)}`
    : buildNotificationBody(plan, deps.timeZone);
  try {
    await deps.sendNotification({
      title: NOTIFICATION_TITLE.slice(0, PUSHOVER_TITLE_LIMIT),
      message: notificationBody,
    });
  } catch (err) {
    log({ level: "error", event: "morning-ritual.notify-failed", detail: describeError(err) });
    return failure("unreachable", `morning-ritual: could not send today's Plan notification — ${describeError(err)}`, err);
  }

  // --- 12c. Mark the day done, AFTER a confirmed delivery -------------------
  // Deliberately after the send, not before. Writing it first would make the
  // notification strictly at-most-once, but at the cost that ANY transient
  // Pushover failure (a network blip, a brief outage) permanently burns the
  // day: every later trigger would return `already-ran` and Spencer would
  // simply never get a Plan, with nothing visible to tell him why. Writing
  // it after means a failed send is retried by the next trigger — which
  // re-reads and re-fits against the current time, so the retry delivers a
  // Plan that is still accurate rather than a stale one.
  //
  // The residual risk this accepts: if the send succeeds and THIS write then
  // throws, the next trigger sends a second notification. That window is a
  // local SQLite write on a singleton row only this ritual ever writes,
  // immediately after a successful network call — far narrower than the
  // outage window it replaces, and it fails loud rather than silent.
  try {
    putRitualRun(deps.store, MORNING_RITUAL_ID, { date: today, ranAt: nowIso, planId: plan.id });
  } catch (err) {
    log({ level: "error", event: "morning-ritual.mark-run-failed", detail: describeError(err) });
    return failure("conflict", `morning-ritual: today's Plan was sent but could not be marked delivered — ${describeError(err)}`, err);
  }

  // --- 12d. Stamp the displayed unchecked night as shown, AFTER a confirmed
  // delivery (Task 21, post-review fix) ---------------------------------------
  // Deliberately the LAST write, after the notification has genuinely been
  // sent and the day itself is marked delivered — `shownAt` is what makes
  // UX-DR14's "shown once" hold (see step 1.5's own comment and
  // `memory-store.ts`'s `UncheckedDay.shownAt` doc comment): stamping it any
  // earlier would risk marking the flag "shown" for a run that then fails to
  // actually deliver anything (e.g. a `sendNotification` failure a few lines
  // above), silently burning Spencer's one guaranteed look at it. A failed
  // send above already returns before reaching here, so a later retry still
  // finds this same record with `shownAt` unset and gets a fresh chance to
  // show it. The RECORD itself was already written earlier — by
  // `rituals/night-ritual.ts`'s `runNightEscalateRitual`, at cap-spend time
  // — this step only ever patches `shownAt` onto it.
  //
  // `markUncheckedDayShown` returns `undefined` (a clean no-op, NOT a throw
  // — Task 21, Minor post-review fix) if the record is already gone by the
  // time this line runs. That is a REAL, reachable case: `rituals/
  // night-ritual.ts`'s `clearUncheckedDay` (Task 21's second post-review
  // fix) now deletes this exact row once Spencer genuinely answers a
  // close-out, and this whole function's own Notion/Calendar reads and
  // Pushover send (steps 2–12b, all awaited above) leave a real window
  // during which a SEPARATE `server.ts` process (same SQLite file,
  // AD-10) can answer and clear it before this line ever runs. That is not
  // an error — the night is no longer unchecked either way — so this run
  // does not fail for it (nothing to catch, since `markUncheckedDayShown`
  // doesn't throw for this case); only a genuine thrown error is converted
  // to a `Result` failure below.
  //
  // Task 27 / Story 5.3 audit fix: this branch used to be entirely SILENT —
  // it executed and changed nothing, with no log line at all, which is
  // exactly the "technically running but effectively broken" gap this
  // story's own AC exists to catch. The `undefined` return is now logged
  // (info, not error — it is a benign, expected race, not a failure) so a
  // run in which this happened is reconstructable afterward rather than
  // looking identical to a run where the stamp genuinely succeeded.
  if (uncheckedNight) {
    try {
      const stamped = markUncheckedDayShown(deps.store, uncheckedNight.date, nowIso);
      if (!stamped) {
        log({
          level: "info",
          event: "morning-ritual.unchecked-day-already-resolved",
          detail: { date: uncheckedNight.date },
        });
      }
    } catch (err) {
      log({ level: "error", event: "morning-ritual.unchecked-day-mark-shown-failed", detail: describeError(err) });
      return failure(
        "conflict",
        `morning-ritual: today's Plan was sent but the unchecked-night flag for ${uncheckedNight.date} could not be marked shown — ${describeError(err)}`,
        err,
      );
    }
  }

  log({
    level: "info",
    event: "morning-ritual.delivered",
    detail: {
      date: today,
      planId: plan.id,
      blocks: plan.blocks.length,
      deferred: fitted.value.deferredTaskIds.length,
      uncheckedNightDate: uncheckedNight?.date,
      planGenerationMs,
    },
  });

  return {
    ok: true,
    value: {
      status: "delivered",
      date: today,
      plan,
      rendered,
      deferredTaskIds: fitted.value.deferredTaskIds,
      incompleteTaskIds,
      planGenerationMs,
      ...(uncheckedNight ? { uncheckedNight } : {}),
    },
  };
}
