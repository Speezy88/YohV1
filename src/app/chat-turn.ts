/**
 * src/app/chat-turn.ts
 *
 * Story 8.3 (AD-16, C3). The one surface-agnostic entry point every
 * non-slash chat line goes through: `chatTurn(deps, input)` dispatches, in
 * priority order, on this task's five deterministic recognizers
 * (`core/chat-commands.ts`) — Time Budget, Plan-view, Mid-Day Re-Flow,
 * Blocker report, why-prioritized — then falls through to
 * `app/general-question.ts`'s `answerQuestion` as the sole, unconditional
 * fallback. It never calls `classifyChatIntent` itself (Controller ruling —
 * `shell/chat-cli.ts` still runs that, plus its save-search/create-item/
 * calendar-edit checks, inline, ahead of this function; Task 5 folds all of
 * that into `chatTurn` itself), and it never itself emits a `"done"`/
 * `"error"` stream event — only `"status"` and (relayed from
 * `answerQuestion`) `"delta"`. The caller that owns the stream's terminal
 * event (a future server, Task 6) builds it from this function's own
 * returned `Result`, after the last delta.
 *
 * Also owns `MAX_CHAT_HISTORY_TURNS` (moved from `chat-cli.ts`'s private
 * const of the same name/value — that file's own `pushChatTurn` now imports
 * this rather than keeping a second copy). `chatTurn` trims `input.history`
 * to this bound itself, even for a caller that does NOT pre-trim its own
 * history (unlike `chat-cli.ts`'s own `pushChatTurn`, which already trims
 * before this function ever sees the array) — the one behavior only this
 * function can be credited or blamed for.
 */
import {
  isBlockerReportCommand,
  isMidDayReflowCommand,
  isPlanViewCommand,
  parseTimeBudgetCommand,
  parseWhyPrioritizedCommand,
} from "../core/chat-commands.ts";
import { reportBlocker } from "./blocker-report.ts";
import { RECENT_MESSAGES_WINDOW, type ChatSession } from "./chat-session.ts";
import { answerQuestion } from "./general-question.ts";
import { reflowDay } from "./mid-day-reflow.ts";
import { showPlan } from "./plan-view.ts";
import { declareTimeBudget } from "./time-budget.ts";
import { explainPriority } from "./why-prioritized.ts";
import type { AnthropicMessagesClient } from "../adapters/llm-adapter.ts";
import type { MemoryStore } from "../adapters/memory-store.ts";
import type { ChatStreamEvent, ChatTurnRequest, ChatTurnResponse } from "../types/api.ts";
import type { ChatTurn, Result, Task, YohError } from "../types/domain.ts";

/**
 * The largest number of `ChatTurn`s `chatTurn` will ever send to Claude —
 * an even number so trimming (always removing complete `[user, assistant]`
 * pairs from the front) can never leave the array starting with an
 * `assistant` turn, which the Messages API rejects. Mirrors
 * `app/chat-session.ts`'s `RECENT_MESSAGES_WINDOW` (20) spirit — a bounded
 * window so a long session's token cost doesn't grow without limit —
 * roughly doubled since turns alternate rather than being Spencer-only
 * lines.
 */
export const MAX_CHAT_HISTORY_TURNS = 40;

/** The one status event `chatTurn` emits at the very start of every turn (when `deps.emit` is present). */
export const STATUS_THINKING = "Thinking…";

/**
 * Emitted right before a capability that does a live Tasks read (Mid-Day
 * Re-Flow, Blocker report, why-prioritized) actually does that read — the
 * "slow read" case a streaming caller may want to distinguish from the
 * initial `STATUS_THINKING`.
 */
export const STATUS_CHECKING_TASKS = "Checking your Tasks…";

export interface ChatTurnDeps {
  readonly store: MemoryStore;
  readonly timeZone: string;
  readonly now: () => Date;
  readonly readTasks: () => Promise<readonly Task[]>;
  readonly llmClient: AnthropicMessagesClient;
  readonly session: ChatSession;
  readonly emit?: (event: ChatStreamEvent) => void;
}

/** Trims `history` to at most `MAX_CHAT_HISTORY_TURNS`, removing complete `[user, assistant]` pairs from the front — see that constant's own doc comment for why pairs, not a bare slice. */
function trimHistory(history: readonly ChatTurn[]): readonly ChatTurn[] {
  let start = 0;
  while (history.length - start > MAX_CHAT_HISTORY_TURNS) start += 2;
  return start === 0 ? history : history.slice(start);
}

function emitStatus(deps: ChatTurnDeps, text: string): void {
  deps.emit?.({ type: "status", text });
}

/**
 * Records `message` into `deps.session.recentMessages` — FR-25's small
 * bounded window of Spencer's own recent (non-blank) chat lines
 * (`app/surface-open-items.ts`'s inference reads it). Moved here from
 * `chat-cli.ts`'s main loop, which used to push every non-blank line before
 * any dispatch check ran; `chatTurn` now owns this for every line that
 * reaches it (a line intercepted by `chat-cli.ts`'s own still-inline
 * search/create-item/calendar-edit/save-that checks isn't recorded until
 * Task 5 folds those into `chatTurn` too — an accepted, bounded gap, same
 * shape as this story's dispatch-reorder cost).
 */
function recordRecentMessage(deps: ChatTurnDeps, message: string): void {
  const trimmed = message.trim();
  if (trimmed.length === 0) return;
  deps.session.recentMessages.push(trimmed);
  if (deps.session.recentMessages.length > RECENT_MESSAGES_WINDOW) deps.session.recentMessages.shift();
}

/**
 * Dispatches `input.message` against this story's five deterministic
 * recognizers, in the same priority order `chat-cli.ts` used to check them
 * inline (Time Budget, Plan-view, Mid-Day Re-Flow, Blocker report,
 * why-prioritized), then falls through to `app/general-question.ts`'s
 * `answerQuestion` as the sole, unconditional fallback.
 */
export async function chatTurn(deps: ChatTurnDeps, input: ChatTurnRequest): Promise<Result<ChatTurnResponse, YohError>> {
  recordRecentMessage(deps, input.message);
  emitStatus(deps, STATUS_THINKING);

  const timeBudgetCommand = parseTimeBudgetCommand(input.message);
  if (timeBudgetCommand) {
    const result = await declareTimeBudget({ store: deps.store, timeZone: deps.timeZone, now: deps.now }, timeBudgetCommand);
    if (!result.ok) return result;
    return { ok: true, value: { reply: result.value.receipt, receipts: [] } };
  }

  if (isPlanViewCommand(input.message)) {
    return showPlan({ store: deps.store, timeZone: deps.timeZone, now: deps.now }, {});
  }

  if (isMidDayReflowCommand(input.message)) {
    emitStatus(deps, STATUS_CHECKING_TASKS);
    return reflowDay({ store: deps.store, timeZone: deps.timeZone, now: deps.now, readTasks: deps.readTasks }, {});
  }

  if (isBlockerReportCommand(input.message)) {
    emitStatus(deps, STATUS_CHECKING_TASKS);
    return reportBlocker({ store: deps.store, timeZone: deps.timeZone, now: deps.now, readTasks: deps.readTasks }, {});
  }

  const whyPrioritizedTaskName = parseWhyPrioritizedCommand(input.message);
  if (whyPrioritizedTaskName !== undefined) {
    emitStatus(deps, STATUS_CHECKING_TASKS);
    return explainPriority({ store: deps.store, readTasks: deps.readTasks }, { taskName: whyPrioritizedTaskName });
  }

  return answerQuestion(
    { llmClient: deps.llmClient, ...(deps.emit ? { emit: deps.emit } : {}) },
    { message: input.message, history: trimHistory(input.history) },
  );
}
