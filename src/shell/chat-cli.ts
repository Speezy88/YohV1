/**
 * src/shell/chat-cli.ts
 *
 * The single on-demand REPL entry point (AD-5), and — per that same AD —
 * "the only place an open interaction request or open `Proposal` gets
 * resolved." Task 5 (Story 1.5) builds only enough of it to establish the
 * prompt-surfacing pattern AD-5/UX-DR20 require: on start, and before
 * accepting any unrelated input, it surfaces every currently open
 * interaction request from `memory-store.ts`, blocking indefinitely (no
 * timeout — UX-DR20) until each is answered. Task 6 (FR-5) added the Time
 * Budget declare/change command, and Task 11 (Story 1.11) adds the
 * on-demand Plan-view command below (`isPlanViewCommand`/
 * `showPlanCommand`) — reusing `rituals/morning-ritual.ts`'s `renderPlan`
 * directly rather than reimplementing its DESIGN.md-compliant layout, so
 * what this shows can never drift from what the Morning Ritual notification
 * showed. Later tasks (15, 16) still extend this file with Mid-Day Re-Flow
 * triggers and Blocker reports.
 *
 * Task 13 update: the free-text placeholder that used to sit after the Time
 * Budget/Plan-view checks is gone. `parseTimeBudgetCommand` and
 * `isPlanViewCommand` still run first, unchanged (cheap, deterministic, no
 * API call — see their own doc comments) — anything that falls through both
 * is, by construction, a genuine general/factual question, and now routes to
 * `adapters/llm-adapter.ts`'s `answerGeneralQuestion`, which calls Claude for
 * a real answer instead of a canned string. Real intent dispatch for
 * Mid-Day Re-Flow (Task 15) and Blocker reports (Task 16) is expected to add
 * its own check here, ahead of this catch-all, the same way the two checks
 * above already work — see `llm-adapter.ts`'s own module docstring for the
 * post-review reasoning on why this file doesn't pre-build that dispatch
 * shape now.
 *
 * Task 15 update (Story 2.3, FR-9): a third deterministic check,
 * `isMidDayReflowCommand`, is added to that same sequence — checked BEFORE
 * the general-qa catch-all, same shape as the two above. It recognizes
 * Spencer telling Yoh to re-fit the rest of today (e.g. a Task ran long or
 * got skipped) and calls into `rituals/mid-day-reflow.ts`'s
 * `runMidDayReflow`, which does the actual re-fitting and persistence; this
 * file only recognizes the trigger and prints the result. This is also the
 * ONLY place in the whole codebase that calls `runMidDayReflow` — Mid-Day
 * Re-Flow never runs proactively (no ritual, cron, or timer path reaches
 * it); see `mid-day-reflow.ts`'s own doc comment and
 * `tests/mid-day-reflow.test.ts`'s structural check for how that's verified.
 *
 * Task 16 update (Story 2.4, FR-10): a FOURTH deterministic check,
 * `isBlockerReportCommand`, is added right after `isMidDayReflowCommand`
 * (still before the general-qa catch-all). It recognizes Spencer reporting
 * a purely logistical Blocker in plain language ("meeting ran over",
 * "running late", "stuck in traffic", ...) — genuinely more open-ended than
 * `isMidDayReflowCommand`'s fixed trigger phrasing, so this is a
 * documented STARTING keyword/phrase heuristic (same spirit as
 * `isMidDayReflowCommand`/`parseTimeBudgetCommand`'s own "not real NLU"
 * notes, and FR-2's even-split weights elsewhere in this codebase — a
 * reasonable v1, not a claim of completeness; richer detection is a natural
 * future improvement). Every recognized phrase is deliberately multi-word
 * (post-review tightening — see `isBlockerReportCommand`'s own doc comment)
 * because a false positive here is unusually costly: a match calls
 * `runMidDayReflow` again — the SAME function Mid-Day Re-Flow uses, with
 * `blockerReported: true` — which immediately PERSISTS a real reschedule of
 * Spencer's Plan, per AD-3, with no confirmation gate. The result renders
 * completely differently from Task 15's trigger, though: UX-DR12 requires a
 * single confirmation line with no discussion or suggestions, sharply
 * terser than Task 15's "one short block" (UX-DR11).
 * `rituals/mid-day-reflow.ts`'s `buildBlockerConfirmationLine` builds that
 * one line; this file never prints `outcome.rendered` for this path.
 *
 * Task 14 update (Story 2.2, FR-18's default/contextual Tone): the catch-all
 * now classifies `line` via `core/tone.ts`'s `resolveToneSystemPrompt` and
 * passes its result as `answerGeneralQuestion`'s `systemPrompt` argument,
 * rather than relying on that function's own generic
 * `DEFAULT_GENERAL_QA_SYSTEM_PROMPT`. `tone.ts` stays pure (AD-1/AD-2) — this
 * is the one line of wiring that hands its classification to the file that
 * actually calls Claude.
 *
 * Per AD-1, this shell file contains no core/ritual logic itself: the pure
 * gate logic lives in `core/data-completeness-gate.ts`, and the thin
 * gate-output-to-memory-store wiring the Task 5 brief's Implementer note
 * calls for (`syncDataCompletenessInteractionRequest` — reading the gate's
 * `Result`, then persisting or clearing an `InteractionRequest`, which the
 * gate itself must not do since it stays pure/I-O-free per AD-2/AD-11) lives
 * in `rituals/data-completeness.ts`, which this file imports. See the
 * Task 10 note below for why it isn't in this file any more.
 *
 * Answering a Data-Completeness prompt (Task 5 fix): when Spencer answers a
 * missing field, the raw answer text is parsed into the correct type for
 * that field (`parseFieldAnswer`) — re-prompting, not silently storing
 * garbage, on unparseable input, via the same "wait indefinitely" pattern
 * already used for a blank answer — then persisted as a `TaskFieldOverride`
 * in `memory-store.ts` (`mergeTaskFieldOverride`), and only then is the
 * interaction request cleared. A raw `Task` (e.g. freshly re-read from
 * Notion, which still won't have the field — AD-12's write surface is
 * Status-only) is merged against any stored override
 * (`mergeStoredOverrides`) before being handed to the gate again, so an
 * answered field actually makes the Task eligible to produce a
 * `CompleteTask` on the next gate run, not just clears the prompt. The
 * override-merge step lives outside `data-completeness-gate.ts` per AD-2 —
 * the gate stays pure and must not read `memory-store.ts` itself.
 *
 * Task 17 update (Story 2.5, FR-11, UX-DR19): a FIFTH deterministic check,
 * `parseWhyPrioritizedCommand`, is added right after `isBlockerReportCommand`
 * (still before the general-qa catch-all). It recognizes Spencer asking "why
 * is X prioritized [today]" and answers with that Task's Slip-Bump lineage
 * (`whyPrioritizedCommand`) — its consecutive-slip count and current bump
 * level, read from `memory-store.ts`'s `getSlipHistory` and computed via
 * `core/slip-bump.ts`'s `computeSlipBumpLevel` (AD-6). This is a read-only
 * view: unlike the Mid-Day Re-Flow/Blocker triggers above, it never
 * persists anything. It deliberately does NOT add a "report a slip"
 * trigger — recording a slip is Night Ritual close-out's job (Task 19,
 * below); see `core/slip-bump.ts`'s own "Scope note" docstring section.
 *
 * Task 19 update (Story 3.1, FR-12–FR-14, AD-12): `surfaceOpenInteractionRequests`
 * gets a SIXTH typed branch, `answerNightCloseOutRequest`, for
 * `requestKind: "night-close-out"` — `rituals/night-ritual.ts`'s
 * `runNightPromptRitual` (the `night-prompt` half, triggered by
 * `ritual-cli.ts`, never this file) persists the request; this file is
 * where it is surfaced and answered. Mirrors `answerDataCompletenessRequest`'s
 * shape exactly: one follow-up question per named Task, each answer
 * immediately applied (`rituals/night-ritual.ts`'s
 * `applyNightCloseOutConfirmation` — writes `notion-adapter.ts`'s
 * `setTaskStatus`, then `recordSlip`/`clearSlip`), the request cleared only
 * once every Task is answered. This is the first real call site for
 * `core/slip-bump.ts`'s storage half (Task 17 built `recordSlip`/
 * `clearSlip` but nothing called them until now) and closes
 * `ritual-cli.ts`'s `createMorningRitualDeps` `bumpLevels` bridge from the
 * other side — see that function's own doc comment.
 *
 * Task 23 update (Story 4.2, AD-3, Propose-Don't-Impose): the generic
 * confirm/apply pathway lives here — `apply(proposal)`, per AD-3's own
 * wording, is called from NOWHERE else in the codebase. `surfaceOpenInteractionRequests`
 * gets a SEVENTH branch, matching any open request whose
 * `requestKind === "proposal"` (deliberately not a fixed id, unlike the
 * `"data-completeness"`/`"night-close-out"` branches — see `apply`'s own doc
 * comment): `answerProposalRequest` shows the Proposal's reason, waits for
 * an explicit yes/no (never silence — UX-DR16), and on "yes" calls the
 * generic `apply` with a `ProposalEntityAccessor` for that Proposal's `kind`.
 * `apply` itself stays generic over `Proposal<T>` — nothing about it is
 * hardcoded to Time Budget — but the only accessor this file currently
 * builds (`timeBudgetEntityAccessor`) is for the one real Proposal kind this
 * codebase generates, `"time-budget-change"` (`core/time-budget.ts`'s
 * `buildTimeBudgetChangeProposal`, wired up by `rituals/morning-ritual.ts`'s
 * daily deferral-streak tracking). A "learned behavioral pattern" Proposal
 * was deliberately NOT invented as a second worked example for this task —
 * no other story in this plan ever actually generates one, and Story 1.7's
 * AC4 ("no UI or interaction path exists" for manually setting a Task's
 * priority) means a plausible-sounding priority-override Proposal would
 * directly contradict an already-established invariant. `apply` staying
 * generic (rather than hardcoded to `Partial<TimeBudget>`) is what lets a
 * future Proposal kind add its own accessor without touching `apply` itself.
 *
 * Task 10 update: the merge/gate/sync trio moved to
 * `rituals/data-completeness.ts` — the `rituals/*.ts` home the note above
 * always pointed at, given its own file because it is its own capability
 * with callers in two layers (AD-9). DESIGN.md's ANSI color tokens moved to
 * `rituals/morning-ritual.ts` alongside the Plan renderer that is their
 * heaviest user. This file imports both directly (AD-1 permits
 * `shell -> rituals`, never the reverse) and re-exports neither; nothing
 * about its behavior changed with either move.
 */
import { createInterface } from "node:readline";
import { Client } from "@notionhq/client";
import {
  clearInteractionRequest,
  clearTimeBudgetDeferralStreak,
  ConflictError,
  createMemoryStore,
  getCurrentTimeBudget,
  getOpenInteractionRequest,
  getPlan,
  getSlipHistory,
  listOpenInteractionRequests,
  mergeTaskFieldOverride,
  putTimeBudget,
  type MemoryStore,
  type StoredRecord,
} from "../adapters/memory-store.ts";
import {
  answerGeneralQuestion,
  createAnthropicMessagesClient,
  draftNotionPageFields,
  loadLlmAdapterConfigFromEnv,
  suggestFieldValue,
  type AnthropicMessagesClient,
} from "../adapters/llm-adapter.ts";
import {
  createPage as notionCreatePage,
  loadTaskPropertyNamesFromEnv,
  readNotionTasks,
  resolveNotionPageDraftProperties as notionResolveNotionPageDraftProperties,
  setTaskStatus as notionSetTaskStatus,
  updateTaskField as notionUpdateTaskField,
} from "../adapters/notion-adapter.ts";
import type { MissingFieldReport } from "../core/data-completeness-gate.ts";
import { computeSlipBumpLevel } from "../core/slip-bump.ts";
import { shapeDeclaredTimeBudget } from "../core/time-budget.ts";
import { resolveToneSystemPrompt } from "../core/tone.ts";
import { DATA_COMPLETENESS_REQUEST_ID, PLANNING_FIELD_LABELS } from "../rituals/data-completeness.ts";
import { buildBlockerConfirmationLine, runMidDayReflow } from "../rituals/mid-day-reflow.ts";
import {
  ACCENT,
  localIsoDate,
  MUTED,
  paint,
  renderMarkdownForTerminal,
  renderPlan,
  shouldUseColor,
  WRAP_WIDTH,
} from "../rituals/ritual-shared.ts";
import {
  applyNightCloseOutConfirmation,
  clearNightCloseOutRequestIfOpen,
  NIGHT_CLOSE_OUT_REQUEST_ID,
  type NightCloseOutRequestDetail,
  type NightCloseOutStatus,
} from "../rituals/night-ritual.ts";
import { applySelfCheckAnswer, isValidSelfCheckScore, SELF_CHECK_REQUEST_ID } from "../rituals/self-check.ts";
import type {
  FieldValueSuggestion,
  InteractionRequest,
  IsoDate,
  NotionDatabaseTarget,
  NotionPageDraft,
  PlanningFieldNames,
  Proposal,
  Result,
  Task,
  TaskFieldOverride,
  TaskStatus,
  TimeBudget,
  YohError,
} from "../types/domain.ts";

// ============================================================================
// REPL IO abstraction — injectable so tests never need a real TTY/stdin
// ============================================================================

export interface ChatCliIo {
  /** Waits for one line of input, indefinitely (UX-DR20 — no prompt this file shows ever times out). Returns `null` on EOF/stream close, never rejects on that. */
  readonly readLine: (prompt?: string) => Promise<string | null>;
  readonly writeLine: (line: string) => void;
}

/**
 * Result of parsing one raw answer line into the type a given planning
 * field actually needs. Discriminated on `ok` like `Result<T, YohError>`,
 * but deliberately its own (simpler) shape — this is `shell/`-local
 * input-parsing, not a `core/*.ts` function, so it isn't bound by AD-8's
 * `YohError` contract.
 */
type FieldAnswerParseResult<F extends PlanningFieldNames> =
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
 * Parses a raw answer line into the correctly-typed value for `field`,
 * per each field's real type in `types/domain.ts` (Estimated Duration: a
 * positive whole number of minutes; Area: any non-blank free text, since
 * it's Spencer's own free-form Notion taxonomy; Due Date: an ISO-8601
 * calendar date `YYYY-MM-DD`; Status/Energy: one of their fixed enum
 * values, matched case- and whitespace-insensitively for typing
 * convenience). Rejects (rather than guesses at) anything that doesn't
 * parse cleanly, so `answerDataCompletenessRequest` (below) can re-prompt
 * instead of silently storing garbage — reusing the same "wait
 * indefinitely" pattern already used for a blank answer.
 */
export function parseFieldAnswer<F extends PlanningFieldNames>(field: F, raw: string): FieldAnswerParseResult<F> {
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

/** The shape `runChatCli`/`surfaceOpenInteractionRequests` thread through to `answerDataCompletenessRequest` — `notion-adapter.ts`'s `updateTaskField` (FR-24), pre-bound to its client/config, the same binding-convention `SetTaskStatusFn` (below) already establishes for `setTaskStatus`. */
type UpdateTaskFieldFn = (
  taskId: string,
  field: PlanningFieldNames,
  value: NonNullable<Task[PlanningFieldNames]>,
) => Promise<Result<void, YohError>>;

/**
 * Answers the single combined `"data-completeness"` interaction request:
 * shows its (already-built) combined prompt line, then asks one follow-up
 * question per missing field per Task named in its `detail.incomplete`
 * payload, in order. Each answer is parsed via `parseFieldAnswer` and, once
 * valid, written to Notion FIRST (FR-24's `updateTaskField`, injected) and
 * only THEN persisted locally as a `TaskFieldOverride`
 * (`mergeTaskFieldOverride`) — mirroring `applyNightCloseOutConfirmation`'s
 * own "Notion written before any local state changes" ordering, so a local
 * override can never claim a value Notion doesn't actually have. A Notion
 * write failure re-asks the SAME question (Spencer sees why, via the
 * failure message) rather than storing an override Notion never agreed to;
 * an unparseable or blank answer does the same, unrelated to Notion at all
 * (UX-DR20) — neither skips the field nor stores anything.
 *
 * Only once every missing field across every named Task has been answered
 * is the interaction request itself cleared — re-reading its current
 * version immediately before clearing, so a genuine concurrent write to it
 * (e.g. a ritual re-running the gate mid-answer and replacing its content)
 * is still caught as `ConflictError` per AD-10 rather than silently
 * dropped.
 *
 * Returns `false` (without clearing the request) if `io.readLine` reports
 * EOF partway through — whatever was answered before that point stays
 * persisted as an override either way.
 */
async function answerDataCompletenessRequest(
  store: MemoryStore,
  io: ChatCliIo,
  record: StoredRecord<InteractionRequest>,
  updateTaskField: UpdateTaskFieldFn,
  llmClient?: AnthropicMessagesClient,
  recentMessages: readonly string[] = [],
): Promise<boolean> {
  const detail = record.data.detail as { readonly incomplete?: readonly MissingFieldReport[] } | undefined;
  const incomplete = detail?.incomplete ?? [];

  io.writeLine(paint(record.data.promptText, ACCENT, shouldUseColor()));
  io.writeLine("");

  for (const report of incomplete) {
    for (const field of report.missingFields) {
      const label = PLANNING_FIELD_LABELS[field];

      if (llmClient) {
        let suggestion: FieldValueSuggestion | undefined;
        try {
          suggestion = await suggestFieldValue(llmClient, report.taskId, report.taskTitle, field, recentMessages);
        } catch {
          suggestion = undefined; // A Claude/API failure must never block the fallback blind ask.
        }

        if (suggestion) {
          io.writeLine(`  ${report.taskTitle} — ${label}: I think it's "${suggestion.value}" — ${suggestion.reason}`);
          let confirmAnswer: string | null = null;
          do {
            confirmAnswer = await io.readLine("  Sound right? (yes/no): ");
            if (confirmAnswer === null) return false; // stdin closed mid-answer.
          } while (confirmAnswer.trim().length === 0); // UX-DR20: silence is never an answer.

          if (parseProposalAnswer(confirmAnswer) === true) {
            const written = await updateTaskField(report.taskId, field, suggestion.value);
            if (written.ok) {
              mergeTaskFieldOverride(store, report.taskId, { [field]: suggestion.value } as TaskFieldOverride);
              continue; // done with this field — skip the blind ask below.
            }
            io.writeLine(`I couldn't record that in Notion: ${written.error.message} — let's try a value directly.`);
          }
          // Anything other than a confirmed "yes" (an explicit "no," an
          // unrecognized reply, or a Notion write failure on "yes") falls
          // through to FR-4's plain blind ask below — FR-25 never blocks or
          // replaces the baseline gate behavior.
        }
      }

      for (;;) {
        const answer = await io.readLine(`  ${report.taskTitle} — ${label}: `);
        if (answer === null) return false; // stdin closed mid-answer.
        if (answer.trim().length === 0) continue; // wait indefinitely (UX-DR20): re-ask, don't skip.

        const parsed = parseFieldAnswer(field, answer);
        if (!parsed.ok) {
          io.writeLine(parsed.message);
          continue; // re-ask the SAME question — an unparseable answer is not an answer.
        }

        const written = await updateTaskField(report.taskId, field, parsed.value as NonNullable<Task[PlanningFieldNames]>);
        if (!written.ok) {
          io.writeLine(
            `I couldn't record that in Notion: ${written.error.message} — try again with a value closer to what's already in Notion.`,
          );
          continue; // re-ask — the Notion write must actually succeed before an override is stored.
        }

        mergeTaskFieldOverride(store, report.taskId, { [field]: parsed.value } as TaskFieldOverride);
        break;
      }
    }
  }

  // Re-read the current version right before clearing (see doc comment
  // above) rather than reusing `record.version`, which may be stale by now.
  const current = getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID);
  if (current) {
    clearInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID, current.version);
  }
  io.writeLine("Got it — thanks. I'll factor that in next time I plan.");
  return true;
}

// ============================================================================
// Night Ritual close-out prompt (Task 19 / Story 3.1, FR-12–FR-14)
// ============================================================================

/** The shape `runChatCli`/`surfaceOpenInteractionRequests` thread through to `rituals/night-ritual.ts`'s `applyNightCloseOutConfirmation` — `notion-adapter.ts`'s `setTaskStatus`, pre-bound to its client/config (see that function's own doc comment for the binding-convention note). */
type SetTaskStatusFn = (taskId: string, status: TaskStatus) => Promise<Result<void, YohError>>;

/**
 * Parses a raw close-out answer into `"completed"` or `"slipped"` — the same
 * deliberately-simple, clearly-documented pattern-matching convention every
 * other `chat-cli.ts` command parser uses (NOT real free-text NLU). Accepts
 * a few natural synonyms case-insensitively; anything else is rejected so
 * `answerNightCloseOutRequest` can re-prompt rather than guess. Does NOT
 * recognize `"skip"` — that is its own, separately-checked escape hatch
 * (`isSkipAnswer`, below), not a third `NightCloseOutStatus` value: skipping
 * a Task explicitly means "no status is being reported," which has no
 * `TaskStatus` to return.
 */
export function parseNightCloseOutAnswer(raw: string): NightCloseOutStatus | undefined {
  const normalized = raw.trim().toLowerCase();
  if (/^(completed?|done|finished)$/.test(normalized)) return "completed";
  if (/^(slipped?|missed|didn'?t (do it|finish)|not done)$/.test(normalized)) return "slipped";
  return undefined;
}

/**
 * Recognizes Spencer's explicit "skip" escape hatch for ONE Task within a
 * close-out answer loop (Task 19 review fix) — see
 * `answerNightCloseOutRequest`'s own doc comment for why this exists and
 * what it does.
 */
function isSkipAnswer(raw: string): boolean {
  return /^skip$/i.test(raw.trim());
}

/**
 * Answers the single combined `"night-close-out"` interaction request: shows
 * its (already-built) combined prompt line, then asks one follow-up question
 * per named Task, in the order the request lists them. Mirrors
 * `answerDataCompletenessRequest`'s own shape exactly (Task 5's established
 * precedent for "one prompt covering multiple items, answered and persisted
 * one at a time, cleared only once every part is answered" — see this
 * file's module docstring for why the Data-Completeness prompt is the
 * closest precedent to follow rather than inventing a new shape).
 *
 * Each answer is parsed (`parseNightCloseOutAnswer`) and, once recognized,
 * immediately applied via `rituals/night-ritual.ts`'s
 * `applyNightCloseOutConfirmation` — which writes Notion FIRST and only then
 * updates local Slip-Bump state (see that function's own doc comment for
 * the ordering rationale). A blank answer re-prompts indefinitely
 * (UX-DR20), same as every other answer loop in this file.
 *
 * **The "skip" escape hatch (Task 19 review fix).** A Notion write failure
 * re-prompts the SAME question rather than silently moving on — correct for
 * a TRANSIENT failure (a network blip, a rate limit), where trying again
 * shortly after is the right move. It is wrong for a PERMANENT one (e.g. a
 * Task archived/deleted in Notion between Plan generation and close-out,
 * returning a hard 404 on every retry): without an escape, every answer
 * re-prompts forever, and since the request stays open on EOF, the very
 * NEXT chat session re-surfaces the same unanswerable prompt before
 * accepting anything else — a permanently unusable assistant. Typing
 * `"skip"` (recognized at ANY point in a Task's question, not only after a
 * failure — simpler to implement/document than gating it behind "has this
 * Task failed once already," and a legitimate "I don't want to answer this
 * one right now" is reasonable even absent a failure) leaves that ONE
 * Task's status unresolved for tonight: neither `setTaskStatus` nor
 * `recordSlip`/`clearSlip` is called for it, since Spencer explicitly did
 * not confirm what actually happened — recording a guess would be worse
 * than recording nothing. The loop still moves on to the next Task, and
 * the whole request still clears once every Task has been either answered
 * OR skipped (see below) — a skip is this task's chosen way to unblock the
 * rest of the close-out and the chat session itself, at the documented cost
 * that a skipped Task gets no Slip-Bump/Notion update for tonight (it is
 * not automatically re-asked; Spencer can address it another way, e.g.
 * directly in Notion, or it may be named again by a future night's prompt
 * if it's still on a later Plan).
 *
 * Only once every named Task has been either answered or explicitly skipped
 * is the interaction request itself cleared
 * (`clearNightCloseOutRequestIfOpen`) — re-reading its current version
 * immediately before clearing, same as `answerDataCompletenessRequest`, so
 * a genuine concurrent write to it is still caught as `ConflictError` per
 * AD-10 rather than silently dropped.
 *
 * Returns `false` (without clearing the request) if `io.readLine` reports
 * EOF partway through — whatever was answered or skipped before that point
 * stays applied either way (Notion already reflects an answered Task, and
 * so does any SlipHistory change; a skipped Task simply stays unresolved).
 */
async function answerNightCloseOutRequest(
  store: MemoryStore,
  io: ChatCliIo,
  record: StoredRecord<InteractionRequest>,
  setTaskStatus: SetTaskStatusFn,
  fallbackDate: IsoDate,
): Promise<boolean> {
  const detail = record.data.detail as NightCloseOutRequestDetail | undefined;
  const tasks = detail?.tasks ?? [];
  // The date these confirmations are ABOUT is the Plan's own date
  // (`detail.date`, stamped by `runNightPromptRitual` when it built this
  // request) — NOT necessarily the date Spencer happens to be answering on.
  // Spencer may open chat the next morning to answer last night's prompt;
  // `recordSlip`/`clearSlip` must record the slip against the day the Task
  // was actually scheduled, not the day it was confirmed. `fallbackDate`
  // (the caller's current local date) is used only if `detail.date` is
  // somehow absent (a malformed/legacy record).
  const closeOutDate = detail?.date ?? fallbackDate;

  io.writeLine(paint(record.data.promptText, ACCENT, shouldUseColor()));
  io.writeLine("");

  const skippedTitles: string[] = [];

  for (const t of tasks) {
    for (;;) {
      const answer = await io.readLine(`  ${t.taskTitle} — completed, slipped, or skip? `);
      if (answer === null) return false; // stdin closed mid-answer.
      if (answer.trim().length === 0) continue; // wait indefinitely (UX-DR20): re-ask, don't skip.

      if (isSkipAnswer(answer)) {
        skippedTitles.push(t.taskTitle);
        io.writeLine(`Skipping "${t.taskTitle}" for now — nothing was recorded for it tonight.`);
        break; // move on to the next Task without applying anything for this one.
      }

      const parsed = parseNightCloseOutAnswer(answer);
      if (!parsed) {
        io.writeLine(`I didn't understand "${answer}" — try "completed", "slipped", or "skip" to leave it for now.`);
        continue; // re-ask the SAME question — an unparseable answer is not an answer.
      }

      const applied = await applyNightCloseOutConfirmation({ store, setTaskStatus }, t.taskId, parsed, closeOutDate);
      if (!applied.ok) {
        io.writeLine(
          `I couldn't record that in Notion: ${applied.error.message} — try again, or type "skip" to leave it for now and move on.`,
        );
        continue; // re-ask — the Notion write must actually succeed before moving on, unless Spencer chooses to skip.
      }
      break;
    }
  }

  // Task 21 (third post-review fix): only resolve a matching UncheckedDay
  // record when EVERY named Task was genuinely answered — a skip means
  // Spencer still hasn't confirmed what happened to at least one Task, so
  // the flag (if this night was ever escalated/recorded) must survive to
  // surface on a future Morning Plan rather than silently vanishing. See
  // clearNightCloseOutRequestIfOpen's own doc comment for the full story.
  clearNightCloseOutRequestIfOpen(store, { resolveUncheckedDay: skippedTitles.length === 0 });
  io.writeLine(
    skippedTitles.length === 0
      ? "Got it — thanks. I've updated Notion and factored this into tomorrow's plan."
      : `Got it — thanks. I've updated Notion for the rest; skipped for now: ${skippedTitles.join(", ")}.`,
  );
  return true;
}

// ============================================================================
// Periodic Self-Check prompt (Task 24 / Story 4.3, FR-17, UX-DR15)
// ============================================================================

/**
 * Parses a raw Self-Check answer line into a score/reason pair. Per UX-DR15
 * both are required together — this is enforced structurally by the regex
 * itself, not by a separate "is the reason present" check afterward: a bare
 * number alone (or a number followed only by whitespace) simply fails to
 * MATCH, so it is indistinguishable from any other unparseable answer to
 * `answerSelfCheckRequest`'s loop below, which re-prompts exactly the same
 * way it would for a blank/nonsense line — no special-cased "you gave a
 * number but no reason" branch needed. The same deliberately-simple,
 * clearly-documented pattern-matching convention every other `chat-cli.ts`
 * answer parser uses (NOT real free-text NLU): a leading 1-2 digit whole
 * number, at least one space, then the rest of the line as the reason
 * (trimmed, must be non-blank). `isValidSelfCheckScore` (`rituals/
 * self-check.ts`) is the single source of truth for the valid range (1-10) —
 * duplicated nowhere here.
 */
const SELF_CHECK_ANSWER_RE = /^\s*(\d{1,2})\s+(.+?)\s*$/;

export interface SelfCheckAnswer {
  readonly score: number;
  readonly reason: string;
}

export function parseSelfCheckAnswer(raw: string): SelfCheckAnswer | undefined {
  const match = SELF_CHECK_ANSWER_RE.exec(raw);
  if (!match) return undefined;
  const score = Number(match[1]);
  const reason = match[2]!.trim();
  if (!isValidSelfCheckScore(score) || reason.length === 0) return undefined;
  return { score, reason };
}

/**
 * Answers the open `"self-check"` interaction request: shows the prompt,
 * then waits for ONE line carrying both a numeric score and a short written
 * reason (UX-DR15). A blank line re-prompts indefinitely (UX-DR20, the same
 * "wait indefinitely" pattern every other answer loop in this file uses); an
 * unparseable answer — including a bare number with no reason — ALSO
 * re-prompts the SAME question rather than guessing or accepting a partial
 * answer, per `parseSelfCheckAnswer`'s own doc comment.
 *
 * On a valid answer: persists it and the freshly-computed next-due schedule
 * via `rituals/self-check.ts`'s `applySelfCheckAnswer` — which is what
 * actually calls the shared `computeEscalation` curve (AD-6) via that file's
 * own `scheduleNextSelfCheck`; nothing here re-derives that arithmetic —
 * then clears the request, re-reading its current version immediately
 * before clearing (same as `answerDataCompletenessRequest`/
 * `answerNightCloseOutRequest`), so a genuine concurrent write to it is
 * still caught as `ConflictError` per AD-10 rather than silently dropped. A
 * failure to persist (a rare `ConflictError`) re-prompts the same question
 * rather than silently dropping the answer.
 *
 * `today` is the local calendar date this check-in is recorded against —
 * `runChatCli` passes its own current local date (the same value already
 * threaded through as `fallbackDate` for the night-close-out branch).
 * `random` defaults to `Math.random` in production and is only ever
 * overridden by a test.
 *
 * Returns `false` (without clearing the request) if `io.readLine` reports
 * EOF partway through — the request stays open, unanswered, for the next
 * session (UX-DR20).
 */
async function answerSelfCheckRequest(
  store: MemoryStore,
  io: ChatCliIo,
  record: StoredRecord<InteractionRequest>,
  today: IsoDate,
  random: () => number,
): Promise<boolean> {
  io.writeLine(paint(record.data.promptText, ACCENT, shouldUseColor()));
  io.writeLine("");

  for (;;) {
    const answer = await io.readLine("  Score + reason: ");
    if (answer === null) return false; // stdin closed mid-answer.
    if (answer.trim().length === 0) continue; // wait indefinitely (UX-DR20): re-ask, don't clear.

    const parsed = parseSelfCheckAnswer(answer);
    if (!parsed) {
      io.writeLine('I need both a number (1-10) and a short reason — e.g. "7 feeling on top of things".');
      continue; // re-ask — UX-DR15: a bare number alone is not a complete answer.
    }

    const applied = applySelfCheckAnswer(store, { today, score: parsed.score, reason: parsed.reason, random });
    if (!applied.ok) {
      io.writeLine(`I couldn't record that: ${applied.error.message} — try again.`);
      continue;
    }

    const current = getOpenInteractionRequest(store, SELF_CHECK_REQUEST_ID);
    if (current) clearInteractionRequest(store, SELF_CHECK_REQUEST_ID, current.version);
    io.writeLine("Thanks — got it. I'll check in again before too long.");
    return true;
  }
}

// ============================================================================
// Propose-Don't-Impose confirm/apply pathway (Task 23 / Story 4.2, AD-3)
// ============================================================================

/**
 * The minimal seam `apply` needs to re-read a Proposal's live entity and,
 * once Spencer has confirmed, write the suggested change — injected per
 * Proposal `kind` (this task's own worked example, `timeBudgetEntityAccessor`
 * below) rather than baked into `apply` itself. This is what keeps `apply`
 * itself generic over `Proposal<T>`, per this task's own scoping note (see
 * this file's module docstring's Task 23 paragraph): a future Proposal kind
 * supplies its own accessor without any change to `apply`.
 */
export interface ProposalEntityAccessor<T> {
  /** The live entity's CURRENT version, formatted the same way `Proposal.entityVersion` already is (a `string`) — `undefined` if the entity no longer exists at all. Always re-reads; never returns a cached/stale value. */
  readonly currentVersion: () => string | undefined;
  /** Applies `suggested` against the live entity. `apply` calls this ONLY after confirming `currentVersion()` still matches `proposal.entityVersion` — never speculatively. */
  readonly applyChange: (suggested: T) => void;
}

/**
 * The generic Propose-Don't-Impose confirm/apply pathway AD-3 requires:
 * `chat-cli.ts` is the sole caller anywhere in the codebase (AD-3's own
 * wording — see this file's module docstring).
 *
 * - `answer: false` ("no"): applies nothing — returns
 *   `{ok: true, value: "declined"}`. `accessor` is never even consulted.
 * - `answer: true` ("yes"): re-reads the live entity's CURRENT version via
 *   `accessor.currentVersion()` and compares it against
 *   `proposal.entityVersion` — the snapshot captured when the Proposal was
 *   generated. A mismatch (including the entity having since been deleted
 *   entirely, which reads as `undefined`) rejects with
 *   `YohError.kind: "stale-proposal"` WITHOUT ever calling
 *   `accessor.applyChange` — a stale Proposal is never applied against
 *   state that has moved on. Only on a genuine match does it call
 *   `accessor.applyChange(proposal.suggested)` and report `"applied"`.
 *
 * Deliberately does NOT touch the `InteractionRequest` the Proposal was
 * surfaced as — clearing (or re-surfacing) that request is the caller's job
 * (`answerProposalRequest`, below), mirroring
 * `answerDataCompletenessRequest`/`answerNightCloseOutRequest`'s own "apply
 * the answer, then separately clear the request" shape elsewhere in this
 * file. This keeps `apply` reusable for a future proposal kind whose
 * request-clearing story might differ.
 *
 * **`accessor.applyChange` is never allowed to escape as an unhandled
 * throw (review fix, Important #2).** It ultimately calls a real
 * `memory-store.ts` write (e.g. `putTimeBudget`), which can throw a real
 * `ConflictError` under AD-10 — a genuine concurrent write racing
 * `ritual-cli.ts`, the exact scenario `rituals/morning-ritual.ts`'s OWN
 * side of this same race already wraps in try/catch. This function's own
 * `Result<..., YohError>` signature promises no throw either, so the call
 * is wrapped: a `ConflictError` is reported via its own already-`YohError`-shaped
 * `.yohError` (`kind: "conflict"`) verbatim; any other thrown value is
 * wrapped as `kind: "unreachable"` — the same kind
 * `rituals/morning-ritual.ts` already uses for "some adapter-level I/O
 * failed" (its `readTasks`/`readCalendarEvents`/`sendNotification` catch
 * sites), which this is structurally the shell-layer equivalent of.
 */
export async function apply<T>(
  proposal: Proposal<T>,
  answer: boolean,
  accessor: ProposalEntityAccessor<T>,
): Promise<Result<"applied" | "declined", YohError>> {
  if (!answer) {
    return { ok: true, value: "declined" };
  }

  const liveVersion = accessor.currentVersion();
  if (liveVersion !== proposal.entityVersion) {
    return {
      ok: false,
      error: {
        kind: "stale-proposal",
        message: `chat-cli: proposal "${proposal.id}" is stale — the live entity's version (${
          liveVersion ?? "none, it no longer exists"
        }) no longer matches the version this proposal was generated against (${proposal.entityVersion})`,
        detail: {
          proposalId: proposal.id,
          entityId: proposal.entityId,
          expectedVersion: proposal.entityVersion,
          actualVersion: liveVersion,
        },
      },
    };
  }

  try {
    accessor.applyChange(proposal.suggested);
  } catch (err) {
    if (err instanceof ConflictError) {
      return { ok: false, error: err.yohError };
    }
    return {
      ok: false,
      error: {
        kind: "unreachable",
        message: `chat-cli: applying proposal "${proposal.id}" failed — ${err instanceof Error ? err.message : String(err)}`,
        detail: err,
      },
    };
  }

  return { ok: true, value: "applied" };
}

/**
 * `apply`'s accessor for the one real Proposal kind this codebase currently
 * generates (`"time-budget-change"`, `core/time-budget.ts`'s
 * `buildTimeBudgetChangeProposal`, wired up by `rituals/morning-ritual.ts`).
 * Re-reads the live singleton Time Budget row fresh on every call (never
 * caches it), and applies a suggested change by merging `suggested` (a
 * `Partial<TimeBudget>`) onto the live row's own data before persisting via
 * `putTimeBudget` — the same "put" primitive `declareTimeBudget` already
 * uses for Spencer's own explicit declarations, so an applied Proposal reads
 * back identically to Spencer having typed the change himself.
 */
function timeBudgetEntityAccessor(store: MemoryStore): ProposalEntityAccessor<Partial<TimeBudget>> {
  return {
    currentVersion: () => {
      const current = getCurrentTimeBudget(store);
      return current ? String(current.version) : undefined;
    },
    applyChange: (suggested) => {
      const current = getCurrentTimeBudget(store);
      if (!current) {
        throw new Error("chat-cli: cannot apply a Time Budget proposal — no current Time Budget exists to change");
      }
      putTimeBudget(store, { ...current.data, ...suggested });
    },
  };
}

/**
 * Recognizes a yes/no answer to an open Proposal, tolerant of a few natural
 * variants — the same deliberately-simple, clearly-documented pattern
 * matching `parseNightCloseOutAnswer` uses above (NOT real free-text NLU).
 * Returns `undefined` for anything else, so `answerProposalRequest` re-asks
 * rather than guessing — UX-DR16: silence (and anything that isn't a clearly
 * recognized yes/no) is never treated as consent.
 */
export function parseProposalAnswer(raw: string): boolean | undefined {
  const normalized = raw.trim().toLowerCase();
  if (/^(y|yes|yeah|yep|confirm|apply)$/.test(normalized)) return true;
  if (/^(n|no|nope|dismiss|decline)$/.test(normalized)) return false;
  return undefined;
}

/**
 * Answers a single open `requestKind: "proposal"` interaction request
 * (AD-3): shows its `promptText` (already built by whatever wiring created
 * it — e.g. `rituals/morning-ritual.ts`'s `buildTimeBudgetProposalPromptText`
 * for a Time-Budget-change Proposal), then waits for an explicit yes/no
 * answer. A blank line re-prompts indefinitely (UX-DR20); an unrecognized
 * answer re-prompts too (UX-DR16 — silence AND an unclear answer are both
 * never treated as consent) — only a genuinely recognized "yes" or "no"
 * ever resolves this loop.
 *
 * On "yes": calls `apply` with the accessor for this Proposal's `kind`.
 *  - `"applied"`: clears the request and confirms the change plainly.
 *  - `stale-proposal` (or any other `apply` failure, e.g. a genuine
 *    `ConflictError`): ALSO clears the request (this task's own documented
 *    choice for "no change is applied, and the interaction request is
 *    cleared or re-surfaced with fresh data as appropriate" — re-surfacing
 *    a Proposal whose entityVersion snapshot can now never match again
 *    would loop forever rather than genuinely re-check anything; clearing
 *    it and telling Spencer plainly is the honest outcome here, and a fresh
 *    Proposal can be generated another day if the underlying deferral
 *    pattern is still happening) — Spencer is told plainly that the entity
 *    changed since the suggestion was made, rather than the information
 *    being silently discarded.
 *
 * On "no": clears the request without applying anything.
 *
 * **The deferral streak is reset once Spencer has genuinely ANSWERED —
 * applied OR declined (review fix, Important #1).** Without this, "no" is
 * never remembered: the streak (`memory-store.ts`'s
 * `TimeBudgetDeferralStreak`) keeps growing on the very next deferral day
 * regardless of the answer, so a fresh Proposal with the same substance
 * reappears every subsequent day the pattern continues — exactly the
 * "confirmation turns into daily nagging" UX-DR16 exists to prevent. And on
 * "yes" it's worse: the budget is raised but the streak still stands, so a
 * day-4 deferral would propose ANOTHER increase stacked on top of the one
 * Spencer just accepted. `clearTimeBudgetDeferralStreak` — the same
 * "cleared entirely, not floored/decremented" shape
 * `core/time-budget.ts`'s own `nextTimeBudgetDeferralStreak` already uses
 * for a zero-deferral day — is called only when `apply` actually resolved
 * (`result.ok`, covering both `"applied"` and `"declined"`), NOT on a
 * `stale-proposal`/`ConflictError` rejection: Spencer never got to
 * genuinely decide in that case, so the streak (and whatever real pattern
 * it reflects) is left exactly as-is for the next run to re-evaluate.
 *
 * Currently the only Proposal `kind` this codebase generates is
 * `"time-budget-change"` — see this file's module docstring for why a
 * second worked example (e.g. a learned-behavioral-pattern Proposal) was
 * deliberately not invented for this task. An unrecognized `kind` (a
 * malformed record, or a future kind this file doesn't yet know how to
 * apply) is dismissed with a plain apology rather than looping forever or
 * crashing the session.
 *
 * Returns `false` (without clearing the request) if `io.readLine` reports
 * EOF partway through — the request stays open, unanswered, for the next
 * session (UX-DR20).
 */
async function answerProposalRequest(
  store: MemoryStore,
  io: ChatCliIo,
  record: StoredRecord<InteractionRequest>,
): Promise<boolean> {
  io.writeLine(paint(record.data.promptText, ACCENT, shouldUseColor()));
  io.writeLine("");

  const clearThisRequest = (): void => {
    const current = getOpenInteractionRequest(store, record.id);
    if (current) clearInteractionRequest(store, record.id, current.version);
  };

  const detail = record.data.detail as { readonly proposal?: Proposal<unknown> } | undefined;
  const proposal = detail?.proposal;

  if (!proposal || proposal.kind !== "time-budget-change") {
    io.writeLine("I don't recognize this proposal any more — dismissing it.");
    clearThisRequest();
    return true;
  }

  for (;;) {
    const answer = await io.readLine("  Apply this? (yes/no): ");
    if (answer === null) return false; // stdin closed mid-answer — leave the request open, unanswered.
    if (answer.trim().length === 0) continue; // UX-DR16: silence is never consent — keep waiting.

    const parsed = parseProposalAnswer(answer);
    if (parsed === undefined) {
      io.writeLine('Please answer "yes" or "no".');
      continue;
    }

    const result = await apply(proposal as Proposal<Partial<TimeBudget>>, parsed, timeBudgetEntityAccessor(store));

    if (result.ok) {
      // Review fix, Important #1: reset the streak now that Spencer has
      // genuinely answered — see this function's own doc comment above.
      clearTimeBudgetDeferralStreak(store);
      clearThisRequest();
      io.writeLine(result.value === "applied" ? "Done — I've updated your Time Budget." : "Okay — I won't make that change.");
    } else {
      clearThisRequest();
      io.writeLine(`I can't apply that any more — ${result.error.message}`);
    }
    return true;
  }
}

/**
 * Surfaces every currently open interaction request, one at a time, each
 * blocking for Spencer's answer before moving to the next — AD-5's "an open
 * confirmation blocks the chat flow rather than queuing silently alongside
 * something else." There is no timeout anywhere in this loop (UX-DR20):
 * every `io.readLine` call is awaited indefinitely, and a blank or
 * unparseable answer re-prompts rather than clearing the request or giving
 * up.
 *
 * The `"data-completeness"` request gets its full typed answer treatment
 * (`answerDataCompletenessRequest`, above: parse each missing field's
 * answer, persist it as a `TaskFieldOverride`, only then clear). The
 * `"night-close-out"` request (Task 19) gets its own typed treatment the
 * same way (`answerNightCloseOutRequest`, above: parse each Task's
 * completed/slipped answer, write Notion and Slip-Bump state, only then
 * clear). The `"self-check"` request (Task 24) gets its own typed treatment
 * too (`answerSelfCheckRequest`, above: parse a combined score+reason
 * answer, persist it and the next-due schedule, only then clear). Any OTHER
 * open request (a future Proposal prompt) falls back to the purely
 * mechanical surface-then-clear-on-any-non-empty-answer behavior this file
 * established before the Task 5 fix — a later task is expected to add its
 * own typed answer-application step the same way this file now does for
 * each of the above.
 *
 * `setTaskStatus`/`fallbackDate` are needed ONLY by the `"night-close-out"`
 * branch; both default to values that are safe for every OTHER caller
 * (including every pre-Task-19 test call site above, which never exercises
 * that branch) — `setTaskStatus` defaults to a stub that throws only if
 * actually invoked (mirrors `runChatCli`'s own `readTasks` default), and
 * `fallbackDate` defaults to `"UTC"`'s local date. `fallbackDate` is
 * deliberately NOT the date used to record a close-out confirmation's
 * Slip-Bump — `answerNightCloseOutRequest` prefers the Plan's own date
 * (`InteractionRequest.detail.date`, stamped when `runNightPromptRitual`
 * built the request), since Spencer may not answer until the next morning;
 * this parameter is only the last-resort fallback for a malformed/legacy
 * record with no `detail.date` at all, so it is provably never read in the
 * ordinary case. `runChatCli` itself always supplies its own real
 * `timeZone`-derived date — see that function's own doc comment on why
 * `timeZone` is never silently defaulted to UTC there. `fallbackDate` is
 * ALSO what `answerSelfCheckRequest` uses as its own `today` — unlike
 * night-close-out, a Self-Check answer has no earlier "Plan date" to prefer,
 * so the date Spencer is actually answering on is the right one to schedule
 * the next interval from.
 *
 * `random` (Task 24) is `rituals/self-check.ts`'s injectable `[0, 1)` RNG,
 * threaded through to `answerSelfCheckRequest` — defaults to `Math.random`
 * in production, overridden only by a test.
 *
 * Returns once no interaction request remains open, or once `io.readLine`
 * reports EOF (stdin closed) — whichever comes first.
 */
export async function surfaceOpenInteractionRequests(
  store: MemoryStore,
  io: ChatCliIo,
  setTaskStatus: SetTaskStatusFn = async () => {
    throw new Error("chat-cli: no setTaskStatus dependency configured — cannot record Night Ritual close-out");
  },
  fallbackDate: IsoDate = localIsoDate(new Date(), "UTC"),
  random: () => number = Math.random,
  updateTaskField: UpdateTaskFieldFn = async () => {
    throw new Error("chat-cli: no updateTaskField dependency configured — cannot record a Data-Completeness answer in Notion");
  },
  llmClient?: AnthropicMessagesClient,
  recentMessages: readonly string[] = [],
): Promise<void> {
  for (;;) {
    const open = listOpenInteractionRequests(store);
    if (open.length === 0) return;
    const next = open[0]!;

    if (next.id === DATA_COMPLETENESS_REQUEST_ID && next.data.requestKind === "data-completeness") {
      const resolved = await answerDataCompletenessRequest(store, io, next, updateTaskField, llmClient, recentMessages);
      if (!resolved) return; // EOF mid-answer.
      continue;
    }

    if (next.id === NIGHT_CLOSE_OUT_REQUEST_ID && next.data.requestKind === "night-close-out") {
      const resolved = await answerNightCloseOutRequest(store, io, next, setTaskStatus, fallbackDate);
      if (!resolved) return; // EOF mid-answer.
      continue;
    }

    if (next.id === SELF_CHECK_REQUEST_ID && next.data.requestKind === "self-check") {
      const resolved = await answerSelfCheckRequest(store, io, next, fallbackDate, random);
      if (!resolved) return; // EOF mid-answer.
      continue;
    }

    if (next.data.requestKind === "proposal") {
      // Checked by `requestKind` alone, deliberately not by a fixed id —
      // see `apply`'s own doc comment on staying generic over `Proposal<T>`
      // for a future Proposal kind with its own request id.
      const resolved = await answerProposalRequest(store, io, next);
      if (!resolved) return; // EOF mid-answer.
      continue;
    }

    io.writeLine(paint(next.data.promptText, ACCENT, shouldUseColor()));
    io.writeLine("");
    const answer = await io.readLine("> ");
    if (answer === null) return; // stdin closed — nothing more can be surfaced or answered.
    if (answer.trim().length === 0) continue; // wait indefinitely (UX-DR20): re-prompt, don't clear on a blank line.

    clearInteractionRequest(store, next.id, next.version);
    io.writeLine("Got it — thanks.");
  }
}

// ============================================================================
// Time Budget declare/change command (Task 6 / Story 1.6, FR-5)
// ============================================================================

/**
 * Recognizes a Time Budget declare/change command typed at the `yoh>`
 * prompt. This is deliberately simple, clearly-documented pattern matching —
 * NOT real free-text NLU. Task 13 review note: this function stays exactly
 * as it is — `runChatCli` still checks it first, unchanged, before ever
 * consulting `llm-adapter.ts`'s real LLM-based routing, so declaring
 * "6 hours" persists a 360-minute budget for today exactly as it always has,
 * with no API call spent recognizing it.
 *
 * Recognized phrasing (case-insensitive, extra whitespace tolerated):
 *   - "time budget <N>[h|hr|hrs|hour|hours]"
 *   - "time budget <N>[m|min|mins|minute|minutes]"
 *   - either optionally prefixed with "set " or "change ", and with "to "
 *     before the number — e.g. "set time budget to 6 hours",
 *     "change time budget to 90 minutes"
 *
 * If `<N>` has no unit at all (e.g. "time budget 5"), it's read as HOURS —
 * documented default, since Spencer declaring a Time Budget in bare minutes
 * ("time budget 5" meaning 5 minutes) would be an implausibly short day,
 * while "5" meaning 5 hours is the natural reading.
 *
 * Returns `undefined` (not an error) for any line that doesn't match this
 * shape at all, so `runChatCli` can fall through to the free-text
 * placeholder rather than misreporting an unrelated line as an invalid Time
 * Budget command.
 */
const TIME_BUDGET_COMMAND_RE =
  /^(?:set\s+|change\s+)?time\s*budget(?:\s+to)?\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)?\s*$/i;

export function parseTimeBudgetCommand(line: string): { readonly totalMinutes: number } | undefined {
  const match = TIME_BUDGET_COMMAND_RE.exec(line.trim());
  if (!match) return undefined;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;

  const unit = (match[2] ?? "hours").toLowerCase();
  const totalMinutes = unit.startsWith("m") ? amount : amount * 60;
  if (!Number.isInteger(totalMinutes)) return undefined; // e.g. "0.5m" doesn't land on a whole minute.

  return { totalMinutes };
}

/**
 * Today's calendar date, ISO-8601 (`YYYY-MM-DD`) — Spencer's own LOCAL
 * calendar day in `timeZone`, never the UTC one (Task 11 review fix: this
 * previously used `new Date().toISOString().slice(0, 10)`, the UTC date,
 * which could name the wrong day for any Spencer session that falls between
 * his local midnight and UTC midnight — e.g. it silently reported "no Plan
 * yet" for a Plan that was in fact stored under today's LOCAL date, and
 * could just as easily have shown a stale prior-day Plan as if it were
 * today's). Delegates to `rituals/morning-ritual.ts`'s `localIsoDate`, the
 * exact same local-day computation `runMorningRitual` uses to key the Plan
 * this function looks up (`memory-store.ts`'s `PLAN_KIND` rows are keyed by
 * that same local date) — see that function's own doc comment for why "today"
 * must be the local day. `now` is injectable purely so tests can pin a
 * specific instant instead of the real system clock.
 */
function currentIsoDate(timeZone: string, now: () => Date = () => new Date()): IsoDate {
  return localIsoDate(now(), timeZone);
}

/**
 * The thin wiring function AD-1/AD-2 call for: runs the pure validate/shape
 * step (`core/time-budget.ts`'s `shapeDeclaredTimeBudget`) and, only on
 * success, persists the result as today's Time Budget in `memory-store.ts`
 * (`putTimeBudget`) — the actual I/O `time-budget.ts` itself is forbidden
 * from doing (AD-2). `today` is threaded in explicitly by the caller rather
 * than read internally here, purely so this function stays trivially
 * testable with a fixed date instead of the real system clock.
 */
export function declareTimeBudget(
  store: MemoryStore,
  totalMinutes: number,
  today: IsoDate,
): Result<StoredRecord<TimeBudget>, YohError> {
  const shaped = shapeDeclaredTimeBudget({ totalMinutes, date: today });
  if (!shaped.ok) return shaped;
  return { ok: true, value: putTimeBudget(store, shaped.value) };
}

/** Formats a minute count for the confirmation line, e.g. `360` -> `"360 minutes (6h)"`. */
function formatMinutesForDisplay(totalMinutes: number): string {
  const hours = totalMinutes / 60;
  const hoursLabel = Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}h`;
  return `${totalMinutes} minutes (${hoursLabel})`;
}

// ============================================================================
// On-demand Plan view command (Task 11 / Story 1.11)
// ============================================================================

/**
 * Recognizes an on-demand Plan-view request typed at the `yoh>` prompt — the
 * same kind of deliberately simple, clearly-documented pattern matching
 * `parseTimeBudgetCommand` uses above, NOT real free-text NLU. Task 13
 * review note: this function stays exactly as it is, same as
 * `parseTimeBudgetCommand` above — see that function's own updated doc
 * comment.
 *
 * Recognized phrasing (case-insensitive, extra whitespace tolerated), per
 * the Task 11 brief's own examples:
 *   - a bare "plan"
 *   - "what's my plan" / "what is my plan" / "...today's plan"
 *   - "show plan" / "show my plan" / "show me my plan" / "show me today's
 *     plan"
 *
 * Returns `false` (not an error) for any line that doesn't match this shape
 * at all, so `runChatCli` can fall through to the Time Budget command check
 * and then the free-text placeholder, exactly as it already does for an
 * unrecognized line.
 */
const PLAN_VIEW_COMMAND_RE =
  /^(?:what(?:'s|\s+is)\s+(?:my|today'?s)\s+plan|show(?:\s+me)?(?:\s+(?:my|today'?s))?\s+plan|plan)\??$/i;

export function isPlanViewCommand(line: string): boolean {
  return PLAN_VIEW_COMMAND_RE.test(line.trim());
}

/**
 * Answers an on-demand Plan-view request: looks up today's stored Plan
 * (`getPlan`) and, if one exists, prints it via `renderPlan` — the exact
 * same pure renderer `rituals/morning-ritual.ts` uses to build the Morning
 * Ritual's own notification, so what Spencer sees here can never drift from
 * what the real notification showed (this task's whole point per its brief).
 *
 * If no Plan has been generated yet today (the Morning Ritual hasn't run,
 * or it ran but produced `nothing-to-plan`/`nothing-fits`), this says so
 * plainly rather than fabricating one or failing silently — the brief's
 * second Given/When/Then.
 */
function showPlanCommand(store: MemoryStore, io: ChatCliIo, today: IsoDate): void {
  const stored = getPlan(store, today);
  if (!stored) {
    io.writeLine("No Plan has been generated for today yet.");
    return;
  }
  io.writeLine(renderPlan(stored.data));
}

// ============================================================================
// Mid-Day Re-Flow trigger command (Task 15 / Story 2.3, FR-9)
// ============================================================================

/**
 * Recognizes a Mid-Day Re-Flow trigger typed at the `yoh>` prompt — the same
 * kind of deliberately simple, clearly-documented pattern matching
 * `parseTimeBudgetCommand`/`isPlanViewCommand` use above, NOT real free-text
 * NLU. This is Task 15's own call on exact phrasing (per its brief): the
 * task description's own examples — "re-flow", "refit my day", "redo my
 * plan" — plus their natural minor variants.
 *
 * Recognized phrasing (case-insensitive, extra whitespace tolerated,
 * optional leading "please"):
 *   - a bare "reflow" / "re-flow" / "refit"
 *   - "reflow my day" / "re-flow my plan" / "refit my day" / "refit plan"
 *   - "redo my plan" / "redo my day" / "redo plan" / "redo day"
 *     (bare "redo" alone is NOT recognized — an ordinary English word too
 *     ambiguous to claim without an explicit "day"/"plan" object, unlike
 *     "reflow"/"refit", which are unambiguously Yoh-specific)
 *
 * Returns `false` (not an error) for any line that doesn't match this shape
 * at all, so `runChatCli` can fall through to the general-qa catch-all
 * exactly as it already does for an unrecognized line.
 */
const MID_DAY_REFLOW_COMMAND_RE =
  /^(?:please\s+)?(?:(?:re-?flow|refit)(?:\s+(?:my\s+)?(?:day|plan))?|redo\s+(?:my\s+)?(?:day|plan))\??$/i;

export function isMidDayReflowCommand(line: string): boolean {
  return MID_DAY_REFLOW_COMMAND_RE.test(line.trim());
}

/**
 * Answers a Mid-Day Re-Flow trigger: calls `rituals/mid-day-reflow.ts`'s
 * `runMidDayReflow` (the only call site of that function anywhere — see
 * this file's own module doc comment) and prints its result. Per UX-DR11,
 * a successful re-flow prints ONLY `outcome.rendered` — the short,
 * remainder-only block that function already built — never the whole
 * day's Plan again.
 */
async function midDayReflowCommand(
  store: MemoryStore,
  io: ChatCliIo,
  timeZone: string,
  readTasks: () => Promise<readonly Task[]>,
  now: () => Date,
): Promise<void> {
  const result = await runMidDayReflow({ store, readTasks, now, timeZone });

  if (!result.ok) {
    io.writeLine(`I couldn't re-flow the rest of today: ${result.error.message}`);
    return;
  }

  switch (result.value.status) {
    case "no-plan-today":
      io.writeLine("There's no Plan for today yet to re-flow.");
      return;
    case "nothing-to-reflow":
      io.writeLine("Nothing left to re-flow — everything remaining is already accounted for.");
      return;
    case "reflowed":
      io.writeLine(result.value.rendered);
      return;
  }
}

// ============================================================================
// Logistics-Only Blocker Handling (Task 16 / Story 2.4, FR-10, UX-DR12)
// ============================================================================

/**
 * Recognizes Spencer reporting a purely logistical Blocker in plain
 * language — e.g. "meeting ran over", "running late", "something came up",
 * "stuck in traffic", "call went long". Unlike `isMidDayReflowCommand`'s
 * fixed trigger phrasing, a Blocker report is genuinely open-ended free text
 * (FR-10's own example names neither a Task nor a duration), so this is a
 * documented STARTING keyword/phrase heuristic — not real NLU — covering
 * the common shapes a logistics Blocker report tends to take. It is
 * deliberately conservative rather than exhaustive: richer (LLM-based, or a
 * broader phrase library) Blocker detection is a natural future
 * improvement, not required for this task.
 *
 * Post-review tightening (Important finding): a false positive here is NOT
 * like a false positive on `parseTimeBudgetCommand`/`isPlanViewCommand` —
 * per AD-3 this path reschedules and PERSISTS a real change to Spencer's
 * Plan immediately, with no confirmation gate, including zero-crediting
 * whatever Task the current block belongs to. So every pattern below is
 * required to be a multi-word phrase with enough co-occurring signal that
 * it's implausible as an accidental substring match inside an unrelated
 * sentence — no bare single common word is allowed on its own. The first
 * version of this list included `\btraffic\b` and `\bdelayed\b` as bare
 * single-word triggers, which matched things like "what's traffic like on
 * I-95 right now" or "my package got delayed" and would have silently
 * mutated Spencer's Plan in response to an ordinary question or an
 * unrelated statement — exactly the risk AD-3's "no confirmation gate"
 * carve-out makes unusually costly to get wrong. Both are replaced below
 * with (or, for "delayed", simply not represented by) a stronger multi-word
 * phrase. `\bheld\s+up\b` and `\bran\s+over\b`/`\bwent\s+long\b`/etc. are
 * kept as-is per review guidance — already reasonably specific two-word
 * phrases unlikely to appear by accident — though "held up" in particular
 * still has a residual, accepted false-positive surface (e.g. a news
 * headline about a robbery) consistent with this being a documented STARTING
 * heuristic, not exhaustive NLU. The previous catch-all
 * `\b(meeting|call)\s+(ran|went)\b` is dropped entirely: it required no
 * continuation after "ran"/"went", so it falsely matched benign statements
 * like "the meeting went great" — it added no coverage the more specific
 * `ran over`/`ran long`/`went long` patterns below don't already provide
 * (they're subject-agnostic, so "the call ran over" is still caught by
 * `ran over` alone).
 *
 * Because these phrases can still plausibly appear inside an unrelated
 * sentence even after tightening, this check is run only AFTER
 * `parseTimeBudgetCommand`/`isPlanViewCommand`/`isMidDayReflowCommand` have
 * all already failed to match.
 */
const BLOCKER_REPORT_PATTERNS: readonly RegExp[] = [
  /\bran\s+over\b/i,
  /\bran\s+long\b/i,
  /\bwent\s+long\b/i,
  /\bran\s+late\b/i,
  /\brunning\s+late\b/i,
  /\bsomething\s+came\s+up\b/i,
  /\bstuck\s+in\s+traffic\b/i,
  /\bheld\s+up\b/i,
  /\bgot\s+(interrupted|blocked|stuck)\b/i,
];

export function isBlockerReportCommand(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  return BLOCKER_REPORT_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Answers a Blocker report: calls `rituals/mid-day-reflow.ts`'s
 * `runMidDayReflow` with `blockerReported: true` (per AD-3, immediately and
 * automatically — no confirmation gate) and prints ONLY a single
 * confirmation line, per UX-DR12 — never `outcome.rendered` (that's Task
 * 15's fuller, multi-line UX-DR11 rendering, reused only by
 * `midDayReflowCommand` above). No suggestions for resolving the underlying
 * obstacle, no commentary or judgment.
 */
async function blockerReportCommand(
  store: MemoryStore,
  io: ChatCliIo,
  timeZone: string,
  readTasks: () => Promise<readonly Task[]>,
  now: () => Date,
): Promise<void> {
  const result = await runMidDayReflow({ store, readTasks, now, timeZone, blockerReported: true });

  if (!result.ok) {
    io.writeLine(`I couldn't reschedule around that: ${result.error.message}`);
    return;
  }

  switch (result.value.status) {
    case "no-plan-today":
      io.writeLine("There's no Plan for today yet to reschedule.");
      return;
    case "nothing-to-reflow":
      io.writeLine("Nothing needed rescheduling.");
      return;
    case "reflowed":
      io.writeLine(buildBlockerConfirmationLine(result.value));
      return;
  }
}

// ============================================================================
// Slip-Bump lineage view (Task 17 / Story 2.5, UX-DR19)
// ============================================================================

/**
 * Recognizes Spencer asking "why is X prioritized [today]" typed at the
 * `yoh>` prompt — the same kind of deliberately simple, clearly-documented
 * pattern matching `parseTimeBudgetCommand`/`isPlanViewCommand`/
 * `isMidDayReflowCommand` use above, NOT real free-text NLU. Recognized
 * phrasing (case-insensitive, extra whitespace tolerated, optional trailing
 * "today" and/or "?"), per the brief's own example:
 *
 *   - "why is <Task name> prioritized"
 *   - "why is <Task name> prioritized today"
 *
 * Returns the captured Task name (verbatim, original casing preserved for
 * echoing back in an error message) on a match, or `undefined` for any line
 * that doesn't match this shape at all — so `runChatCli` can fall through to
 * the general-qa catch-all exactly as it already does for an unrecognized
 * line. The captured name is matched against real Task titles
 * case-insensitively by `whyPrioritizedCommand` below, so the exact casing
 * Spencer types doesn't need to match Notion's stored title.
 */
const WHY_PRIORITIZED_COMMAND_RE = /^why\s+is\s+(.+?)\s+prioritized(?:\s+today)?\??$/i;

export function parseWhyPrioritizedCommand(line: string): string | undefined {
  const match = WHY_PRIORITIZED_COMMAND_RE.exec(line.trim());
  return match?.[1];
}

/**
 * Answers a Slip-Bump lineage-view request (UX-DR19): finds the named Task
 * (case-insensitive exact match on title — a documented starting heuristic,
 * same spirit as `isBlockerReportCommand`'s own "not real NLU" note; a
 * fuzzier/substring match is a natural future improvement, not required
 * here) among `tasks`, then shows its current Slip-Bump lineage — its
 * consecutive-slip count, most recent slip date, and the resulting bump
 * level/cap status from `core/slip-bump.ts`'s `computeSlipBumpLevel`
 * (AD-6).
 *
 * A Task with no stored `SlipHistory` (never slipped, or its history was
 * cleared on completion — `memory-store.ts`'s `clearSlip`, this story's own
 * AC) is reported as having no Slip-Bump applied, rather than a bump level
 * of a bare `0` with no explanation. A name that matches no Task in `tasks`
 * says so plainly rather than silently doing nothing.
 */
function whyPrioritizedCommand(store: MemoryStore, io: ChatCliIo, tasks: readonly Task[], taskName: string): void {
  const normalized = taskName.trim().toLowerCase();
  const task = tasks.find((t) => t.title.trim().toLowerCase() === normalized);
  if (!task) {
    io.writeLine(`I couldn't find a Task named "${taskName}".`);
    return;
  }

  const history = getSlipHistory(store, task.id);
  if (!history || history.data.consecutiveSlipCount <= 0) {
    io.writeLine(`"${task.title}" hasn't slipped recently — no Slip-Bump applied.`);
    return;
  }

  const { consecutiveSlipCount, lastSlipDate } = history.data;
  const level = computeSlipBumpLevel(consecutiveSlipCount);
  const dayWord = consecutiveSlipCount === 1 ? "day" : "days";
  const capNote = level.atCap ? " — at its Slip-Bump cap" : "";
  io.writeLine(
    `"${task.title}" has slipped ${consecutiveSlipCount} consecutive ${dayWord} (last slipped ${lastSlipDate}) — current Slip-Bump level ${level.value}${capNote}.`,
  );
}

// ============================================================================
// Create-item command (Story 6.3 / FR-26)
// ============================================================================

/**
 * Recognizes "create/add a [task|project|research vault item] ..." — the
 * same deliberately-simple, documented starting heuristic every other
 * trigger recognizer in this file uses (NOT real NLU). Only ever emits one
 * of the three real `NotionDatabaseTarget` values — Story 6.3's AC2 ("Yoh
 * does not attempt the creation" for any other target) holds by
 * construction: anything that doesn't match one of these three database
 * words simply doesn't match this regex at all, and falls through to the
 * general-qa catch-all untouched.
 */
const CREATE_ITEM_RE = /^(?:create|add|new)\s+(?:a|an)?\s*(task|project|research\s*vault(?:\s+(?:item|entry))?)\b[:\s-]*(.*)$/i;

export function parseCreateItemCommand(line: string): { readonly database: NotionDatabaseTarget; readonly request: string } | undefined {
  const match = CREATE_ITEM_RE.exec(line.trim());
  if (!match) return undefined;
  const [, dbWord, rest] = match;
  const database: NotionDatabaseTarget = /task/i.test(dbWord!) ? "Tasks" : /project/i.test(dbWord!) ? "Projects" : "ResearchVault";
  const request = rest!.trim().length > 0 ? rest!.trim() : line.trim();
  return { database, request };
}

type CreateNotionPageFn = (
  database: NotionDatabaseTarget,
  properties: Readonly<Record<string, string>>,
) => Promise<Result<{ pageId: string; url?: string }, YohError>>;

type ValidateNotionPageDraftFn = (
  database: NotionDatabaseTarget,
  properties: Readonly<Record<string, string>>,
) => Promise<Result<void, YohError>>;

/**
 * Handles one recognized create-item request end-to-end (Story 6.3 /
 * FR-26): asks Claude to draft the fields (`draftNotionPageFields`),
 * validates the draft against the target database's real live schema
 * (`validateDraft` — AD-12's draft-time check), shows it as a
 * `Proposal<NotionPageDraft>` and waits for an explicit yes/no, and on
 * "yes" creates it (`createPageFn`, which re-validates at write time —
 * AD-12's binding guarantee) and echoes a one-line receipt (AD-5's Phase
 * 1.5 chat-receipt requirement). Never persists this Proposal to
 * `memory-store.ts` — per AD-3, a create has no live entity to snapshot,
 * so it's built, shown, and resolved entirely within this one call.
 */
async function handleCreateItemCommand(
  io: ChatCliIo,
  llmClient: AnthropicMessagesClient,
  database: NotionDatabaseTarget,
  request: string,
  createPageFn: CreateNotionPageFn,
  validateDraft: ValidateNotionPageDraftFn,
): Promise<void> {
  let fields: Record<string, string> | undefined;
  try {
    fields = await draftNotionPageFields(llmClient, database, request);
  } catch {
    fields = undefined;
  }

  if (!fields) {
    io.writeLine(`I couldn't tell what you want in the new ${database} item — try naming it more directly.`);
    return;
  }

  const validated = await validateDraft(database, fields);
  if (!validated.ok) {
    io.writeLine(`I can't create that — ${validated.error.message}`);
    return;
  }

  const draft: NotionPageDraft = { database, properties: fields };
  const proposal: Proposal<NotionPageDraft> = {
    id: `create-${database}-${Date.now()}`,
    kind: "notion-page-draft",
    entityId: database,
    entityVersion: "new",
    suggested: draft,
    reason: `You asked me to create this in ${database}.`,
    createdAt: new Date().toISOString(),
  };

  io.writeLine(`Here's what I'll create in ${database}:`);
  for (const [field, value] of Object.entries(draft.properties)) {
    io.writeLine(`  ${field}: ${value}`);
  }

  let confirmAnswer: string | null = null;
  do {
    confirmAnswer = await io.readLine("Create this? (yes/no): ");
    if (confirmAnswer === null) return; // EOF — nothing created.
  } while (confirmAnswer.trim().length === 0);

  if (parseProposalAnswer(confirmAnswer) !== true) {
    io.writeLine("Okay — I won't create that.");
    return;
  }

  const created = await createPageFn(proposal.suggested.database, proposal.suggested.properties);
  if (!created.ok) {
    io.writeLine(`I couldn't create that: ${created.error.message}`);
    return;
  }

  io.writeLine(`Created "${draft.properties["title"]}" in ${database}.`);
}

/**
 * The REPL loop (Task 5, extended by Task 6, Task 11, Task 13, Task 14): on
 * start, and before processing every subsequent line of input, surfaces any
 * open interaction request(s) first (AD-5). Then checks whether the line is
 * a Time Budget declare/change command (`parseTimeBudgetCommand`) and, if
 * so, validates and persists it (`declareTimeBudget`); then whether it's an
 * on-demand Plan-view request (`isPlanViewCommand`) — both checks are
 * unchanged from before Task 13 (see their own doc comments). Anything that
 * falls through both now routes through `llm-adapter.ts`'s
 * `answerGeneralQuestion`, which calls Claude for a real response — never
 * the old placeholder string — governed by `core/tone.ts`'s
 * `resolveToneSystemPrompt(line)` as its `systemPrompt` (Task 14). A thrown
 * error from that call (AD-8:
 * `adapters/*.ts` may throw on I/O failure) is caught here and surfaced as a
 * plain error line rather than crashing the whole persistent session —
 * ordinary shell-layer error handling, not the Result-conversion AD-8
 * reserves for `rituals/*.ts`.
 *
 * `timeZone` is REQUIRED — deliberately never defaulted to UTC, matching
 * `calendar-adapter.ts`/`ritual-cli.ts`'s own convention: "today" must be
 * Spencer's own local calendar day for `showPlanCommand`'s Plan lookup to
 * find the exact same date `runMorningRitual` stored it under (Task 11
 * review fix — see `currentIsoDate`'s doc comment). `llmClient` is REQUIRED
 * too (no default) — same injectable-dependency convention as `store`/`io`,
 * so no test accidentally reaches the real Claude API. `now` is injectable
 * purely so tests can pin a specific instant instead of the real system
 * clock; it defaults to the real clock for the real entrypoint.
 *
 * `readTasks` (Task 15) is what `midDayReflowCommand` hands to
 * `rituals/mid-day-reflow.ts`'s `runMidDayReflow` — the same
 * `adapters/notion-adapter.ts` seam `ritual-cli.ts`'s Morning Ritual wiring
 * already uses. Task 17's `whyPrioritizedCommand` reuses this exact same
 * seam to resolve the named Task by title before looking up its Slip-Bump
 * lineage. It's OPTIONAL (unlike `store`/`io`/`timeZone`/`llmClient`)
 * so every pre-Task-15 test call site above keeps compiling unchanged; its
 * default throws only if a test that never exercises the Mid-Day Re-Flow
 * command somehow reaches it anyway, which would itself be a bug worth
 * surfacing loudly rather than silently. The real entrypoint (`main`,
 * below) always supplies a real one.
 *
 * `setTaskStatus` (Task 19) is what `surfaceOpenInteractionRequests` threads
 * into `answerNightCloseOutRequest` for the `"night-close-out"` branch —
 * `notion-adapter.ts`'s own `setTaskStatus`, pre-bound to its client/config,
 * same optional-with-a-throws-only-if-invoked-default convention as
 * `readTasks` above.
 */
export async function runChatCli(
  store: MemoryStore,
  io: ChatCliIo,
  timeZone: string,
  llmClient: AnthropicMessagesClient,
  now: () => Date = () => new Date(),
  readTasks: () => Promise<readonly Task[]> = () => {
    throw new Error("chat-cli: no readTasks dependency configured — cannot re-flow the day");
  },
  setTaskStatus: SetTaskStatusFn = async () => {
    throw new Error("chat-cli: no setTaskStatus dependency configured — cannot record Night Ritual close-out");
  },
  updateTaskField: UpdateTaskFieldFn = async () => {
    throw new Error("chat-cli: no updateTaskField dependency configured — cannot record a Data-Completeness answer in Notion");
  },
  createNotionPage: CreateNotionPageFn = async () => {
    throw new Error("chat-cli: no createNotionPage dependency configured — cannot create a Notion item");
  },
  validateNotionPageDraft: ValidateNotionPageDraftFn = async () => {
    throw new Error("chat-cli: no validateNotionPageDraft dependency configured — cannot validate a Notion item draft");
  },
): Promise<void> {
  // FR-25 (Story 6.2): a small bounded window of Spencer's own recent
  // (non-blank) chat lines, threaded into `suggestFieldValue`'s inference
  // attempt — never persisted (AD-11's "enrichment happens at display time,
  // every time, not once at write time"), so it's purely an in-memory,
  // per-session accumulator.
  const recentMessages: string[] = [];
  const RECENT_MESSAGES_WINDOW = 20;

  await surfaceOpenInteractionRequests(
    store,
    io,
    setTaskStatus,
    currentIsoDate(timeZone, now),
    undefined,
    updateTaskField,
    llmClient,
    recentMessages,
  );

  // Set once the first real (non-blank) line has been handled, so a
  // muted divider separates each conversation turn from the next —
  // deliberately not printed before the very first prompt, when there is no
  // prior turn yet to separate from.
  let turnComplete = false;

  for (;;) {
    // The divider is folded into the PROMPT string itself, rather than a
    // separate `io.writeLine` call before it — it must only ever appear
    // attached to an actual next prompt Spencer is being shown, never as a
    // dangling trailing line when `io.readLine` is about to return `null`
    // (stdin/EOF) and the session is ending with nothing further to print.
    const prompt = turnComplete
      ? `${paint("─".repeat(WRAP_WIDTH), MUTED, shouldUseColor())}\n${paint("yoh> ", ACCENT, shouldUseColor())}`
      : paint("yoh> ", ACCENT, shouldUseColor());
    const line = await io.readLine(prompt);
    if (line === null) return;

    if (line.trim().length > 0) {
      recentMessages.push(line.trim());
      if (recentMessages.length > RECENT_MESSAGES_WINDOW) recentMessages.shift();
    }

    // Re-check before processing anything else — a ritual running
    // concurrently (AD-10) may have opened a new interaction request since
    // the last check.
    await surfaceOpenInteractionRequests(
      store,
      io,
      setTaskStatus,
      currentIsoDate(timeZone, now),
      undefined,
      updateTaskField,
      llmClient,
      recentMessages,
    );

    if (line.trim().length === 0) continue;
    turnComplete = true;

    const timeBudgetCommand = parseTimeBudgetCommand(line);
    if (timeBudgetCommand) {
      const result = declareTimeBudget(store, timeBudgetCommand.totalMinutes, currentIsoDate(timeZone, now));
      if (result.ok) {
        io.writeLine(`Got it — today's Time Budget is set to ${formatMinutesForDisplay(result.value.data.totalMinutes)}.`);
      } else {
        io.writeLine(`I couldn't set that Time Budget: ${result.error.message}`);
      }
      continue;
    }

    if (isPlanViewCommand(line)) {
      showPlanCommand(store, io, currentIsoDate(timeZone, now));
      continue;
    }

    if (isMidDayReflowCommand(line)) {
      await midDayReflowCommand(store, io, timeZone, readTasks, now);
      continue;
    }

    if (isBlockerReportCommand(line)) {
      await blockerReportCommand(store, io, timeZone, readTasks, now);
      continue;
    }

    const whyPrioritizedTaskName = parseWhyPrioritizedCommand(line);
    if (whyPrioritizedTaskName !== undefined) {
      const tasks = await readTasks();
      whyPrioritizedCommand(store, io, tasks, whyPrioritizedTaskName);
      continue;
    }

    const createItemCommand = parseCreateItemCommand(line);
    if (createItemCommand) {
      await handleCreateItemCommand(
        io,
        llmClient,
        createItemCommand.database,
        createItemCommand.request,
        createNotionPage,
        validateNotionPageDraft,
      );
      continue;
    }

    try {
      const response = await answerGeneralQuestion(llmClient, line, resolveToneSystemPrompt(line));
      io.writeLine(renderMarkdownForTerminal(response, shouldUseColor()));
    } catch (err) {
      io.writeLine(`I hit a problem trying to answer that: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ============================================================================
// Real entrypoint
// ============================================================================

function createNodeIo(): ChatCliIo {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });

  return {
    readLine: (prompt) =>
      new Promise<string | null>((resolve) => {
        if (closed) {
          resolve(null);
          return;
        }
        rl.question(prompt ?? "", (answer) => resolve(answer));
        rl.once("close", () => resolve(null));
      }),
    writeLine: (line) => {
      process.stdout.write(`${line}\n`);
    },
  };
}

/**
 * Real entrypoint: wires a real `MemoryStore` (per `MEMORY_DB_PATH`,
 * defaulting to `./data/yoh-memory.db` — same default `.env.example`
 * documents), a real `AnthropicMessagesClient` (per `CLAUDE_API_KEY` —
 * `llm-adapter.ts`'s `loadLlmAdapterConfigFromEnv`), a real Notion
 * `readTasks` (Task 15), and real stdin/stdout, and runs the REPL loop.
 * Accepts an injectable `env` map (mirroring `token-store.ts`'s
 * `loadGoogleOAuthConfigFromEnv`) so tests never need to mutate real
 * `process.env`.
 *
 * `YOH_TIMEZONE` is read here the same way `ritual-cli.ts`'s
 * `createMorningRitualDeps` reads it — required, throwing rather than
 * silently defaulting to UTC, since `runChatCli`'s Plan lookup must key on
 * Spencer's local calendar day to find what `runMorningRitual` stored under
 * that same local day (Task 11 review fix).
 *
 * Notion's `NOTION_TOKEN`/`NOTION_TASKS_DATA_SOURCE_ID`/
 * `NOTION_PROJECTS_DATA_SOURCE_ID` env vars (and the `Client` they
 * construct) are DELIBERATELY read/constructed LAZILY, inside the
 * `readTasks` closure below, rather than validated up front the way
 * `YOH_TIMEZONE` is (review fix): most of what `chat-cli.ts` does — Time
 * Budget commands, on-demand Plan view, general chat — needs no Notion
 * access at all, so a session that never types a Mid-Day Re-Flow trigger
 * must not be unable to start at all just because Notion isn't configured.
 * `readTasks` is only ever called from inside `midDayReflowCommand`, so the
 * check/construction only actually runs the first time Spencer triggers a
 * re-flow — mirroring the same "throws only if actually invoked" contract
 * `runChatCli`'s own `readTasks` default parameter already documents.
 */
export async function main(env: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  const databasePath = env["MEMORY_DB_PATH"] || "./data/yoh-memory.db";
  const timeZone = env["YOH_TIMEZONE"];
  if (!timeZone) {
    throw new Error("chat-cli: missing required environment variable YOH_TIMEZONE (e.g. America/New_York)");
  }
  const store = createMemoryStore({ databasePath });
  const llmClient = createAnthropicMessagesClient(loadLlmAdapterConfigFromEnv(env));
  const io = createNodeIo();
  const readTasks = async (): Promise<readonly Task[]> => {
    const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
    const projectsDataSourceId = env["NOTION_PROJECTS_DATA_SOURCE_ID"];
    const notionToken = env["NOTION_TOKEN"];
    if (!tasksDataSourceId || !projectsDataSourceId || !notionToken) {
      throw new Error(
        "chat-cli: missing required environment variable(s) NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID / NOTION_PROJECTS_DATA_SOURCE_ID — needed to re-flow the day",
      );
    }
    const notionClient = new Client({
      auth: notionToken,
      ...(env["NOTION_API_VERSION"] ? { notionVersion: env["NOTION_API_VERSION"] } : {}),
    });
    const taskPropertyNames = loadTaskPropertyNamesFromEnv(env);
    return (await readNotionTasks(notionClient, { tasksDataSourceId, projectsDataSourceId, taskPropertyNames })).tasks;
  };
  // Same "lazily constructed, no unrelated startup requirement" convention
  // as `readTasks` above (Task 19) — a session that never answers a Night
  // Ritual close-out prompt must not be unable to start just because Notion
  // isn't configured. Unlike `readTasks`, `setTaskStatus` doesn't throw on
  // missing config — it returns a `Result` failure (AD-12's own AD-8
  // exception, honored all the way up to this binding).
  //
  // Only `NOTION_TOKEN` is checked here (Task 19 review fix) — NOT
  // `NOTION_TASKS_DATA_SOURCE_ID`/`NOTION_PROJECTS_DATA_SOURCE_ID`, which
  // `notion-adapter.ts`'s `setTaskStatus` never reads (see
  // `NotionStatusWriteConfig`'s own doc comment): those two ids address a
  // `dataSources.query` call this write never makes. Checking them here
  // would let an unrelated missing/misconfigured field block a Status
  // write that has nothing to do with it.
  const setTaskStatus: SetTaskStatusFn = async (taskId, status) => {
    const notionToken = env["NOTION_TOKEN"];
    if (!notionToken) {
      return {
        ok: false,
        error: {
          kind: "missing-field",
          message: "chat-cli: missing required environment variable NOTION_TOKEN — needed to record the Night Ritual close-out",
        },
      };
    }
    const notionClient = new Client({
      auth: notionToken,
      ...(env["NOTION_API_VERSION"] ? { notionVersion: env["NOTION_API_VERSION"] } : {}),
    });
    return notionSetTaskStatus(notionClient, {}, taskId, status);
  };
  // Same lazy-construction convention as `setTaskStatus` above (FR-24) — a
  // session that never answers a Data-Completeness prompt must not be
  // unable to start just because Notion isn't configured. Needs
  // `NOTION_TASKS_DATA_SOURCE_ID` (unlike `setTaskStatus`): `updateTaskField`
  // may call `dataSources.retrieve` to check a `select`-backed property's
  // live options before writing it (AD-12's data-integrity guard) — a
  // dependency `setTaskStatus` genuinely has no equivalent of.
  const updateTaskField: UpdateTaskFieldFn = async (taskId, field, value) => {
    const notionToken = env["NOTION_TOKEN"];
    const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
    if (!notionToken || !tasksDataSourceId) {
      return {
        ok: false,
        error: {
          kind: "missing-field",
          message:
            "chat-cli: missing required environment variable(s) NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID — needed to record this answer in Notion",
        },
      };
    }
    const notionClient = new Client({
      auth: notionToken,
      ...(env["NOTION_API_VERSION"] ? { notionVersion: env["NOTION_API_VERSION"] } : {}),
    });
    return notionUpdateTaskField(notionClient, { tasksDataSourceId }, taskId, field, value);
  };
  // Same lazy-construction convention as `updateTaskField` above (Story 6.3)
  // — a session that never asks Yoh to create a Notion item must not be
  // unable to start just because Notion isn't configured. Needs all three
  // data source ids (unlike `updateTaskField`, which only ever needs
  // Tasks'): a create request can target any of the three databases.
  const createNotionPage: CreateNotionPageFn = async (database, properties) => {
    const notionToken = env["NOTION_TOKEN"];
    const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
    const projectsDataSourceId = env["NOTION_PROJECTS_DATA_SOURCE_ID"];
    const researchVaultDataSourceId = env["NOTION_RESEARCH_VAULT_DATA_SOURCE_ID"];
    if (!notionToken || !tasksDataSourceId || !projectsDataSourceId || !researchVaultDataSourceId) {
      return {
        ok: false,
        error: {
          kind: "missing-field",
          message:
            "chat-cli: missing required environment variable(s) NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID / NOTION_PROJECTS_DATA_SOURCE_ID / NOTION_RESEARCH_VAULT_DATA_SOURCE_ID — needed to create a Notion item",
        },
      };
    }
    const notionClient = new Client({
      auth: notionToken,
      ...(env["NOTION_API_VERSION"] ? { notionVersion: env["NOTION_API_VERSION"] } : {}),
    });
    return notionCreatePage(notionClient, { tasksDataSourceId, projectsDataSourceId, researchVaultDataSourceId }, database, properties);
  };
  const validateNotionPageDraft: ValidateNotionPageDraftFn = async (database, properties) => {
    const notionToken = env["NOTION_TOKEN"];
    const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
    const projectsDataSourceId = env["NOTION_PROJECTS_DATA_SOURCE_ID"];
    const researchVaultDataSourceId = env["NOTION_RESEARCH_VAULT_DATA_SOURCE_ID"];
    if (!notionToken || !tasksDataSourceId || !projectsDataSourceId || !researchVaultDataSourceId) {
      return {
        ok: false,
        error: {
          kind: "missing-field",
          message: "chat-cli: missing required Notion environment variable(s) — needed to validate a Notion item draft",
        },
      };
    }
    const notionClient = new Client({
      auth: notionToken,
      ...(env["NOTION_API_VERSION"] ? { notionVersion: env["NOTION_API_VERSION"] } : {}),
    });
    const result = await notionResolveNotionPageDraftProperties(
      notionClient,
      { tasksDataSourceId, projectsDataSourceId, researchVaultDataSourceId },
      database,
      properties,
    );
    return result.ok ? { ok: true, value: undefined } : result;
  };
  try {
    await runChatCli(
      store,
      io,
      timeZone,
      llmClient,
      () => new Date(),
      readTasks,
      setTaskStatus,
      updateTaskField,
      createNotionPage,
      validateNotionPageDraft,
    );
  } finally {
    store.close();
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`chat-cli: fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
