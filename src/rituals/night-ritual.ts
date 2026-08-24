/**
 * src/rituals/night-ritual.ts
 *
 * Night Ritual Close-Out (Story 3.1 / Epic 3, FR-12–FR-14): the first task of
 * Epic 3, and the file that finally exercises Task 17's `slip-bump.ts`
 * (`recordSlip`/`clearSlip` were built, but unused, until now) and closes the
 * `bumpLevels` bridge `shell/ritual-cli.ts`'s `createMorningRitualDeps`
 * deliberately left unpopulated. As Spencer, I want Yoh to ask once per day
 * what got done and what slipped, and have that recorded both internally and
 * in Notion, so tomorrow's Plan starts from an honest, synced state.
 *
 * ============================================================================
 * Two halves, on two different sides of AD-5's "never blocks" line
 * ============================================================================
 *
 * `night-prompt` (AD-5) is one-shot, OS-cron-triggered, and must never wait
 * for input — the same contract `rituals/morning-ritual.ts` has for
 * `ritual-cli.ts morning`. Spencer's ANSWER, though, only ever arrives later,
 * interactively, in `shell/chat-cli.ts`. So — mirroring
 * `rituals/data-completeness.ts`'s own two-caller split, and
 * `rituals/mid-day-reflow.ts`'s "one function, two shell-layer callers"
 * shape — this file exports two independent entry points instead of one:
 *
 *  1. `runNightPromptRitual` — what `ritual-cli.ts night-prompt` calls.
 *     Reads today's stored `Plan` (`getPlan`), collects every DISTINCT Task
 *     named by a `work` PlanBlock (skipping `break`/`calendar-anchor` — they
 *     carry no `taskId` to confirm), persists ONE combined open interaction
 *     request (`requestKind: "night-close-out"`, the same "one prompt names
 *     everything" shape Task 5's Data-Completeness Gate established for
 *     `requestKind: "data-completeness"` — see that file's own
 *     `DATA_COMPLETENESS_REQUEST_ID` for the precedent this mirrors), and
 *     returns immediately. No `io.readLine` anywhere in this half — enforced
 *     by the same `tests/ritual-cli.test.ts`-style source scan
 *     `tests/night-ritual.test.ts` could add, though this file's own
 *     structure (an injected `NightPromptRitualDeps` with no IO seam at all)
 *     makes the violation impossible to construct in the first place, not
 *     just discouraged.
 *
 *  2. `applyNightCloseOutConfirmation` — what `shell/chat-cli.ts` calls once
 *     PER TASK, as Spencer answers each one. Writes the confirmed status to
 *     Notion (`notion-adapter.ts`'s `setTaskStatus`, injected) and then —
 *     for a `"slipped"` confirmation — calls `memory-store.ts`'s
 *     `recordSlip`, Task 17's AUTHORITATIVE Slip-Bump trigger ("Night Ritual
 *     close-out is Slip-Bump's guaranteed, authoritative trigger; Mid-Day
 *     Re-Flow is the earlier, optional one" — the epics text, quoted
 *     verbatim in `slip-bump.ts`'s own "Scope note"). A `"completed"`
 *     confirmation calls `clearSlip` if a `SlipHistory` row exists, per Task
 *     17's own AC ("cleared, not carried indefinitely"). The interaction
 *     request's LOOP (ask each named Task, persist each answer, clear once
 *     every Task is answered) lives in `shell/chat-cli.ts` itself — this
 *     function is the single-Task apply step it calls once per answer,
 *     exactly the role `parseFieldAnswer` + the per-field
 *     `mergeTaskFieldOverride` call plays inside
 *     `chat-cli.ts`'s `answerDataCompletenessRequest` for the
 *     Data-Completeness precedent.
 *
 * Notion is written BEFORE any local Slip-Bump state changes (see the
 * ordering inside `applyNightCloseOutConfirmation` below) — a failed Notion
 * write must not leave a `SlipHistory` row (or a cleared one) that Notion
 * itself doesn't yet agree with; `chat-cli.ts` re-asks the same question on
 * failure rather than silently moving on, the same "wait indefinitely,
 * re-prompt on failure" pattern `answerDataCompletenessRequest` already uses
 * for an unparseable answer.
 *
 * ============================================================================
 * The first attempt's own push notification (Task 20 review fix)
 * ============================================================================
 *
 * `runNightPromptRitual` was originally built (Task 19) to only persist the
 * open interaction request — discoverable exclusively by opening
 * `chat-cli.ts`, with no active nudge at all. That silently broke Task 20's
 * whole premise ("a channel distinct from the first attempt's push
 * notification"): there was no first push to be distinct FROM. Fixed here by
 * adding a `sendNotification` seam to `NightPromptRitualDeps`, the exact
 * same shape `morning-ritual.ts`'s `MorningRitualDeps.sendNotification`
 * already has — `runNightPromptRitual` now sends one short Pushover push
 * (`NIGHT_PROMPT_NOTIFICATION_TITLE`, the same `promptText` the interaction
 * request itself carries) immediately after persisting the request, and
 * BEFORE marking the night's `night-prompt` ritual-run done — mirroring
 * `runMorningRitual`'s own persist-then-send-then-mark ordering, so a
 * transient Pushover failure never loses the persisted request (Spencer can
 * still find it in chat) and is retried by the next same-night trigger
 * rather than permanently burning the night.
 *
 * ============================================================================
 * Idempotence (AD-5, this task's own AC #6: "triggered twice the same night
 * doesn't re-persist a duplicate/redundant request")
 * ============================================================================
 *
 * Reuses Task 10's exact `RitualRun` marker pattern (`getRitualRun`/
 * `putRitualRun`, `memory-store.ts`), under its own ritual id
 * (`NIGHT_PROMPT_RITUAL_ID`), the same way `morning-ritual.ts`'s
 * `MORNING_RITUAL_ID` marker makes a second same-day cron trigger a cheap
 * no-op. A second `night-prompt` trigger the same LOCAL day therefore
 * short-circuits to `"already-ran"` before touching the interaction request
 * at all — the open request (if Spencer hasn't answered it yet) is left
 * completely untouched: same `StoredRecord.version`, same `createdAt`, not
 * replaced or bumped. Like `morning-ritual.ts`'s own outcomes that write
 * nothing (`nothing-to-plan`/`nothing-fits`), `"no-plan-today"` here
 * deliberately does NOT write the marker, so a later same-night trigger
 * (after the Plan has actually been generated) can still prompt — the day
 * isn't burned by an early trigger that found nothing to confirm yet.
 * `"nothing-to-confirm"` (a Plan exists but has no `work` blocks at all — an
 * all-calendar/all-break day) DOES write the marker: nothing about that Plan
 * is going to spontaneously grow a `work` block later tonight, so there is
 * nothing a retry could accomplish that this run didn't already determine.
 *
 * ============================================================================
 * Deduplication by Task id (this task's own AC: "for each Plan Block" read
 * as "for each Task a Plan Block names")
 * ============================================================================
 *
 * `mid-day-reflow.ts` can leave a single Task split across more than one
 * `work` PlanBlock in the same day's stored Plan (its own docstring's
 * "Merging past and re-fit blocks" section). Notion's Status property is
 * per-TASK, not per-block, and asking "did you finish 'Draft the memo'?"
 * twice in the same prompt would be confusing and would risk two
 * conflicting answers for the one Notion write `setTaskStatus` can make.
 * `runNightPromptRitual` therefore collects DISTINCT `taskId`s (first-seen
 * label wins), never one entry per block.
 *
 * ============================================================================
 * Unchecked-Day Handling & Rollover (Story 3.3 / Task 21) — see
 * `runNightEscalateRitual`'s own "Recording the unchecked day" section
 * ============================================================================
 *
 * This file's third and final addition: `runNightEscalateRitual` (below)
 * writes `memory-store.ts`'s new `UncheckedDay` record itself, at the exact
 * moment it confirms both close-out attempts have genuinely been spent for
 * a night — this IS the "when a night counts as unchecked" determination
 * (resolving this story's first genuine source-text ambiguity: AD-5 names
 * no fourth subcommand to "seal" a night, so this task settled on making
 * the moment `night-escalate` itself confirms the cap is spent, rather than
 * an inference some LATER ritual run re-derives from other state).
 *
 * **Post-review correction.** The first version of this task inferred
 * "unchecked" from `rituals/morning-ritual.ts`, the following morning,
 * by re-reading `night-escalate`'s own `RitualRun` marker and the
 * close-out `InteractionRequest` singleton and checking whether they still
 * both described the same night. That was wrong: both of those records are
 * singletons the very NEXT night's own `night-prompt`/`night-escalate` runs
 * silently overwrite to describe the new night — so if the Morning Ritual
 * didn't happen to deliver on the one morning that inference was still
 * valid (e.g. `nothing-to-plan`, `nothing-fits`, any failure, or simply not
 * running that day), the unchecked status was never written at all and was
 * unrecoverable. Recording it HERE, at the moment of genuine certainty,
 * makes it independent of anything a later night can overwrite —
 * `rituals/morning-ritual.ts` now only ever reads this durable record
 * (`memory-store.ts`'s `listUncheckedDays`) to decide what to display.
 *
 * `runNightEscalateRitual`'s own doc comment (below) carries the full
 * reasoning for this story's second genuine ambiguity too — WHAT
 * "mandatory Blocker(s)" means concretely in this codebase's actual data
 * model (there is no persisted `Blocker` entity anywhere).
 *
 * **Second round of post-review fixes.** Moving detection into
 * `runNightEscalateRitual` introduced two regressions of its own, both now
 * fixed and both documented at their own call sites: (1) the still-open
 * request `night-escalate` finds is not necessarily TONIGHT's own — a
 * planless night leaves an earlier night's request open and stale, so the
 * write is now gated on `detail?.date === today` (see that function's own
 * "Guarding against a STALE open request" section); (2) a genuinely
 * answered night's `UncheckedDay` row was never being resolved, so a
 * properly-closed-out night (even one that WAS escalated first) could still
 * be falsely flagged later — `clearNightCloseOutRequestIfOpen` (below) now
 * also resolves the matching `UncheckedDay` record via
 * `memory-store.ts`'s new `clearUncheckedDay`.
 */
import {
  clearInteractionRequest,
  clearSlip,
  clearUncheckedDay,
  getOpenInteractionRequest,
  getPlan,
  getRitualRun,
  getSlipHistory,
  putOpenInteractionRequest,
  putRitualRun,
  putUncheckedDay,
  recordSlip,
  type MemoryStore,
} from "../adapters/memory-store.ts";
import type { LogEntry } from "../adapters/logger.ts";
import { ATTENTION, localIsoDate, RESET, shouldUseColor } from "./morning-ritual.ts";
import type { PlanNotification } from "./morning-ritual.ts";
import type { EmailMessage } from "../adapters/email-adapter.ts";
import type {
  ExternalId,
  InteractionRequest,
  IsoDate,
  Result,
  TaskStatus,
  YohError,
} from "../types/domain.ts";

// ============================================================================
// Shared ids
// ============================================================================

/** The `ritual-run` marker id `night-prompt` writes/reads for its own AD-5 idempotence guard — mirrors `morning-ritual.ts`'s `MORNING_RITUAL_ID`. */
export const NIGHT_PROMPT_RITUAL_ID = "night-prompt";

/** The fixed, singleton interaction-request id the Night Ritual close-out prompt is stored under — mirrors `rituals/data-completeness.ts`'s `DATA_COMPLETENESS_REQUEST_ID` (one combined request, not one per Task). */
export const NIGHT_CLOSE_OUT_REQUEST_ID = "night-close-out";

/**
 * The `night-prompt` push notification's title (Task 20 review fix — see the
 * module docstring's "The first attempt's own push notification" section).
 * Plain text, like `morning-ritual.ts`'s own `NOTIFICATION_TITLE`: Pushover
 * titles carry no styling at all, so the cue is the wording itself, not
 * color (UX-DR20).
 */
export const NIGHT_PROMPT_NOTIFICATION_TITLE = "Close out today?";

// ============================================================================
// Prompt text / detail shape
// ============================================================================

/** One Task named by the close-out prompt — enough for `chat-cli.ts` to ask "completed or slipped?" and later call `applyNightCloseOutConfirmation(taskId, ...)`. */
export interface NightCloseOutTaskDetail {
  readonly taskId: ExternalId;
  /** The PlanBlock's own `label` (the Task's title as of Plan-generation time) — display only, never re-parsed. */
  readonly taskTitle: string;
}

/** `InteractionRequest<NightCloseOutRequestDetail>`'s `detail` payload — the structured half `chat-cli.ts` reads programmatically, alongside `promptText`'s human-readable half. */
export interface NightCloseOutRequestDetail {
  readonly date: IsoDate;
  readonly tasks: readonly NightCloseOutTaskDetail[];
}

/**
 * Builds the single combined prompt text (UX-DR10's "one prompt may cover
 * multiple ... Tasks" shape, applied here) — mirrors
 * `rituals/data-completeness.ts`'s `buildMissingFieldsPromptText`. Pure/no
 * I/O; the caller applies any accent-color wrapping when actually printing
 * it (`chat-cli.ts`, same as every other interaction-request prompt).
 */
export function buildNightCloseOutPromptText(tasks: readonly NightCloseOutTaskDetail[]): string {
  const subject = tasks.length === 1 ? "this Task" : "these Tasks";
  const lines = tasks.map((t) => `  - ${t.taskTitle}`);
  return [`How did today go? For ${subject}, tell me completed or slipped:`, ...lines].join("\n");
}

// ============================================================================
// runNightPromptRitual — the persist-and-exit half (AD-5)
// ============================================================================

/**
 * Every input/I-O edge `runNightPromptRitual` needs, injected — deliberately
 * has NO `io`/`readLine` seam at all (unlike `ChatCliIo`): AD-5 requires
 * this half to never wait for input, and giving it no readable-input seam to
 * begin with makes that impossible to violate by construction, not merely a
 * convention to remember.
 */
export interface NightPromptRitualDeps {
  readonly store: MemoryStore;
  /**
   * `adapters/notification-adapter.ts`'s `sendPushoverNotification`,
   * pre-bound to its config — the SAME shape (and the same seam name) as
   * `MorningRitualDeps.sendNotification`, added by Task 20's review fix: the
   * first close-out attempt has to be an actively-delivered push, not merely
   * a silently-persisted interaction request Spencer only sees if he happens
   * to open `chat-cli.ts` — see the module docstring's "The first attempt's
   * own push notification" section. Throws on I/O failure (AD-8).
   */
  readonly sendNotification: (notification: PlanNotification) => Promise<void>;
  /** Injectable clock — never `new Date()` inline, so a test can pin the night. */
  readonly now: () => Date;
  /** Spencer's IANA timezone, defining "today" — the same Plan-date key `morning-ritual.ts`/`mid-day-reflow.ts` use. */
  readonly timeZone: string;
  readonly log?: (entry: LogEntry) => void;
}

/** What one `night-prompt` run did. Discriminated on `status`, mirroring `MorningRitualOutcome`'s/`MidDayReflowOutcome`'s shape. */
export type NightPromptOutcome =
  | {
      /** A `night-prompt` trigger already ran (and, if it found anything to confirm, opened the request) for today — this run touched nothing. */
      readonly status: "already-ran";
      readonly date: IsoDate;
    }
  | {
      /** No Plan has been generated for today yet. No marker is written — a later same-night trigger, once a Plan exists, can still prompt. */
      readonly status: "no-plan-today";
      readonly date: IsoDate;
    }
  | {
      /** Today's Plan exists but names no `work` blocks at all (an all-calendar/all-break day) — nothing to confirm. The marker IS written; nothing about this Plan will change later tonight. */
      readonly status: "nothing-to-confirm";
      readonly date: IsoDate;
    }
  | {
      /** The combined close-out request was persisted, naming every distinct Task a `work` block referenced. */
      readonly status: "prompted";
      readonly date: IsoDate;
      readonly tasks: readonly NightCloseOutTaskDetail[];
    };

function failure(kind: YohError["kind"], message: string, detail?: unknown): Result<never, YohError> {
  return { ok: false, error: detail === undefined ? { kind, message } : { kind, message, detail } };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The `night-prompt` half (AD-5): persists an open interaction request
 * naming every distinct Task a `work` PlanBlock references in today's stored
 * Plan, and returns immediately. See the module docstring for the full
 * design.
 *
 * Per AD-8, this is one of the layers allowed to catch an adapter's throw:
 * every `memory-store.ts` write below (which can throw `ConflictError` under
 * AD-10 concurrency with `chat-cli.ts`) is wrapped and converted into a
 * `Result` failure plus a structured log line.
 */
export async function runNightPromptRitual(
  deps: NightPromptRitualDeps,
): Promise<Result<NightPromptOutcome, YohError>> {
  const log = deps.log ?? ((): void => {});
  const nowDate = deps.now();
  const nowIso = nowDate.toISOString();
  const today = localIsoDate(nowDate, deps.timeZone);

  // --- Idempotence guard (AC #6) --------------------------------------------
  const lastRun = getRitualRun(deps.store, NIGHT_PROMPT_RITUAL_ID);
  if (lastRun?.data.date === today) {
    log({ level: "info", event: "night-ritual.already-ran", detail: { date: today } });
    return { ok: true, value: { status: "already-ran", date: today } };
  }

  // --- Read today's stored Plan ----------------------------------------------
  const plan = getPlan(deps.store, today);
  if (!plan) {
    log({ level: "info", event: "night-ritual.no-plan-today", detail: { date: today } });
    return { ok: true, value: { status: "no-plan-today", date: today } };
  }

  // --- Collect every DISTINCT Task a work block names (dedupe by taskId) ----
  const seen = new Set<ExternalId>();
  const tasks: NightCloseOutTaskDetail[] = [];
  for (const b of plan.data.blocks) {
    if (b.kind !== "work" || b.taskId === undefined) continue;
    if (seen.has(b.taskId)) continue;
    seen.add(b.taskId);
    tasks.push({ taskId: b.taskId, taskTitle: b.label });
  }

  if (tasks.length === 0) {
    try {
      putRitualRun(deps.store, NIGHT_PROMPT_RITUAL_ID, { date: today, ranAt: nowIso });
    } catch (err) {
      log({ level: "error", event: "night-ritual.mark-run-failed", detail: describeError(err) });
      return failure("conflict", `night-ritual: could not mark night-prompt done — ${describeError(err)}`, err);
    }
    log({ level: "info", event: "night-ritual.nothing-to-confirm", detail: { date: today } });
    return { ok: true, value: { status: "nothing-to-confirm", date: today } };
  }

  // --- Persist the single combined interaction request -----------------------
  const request: InteractionRequest<NightCloseOutRequestDetail> = {
    requestKind: "night-close-out",
    promptText: buildNightCloseOutPromptText(tasks),
    detail: { date: today, tasks },
    createdAt: nowIso,
  };

  try {
    putOpenInteractionRequest(deps.store, NIGHT_CLOSE_OUT_REQUEST_ID, request);
  } catch (err) {
    log({ level: "error", event: "night-ritual.persist-failed", detail: describeError(err) });
    return failure("conflict", `night-ritual: could not persist the close-out prompt — ${describeError(err)}`, err);
  }

  // --- Notify Spencer the close-out prompt is waiting (AD-8 boundary) -------
  // The interaction request is already persisted above, so a delivery
  // failure here never loses it — Spencer can still find it by opening
  // `chat-cli.ts` even without the push. Mirrors `runMorningRitual`'s own
  // "persist before send" ordering.
  try {
    await deps.sendNotification({
      title: NIGHT_PROMPT_NOTIFICATION_TITLE,
      message: request.promptText,
    });
  } catch (err) {
    log({ level: "error", event: "night-ritual.notify-failed", detail: describeError(err) });
    return failure(
      "unreachable",
      `night-ritual: could not send tonight's close-out notification — ${describeError(err)}`,
      err,
    );
  }

  // --- Mark the day done, AFTER a confirmed delivery -------------------------
  // Deliberately after the send, not before — the same reasoning
  // `runMorningRitual`'s own step 12c gives: writing this first would make
  // the notification strictly at-most-once, but a transient Pushover outage
  // would then permanently burn the night with nothing telling Spencer why.
  // Leaving it unwritten on a failed send lets the next trigger retry.
  try {
    putRitualRun(deps.store, NIGHT_PROMPT_RITUAL_ID, { date: today, ranAt: nowIso });
  } catch (err) {
    log({ level: "error", event: "night-ritual.mark-run-failed", detail: describeError(err) });
    return failure(
      "conflict",
      `night-ritual: tonight's close-out prompt was sent but could not be marked done — ${describeError(err)}`,
      err,
    );
  }

  log({ level: "info", event: "night-ritual.prompted", detail: { date: today, taskCount: tasks.length } });
  return { ok: true, value: { status: "prompted", date: today, tasks } };
}

// ============================================================================
// applyNightCloseOutConfirmation — the answer-processing half
// ============================================================================

/** The two statuses a close-out confirmation can carry — Notion's own `TaskStatus` enum has two more (`"not-started"`/`"in-progress"`), neither of which a close-out confirmation ever reports. */
export type NightCloseOutStatus = Extract<TaskStatus, "completed" | "slipped">;

/**
 * Every I/O edge `applyNightCloseOutConfirmation` needs, injected —
 * `setTaskStatus` is `notion-adapter.ts`'s own write function, pre-bound to
 * its client/config (see that function's own doc comment for why the bound
 * shape here is exactly AD-12's quoted 2-arg signature while the adapter
 * export itself carries `(client, config, ...)`). Unlike `readTasks`/
 * `sendNotification` elsewhere in this codebase, `setTaskStatus` does NOT
 * throw — it already returns `Result<void, YohError>` directly (AD-12's
 * deliberate AD-8 exception), so this function has no `try`/`catch` around
 * that one call, only around its own `memory-store.ts` writes below.
 */
export interface NightCloseOutApplyDeps {
  readonly store: MemoryStore;
  readonly setTaskStatus: (taskId: ExternalId, status: TaskStatus) => Promise<Result<void, YohError>>;
}

/**
 * Applies ONE confirmed Task status: writes it to Notion, then updates
 * Slip-Bump state to match. See the module docstring's "Two halves" section
 * for the full design and why Notion is written first.
 *
 * - `"slipped"`: calls `memory-store.ts`'s `recordSlip(store, taskId,
 *   closeOutDate)` — Task 17's AUTHORITATIVE Slip-Bump trigger, the exact
 *   same storage primitive a mid-day-reported slip would call, so the
 *   resulting `SlipHistory`/bump level is genuinely computed by
 *   `core/slip-bump.ts`'s `computeSlipBumpLevel` (which itself delegates to
 *   `core/escalate-under-strain.ts`'s `computeEscalation`, AD-6) — nothing
 *   in this function fabricates or shortcuts that number.
 * - `"completed"`: calls `clearSlip(store, taskId)` ONLY if a `SlipHistory`
 *   row currently exists — a harmless no-op otherwise (Task 17's own AC:
 *   the bump is cleared, not carried indefinitely, but a Task that never
 *   slipped has nothing to clear).
 *
 * Per AD-8, this is one of the layers allowed to catch an adapter's throw:
 * `recordSlip`/`clearSlip` (which can throw `ConflictError` under AD-10
 * concurrency) are wrapped and converted into a `Result` failure. If the
 * Notion write itself fails, this function returns that failure immediately
 * and touches NO local Slip-Bump state at all — see the module docstring's
 * ordering note.
 */
export async function applyNightCloseOutConfirmation(
  deps: NightCloseOutApplyDeps,
  taskId: ExternalId,
  status: NightCloseOutStatus,
  closeOutDate: IsoDate,
): Promise<Result<void, YohError>> {
  const written = await deps.setTaskStatus(taskId, status);
  if (!written.ok) return written;

  try {
    if (status === "slipped") {
      recordSlip(deps.store, taskId, closeOutDate);
    } else {
      const existing = getSlipHistory(deps.store, taskId);
      if (existing) clearSlip(deps.store, taskId);
    }
  } catch (err) {
    return failure(
      "conflict",
      `night-ritual: Notion Status was written for Task ${taskId}, but its Slip-Bump history could not be updated — ${describeError(err)}`,
      err,
    );
  }

  return { ok: true, value: undefined };
}

// ============================================================================
// clearNightCloseOutRequestIfFullyAnswered — the loop-completion helper
// ============================================================================

/**
 * Clears the combined close-out interaction request, IF it is still open —
 * `shell/chat-cli.ts`'s per-Task confirmation loop calls this once every
 * named Task has been either answered OR explicitly skipped (Task 19's
 * "skip" escape hatch — see `chat-cli.ts`'s own `answerNightCloseOutRequest`
 * doc comment), mirroring `answerDataCompletenessRequest`'s own
 * re-read-current-version-then-clear step in that file. Re-reads the
 * request's current version rather than trusting a version captured before
 * the loop ran, so a genuine concurrent write to it (AD-10) is still caught
 * as `ConflictError` rather than silently dropped — the same reasoning that
 * function's own doc comment gives.
 *
 * **Also resolves a matching `UncheckedDay` record — but ONLY when nothing
 * was skipped (Task 21, third post-review fix).** If the request being
 * cleared here was ever recorded as unchecked (`runNightEscalateRitual`'s
 * own `putUncheckedDay` call, for the SAME date this request's own
 * `detail.date` names), a genuine full answer means the night is no longer
 * unchecked, and leaving the record unresolved would falsely flag "last
 * night wasn't closed out" on a future Morning Plan naming a Task Spencer
 * just confirmed — exactly the scenario this story's own AC3 forbids ("a
 * day that was actually closed out ... is never silently treated as
 * equivalent to an unchecked day").
 *
 * BUT the second post-review fix that added this originally cleared the
 * record UNCONDITIONALLY on every call — including a skip-all or partial
 * skip, where `chat-cli.ts` deliberately does NOT call `setTaskStatus`/
 * `recordSlip`/`clearSlip` for the skipped Task(s) ("since Spencer
 * explicitly did not confirm what actually happened," per that function's
 * own doc comment) yet still clears the request to unblock the chat
 * session. A skip is NOT a genuine answer — Spencer still hasn't confirmed
 * what happened to at least one Task that night — so clearing the
 * `UncheckedDay` record on a skip would silently vanish the escalated
 * night's flag and rolled-forward Task names forever, precisely the
 * "silently vanishes" failure mode FR-14/UX-DR14 exist to prevent, and
 * precisely the scenario the skip hatch was built for.
 *
 * `resolveUncheckedDay` is therefore a REQUIRED parameter — `chat-cli.ts`
 * passes `skippedTitles.length === 0` (true only when every named Task was
 * genuinely answered, none skipped). Making it required rather than
 * defaulted forces every call site to make this choice explicitly rather
 * than silently inheriting a default that could be wrong for a future
 * caller. Reads the request's `detail.date` BEFORE clearing the request
 * itself (both come from the same already-read `current` record, so this
 * costs no extra read); `clearUncheckedDay` is a harmless no-op if that
 * night was never escalated/recorded in the first place either way.
 */
export function clearNightCloseOutRequestIfOpen(
  store: MemoryStore,
  options: { readonly resolveUncheckedDay: boolean },
): void {
  const current = getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID);
  if (!current) return;

  const detail = current.data.detail as NightCloseOutRequestDetail | undefined;
  clearInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID, current.version);
  if (options.resolveUncheckedDay && detail?.date !== undefined) {
    clearUncheckedDay(store, detail.date);
  }
}

// ============================================================================
// runNightEscalateRitual — the capped, second-attempt escalation half
// (Story 3.2 / Task 20)
// ============================================================================

/**
 * The `ritual-run` marker id `night-escalate` writes/reads for its own two
 * jobs at once: AD-5's ordinary "already ran today" idempotence guard, AND
 * this story's own cap ("both attempts have now been sent for tonight ...
 * no third attempt is ever sent, regardless of continued non-response").
 * Both properties fall out of the SAME marker for the SAME reason
 * `NIGHT_PROMPT_RITUAL_ID` gives `night-prompt` its once-per-night guard —
 * there is deliberately no separate "escalation count" anywhere: a capped
 * retry of exactly one further attempt IS "ran today or not," nothing more
 * to track.
 */
export const NIGHT_ESCALATE_RITUAL_ID = "night-escalate";

/**
 * The plain-text degradation of DESIGN.md's `{colors.attention}` escalation
 * marker, for the one destination in this ritual that can carry NO ANSI
 * color at all: an SMTP plain-text email body. Mirrors
 * `rituals/morning-ritual.ts`'s own precedent for Pushover's un-stylable
 * notification title (`NOTIFICATION_TITLE`'s doc comment) — UX-DR20 requires
 * every color cue be paired with plain-text wording carrying the same
 * meaning, and here that pairing IS the only signal, since the color half
 * has nowhere to render. `shell/ritual-cli.ts`'s own terminal confirmation
 * line for an `"escalated"` outcome is the one place the literal
 * `morning-ritual.ts` `ATTENTION` ANSI escape is used (see that file), for a
 * destination that CAN render it.
 */
export const ATTENTION_TEXT_MARKER = "ATTENTION:";

/**
 * Builds the escalated email's subject and body. UX-DR6/UX-DR13: the second
 * attempt escalates in DIRECTNESS OF WORDING and CHANNEL, never in volume of
 * text or alarm language — this is deliberately only a few lines longer than
 * `buildNightCloseOutPromptText`'s own first-attempt prompt, names the same
 * Tasks, and adds no explanation, exclamation, or repeated restatement.
 * Pure/no I/O, mirroring that function's own shape.
 */
export function buildNightEscalationEmail(tasks: readonly NightCloseOutTaskDetail[]): EmailMessage {
  const subject = `${ATTENTION_TEXT_MARKER} Still waiting on last night's close-out`;
  const lines = tasks.map((t) => `  - ${t.taskTitle}`);
  const text = [
    `${ATTENTION_TEXT_MARKER} You haven't answered tonight's close-out yet, for:`,
    ...lines,
    "",
    "Reply in chat: completed or slipped.",
  ].join("\n");
  return { subject, text };
}

/**
 * Renders the terminal-side confirmation line for an `"escalated"` outcome —
 * `shell/ritual-cli.ts`'s `handleNightEscalateResult` calls this rather than
 * composing the line itself. This is the ONE destination in this ritual that
 * CAN render ANSI color (unlike the SMTP email body above), so it is where
 * the literal `{colors.attention}` `ATTENTION` escape (`rituals/
 * morning-ritual.ts`) is actually used — the same "paint the label, degrade
 * to plain text off a TTY" shape `renderPlan`'s own `ACCENT` header uses.
 */
export function renderNightEscalateNotice(
  taskCount: number,
  date: IsoDate,
  options: { readonly color?: boolean } = {},
): string {
  const color = options.color ?? shouldUseColor();
  const text = `Sent a second, capped attempt via email for ${taskCount} Task${taskCount === 1 ? "" : "s"} still unconfirmed from ${date}.`;
  return color ? `${ATTENTION}${text}${RESET}` : text;
}

/**
 * Every input/I-O edge `runNightEscalateRitual` needs, injected. Like
 * `NightPromptRitualDeps`, this has NO `io`/`readLine` seam — AD-5 requires
 * this half to never wait for input either, and `shell/ritual-cli.ts`'s own
 * source-scan test covers the file as a whole.
 */
export interface NightEscalateRitualDeps {
  readonly store: MemoryStore;
  /** `adapters/email-adapter.ts`'s `sendEmail`, pre-bound to its config — the second attempt's channel, deliberately DISTINCT from `NightPromptRitualDeps.sendNotification` above (the first attempt's own Pushover push, Task 20 review fix). Throws on I/O failure (AD-8). */
  readonly sendEscalationEmail: (message: EmailMessage) => Promise<void>;
  /** Injectable clock — never `new Date()` inline, so a test can pin the night. */
  readonly now: () => Date;
  /** Spencer's IANA timezone, defining "tonight" — the same Plan-date key `runNightPromptRitual` uses. */
  readonly timeZone: string;
  readonly log?: (entry: LogEntry) => void;
}

/** What one `night-escalate` run did. Discriminated on `status`, mirroring `NightPromptOutcome`'s shape. */
export type NightEscalateOutcome =
  | {
      /** `night-escalate` already ran tonight — whether it escalated or found nothing open, a further trigger the same night is a no-op. This is what makes the cap hold: see `NIGHT_ESCALATE_RITUAL_ID`'s own doc comment. */
      readonly status: "already-ran";
      readonly date: IsoDate;
    }
  | {
      /**
       * `night-prompt` has not recorded a run for tonight yet (Task 20
       * review fix, Important #2): there is nothing to escalate ABOUT yet —
       * distinguished from `"no-open-request"` below by checking
       * `NIGHT_PROMPT_RITUAL_ID`'s own ritual-run marker. Deliberately does
       * NOT write the `NIGHT_ESCALATE_RITUAL_ID` marker, so a later
       * same-night trigger (once `night-prompt` has actually run — whether
       * on schedule, delayed, or manually re-run) can still escalate. Never
       * burn the one capped attempt on a night that hasn't even asked the
       * question yet.
       */
      readonly status: "not-prompted-yet";
      readonly date: IsoDate;
    }
  | {
      /** `night-prompt` DID run tonight, and the close-out request is now absent — genuinely answered and cleared by `chat-cli.ts` before this trigger ran (the only other way it could be absent, `night-prompt` simply not having run yet, is `"not-prompted-yet"` above). Nothing to escalate. */
      readonly status: "no-open-request";
      readonly date: IsoDate;
    }
  | {
      /** The close-out request was still open — the escalation email was sent, naming every Task the (still-open) request names. */
      readonly status: "escalated";
      readonly date: IsoDate;
      readonly tasks: readonly NightCloseOutTaskDetail[];
    };

/**
 * The `night-escalate` half (AD-5, Story 3.2): checks whether tonight's
 * close-out request (`NIGHT_CLOSE_OUT_REQUEST_ID`) is STILL open, and if so
 * sends exactly one escalated email via the injected `sendEscalationEmail`
 * — a second, more direct nudge, never a third. See the module-level task
 * context (this file's own docstring predates this half; the design is
 * summarized here): `shell/ritual-cli.ts` schedules this some hours after
 * `night-prompt`, and it never blocks for input.
 *
 * Order of operations (mirrors `runMorningRitual`'s own send-before-mark
 * reasoning): the email is sent BEFORE the `night-escalate` ran-today marker
 * is written, so a transient SMTP failure is retried by a later same-night
 * trigger instead of permanently burning the one capped attempt. Once the
 * send succeeds (or once this run confirms the close-out was genuinely
 * answered and there was nothing left to send — see the `"not-prompted-yet"`
 * vs `"no-open-request"` distinction below), the marker is written — and
 * from then on, per this story's own AC ("both attempts have now been sent
 * for tonight ... no third attempt is ever sent"), EVERY further trigger the
 * same night short-circuits to `"already-ran"` without re-checking the
 * request at all — even if it is still open and Spencer still hasn't
 * answered. That is deliberate: the cap is unconditional, not "resend until
 * answered." The ONE case that does NOT write the marker at all is
 * `"not-prompted-yet"` — see below.
 *
 * Per AD-8, this is one of the layers allowed to catch an adapter's throw:
 * `sendEscalationEmail` (which may throw on I/O failure, `email-adapter.ts`'s
 * own contract) and every `memory-store.ts` write below (which can throw
 * `ConflictError` under AD-10 concurrency with `chat-cli.ts`) are wrapped and
 * converted into a `Result` failure plus a structured log line.
 *
 * **Disambiguating "no open request" (Task 20 review fix, Important #2).**
 * `getOpenInteractionRequest` returning nothing is ambiguous by itself — it
 * cannot distinguish "Spencer already answered and `chat-cli.ts` cleared it"
 * from "`night-prompt` hasn't fired tonight yet" (a delayed cron, a crash, a
 * manual re-run later). Only the FIRST case should burn the escalation cap;
 * the second must leave it un-burned so a later same-night trigger — once
 * `night-prompt` has actually run — can still escalate. See
 * `NightEscalateOutcome`'s `"not-prompted-yet"` vs `"no-open-request"`
 * variants for the two outcomes this distinction produces.
 *
 * **Recording the unchecked day (Story 3.3 / Task 21, post-review fix).**
 * The ONLY branch that ends in `"escalated"` — i.e. the request was
 * genuinely still open when the cap-spending email was sent — is where
 * `memory-store.ts`'s `putUncheckedDay` is called, immediately after a
 * confirmed send and (deliberately) BEFORE the `NIGHT_ESCALATE_RITUAL_ID`
 * ran-today marker is written. This is the actual "cap reached" moment
 * AC1 describes ("when the cap is reached ... marks the day as unchecked
 * in memory"), recorded right here rather than inferred later by
 * `rituals/morning-ritual.ts` re-reading state that the NEXT night's own
 * `night-prompt`/`night-escalate` runs will silently overwrite — see the
 * module docstring's "Unchecked-Day Handling & Rollover" section for the
 * full story of why the first version of this task got that wrong. Placed
 * BEFORE the ran-today marker write (not after, unlike every other
 * "mark done" step in this file) so that if it throws, the marker is
 * NOT written either — a retry re-sends the email (an accepted, narrow,
 * already-precedented residual risk, per this file's/`morning-ritual.ts`'s
 * own send-then-mark reasoning elsewhere) but also retries recording the
 * unchecked day, rather than risking a world where the marker says "ran"
 * but the night was never actually recorded as unchecked. The
 * `"no-open-request"` branch (cap spent because Spencer genuinely
 * answered) and the `"not-prompted-yet"` branch (cap not yet spent at
 * all) both correctly write NOTHING here — neither describes a night that
 * actually went unchecked.
 *
 * **Guarding against a STALE open request (Task 21, first post-review
 * fix).** `open` being truthy does NOT by itself mean the still-open
 * request describes TONIGHT — `night-prompt` only opens a NEW request when
 * it actually finds a Plan to confirm (`"no-plan-today"` is a deliberate
 * no-op, see that function's own doc comment), so a planless night leaves
 * an EARLIER night's request sitting open, unrelated to tonight. Recording
 * it here as tonight's own `UncheckedDay` would misattribute an old,
 * already-recorded (or already-answered) night to a night that never even
 * had a close-out — and left unguarded, this compounds: every further
 * planless night would record ANOTHER spurious row against the same stale
 * request, a growing, repeating flag that is exactly the "endless nagging"
 * this whole feature exists to prevent (UX-DR14: shown once). The guard is
 * simple: `putUncheckedDay` is only called when `detail?.date === today` —
 * the still-open request must genuinely describe THIS night. When it
 * doesn't, nothing is recorded (deliberately not keyed by `detail.date`
 * either — that would silently re-`put` whatever row already exists for
 * that EARLIER date, clobbering a `shownAt` stamp if one was already set;
 * simply skipping the write is the safe choice). The escalation EMAIL
 * itself is still sent either way (unchanged, pre-existing behavior,
 * outside this fix's scope) — only the unchecked-day RECORD is gated.
 *
 * **What "mandatory Blocker(s)" means, concretely (Story 3.3's second
 * genuine source-text ambiguity).** There is no persisted `Blocker` entity
 * anywhere in this codebase — FR-10's Blocker handling (Task 16) is a
 * transient mid-day rescheduling trigger with no lasting record, and the
 * PRD's own Glossary defines "Blocker" only generically ("a logistical
 * obstacle to a Plan Block"). The most defensible, implementable reading
 * given what actually exists: an unchecked night means Spencer never
 * confirmed which `work` Plan Blocks/Tasks completed or slipped, so every
 * Task still named by that night's close-out request is what "rolls
 * forward" as still needing attention. Concretely, that is simply `tasks`
 * (below — read verbatim off the still-open request's own `detail.tasks`,
 * the same list `runNightPromptRitual` built), stored into
 * `rolledForwardTasks`. This also naturally handles a PARTIALLY answered
 * close-out correctly without any extra bookkeeping: `chat-cli.ts`'s
 * `answerNightCloseOutRequest` only ever clears the request once EVERY
 * named Task has been answered or explicitly skipped (see that function's
 * own doc comment) — the list of named Tasks never shrinks mid-way through
 * a partially-completed session. So "still open at cap time" already means
 * "not fully closed out," and everything the request names is genuinely
 * still part of that unresolved close-out, whether or not some of them
 * were individually confirmed to Notion before Spencer stopped partway
 * through.
 */
export async function runNightEscalateRitual(
  deps: NightEscalateRitualDeps,
): Promise<Result<NightEscalateOutcome, YohError>> {
  const log = deps.log ?? ((): void => {});
  const nowDate = deps.now();
  const nowIso = nowDate.toISOString();
  const today = localIsoDate(nowDate, deps.timeZone);

  // --- Idempotence guard AND the cap itself (this task's own AC #3) --------
  const lastRun = getRitualRun(deps.store, NIGHT_ESCALATE_RITUAL_ID);
  if (lastRun?.data.date === today) {
    log({ level: "info", event: "night-ritual.escalate-already-ran", detail: { date: today } });
    return { ok: true, value: { status: "already-ran", date: today } };
  }

  // --- Is tonight's close-out request STILL open? ---------------------------
  const open = getOpenInteractionRequest(deps.store, NIGHT_CLOSE_OUT_REQUEST_ID);
  if (!open) {
    // Task 20 review fix (Important #2): `getOpenInteractionRequest`
    // returning `undefined` is ambiguous on its own — it can't tell "Spencer
    // already answered and chat-cli.ts cleared it" apart from "night-prompt
    // hasn't fired tonight at all yet" (`clearInteractionRequest` just
    // deletes the row; there's no audit trail). Disambiguate via
    // `night-prompt`'s OWN ritual-run marker before deciding whether to burn
    // the escalation cap.
    const promptRun = getRitualRun(deps.store, NIGHT_PROMPT_RITUAL_ID);
    if (promptRun?.data.date !== today) {
      // night-prompt hasn't run tonight yet — nothing to escalate about, and
      // burning the cap now would silently disable the safety net for the
      // rest of the night if night-prompt is merely delayed. No marker
      // written; a later same-night trigger (after night-prompt actually
      // runs) can still escalate.
      log({ level: "info", event: "night-ritual.escalate-not-prompted-yet", detail: { date: today } });
      return { ok: true, value: { status: "not-prompted-yet", date: today } };
    }

    // night-prompt DID run tonight, and the request is genuinely gone —
    // answered and cleared. Burn the cap: there is nothing left to escalate
    // tonight, and no further trigger should re-check.
    try {
      putRitualRun(deps.store, NIGHT_ESCALATE_RITUAL_ID, { date: today, ranAt: nowIso });
    } catch (err) {
      log({ level: "error", event: "night-ritual.escalate-mark-run-failed", detail: describeError(err) });
      return failure(
        "conflict",
        `night-ritual: could not mark night-escalate done — ${describeError(err)}`,
        err,
      );
    }
    log({ level: "info", event: "night-ritual.escalate-no-open-request", detail: { date: today } });
    return { ok: true, value: { status: "no-open-request", date: today } };
  }

  const detail = open.data.detail as NightCloseOutRequestDetail | undefined;
  const tasks = detail?.tasks ?? [];
  const email = buildNightEscalationEmail(tasks);

  // --- Send the (only) escalation email (AD-8 boundary) ----------------------
  try {
    await deps.sendEscalationEmail(email);
  } catch (err) {
    log({ level: "error", event: "night-ritual.escalate-send-failed", detail: describeError(err) });
    return failure(
      "unreachable",
      `night-ritual: could not send the escalation email — ${describeError(err)}`,
      err,
    );
  }

  // --- Record the night as unchecked, right now — Task 21 (post-review fix)
  // This IS the "cap reached" moment: see this function's own doc comment's
  // "Recording the unchecked day" section for why this happens HERE (not
  // inferred later by morning-ritual.ts) and why it happens BEFORE the
  // ran-today marker below. ONLY when the still-open request genuinely
  // describes TONIGHT (`detail?.date === today`) — see this function's own
  // "Guarding against a STALE open request" doc comment section (Task 21,
  // first post-review fix): a stale request left open by a planless night
  // must not be misattributed to tonight, which never had a close-out at
  // all, and must not spuriously re-put whatever's already recorded for
  // the request's own (earlier) date either.
  if (detail?.date === today) {
    try {
      putUncheckedDay(deps.store, {
        date: today,
        rolledForwardTasks: tasks.map((t) => ({ taskId: t.taskId, taskTitle: t.taskTitle })),
        recordedAt: nowIso,
      });
    } catch (err) {
      log({ level: "error", event: "night-ritual.escalate-record-unchecked-failed", detail: describeError(err) });
      return failure(
        "conflict",
        `night-ritual: the escalation email was sent but tonight could not be recorded as unchecked — ${describeError(err)}`,
        err,
      );
    }
  } else {
    log({
      level: "info",
      event: "night-ritual.escalate-stale-request-not-recorded",
      detail: { today, requestDate: detail?.date },
    });
  }

  // --- Mark the cap spent, AFTER a confirmed send AND a confirmed record ----
  try {
    putRitualRun(deps.store, NIGHT_ESCALATE_RITUAL_ID, { date: today, ranAt: nowIso });
  } catch (err) {
    log({ level: "error", event: "night-ritual.escalate-mark-run-failed", detail: describeError(err) });
    return failure(
      "conflict",
      `night-ritual: the escalation email was sent but could not be marked done — ${describeError(err)}`,
      err,
    );
  }

  log({ level: "info", event: "night-ritual.escalated", detail: { date: today, taskCount: tasks.length } });
  return { ok: true, value: { status: "escalated", date: today, tasks } };
}
