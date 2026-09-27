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
 * that field (`parsePlanningFieldValue`, `core/planning-field-value.ts`) — re-prompting, not silently storing
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
 * Task 23 update (Story 4.2, AD-3, Propose-Don't-Impose): originally added
 * the generic confirm/apply pathway (`apply(proposal)`) and
 * `answerProposalRequest` here. Story 8.2 moved both — see that story's own
 * update paragraph below.
 *
 * Task 10 update: the merge/gate/sync trio moved to
 * `rituals/data-completeness.ts` — the `rituals/*.ts` home the note above
 * always pointed at, given its own file because it is its own capability
 * with callers in two layers (AD-9). DESIGN.md's ANSI color tokens moved to
 * `rituals/morning-ritual.ts` alongside the Plan renderer that is their
 * heaviest user. This file imports both directly (AD-1 permits
 * `shell -> rituals`, never the reverse) and re-exports neither; nothing
 * about its behavior changed with either move.
 *
 * Story 8.1 update (Epic 8): every blocking answer LOOP this docstring
 * describes above — the Data-Completeness field-by-field ask
 * (`answerDataCompletenessRequest`), the Night Ritual close-out
 * (`answerNightCloseOutRequest`), and the Self-Check prompt
 * (`answerSelfCheckRequest`) — moved OUT of this file entirely, into
 * `app/surface-open-items.ts` plus one `app/answer-*.ts` file per request
 * kind, each answering exactly one question per call and returning the
 * next question (or `"done"`) — the same shape a future Web route drives
 * non-blockingly (C4). `parseNightCloseOutAnswer`/`isSkipAnswer`/
 * `parseSelfCheckAnswer`/`parseProposalAnswer` moved to
 * `core/open-item-answers.ts`; the pure cursor/question-assembly logic those
 * loops used to inline now lives in `core/open-item-questions.ts`.
 * `surfaceOpenInteractionRequests` (below) is now pure transport: it calls
 * `app/surface-open-items.ts`'s `surfaceOpenItems`, prints the current
 * question, reads one line, and calls `app/answer-open-item.ts`'s
 * `answerOpenItem` — looping until `next === "done"` — for every request
 * kind. At this point that still excluded `"proposal"`, which stayed on
 * this file's own `answerProposalRequest` a little longer (Story 8.2 below).
 *
 * Story 8.2 update (AD-3/AD-16): `apply`, `ProposalEntityAccessor`,
 * `timeBudgetEntityAccessor`, and `answerProposalRequest` moved OUT of this
 * file entirely, into `app/confirm-proposal.ts` (the first three kept
 * module-private there, per AD-16's `app/` export-shape rule;
 * `answerProposalRequest` superseded outright by `app/answer-open-item.ts`'s
 * `"proposal"` case). `confirmProposal` — that file's one public export —
 * is now the single confirm path for every Proposal kind (`time-budget-
 * change`, `field-value`, `notion-page-draft`, `calendar-edit`), called from
 * `handleCreateItemCommand`/`handleCalendarEditCommand` below and from
 * `answerOpenItem`'s `"proposal"` dispatch. `surfaceOpenInteractionRequests`
 * no longer special-cases `"proposal"` at all — every request kind now
 * flows through the same `surfaceOpenItems`/`answerOpenItem` transport.
 */
import { createInterface } from "node:readline";
import { Client } from "@notionhq/client";
import {
  createMemoryStore,
  getPlan,
  getSlipHistory,
  putTimeBudget,
  type MemoryStore,
  type StoredRecord,
} from "../adapters/memory-store.ts";
import { openSqliteConnection } from "../adapters/sqlite.ts";
import {
  answerGeneralQuestion,
  classifyChatIntent,
  CLAUDE_CHAT_MODEL_CAPABLE,
  CLAUDE_CHAT_MODEL_FAST,
  createAnthropicMessagesClient,
  draftCalendarEditRequest,
  draftNotionPageFields,
  loadLlmAdapterConfigFromEnv,
  type AnthropicMessagesClient,
  type DraftedCalendarEditRequest,
} from "../adapters/llm-adapter.ts";
import {
  applyCalendarEdit as calendarApplyEdit,
  createCalendarBroadClient,
  createCalendarReadClient,
  proposeCalendarEdit as calendarProposeEdit,
  proposeNewCalendarEvent,
  readCalendarEvents,
  resolveCalendarEditRoute as calendarResolveRoute,
  type CalendarBroadClient,
  type MoveOrResizeChange,
} from "../adapters/calendar-adapter.ts";
import {
  createPage as notionCreatePage,
  loadTaskPropertyNamesFromEnv,
  readNotionTasks,
  resolveNotionPageDraftProperties as notionResolveNotionPageDraftProperties,
  setTaskStatus as notionSetTaskStatus,
  updateTaskField as notionUpdateTaskField,
} from "../adapters/notion-adapter.ts";
import {
  initCompletionLogSchema,
  recordCompletion as completionLogRecordCompletion,
  type RecordCompletionInput,
} from "../adapters/completion-log.ts";
import { search as runSearch, type SearchAdapterConfig } from "../adapters/search-adapter.ts";
import { createTokenStore, loadGoogleOAuthConfigFromEnv, type TokenStore } from "../adapters/token-store.ts";
import { parsePlanningFieldValue } from "../core/planning-field-value.ts";
import { parseProposalAnswer } from "../core/open-item-answers.ts";
import { computeSlipBumpLevel } from "../core/slip-bump.ts";
import { shapeDeclaredTimeBudget } from "../core/time-budget.ts";
import { classifyTone, resolveToneSystemPrompt } from "../core/tone.ts";
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
import { RECENT_MESSAGES_WINDOW, type ChatSession } from "../app/chat-session.ts";
import { surfaceOpenItems } from "../app/surface-open-items.ts";
import { answerOpenItem, type AnswerOpenItemDeps } from "../app/answer-open-item.ts";
import { confirmProposal } from "../app/confirm-proposal.ts";
import type {
  CalendarEditChange,
  CalendarEvent,
  ChatIntent,
  ChatTurn,
  ExternalId,
  IsoDate,
  NotionDatabaseTarget,
  NotionPageDraft,
  PlanningFieldNames,
  Proposal,
  Result,
  SearchAnswer,
  Task,
  TaskStatus,
  TimeBudget,
  YohError,
} from "../types/domain.ts";
import type { OpenItem } from "../types/api.ts";

// ============================================================================
// REPL IO abstraction — injectable so tests never need a real TTY/stdin
// ============================================================================

export interface ChatCliIo {
  /** Waits for one line of input, indefinitely (UX-DR20 — no prompt this file shows ever times out). Returns `null` on EOF/stream close, never rejects on that. */
  readonly readLine: (prompt?: string) => Promise<string | null>;
  readonly writeLine: (line: string) => void;
}

// ============================================================================
// Conversation-history recording (2026-09-22 revision) — the root-cause fix
// for `llm-adapter.ts`'s `answerGeneralQuestion` having no memory of the
// session, even of Yoh's own prior actions. See that function's own doc
// comment for the observed failure this fixes.
// ============================================================================

/** ANSI SGR escape sequences (`paint`/`renderMarkdownForTerminal`'s color codes) — stripped before a line is recorded into `ChatTurn` history, since that history is sent to Claude, never rendered to a terminal. */
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

/**
 * The largest number of `ChatTurn`s kept in a session's running history —
 * an even number so trimming (always removing complete `[user, assistant]`
 * pairs from the front, see `pushChatTurn`) can never leave the array
 * starting with an `assistant` turn, which the Messages API rejects. Chosen
 * to mirror `RECENT_MESSAGES_WINDOW`'s (20) spirit — a bounded window so a
 * long session's token cost doesn't grow without limit — roughly doubled
 * since turns alternate rather than being Spencer-only lines.
 */
const MAX_CHAT_HISTORY_TURNS = 40;

/** Appends `turn` to `history` (mutating it in place) and trims from the front, two at a time, once over `MAX_CHAT_HISTORY_TURNS` — see that constant's own doc comment for why trimming happens in pairs. */
function pushChatTurn(history: ChatTurn[], turn: ChatTurn): void {
  history.push(turn);
  while (history.length > MAX_CHAT_HISTORY_TURNS) {
    history.splice(0, 2);
  }
}

/**
 * Wraps `io`, recording everything written/read into `history` (mutated in
 * place) as a running, strictly-alternating `user`/`assistant` `ChatTurn`
 * transcript — passed to `llm-adapter.ts`'s `answerGeneralQuestion` so a
 * general-chat answer can accurately reference what was just said or done,
 * including by a deterministic flow that never itself calls Claude (a
 * Data-Completeness answer, a Night Ritual close-out, a Calendar edit, a
 * Notion write — every one of those already goes through THIS `io`, so
 * nothing about them needs its own separate recording logic).
 *
 * **Buffering, not a turn per call (why this is safe against the Messages
 * API's strict alternation requirement).** Every `writeLine` call, and every
 * `readLine` call's own `prompt` string, is appended to an in-flight
 * `pendingAssistant` buffer rather than immediately becoming a `ChatTurn` —
 * `chat-cli.ts` routinely issues several prompts/writes in a row with no
 * intervening REAL answer (a blank-line re-ask per UX-DR20, a multi-Task
 * close-out loop's back-to-back questions, an invalid-answer re-prompt), and
 * naively recording each as its own turn would produce consecutive
 * same-role messages the API rejects. The buffer is flushed as exactly ONE
 * `assistant` turn only at the moment it is finally paired with a genuine
 * non-blank answer, immediately followed by that answer as the `user` turn —
 * so the recorded history alternates by construction, no matter how many
 * prompts/retries happened in between. A buffer that accumulates content but
 * is dropped instead of flushed (before `history` has ANY turns yet, i.e.
 * whatever was printed before Spencer's very first real input of the
 * session) is the one deliberate exception — the Messages API requires the
 * first message to be `user`, so there is nothing valid to attach a leading
 * `assistant` turn to.
 */
function withConversationHistory(io: ChatCliIo, history: ChatTurn[]): ChatCliIo {
  let pendingAssistant: string[] = [];

  return {
    writeLine: (line) => {
      pendingAssistant.push(stripAnsi(line));
      io.writeLine(line);
    },
    readLine: async (prompt) => {
      if (prompt) pendingAssistant.push(stripAnsi(prompt));
      const answer = await io.readLine(prompt);
      if (answer !== null && answer.trim().length > 0) {
        if (pendingAssistant.length > 0 && history.length > 0) {
          pushChatTurn(history, { role: "assistant", content: pendingAssistant.join("\n") });
        }
        pendingAssistant = [];
        pushChatTurn(history, { role: "user", content: answer.trim() });
      }
      return answer;
    },
  };
}

/** The shape `ChatCliDeps`/`main()` thread through as FR-24's Notion write — `notion-adapter.ts`'s `updateTaskField`, pre-bound to its client/config, the same binding-convention `SetTaskStatusFn` (below) already establishes for `setTaskStatus`. Story 8.1: this is now `app/answer-data-completeness.ts`'s `AnswerDataCompletenessDeps.updateTaskField` too — the Data-Completeness answer loop itself moved there. */
type UpdateTaskFieldFn = (
  taskId: string,
  field: PlanningFieldNames,
  value: NonNullable<Task[PlanningFieldNames]>,
) => Promise<Result<void, YohError>>;

// ============================================================================
// Night Ritual close-out prompt (Task 19 / Story 3.1, FR-12–FR-14)
// ============================================================================

/** The shape `runChatCli`/`surfaceOpenInteractionRequests` thread through to `rituals/night-ritual.ts`'s `applyNightCloseOutConfirmation` — `notion-adapter.ts`'s `setTaskStatus`, pre-bound to its client/config (see that function's own doc comment for the binding-convention note). */
type SetTaskStatusFn = (taskId: string, status: TaskStatus) => Promise<Result<void, YohError>>;

/** Story 7.9 (AD-23): `completion-log.ts`'s `recordCompletion`, pre-bound to the shared `SqliteConnection` — threaded into `applyNightCloseOutConfirmation`'s `NightCloseOutApplyDeps.recordCompletion`. */
type RecordCompletionFn = (input: RecordCompletionInput) => void;

/**
 * Story 7.9 (Controller ruling R7): a live-Task lookup, used ONLY by the
 * Night Ritual close-out path to snapshot `area`/`dueDate`/`estimatedMinutes`
 * onto a completion record before it's written — `main()` binds this to
 * `readNotionTasks`, filtered down to the one Task by id. Threaded into
 * `applyNightCloseOutConfirmation`'s `NightCloseOutApplyDeps.lookupTask`,
 * which already tolerates (and logs) a rejection without blocking anything.
 */
type LookupTaskFn = (taskId: ExternalId) => Promise<Task | undefined>;

// Story 8.1: `parseNightCloseOutAnswer`/`isSkipAnswer` moved to
// `core/open-item-answers.ts`; `answerNightCloseOutRequest` moved (as
// `answerNightCloseOut`) to `app/answer-night-close-out.ts`.

// Story 8.1: `parseSelfCheckAnswer`/`SelfCheckAnswer` moved to
// `core/open-item-answers.ts`; `answerSelfCheckRequest` moved (as
// `answerSelfCheck`) to `app/answer-self-check.ts`.

// Story 8.2: `ProposalEntityAccessor`, `apply`, `timeBudgetEntityAccessor`,
// and `answerProposalRequest` moved OUT of this file entirely, into
// `app/confirm-proposal.ts` (the first two/`timeBudgetEntityAccessor` kept
// module-private there — AD-16's `app/` export shape rule — and
// `answerProposalRequest` superseded outright by `app/answer-open-item.ts`'s
// `"proposal"` case). `confirmProposal` (that file's public export) is now
// the single confirm path for every Proposal kind, called from
// `handleCreateItemCommand`/`handleCalendarEditCommand` below and from
// `answerOpenItem`'s `"proposal"` dispatch — `apply(proposal)` is no longer
// called from anywhere in this file.

/**
 * Story 8.1 rewrite: `chat-cli.ts` is transport only over `app/surface-
 * open-items.ts`'s `surfaceOpenItems` and `app/answer-open-item.ts`'s
 * `answerOpenItem` — the exact shape a future Web route drives
 * non-blockingly (C4). Surfaces every currently open interaction request,
 * one at a time, each blocking for Spencer's answer before moving to the
 * next — AD-5's "an open confirmation blocks the chat flow rather than
 * queuing silently alongside something else." There is no timeout anywhere
 * in this loop (UX-DR20): every `io.readLine` call is awaited indefinitely,
 * and a blank answer re-prompts rather than clearing the request or giving
 * up.
 *
 * Story 8.2: every request kind — including `"proposal"` — now flows
 * through this same `surfaceOpenItems`/`answerOpenItem` transport; this file
 * no longer special-cases `"proposal"` with its own `answerProposalRequest`
 * (moved to `app/confirm-proposal.ts`/`app/answer-open-item.ts`).
 *
 * `answerDeps` defaults to a set of stubs that throw only if actually
 * invoked (mirrors every other optional dependency in this file) — safe for
 * a caller that surfaces nothing at all. `runChatCli` always supplies a
 * real one, built fresh at each call site so `today`/`session` stay
 * current.
 *
 * Returns once no interaction request remains open, or once `io.readLine`
 * reports EOF (stdin closed) — whichever comes first.
 */
function defaultAnswerOpenItemDeps(store: MemoryStore): AnswerOpenItemDeps {
  return {
    store,
    session: { recentMessages: [], lastSearchAnswer: undefined },
    updateTaskField: async () => {
      throw new Error("chat-cli: no updateTaskField dependency configured — cannot record a Data-Completeness answer in Notion");
    },
    setTaskStatus: async () => {
      throw new Error("chat-cli: no setTaskStatus dependency configured — cannot record Night Ritual close-out");
    },
    recordCompletion: () => {
      throw new Error("chat-cli: no recordCompletion dependency configured — cannot record a Night Ritual close-out completion");
    },
    lookupTask: async () => {
      throw new Error("chat-cli: no lookupTask dependency configured — cannot snapshot a close-out completion's Task fields");
    },
    today: localIsoDate(new Date(), "UTC"),
    random: Math.random,
  };
}

export async function surfaceOpenInteractionRequests(
  store: MemoryStore,
  io: ChatCliIo,
  answerDeps: AnswerOpenItemDeps = defaultAnswerOpenItemDeps(store),
): Promise<void> {
  for (;;) {
    const surfaced = await surfaceOpenItems(answerDeps, {});
    if (!surfaced.ok || surfaced.value.items.length === 0) return;
    const item = surfaced.value.items[0]!;

    const resolved = await answerAndPresentOneItem(io, answerDeps, item);
    if (!resolved) return; // EOF mid-answer.
  }
}

/**
 * Presents ONE open item's CURRENT question, reads one line, and calls
 * `answerOpenItem` — looping (still within this one item, never returning to
 * `surfaceOpenInteractionRequests`'s own outer loop) as long as the answer
 * carries a `next` question rather than `"done"` (Review Focus #5: a
 * decline-then-blind-answer within one field completes within a single
 * `surfaceOpenInteractionRequests` call, before any unrelated line is read).
 * A blank line re-prompts indefinitely (UX-DR20) without ever calling
 * `answerOpenItem`. Returns `false` (leaving whatever's pending open,
 * unanswered) on EOF.
 */
async function answerAndPresentOneItem(io: ChatCliIo, answerDeps: AnswerOpenItemDeps, first: OpenItem): Promise<boolean> {
  io.writeLine(paint(first.promptText, ACCENT, shouldUseColor()));
  io.writeLine("");
  let question = first.question;
  for (;;) {
    if (question.text.length > 0) io.writeLine(question.text);
    let answer: string | null;
    for (;;) {
      answer = await io.readLine("> ");
      if (answer === null) return false; // stdin closed mid-answer.
      if (answer.trim().length > 0) break; // wait indefinitely (UX-DR20): re-ask, don't skip.
    }

    const result = await answerOpenItem(answerDeps, {
      requestId: first.requestId,
      questionId: question.questionId,
      answer: answer.trim(),
      ...(question.proposal !== undefined ? { proposal: question.proposal } : {}),
    });
    if (!result.ok) {
      io.writeLine(`I can't process that any more — ${result.error.message}`);
      return true;
    }
    if (result.value.message) io.writeLine(result.value.message);
    for (const receipt of result.value.receipts) io.writeLine(receipt);
    if (result.value.next === "done") return true;
    question = result.value.next;
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

/**
 * Second, looser trigger (root-cause fix alongside `core/tone.ts`'s
 * `CAPABILITIES_INSTRUCTION` — see that constant's doc comment) for a
 * request that names Notion and a database explicitly but doesn't open with
 * `CREATE_ITEM_RE`'s exact "create/add/new a ___" shape — e.g. "can we input
 * the high priority data to the notion tasks db" or "put this in the notion
 * research vault". Requires BOTH a write-ish verb AND "notion" co-occurring
 * with a database word IN THE SAME CLAUSE (sentence, split on `.`/`?`/`!`) —
 * same deliberately-simple, documented starting heuristic every other
 * trigger recognizer in this file uses (NOT real NLU). Checking per-clause
 * rather than anywhere-in-the-line matters: without it, an unrelated write
 * verb earlier in a multi-sentence message ("add milk to the list. also
 * check notion tasks later") would false-positive on a line that never
 * actually asked to write anything to Notion.
 */
const NOTION_WRITE_VERB_RE = /\b(?:create|add|new|put|input|file|log|enter|record|save|move|sync|export|push|write)\b/i;
const NOTION_DB_MENTION_RE =
  /\bnotion\b[^.?!]*\b(task|project|research\s*vault)s?\b|\b(task|project|research\s*vault)s?\b[^.?!]*\bnotion\b/i;

export function parseCreateItemCommand(line: string): { readonly database: NotionDatabaseTarget; readonly request: string } | undefined {
  const trimmed = line.trim();

  const match = CREATE_ITEM_RE.exec(trimmed);
  if (match) {
    const [, dbWord, rest] = match;
    const database: NotionDatabaseTarget = /task/i.test(dbWord!) ? "Tasks" : /project/i.test(dbWord!) ? "Projects" : "ResearchVault";
    const request = rest!.trim().length > 0 ? rest!.trim() : trimmed;
    return { database, request };
  }

  const clauses = trimmed.split(/[.?!]+/).map((c) => c.trim()).filter((c) => c.length > 0);
  for (const clause of clauses) {
    if (!NOTION_WRITE_VERB_RE.test(clause)) continue;
    const dbMatch = NOTION_DB_MENTION_RE.exec(clause);
    if (!dbMatch) continue;
    const dbWord = dbMatch[1] ?? dbMatch[2];
    const database: NotionDatabaseTarget = /task/i.test(dbWord!) ? "Tasks" : /project/i.test(dbWord!) ? "Projects" : "ResearchVault";
    return { database, request: trimmed };
  }

  return undefined;
}

/**
 * Recognizes "save/file that/this [to the/my (notion) (research) vault]" —
 * the same deliberately-simple starting heuristic every other trigger
 * recognizer in this file uses (Story 6.5 / FR-29). Deliberately does NOT
 * match "save my progress" or similar — the trigger word must be
 * immediately followed by "that"/"this" (optionally then a "to the/my
 * ... vault" tail), not an arbitrary object. The tail's "notion" segment
 * (F6, Epic 6 retro) matters because this is checked before
 * `parseCreateItemCommand`'s own looser Notion-mention trigger — without
 * it, "save that to my notion research vault" would match neither trigger
 * exactly and fall through to the wrong one.
 */
const SAVE_SEARCH_RESULT_RE = /^(?:save|file)\s+(?:that|this)(?:\s+to\s+(?:the|my)\s+(?:notion\s+)?(?:research\s+)?vault)?\.?$/i;

export function isSaveSearchResultCommand(line: string): boolean {
  return SAVE_SEARCH_RESULT_RE.test(line.trim());
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
  store: MemoryStore,
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

  // Story 8.2: the write itself now goes through `confirmProposal` — the
  // ONE confirm path every Proposal kind resolves through (FR-48) —
  // instead of calling `createPageFn` directly.
  const confirmed = await confirmProposal({ store, createPage: createPageFn }, { proposal, accept: true });
  if (!confirmed.ok) {
    io.writeLine(`I couldn't create that: ${confirmed.error.message}`);
    return;
  }

  io.writeLine(`Created "${draft.properties["title"]}" in ${database}.`);
}

// ============================================================================
// Web search (Story 6.4 / FR-28)
// ============================================================================

type SearchFn = (query: string) => Promise<Result<SearchAnswer, YohError>>;

/**
 * Runs one search (Story 6.4 / FR-28) and renders the result: the answer
 * text, then a "Sources:" list of citation URLs if any. A legitimate
 * zero-result answer is relayed honestly, not as an error (AD-14). Returns
 * the `SearchAnswer` on success so a later story can reference "the most
 * recent search result in this session"; returns `undefined` on failure.
 */
async function handleSearchCommand(io: ChatCliIo, query: string, searchFn: SearchFn): Promise<SearchAnswer | undefined> {
  const result = await searchFn(query);
  if (!result.ok) {
    io.writeLine(`I couldn't search for that: ${result.error.message}`);
    return undefined;
  }

  const { answer, citations } = result.value;
  if (answer.length === 0 && citations.length === 0) {
    io.writeLine("I searched but didn't find anything useful.");
    return result.value;
  }

  io.writeLine(renderMarkdownForTerminal(answer, shouldUseColor()));
  if (citations.length > 0) {
    io.writeLine("");
    io.writeLine(paint("Sources:", MUTED, shouldUseColor()));
    for (const url of citations) io.writeLine(`  - ${url}`);
  }
  return result.value;
}

/**
 * Files `lastSearchAnswer` to the Research Vault directly (Story 6.5 /
 * FR-29) — no `Proposal`, no confirm step (AD-3: FR-29 is a direct write,
 * the save request itself is the confirmation). Uses the query that
 * produced the answer as both the page's title and its `query` field.
 * `undefined` (no recent search this session) reports plainly rather than
 * fabricating a page from nothing.
 */
async function handleSaveSearchResultCommand(
  io: ChatCliIo,
  lastSearchAnswer: { readonly query: string; readonly answer: SearchAnswer } | undefined,
  today: IsoDate,
  createPageFn: CreateNotionPageFn,
): Promise<void> {
  if (!lastSearchAnswer) {
    io.writeLine("I don't have a recent search result to save — search for something first.");
    return;
  }

  const properties: Record<string, string> = {
    title: lastSearchAnswer.query,
    keyFindings: lastSearchAnswer.answer.answer,
    query: lastSearchAnswer.query,
    searchDate: today,
    sources: lastSearchAnswer.answer.citations.join("\n"),
  };

  const created = await createPageFn("ResearchVault", properties);
  if (!created.ok) {
    io.writeLine(`I couldn't file that: ${created.error.message}`);
    return;
  }

  io.writeLine(`Filed "${properties["title"]}" to the Research Vault.`);
}

// ============================================================================
// Calendar editing beyond Yoh-owned events (Story 6.6 / FR-27, AD-13)
// ============================================================================

/**
 * Recognizes a calendar-edit request — the same deliberately-simple
 * starting keyword heuristic every other trigger recognizer in this file
 * uses. Broad on purpose (natural phrasing for "move this meeting" varies
 * far more than this file's fixed-phrase triggers): the actual
 * move/resize/create and event-name extraction is `draftCalendarEditRequest`'s
 * job (an LLM call), which returns nothing for a line that turns out not to
 * be a calendar edit. There is deliberately no "delete" trigger — deleting
 * an event isn't a value `CalendarEditChange` can even express (AD-13).
 */
const CALENDAR_EDIT_TRIGGER_RE = /^(move|reschedule|resize|extend|shorten|schedule a|block off|create (a|an) (time )?(block|event))\b/i;

export function isCalendarEditCommand(line: string): boolean {
  return CALENDAR_EDIT_TRIGGER_RE.test(line.trim());
}

type ResolveCalendarEditRouteFn = (
  calendarId: string,
  eventId: string,
) => Promise<{ readonly kind: "owned" } | { readonly kind: "external" }>;
type ProposeCalendarEditFn = (
  calendarId: string,
  eventId: string,
  change: MoveOrResizeChange,
) => Promise<Proposal<CalendarEditChange>>;
type ApplyCalendarEditFn = (
  proposal: Proposal<CalendarEditChange>,
) => Promise<Result<{ readonly eventId: string; readonly calendarId: string }, YohError>>;

/**
 * `iso` as Spencer's local weekday, date, year and wall-clock time (e.g.
 * "Fri, Sep 18, 2026, 6:00 PM"), for display only. The date AND year are
 * included on purpose: the drafted datetime is LLM-computed, so a wrong day
 * — or a wrong year entirely — must be visible at the confirm step.
 */
function formatLocalTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** One line describing `change` to `eventTitle`, in Spencer's local time — used for both the confirm preview and the receipt. */
function describeCalendarEdit(change: CalendarEditChange, eventTitle: string, timeZone: string, past: boolean): string {
  switch (change.kind) {
    case "move":
      return `${past ? "Moved" : "Move"} "${eventTitle}" to ${formatLocalTime(change.newStart, timeZone)}–${formatLocalTime(change.newEnd, timeZone)}`;
    case "resize":
      return `${past ? "Resized" : "Resize"} "${eventTitle}" to end at ${formatLocalTime(change.newEnd, timeZone)}`;
    case "create":
      return `${past ? "Created" : "Create"} "${eventTitle}" from ${formatLocalTime(change.start, timeZone)} to ${formatLocalTime(change.end, timeZone)}`;
  }
}

/**
 * Handles one recognized calendar-edit request end-to-end. Event lookup is
 * scoped to TODAY's primary-calendar events only (this story's documented
 * boundary) — a `move`/`resize` request names an event by title, matched
 * case-insensitively among `readCalendarEventsFn`'s result; `create` needs
 * no lookup. Every `move`/`resize` routes through `resolveRoute` first: an
 * `'owned'` event (a "Yoh Plan" block) is declined here — it stays on AD-4's
 * existing automatic path (Mid-Day Re-Flow), never this confirm-gated one
 * (AD-13). Nothing is written until Spencer confirms the exact change,
 * naming the specific event; the receipt is one line naming the event and
 * what changed.
 *
 * Returns `false` — having written nothing — when the message turned out not
 * to be a calendar edit at all (the draft came back `NONE`), so the caller
 * can fall through to ordinary chat; `true` once it has handled the line.
 */
async function handleCalendarEditCommand(
  store: MemoryStore,
  io: ChatCliIo,
  llmClient: AnthropicMessagesClient,
  line: string,
  today: IsoDate,
  timeZone: string,
  readCalendarEventsFn: () => Promise<readonly CalendarEvent[]>,
  resolveRoute: ResolveCalendarEditRouteFn,
  proposeEdit: ProposeCalendarEditFn,
  applyEdit: ApplyCalendarEditFn,
): Promise<boolean> {
  const events = await readCalendarEventsFn();

  let draft: DraftedCalendarEditRequest | undefined;
  try {
    draft = await draftCalendarEditRequest(
      llmClient,
      line,
      today,
      timeZone,
      events.map((e) => ({ title: e.title, start: e.start, end: e.end })),
    );
  } catch (err) {
    io.writeLine(`I couldn't work out that calendar change: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }

  if (!draft) return false;

  let proposal: Proposal<CalendarEditChange>;
  let eventTitle: string;

  if (draft.kind === "create") {
    eventTitle = draft.title;
    proposal = proposeNewCalendarEvent({ calendarId: "primary", title: draft.title, start: draft.start, end: draft.end });
  } else {
    const requestedTitle = draft.eventTitle.trim().toLowerCase();
    const matches = events.filter((e) => e.id !== "" && e.title.trim().toLowerCase() === requestedTitle);
    if (matches.length === 0) {
      io.writeLine(`I couldn't find an event called "${draft.eventTitle}" on today's calendar.`);
      return true;
    }
    if (matches.length > 1) {
      io.writeLine(`You have ${matches.length} events called "${draft.eventTitle}" today (${matches.map((e) => formatLocalTime(e.start, timeZone)).join("; ")}) — I won't guess which one. Rename one so I can tell them apart, then try again.`);
      return true;
    }
    const matchedEvent = matches[0]!;
    eventTitle = matchedEvent.title;

    const route = await resolveRoute("primary", matchedEvent.id);
    if (route.kind === "owned") {
      io.writeLine("That's one of my own Plan blocks — ask me to re-flow the day to adjust it instead.");
      return true;
    }

    proposal = await proposeEdit(
      "primary",
      matchedEvent.id,
      draft.kind === "move" ? { kind: "move", newStart: draft.newStart } : { kind: "resize", newEnd: draft.newEnd },
    );
  }

  io.writeLine(describeCalendarEdit(proposal.suggested, eventTitle, timeZone, false));

  for (;;) {
    const confirmAnswer = await io.readLine("Apply this change? (yes/no): ");
    if (confirmAnswer === null) return true; // EOF — nothing changed.
    if (confirmAnswer.trim().length === 0) continue; // UX-DR16: silence is never consent.

    const confirmed = parseProposalAnswer(confirmAnswer);
    if (confirmed === undefined) {
      io.writeLine('Please answer "yes" or "no".');
      continue;
    }
    if (!confirmed) {
      io.writeLine("Okay — I won't make that change.");
      return true;
    }
    break;
  }

  // Story 8.2: the write itself now goes through `confirmProposal` — the
  // ONE confirm path every Proposal kind resolves through (FR-48) —
  // instead of calling `applyEdit` directly. `applyCalendarEdit` still
  // takes the `Proposal` itself, unwrapped, exactly as before.
  const applied = await confirmProposal({ store, applyCalendarEdit: applyEdit }, { proposal, accept: true });
  if (!applied.ok) {
    io.writeLine(`I couldn't apply that: ${applied.error.message}`);
    return true;
  }

  io.writeLine(`${describeCalendarEdit(proposal.suggested, eventTitle, timeZone, true)}.`);
  return true;
}

/**
 * `runChatCli`'s dependencies (Epic 6 retro item 7, F9 — replaces what used
 * to be 17 positional parameters, 7 of them added across Epic 6 alone).
 * Only `store`/`io`/`timeZone`/`llmClient` are required; every other field
 * is optional and defaults to the same throws-only-if-actually-invoked stub
 * it always has (see each default's own doc note below) — Tasks 2-5 extend
 * this interface with new optional fields as they move more of this file's
 * handlers into `app/`.
 */
export interface ChatCliDeps {
  readonly store: MemoryStore;
  readonly io: ChatCliIo;
  readonly timeZone: string;
  readonly llmClient: AnthropicMessagesClient;
  readonly now?: () => Date;
  readonly readTasks?: () => Promise<readonly Task[]>;
  readonly setTaskStatus?: SetTaskStatusFn;
  readonly updateTaskField?: UpdateTaskFieldFn;
  readonly createNotionPage?: CreateNotionPageFn;
  readonly validateNotionPageDraft?: ValidateNotionPageDraftFn;
  readonly searchFn?: SearchFn;
  readonly readCalendarEventsFn?: () => Promise<readonly CalendarEvent[]>;
  readonly resolveCalendarEditRouteFn?: ResolveCalendarEditRouteFn;
  readonly proposeCalendarEditFn?: ProposeCalendarEditFn;
  readonly applyCalendarEditFn?: ApplyCalendarEditFn;
  readonly recordCompletion?: RecordCompletionFn;
  readonly lookupTask?: LookupTaskFn;
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
export async function runChatCli({
  store,
  io,
  timeZone,
  llmClient,
  now = () => new Date(),
  readTasks = () => {
    throw new Error("chat-cli: no readTasks dependency configured — cannot re-flow the day");
  },
  setTaskStatus = async () => {
    throw new Error("chat-cli: no setTaskStatus dependency configured — cannot record Night Ritual close-out");
  },
  updateTaskField = async () => {
    throw new Error("chat-cli: no updateTaskField dependency configured — cannot record a Data-Completeness answer in Notion");
  },
  createNotionPage = async () => {
    throw new Error("chat-cli: no createNotionPage dependency configured — cannot create a Notion item");
  },
  validateNotionPageDraft = async () => {
    throw new Error("chat-cli: no validateNotionPageDraft dependency configured — cannot validate a Notion item draft");
  },
  searchFn = async () => {
    throw new Error("chat-cli: no searchFn dependency configured — cannot run a web search");
  },
  readCalendarEventsFn = async () => {
    throw new Error("chat-cli: no readCalendarEventsFn dependency configured — cannot look up today's Calendar events");
  },
  resolveCalendarEditRouteFn = async () => {
    throw new Error("chat-cli: no resolveCalendarEditRouteFn dependency configured — cannot route a Calendar edit");
  },
  proposeCalendarEditFn = async () => {
    throw new Error("chat-cli: no proposeCalendarEditFn dependency configured — cannot propose a Calendar edit");
  },
  applyCalendarEditFn = async () => {
    throw new Error("chat-cli: no applyCalendarEditFn dependency configured — cannot apply a Calendar edit");
  },
  recordCompletion = () => {
    throw new Error("chat-cli: no recordCompletion dependency configured — cannot record a Night Ritual close-out completion");
  },
  lookupTask = async () => {
    throw new Error("chat-cli: no lookupTask dependency configured — cannot snapshot a close-out completion's Task fields");
  },
}: ChatCliDeps): Promise<void> {
  // The running session transcript (2026-09-22 revision) — see
  // `withConversationHistory`'s own doc comment. Wrapping `io` here, once,
  // means every flow below (Data-Completeness answers, Night Ritual
  // close-out, Calendar edits, Notion creates, search, ordinary chat) is
  // recorded automatically through its own already-existing `io.writeLine`/
  // `io.readLine` calls — nothing about any individual handler function
  // needed to change.
  const chatHistory: ChatTurn[] = [];
  io = withConversationHistory(io, chatHistory);

  // Story 8.1 (C3): the one per-conversation `ChatSession` — replaces this
  // function's own former `recentMessages`/`lastSearchAnswer` locals.
  // `session.recentMessages` is FR-25's small bounded window of Spencer's
  // own recent (non-blank) chat lines, threaded into `surfaceOpenItems`'s
  // inference attempt — never persisted (AD-11's "enrichment happens at
  // display time, every time, not once at write time"), so it's purely an
  // in-memory, per-session accumulator, deliberately kept separate from
  // `chatHistory` above (FR-25 wants only Spencer's OWN lines, not Yoh's
  // replies). `session.lastSearchAnswer` (Story 6.5 / FR-29) is the most
  // recent `SearchAnswer` produced THIS session (never persisted — "save
  // that" only ever files a result from the current conversation), set by
  // the search-trigger branch below.
  const session: ChatSession = { recentMessages: [], lastSearchAnswer: undefined };

  // Built fresh at each `surfaceOpenInteractionRequests` call site (below)
  // so `today` always reflects the current instant — mirrors this
  // function's own pre-Story-8.1 convention of recomputing
  // `currentIsoDate(timeZone, now)` fresh at every call, never caching it.
  const buildAnswerDeps = (): AnswerOpenItemDeps => ({
    store,
    session,
    llmClient,
    updateTaskField,
    setTaskStatus,
    recordCompletion,
    lookupTask,
    today: currentIsoDate(timeZone, now),
    random: Math.random,
  });

  await surfaceOpenInteractionRequests(store, io, buildAnswerDeps());

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
      session.recentMessages.push(line.trim());
      if (session.recentMessages.length > RECENT_MESSAGES_WINDOW) session.recentMessages.shift();
    }

    // Re-check before processing anything else — a ritual running
    // concurrently (AD-10) may have opened a new interaction request since
    // the last check.
    await surfaceOpenInteractionRequests(store, io, buildAnswerDeps());

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

    // Checked BEFORE parseCreateItemCommand (F6, Epic 6 retro): its own
    // looser Notion-mention trigger also matches "save"/"file" verbs, so a
    // natural "save that to my notion research vault" would otherwise be
    // taken over by the FR-26 create-item draft path instead of filing the
    // actual search result (FR-29).
    if (isSaveSearchResultCommand(line)) {
      await handleSaveSearchResultCommand(io, session.lastSearchAnswer, currentIsoDate(timeZone, now), createNotionPage);
      continue;
    }

    const createItemCommand = parseCreateItemCommand(line);
    if (createItemCommand) {
      await handleCreateItemCommand(
        store,
        io,
        llmClient,
        createItemCommand.database,
        createItemCommand.request,
        createNotionPage,
        validateNotionPageDraft,
      );
      continue;
    }

    if (isCalendarEditCommand(line)) {
      let handled = true;
      try {
        handled = await handleCalendarEditCommand(
          store,
          io,
          llmClient,
          line,
          currentIsoDate(timeZone, now),
          timeZone,
          readCalendarEventsFn,
          resolveCalendarEditRouteFn,
          proposeCalendarEditFn,
          applyCalendarEditFn,
        );
      } catch (err) {
        io.writeLine(`I hit a problem with that calendar change: ${err instanceof Error ? err.message : String(err)}`);
      }
      // Not actually a calendar edit ("move on to the next topic") — fall through to ordinary chat.
      if (handled) continue;
    }

    let chatIntent: ChatIntent = { kind: "general-question" };
    try {
      chatIntent = await classifyChatIntent(llmClient, line);
    } catch {
      chatIntent = { kind: "general-question" }; // A classifier failure must never block the ordinary chat turn.
    }

    if (chatIntent.kind === "search-trigger") {
      const answer = await handleSearchCommand(io, chatIntent.query, searchFn);
      // F5 (Epic 6 retro, Ruling R20): `answer === undefined` means the
      // search itself failed (handleSearchCommand already reported it); a
      // truthy `answer` with no content means it searched fine but found
      // nothing. Both must CLEAR any earlier result, not just skip setting
      // a new one — 6.5 AC3 requires "an actual search result in play"
      // before "save that" can file anything, and a still-set earlier
      // answer is exactly as stale as one left over from a failure.
      if (answer === undefined || (answer.answer.length === 0 && answer.citations.length === 0)) {
        session.lastSearchAnswer = undefined;
      } else {
        session.lastSearchAnswer = { query: chatIntent.query, answer };
      }
      continue;
    }

    try {
      // `chatHistory`'s last turn is already `{role: "user", content: line}`
      // — pushed by the wrapped `io.readLine` call at the top of this loop
      // iteration (see `withConversationHistory`'s doc comment) — so passing
      // `chatHistory` itself IS "the current question plus everything said
      // or done before it," with no separate `line` argument needed.
      //
      // Model routing (2026-09-22 revision): reuses `core/tone.ts`'s own
      // `classifyTone(line)` — already the source of truth for which
      // register's system prompt to send — as the signal for which model to
      // send it to. A `"concise-educational"` line (a genuine factual/
      // analytical question, per `classifyTone`'s own heuristic) escalates
      // to `CLAUDE_CHAT_MODEL_CAPABLE` (Sonnet); ordinary `"casual-peer"`
      // chat stays on `CLAUDE_CHAT_MODEL_FAST` (Haiku), `answerGeneralQuestion`'s
      // own default. See `llm-adapter.ts`'s "Model routing" doc comment
      // (above `CLAUDE_CHAT_MODEL_FAST`) for why this decision lives here,
      // in `chat-cli.ts`, rather than in that file — AD-1 forbids
      // `adapters/*.ts` importing `core/tone.ts`.
      const chatModel = classifyTone(line) === "concise-educational" ? CLAUDE_CHAT_MODEL_CAPABLE : CLAUDE_CHAT_MODEL_FAST;
      const response = await answerGeneralQuestion(llmClient, chatHistory, resolveToneSystemPrompt(line), chatModel);
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
  const connection = openSqliteConnection({ databasePath });
  const store = createMemoryStore(connection);
  // Story 7.9 (AD-10/AD-23): completion-log.ts's own dedicated table, created
  // idempotently alongside memory-store.ts's, before either is used.
  initCompletionLogSchema(connection.db);
  const recordCompletion: RecordCompletionFn = (input) => completionLogRecordCompletion(connection, input);
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
  // Story 7.9 (Controller ruling R7): the Night Ritual close-out
  // completion-snapshot lookup — reuses `readTasks` above (the same live
  // Notion read Mid-Day Re-Flow already uses) and filters to the one Task by
  // id. A rejection (missing config, a Notion failure) propagates to
  // `applyNightCloseOutConfirmation`'s own try/catch, which logs it and
  // never lets it block the completion record or the Status write.
  const lookupTask: LookupTaskFn = async (taskId) => (await readTasks()).find((t) => t.id === taskId);
  // Same "lazily constructed, no unrelated startup requirement" convention
  // as `readTasks` above (Task 19) — a session that never answers a Night
  // Ritual close-out prompt must not be unable to start just because Notion
  // isn't configured. Unlike `readTasks`, `setTaskStatus` doesn't throw on
  // missing config — it returns a `Result` failure (AD-12's own AD-8
  // exception, honored all the way up to this binding).
  //
  // `NOTION_TASKS_DATA_SOURCE_ID` is now checked here too (revision to the
  // Task 19 review fix) — `notion-adapter.ts`'s `setTaskStatus` is
  // schema-checked as of this same revision (see its own doc comment) and
  // needs the Tasks data source id to resolve a Status option against
  // Notion's LIVE option list. `NOTION_PROJECTS_DATA_SOURCE_ID` still isn't
  // checked: nothing about writing a Task's Status ever depends on it.
  const setTaskStatus: SetTaskStatusFn = async (taskId, status) => {
    const notionToken = env["NOTION_TOKEN"];
    const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
    if (!notionToken || !tasksDataSourceId) {
      return {
        ok: false,
        error: {
          kind: "missing-field",
          message:
            "chat-cli: missing required environment variable(s) NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID — needed to record the Night Ritual close-out",
        },
      };
    }
    const notionClient = new Client({
      auth: notionToken,
      ...(env["NOTION_API_VERSION"] ? { notionVersion: env["NOTION_API_VERSION"] } : {}),
    });
    return notionSetTaskStatus(notionClient, { tasksDataSourceId }, taskId, status);
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
  // Same lazy-construction convention as every Notion binding above (Story
  // 6.4) — a session that never triggers a search must not be unable to
  // start just because Perplexity isn't configured.
  const searchAdapterConfig: SearchAdapterConfig | undefined = env["PERPLEXITY_API_KEY"]
    ? { apiKey: env["PERPLEXITY_API_KEY"] }
    : undefined;
  const searchFn: SearchFn = async (query) => {
    if (!searchAdapterConfig) {
      return {
        ok: false,
        error: {
          kind: "missing-field",
          message: "chat-cli: missing required environment variable PERPLEXITY_API_KEY — needed to search",
        },
      };
    }
    return runSearch(searchAdapterConfig, query);
  };
  // Story 6.6 (FR-27): same lazy-construction convention as every binding
  // above — a session that never asks for a Calendar edit must not be unable
  // to start just because Google OAuth isn't configured. chat-cli.ts never
  // needed Google OAuth before this story, so this is its own TokenStore,
  // constructed once on first actual use. Reading today's events uses the
  // existing narrow client (its calendar.readonly scope already covers
  // this, exactly as ritual-cli.ts's Morning Ritual read does); only the
  // route/propose/apply calls use the second, broader-scoped client (AD-13).
  let cachedTokenStore: TokenStore | undefined;
  const getTokenStore = (): TokenStore => {
    cachedTokenStore ??= createTokenStore(loadGoogleOAuthConfigFromEnv(env));
    return cachedTokenStore;
  };
  const readCalendarEventsFn = async (): Promise<readonly CalendarEvent[]> => {
    const readClient = createCalendarReadClient(
      getTokenStore().getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0],
    );
    return readCalendarEvents(readClient, { timeZone });
  };
  const getCalendarBroadClient = (): CalendarBroadClient =>
    createCalendarBroadClient(getTokenStore().getBroadOAuth2Client() as unknown as Parameters<typeof createCalendarBroadClient>[0]);
  const resolveCalendarEditRouteFn: ResolveCalendarEditRouteFn = (calendarId, eventId) =>
    calendarResolveRoute(getCalendarBroadClient(), calendarId, eventId);
  const proposeCalendarEditFn: ProposeCalendarEditFn = (calendarId, eventId, change) =>
    calendarProposeEdit(getCalendarBroadClient(), calendarId, eventId, change);
  const applyCalendarEditFn: ApplyCalendarEditFn = (proposal) => calendarApplyEdit(getCalendarBroadClient(), proposal);
  try {
    await runChatCli({
      store,
      io,
      timeZone,
      llmClient,
      now: () => new Date(),
      readTasks,
      setTaskStatus,
      updateTaskField,
      createNotionPage,
      validateNotionPageDraft,
      searchFn,
      readCalendarEventsFn,
      resolveCalendarEditRouteFn,
      proposeCalendarEditFn,
      applyCalendarEditFn,
      recordCompletion,
      lookupTask,
    });
  } finally {
    connection.close();
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(`chat-cli: fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
