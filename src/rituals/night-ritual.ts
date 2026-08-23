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
 */
import {
  clearInteractionRequest,
  clearSlip,
  getOpenInteractionRequest,
  getPlan,
  getRitualRun,
  getSlipHistory,
  putOpenInteractionRequest,
  putRitualRun,
  recordSlip,
  type MemoryStore,
} from "../adapters/memory-store.ts";
import { localIsoDate } from "./morning-ritual.ts";
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

/** One structured log line, same shape as `morning-ritual.ts`'s/`mid-day-reflow.ts`'s (AD-7's real failure alerting is Epic 5; this is the seam it will read from). */
export interface NightPromptLogEntry {
  readonly level: "info" | "warn" | "error";
  readonly event: string;
  readonly detail?: unknown;
}

/**
 * Every input/I-O edge `runNightPromptRitual` needs, injected — deliberately
 * has NO `io`/`readLine` seam at all (unlike `ChatCliIo`): AD-5 requires
 * this half to never wait for input, and giving it no readable-input seam to
 * begin with makes that impossible to violate by construction, not merely a
 * convention to remember.
 */
export interface NightPromptRitualDeps {
  readonly store: MemoryStore;
  /** Injectable clock — never `new Date()` inline, so a test can pin the night. */
  readonly now: () => Date;
  /** Spencer's IANA timezone, defining "today" — the same Plan-date key `morning-ritual.ts`/`mid-day-reflow.ts` use. */
  readonly timeZone: string;
  readonly log?: (entry: NightPromptLogEntry) => void;
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
    putRitualRun(deps.store, NIGHT_PROMPT_RITUAL_ID, { date: today, ranAt: nowIso });
  } catch (err) {
    log({ level: "error", event: "night-ritual.persist-failed", detail: describeError(err) });
    return failure("conflict", `night-ritual: could not persist the close-out prompt — ${describeError(err)}`, err);
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
 * named Task has been answered, mirroring `answerDataCompletenessRequest`'s
 * own re-read-current-version-then-clear step in that file. Re-reads the
 * request's current version rather than trusting a version captured before
 * the loop ran, so a genuine concurrent write to it (AD-10) is still caught
 * as `ConflictError` rather than silently dropped — the same reasoning that
 * function's own doc comment gives.
 */
export function clearNightCloseOutRequestIfOpen(store: MemoryStore): void {
  const current = getOpenInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID);
  if (current) {
    clearInteractionRequest(store, NIGHT_CLOSE_OUT_REQUEST_ID, current.version);
  }
}
