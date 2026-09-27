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
 * Task 13 update — HISTORICAL (describes this file's shape at the time,
 * before Epic 8; see the Story 8.3 update paragraph below for what's
 * actually true today): the free-text placeholder that used to sit after
 * the Time Budget/Plan-view checks was removed. At the time,
 * `parseTimeBudgetCommand` and `isPlanViewCommand` ran first, directly in
 * this file's main loop, unchanged (cheap, deterministic, no API call) —
 * anything that fell through both was, by construction, a genuine
 * general/factual question, and routed to `adapters/llm-adapter.ts`'s
 * `answerGeneralQuestion`, which calls Claude for a real answer instead of a
 * canned string. Real intent dispatch for Mid-Day Re-Flow (Task 15) and
 * Blocker reports (Task 16) was expected to add its own check here, ahead of
 * this catch-all, the same way the two checks above already worked — see
 * `llm-adapter.ts`'s own module docstring for the post-review reasoning on
 * why this file didn't pre-build that dispatch shape at the time.
 *
 * Task 15 update (Story 2.3, FR-9) — HISTORICAL (see the Story 8.3 update
 * paragraph below): a third deterministic check, `isMidDayReflowCommand`,
 * was added to that same sequence — checked BEFORE the general-qa
 * catch-all, same shape as the two above, at the time. It recognized
 * Spencer telling Yoh to re-fit the rest of today (e.g. a Task ran long or
 * got skipped) and called into `rituals/mid-day-reflow.ts`'s core re-flow
 * function, which does the actual re-fitting and persistence; this file
 * only recognized the trigger and printed the result. At the time this
 * paragraph was written, this was also the ONLY place in the whole codebase
 * that called it directly — Mid-Day Re-Flow never runs proactively (no
 * ritual, cron, or timer path reaches it); see `mid-day-reflow.ts`'s own doc
 * comment and `tests/mid-day-reflow.test.ts`'s structural check for how
 * that's verified. (Story 8.3 moved the recognizer to
 * `core/chat-commands.ts`, the handler and the real call site to
 * `app/mid-day-reflow.ts`, and the dispatch itself into `app/chat-turn.ts`'s
 * `chatTurn` — see this docstring's own Story 8.3 update paragraph.)
 *
 * Task 16 update (Story 2.4, FR-10) — HISTORICAL (see the Story 8.3 update
 * paragraph below): a FOURTH deterministic check, `isBlockerReportCommand`,
 * was added right after `isMidDayReflowCommand` (still before the
 * general-qa catch-all, at the time). It recognized Spencer reporting a
 * purely logistical Blocker in plain language ("meeting ran over", "running
 * late", "stuck in traffic", ...) — genuinely more open-ended than
 * `isMidDayReflowCommand`'s fixed trigger phrasing, so this was a
 * documented STARTING keyword/phrase heuristic (same spirit as
 * `isMidDayReflowCommand`/`parseTimeBudgetCommand`'s own "not real NLU"
 * notes, and FR-2's even-split weights elsewhere in this codebase — a
 * reasonable v1, not a claim of completeness; richer detection remains a
 * natural future improvement). Every recognized phrase is deliberately
 * multi-word (post-review tightening — see `isBlockerReportCommand`'s own
 * doc comment, now in `core/chat-commands.ts`) because a false positive
 * here is unusually costly: a match calls the SAME re-flow function
 * Mid-Day Re-Flow uses, with `blockerReported: true` — which immediately
 * PERSISTS a real reschedule of Spencer's Plan, per AD-3, with no
 * confirmation gate. The result renders completely differently from
 * Task 15's trigger, though: UX-DR12 requires a single confirmation line
 * with no discussion or suggestions, sharply terser than Task 15's "one
 * short block" (UX-DR11). `rituals/mid-day-reflow.ts`'s
 * `buildBlockerConfirmationLine` builds that one line; `app/blocker-
 * report.ts` (Story 8.3's home for this handler) never prints the fuller
 * rendering for this path.
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
 * Task 17 update (Story 2.5, FR-11, UX-DR19) — HISTORICAL (see the Story
 * 8.3 update paragraph below): a FIFTH deterministic check,
 * `parseWhyPrioritizedCommand`, was added right after
 * `isBlockerReportCommand` (still before the general-qa catch-all, at the
 * time). It recognized Spencer asking "why is X prioritized [today]" and
 * answered with that Task's Slip-Bump lineage — its consecutive-slip count
 * and current bump level, read from `memory-store.ts`'s `getSlipHistory`
 * and computed via `core/slip-bump.ts`'s `computeSlipBumpLevel` (AD-6).
 * This is a read-only view: unlike the Mid-Day Re-Flow/Blocker triggers
 * above, it never persists anything. It deliberately does NOT add a
 * "report a slip" trigger — recording a slip is Night Ritual close-out's
 * job (Task 19, below); see `core/slip-bump.ts`'s own "Scope note" docstring
 * section. (Story 8.3 moved the recognizer to `core/chat-commands.ts` and
 * the handler, as `explainPriority`, to `app/why-prioritized.ts`.)
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
 *
 * Story 8.3 update (AD-16): the five deterministic recognizers this
 * docstring's earlier updates describe — `parseTimeBudgetCommand`,
 * `isPlanViewCommand`, `isMidDayReflowCommand`, `isBlockerReportCommand`,
 * `parseWhyPrioritizedCommand` — moved to `core/chat-commands.ts`; their
 * five handlers (`declareTimeBudget`/`showPlanCommand`/`midDayReflowCommand`/
 * `blockerReportCommand`/`whyPrioritizedCommand`) moved to their own
 * `app/*.ts` files (`app/time-budget.ts`, `app/plan-view.ts`,
 * `app/mid-day-reflow.ts`, `app/blocker-report.ts`,
 * `app/why-prioritized.ts`), each returning a plain-text-or-markdown
 * `ChatTurnResponse` instead of writing to `io` directly. The general-qa
 * catch-all (Task 13/14's Tone/model routing) moved the same way, to
 * `app/general-question.ts`. All six are now dispatched by one call into
 * `app/chat-turn.ts`'s `chatTurn`, which this file calls from exactly the
 * position the old trailing general-qa block used to occupy — *after* the
 * `classifyChatIntent`/search-trigger check and the create-item/calendar-
 * edit/save-that checks above it, which all stay inline in this file
 * unchanged (Controller ruling; Story 8.4 folds them into `chatTurn` too —
 * NOT this docstring's own historical "Task 5" above, which is a different,
 * pre-Epic-8 numbering scheme; Epic 8 work is always cited here by Story
 * number to avoid exactly that collision).
 * `chatTurn` never calls `classifyChatIntent` itself, and this file renders
 * whatever it returns — a reply, receipts, or an error message — through
 * its own terminal styling (`renderMarkdownForTerminal`, `shouldUseColor()`),
 * since `ChatTurnResponse.reply` is never ANSI (C2): the Plan-view and
 * Mid-Day Re-Flow/Blocker views accordingly lose their prior terminal color
 * here (accepted — this CLI itself retires in Story 8.9).
 *
 * The current dispatch truth (superseding every "still run first"/"before
 * the general-qa catch-all" claim in this docstring's earlier, historical
 * update paragraphs above): NONE of the five recognizers named above still
 * run directly in this file's main loop, and none of them run "before"
 * anything general-qa-related in the old sense — they're checked from
 * INSIDE `chatTurn`, by `core/chat-commands.ts`, only once `chatTurn` itself
 * is reached. This file's own main loop, top to bottom, is now: surface any
 * open interaction request; the save-that/create-item/calendar-edit checks;
 * `classifyChatIntent` (one real Claude call on every line that reaches it)
 * and, on a `"search-trigger"` result, the search handler; otherwise one
 * `chatTurn` call. That means a line `chatTurn` would recognize
 * deterministically (e.g. "time budget 6h") still costs exactly ONE Claude
 * call today — `classifyChatIntent`'s own — before `chatTurn` recognizes it
 * for free; this is a real, if small and bounded, transitional cost
 * (`app/chat-turn.ts`'s own doc comment and `tests/chat-cli.test.ts`'s
 * updated Time-Budget integration test both name it explicitly). Story 8.4
 * removes it by folding `classifyChatIntent`/search/create-item/
 * calendar-edit into `chatTurn` too, restoring the original top-to-bottom
 * priority (the five recognizers checked first again, ahead of classify,
 * at zero API cost).
 */
import { createInterface } from "node:readline";
import { Client } from "@notionhq/client";
import { createMemoryStore, type MemoryStore } from "../adapters/memory-store.ts";
import { openSqliteConnection } from "../adapters/sqlite.ts";
import {
  classifyChatIntent,
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
import {
  ACCENT,
  localIsoDate,
  MUTED,
  paint,
  renderMarkdownForTerminal,
  shouldUseColor,
  WRAP_WIDTH,
} from "../rituals/ritual-shared.ts";
import type { ChatSession } from "../app/chat-session.ts";
import { surfaceOpenItems } from "../app/surface-open-items.ts";
import { answerOpenItem, type AnswerOpenItemDeps } from "../app/answer-open-item.ts";
import { confirmProposal } from "../app/confirm-proposal.ts";
import { chatTurn, MAX_CHAT_HISTORY_TURNS, type ChatTurnDeps } from "../app/chat-turn.ts";
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
 * Appends `turn` to `history` (mutating it in place) and trims from the
 * front, two at a time, once over `MAX_CHAT_HISTORY_TURNS` (Story 8.3: moved
 * to `app/chat-turn.ts` — this file imports it rather than keeping a second
 * copy) — see that constant's own doc comment for why trimming happens in
 * pairs.
 */
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

// Story 8.3: `parseTimeBudgetCommand`/`declareTimeBudget`/
// `formatMinutesForDisplay`, `isPlanViewCommand`/`showPlanCommand`,
// `isMidDayReflowCommand`/`midDayReflowCommand`,
// `isBlockerReportCommand`/`blockerReportCommand`, and
// `parseWhyPrioritizedCommand`/`whyPrioritizedCommand` all moved OUT of this
// file entirely — the five recognizers to `core/chat-commands.ts`, the five
// handlers to their own one-function-per-file `app/*.ts` modules
// (`app/time-budget.ts`, `app/plan-view.ts`, `app/mid-day-reflow.ts`,
// `app/blocker-report.ts`, `app/why-prioritized.ts`), all now dispatched by
// `app/chat-turn.ts`'s `chatTurn` — see `runChatCli`'s own updated doc
// comment below for where that single call now sits in this file's loop.

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
 * `readTasks` (Task 15) is what `app/chat-turn.ts`'s dispatch hands, via
 * `chatTurnDeps`, into `rituals/mid-day-reflow.ts`'s core re-flow function
 * (Story 8.3: through `app/mid-day-reflow.ts`'s `runReflow`, the one call
 * site) — the same `adapters/notion-adapter.ts` seam `ritual-cli.ts`'s
 * Morning Ritual wiring already uses. `app/why-prioritized.ts`'s
 * `explainPriority` reuses this exact same seam to resolve the named Task
 * by title before looking up its Slip-Bump
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

  // Story 8.3 (C3): the one `ChatTurnDeps` this function's `chatTurn` call
  // site (below) threads through — built once, since (unlike
  // `buildAnswerDeps` below) nothing in it needs to be recomputed per line;
  // each `app/*.ts` capability recomputes its own "today" from `now`/
  // `timeZone` internally. `emit` is omitted — the CLI has no live stream
  // sink, so `chatTurn` (via `app/general-question.ts`) keeps using the
  // existing non-streaming `answerGeneralQuestion` call, unchanged.
  const chatTurnDeps: ChatTurnDeps = { store, timeZone, now, readTasks, llmClient, session };

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

    // Story 8.3: recording Spencer's own recent lines into
    // `session.recentMessages` (FR-25) moved to `app/chat-turn.ts`'s
    // `chatTurn` itself, which now owns every line that reaches it — see
    // that function's own doc comment for the accepted, bounded gap this
    // creates until Task 5 folds the search/create-item/calendar-edit/
    // save-that checks below into `chatTurn` too.

    // Re-check before processing anything else — a ritual running
    // concurrently (AD-10) may have opened a new interaction request since
    // the last check.
    await surfaceOpenInteractionRequests(store, io, buildAnswerDeps());

    if (line.trim().length === 0) continue;
    turnComplete = true;

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

    // Story 8.3: every one of this task's five deterministic commands (Time
    // Budget, Plan-view, Mid-Day Re-Flow, Blocker report, why-prioritized)
    // and the general-qa catch-all are now dispatched by one call into
    // `app/chat-turn.ts`'s `chatTurn` — this is the position the trailing
    // general-qa block used to occupy (the classify/search-trigger block
    // above stays exactly where it was; a search-shaped line never reaches
    // `chatTurn` at all — Controller ruling). `chatHistory`'s last turn is
    // already `{role: "user", content: line}` (pushed by the wrapped
    // `io.readLine` call at the top of this loop iteration — see
    // `withConversationHistory`'s doc comment), so it IS "the current
    // question plus everything said or done before it" — `chatTurn` itself
    // trims it to `MAX_CHAT_HISTORY_TURNS` (a no-op here, since
    // `pushChatTurn` already keeps it within that bound). `chatTurn` never
    // throws (AD-8) — every failure comes back as a `Result` failure, whose
    // message is already the full user-facing string each capability built.
    const chatTurnResult = await chatTurn(chatTurnDeps, { message: line, history: chatHistory });
    if (!chatTurnResult.ok) {
      io.writeLine(chatTurnResult.error.message);
    } else {
      io.writeLine(renderMarkdownForTerminal(chatTurnResult.value.reply, shouldUseColor()));
      for (const receipt of chatTurnResult.value.receipts) io.writeLine(receipt);
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
