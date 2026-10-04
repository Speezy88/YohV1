/**
 * src/app/chat-turn.ts
 *
 * Story 8.3 (AD-16, C3), extended by Story 8.4 and Story 8.8. The one
 * surface-agnostic entry point every non-slash chat line goes through:
 * `chatTurn(deps, input)` dispatches, in priority order, on this file's
 * eight deterministic recognizers (`core/chat-commands.ts`) — Time Budget,
 * Plan-view, Mid-Day Re-Flow, Blocker report, why-prioritized (Story 8.3),
 * then save-search-result, create-item, calendar-edit (Story 8.4, F6/Epic 6
 * retro order) — then, once every deterministic recognizer above has
 * failed, one `chatAgent` tool loop (`app/chat-agent.ts`) — the model reads
 * Tasks, Calendar, the Plan, memory and the web through tools, and stages
 * any change as a single "change-set" proposal that waits for a yes. A
 * recognized command costs ZERO Claude calls; an unmatched line costs
 * between one and `CHAT_AGENT_MAX_STEPS`. It never itself emits
 * a `"done"`/`"error"` stream event — only
 * `"status"` and `"delta"`. The caller that
 * owns the stream's terminal event (a future server) builds it from this
 * function's own returned `Result`, after the last delta.
 *
 * Also owns `MAX_CHAT_HISTORY_TURNS` (moved from `chat-cli.ts`'s private
 * const of the same name/value — that file's own `pushChatTurn` now imports
 * this rather than keeping a second copy). `chatTurn` trims `input.history`
 * to this bound itself, even for a caller that does NOT pre-trim its own
 * history (unlike `chat-cli.ts`'s own `pushChatTurn`, which already trims
 * before this function ever sees the array) — the one behavior only this
 * function can be credited or blamed for.
 */
import { randomUUID } from "node:crypto";
import {
  isBlockerReportCommand,
  isCalendarEditCommand,
  isMidDayReflowCommand,
  isPlanDayCommand,
  isPlanEditRequest,
  isPlanViewCommand,
  isSaveSearchResultCommand,
  parseCreateItemCommand,
  parseDayViewCommand,
  parseTimeBudgetCommand,
  parseWhyPrioritizedCommand,
} from "../core/chat-commands.ts";
import { parseRoutineCommand } from "../core/routine-commands.ts";
import { resolveRelativeDate } from "../core/relative-date.ts";
import { firstCardView } from "../core/sandbox-card-view.ts";
import { parseSearchIntent } from "../core/search-intent.ts";
import { resolveToneSystemPrompt } from "../core/tone.ts";
import { parseSlashMemoryCommand, recognizeMemoryCommand, type MemoryCommand } from "../core/memory-commands.ts";
import { MEMORY_FOLDERS_IN_ORDER, memoryFolderLabel } from "../core/memory-folders.ts";
import { reportBlocker } from "./blocker-report.ts";
import { RECENT_MESSAGES_WINDOW, type ChatSession } from "./chat-session.ts";
import { proposeCalendarEdit, type CalendarEditDeps } from "./calendar-edit.ts";
import { COMMANDS } from "./commands.ts";
import { tryDraftItem, type CreateItemDeps } from "./create-item.ts";
import { dayView } from "./day-view.ts";
import { CHANGE_SET_PROPOSAL_KIND } from "./apply-change-set.ts";
import { chatAgent, type ChatAgentDeps } from "./chat-agent.ts";
import { CHANGE_SET_USE_CARD_REPLY } from "../core/chat-tools.ts";
import { parseProposalAnswer } from "../core/open-item-answers.ts";
import { recallMemoryContext } from "./memory-recall.ts";
import { manageRoutine } from "./routines.ts";
import { requestReshuffle } from "./request-reshuffle.ts";
import { PLAN_EDIT_HOW_TO_REPLY, parsePlanEditCommand, resolvePlanEdit } from "../core/plan-edit-commands.ts";
import { isOpenTask } from "../core/planning-field-value.ts";
import { readPlanningSettings } from "../adapters/settings-store.ts";
import { computeSchoolDayInputs } from "../rituals/reshuffle.ts";
import { morningView } from "./morning-view.ts";
import { startNightCloseOut } from "./night-close-out.ts";
import { planDay, type PlanDayDeps } from "./plan-day.ts";
import { showPlan } from "./plan-view.ts";
import { saveSearchResult, type SaveSearchResultDeps } from "./save-search-result.ts";
import { sandboxQueue } from "./sandbox-queue.ts";
import { declareTimeBudget } from "./time-budget.ts";
import { searchWeb, type WebSearchDeps } from "./web-search.ts";
import { explainPriority } from "./why-prioritized.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { ChatStore } from "../adapters/chat-store.ts";
import type { MemoryItemStore } from "../adapters/memory-item-store.ts";
import type { LogEntry } from "../adapters/logger.ts";
import type { AnthropicMessagesClient } from "../adapters/llm-adapter.ts";
import { getPlan, hasOpenProposalOfKind, putOpenInteractionRequest, withdrawRuleProposal, type MemoryStore } from "../adapters/memory-store.ts";
import { buildMemoryForgetQuestion } from "../core/open-item-questions.ts";
import type { MemoryContext } from "../core/memory-context.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import type { ChatStreamEvent, ChatTurnRequest, ChatTurnResponse, MorningViewResponse } from "../types/api.ts";
import type { CalendarEvent, ChatTurn, ExternalId, IsoDate, MemoryItem, PlanBlock, Result, Task, YohError } from "../types/domain.ts";

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

/** A reshuffle request that can't be honored carries its plain reason as a validation failure; chat says it as a reply. */
function rejectedRequestReply(error: YohError): Result<ChatTurnResponse, YohError> | undefined {
  return error.kind === "validation" ? { ok: true, value: { reply: error.message, receipts: [] } } : undefined;
}

const NO_PLAN_TODAY_REPLY = "There's no Plan for today yet. Say \"plan my day\" to make one.";

export interface ChatTurnDeps extends CreateItemDeps, CalendarEditDeps, WebSearchDeps, SaveSearchResultDeps {
  /** Pre-bound read helper for the tool loop (`app/chat-agent.ts`). Absent in a test that never reaches the loop's memory tool. */
  readonly agentSearchMemory?: ChatAgentDeps["searchMemory"];
  readonly store: MemoryStore;
  /** Server-owned chat history (Story 13.1); absent -> the model sees only the current message. */
  readonly chatHistory?: ChatStore;
  /** Versioned memory (Story 13.4); absent -> memory commands answer "Couldn't reach memory right now." */
  readonly memoryItems?: MemoryItemStore;
  /** Set by `chatExchange` for the inner turn: the Conversation and Spencer's stored turn. */
  readonly turn?: { readonly conversationId: string; readonly userTurnId: string };
  /** Test/fixture seam for the memory filer's Haiku call; defaults to `llmClient`. */
  readonly memoryLlmClient?: AnthropicMessagesClient;
  readonly timeZone: string;
  readonly now: () => Date;
  readonly readTasks: () => Promise<readonly Task[]>;
  readonly llmClient: AnthropicMessagesClient;
  readonly session: ChatSession;
  readonly emit?: (event: ChatStreamEvent) => void;
  /** Story 8.7 (FR-41): threaded through to `/night`'s exclusion rule (`app/night-close-out.ts`). */
  readonly getCompletedTaskIdsToday: () => ReadonlySet<ExternalId>;
  /**
   * Real-use fixes plan, Task 1 ("plan my day on demand"): threaded through
   * to `app/plan-day.ts`'s `planDay`, which runs the SAME
   * `rituals/morning-ritual.ts` pipeline the 6am cron uses. Optional — a
   * test/CLI that never dispatches `/plan` or "plan my day" need not stub
   * it, mirroring `MorningRitualDeps`'s own optional seam. Deliberately NOT
   * a `sendNotification`-shaped field: `planDay` hardcodes that to a no-op
   * itself, so there is no seam here through which a push could ever be
   * wired back in (Spencer, 2026-09-27 — see `plan-day.ts`'s own doc
   * comment). `bumpLevels` isn't threaded here at all — `planDay` computes
   * it itself from `store`, fresh on every call (see `plan-day.ts`'s own
   * doc comment for why a long-running server process can't just capture
   * it once).
   */
  readonly writeCalendarPlan?: (blocks: readonly PlanBlock[]) => Promise<unknown>;
  readonly log?: (entry: LogEntry) => void;
  /**
   * Real-use fixes plan, Task 5 ("what's happening tomorrow"):
   * `adapters/calendar-adapter.ts`'s `readCalendarEvents`, pre-bound to its
   * client/timeZone, taking the target date Task 5's `CalendarAdapterConfig.date`
   * added — threaded through to `app/day-view.ts`'s `dayView`. Distinct
   * from `readCalendarEventsFn` above (which always reads TODAY, for
   * `app/calendar-edit.ts`'s own overlap check) rather than widening that
   * existing field's shape.
   */
  readonly readCalendarEventsForDate: (date: IsoDate) => Promise<readonly CalendarEvent[]>;
}

/**
 * Builds `app/plan-day.ts`'s `PlanDayDeps` from `ChatTurnDeps` — the one
 * field-name remap this needs: `MorningRitualDeps`/`PlanDayDeps` call the
 * Calendar read seam `readCalendarEvents`, while `ChatTurnDeps` (via
 * `CalendarEditDeps`) already calls the identical function
 * `readCalendarEventsFn` — reused as-is here rather than adding a second,
 * differently-named required field to `ChatTurnDeps` for the same
 * capability.
 */
function planDayDepsFrom(deps: ChatTurnDeps): PlanDayDeps {
  return {
    store: deps.store,
    session: deps.session,
    llmClient: deps.llmClient,
    timeZone: deps.timeZone,
    now: deps.now,
    readTasks: deps.readTasks,
    readCalendarEvents: deps.readCalendarEventsFn,
    ...(deps.writeCalendarPlan ? { writeCalendarPlan: deps.writeCalendarPlan } : {}),
    ...(deps.log ? { log: deps.log } : {}),
  };
}

/**
 * Trims `history` to at most `MAX_CHAT_HISTORY_TURNS`, removing complete
 * `[user, assistant]` pairs from the front — see that constant's own doc
 * comment for why pairs, not a bare slice.
 *
 * Story 8.6 (Task 7): that pair-stepping alone assumes STRICT
 * `[user, assistant, user, assistant, ...]` alternation from index 0, which
 * a long-lived transcript can quietly violate — `web/`'s `chatStore.ts`
 * leaves out any turn with empty content (a reply that streamed to "" and
 * failed), so ONE dropped turn shifts every later turn's role one slot out
 * of phase with its array position. In a rare case (40+ turns plus one such
 * gap), the pair-stepped `start` can land squarely on an `assistant` turn,
 * which the Messages API rejects outright. So after trimming, this also
 * drops any further LEADING `assistant` turn(s) — the history handed
 * onward always starts with `user`, regardless of how the array's roles
 * happened to land.
 */
function trimHistory(history: readonly ChatTurn[]): readonly ChatTurn[] {
  let start = 0;
  while (history.length - start > MAX_CHAT_HISTORY_TURNS) start += 2;
  let trimmed = start === 0 ? history : history.slice(start);
  while (trimmed.length > 0 && trimmed[0]!.role === "assistant") trimmed = trimmed.slice(1);
  return trimmed;
}

function emitStatus(deps: ChatTurnDeps, text: string): void {
  deps.emit?.({ type: "status", text });
}

/**
 * Calls `proposeCalendarEdit` and applies its own "empty fall-through"
 * convention (`app/calendar-edit.ts`'s doc comment): `{reply: "", receipts:
 * [], question: undefined}` means the line only LOOKED like a calendar edit
 * (the LLM draft came back NONE), not a real error or a real confirm
 * question. Returns `undefined` for exactly that shape so both call sites
 * below (the deterministic `isCalendarEditCommand` branch and the tool
 * loop) fall through to the next dispatch step identically, rather than ever handing Spencer back a blank reply.
 */
async function tryCalendarCreate(deps: ChatTurnDeps, line: string, today: IsoDate): Promise<Result<ChatTurnResponse, YohError> | undefined> {
  const result = await proposeCalendarEdit(deps, { line, today });
  if (!result.ok) return result;
  const isEmptyFallThrough = result.value.reply === "" && result.value.receipts.length === 0 && result.value.question === undefined;
  return isEmptyFallThrough ? undefined : result;
}

/**
 * Records `message` into `deps.session.recentMessages` — FR-25's small
 * bounded window of Spencer's own recent (non-blank) chat lines
 * (`app/surface-open-items.ts`'s inference reads it). Moved here from
 * `chat-cli.ts`'s main loop, which used to push every non-blank line before
 * any dispatch check ran; as of Story 8.4, EVERY line `chat-cli.ts` reads —
 * including a save-search-result/create-item/calendar-edit/search line, now
 * that all four route through `chatTurn` too — is recorded here, since
 * `chat-cli.ts` no longer intercepts any of them before calling `chatTurn`.
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
 * why-prioritized), then falls through to the `chatAgent` tool loop as the
 * sole, unconditional fallback.
 */
/** Marks an OK result as a substantive turn (Story 13.11): only `chatExchange` reads it, to decide on a rating prompt. */
function substantive(result: Result<ChatTurnResponse, YohError>): Result<ChatTurnResponse, YohError> {
  return result.ok ? { ok: true, value: { ...result.value, substantive: true } } : result;
}

export async function chatTurn(deps: ChatTurnDeps, input: ChatTurnRequest): Promise<Result<ChatTurnResponse, YohError>> {
  const reachedLlm = { value: false };
  const result = await routeChatTurn(deps, input, reachedLlm);
  // Story 13.5: a turn answered before any LLM classification step is "handled deterministically" (no automatic memory filing).
  if (result.ok && !reachedLlm.value) return { ok: true, value: { ...result.value, handledDeterministically: true } };
  return result;
}

async function routeChatTurn(
  deps: ChatTurnDeps,
  input: ChatTurnRequest,
  reachedLlm: { value: boolean },
): Promise<Result<ChatTurnResponse, YohError>> {
  recordRecentMessage(deps, input.message);
  emitStatus(deps, STATUS_THINKING);

  const line = input.message.trim();
  if (line.startsWith("/")) {
    return dispatchSlashCommand(deps, line);
  }

  // Story 13.4: memory commands are deterministic and sit before every LLM step.
  const memoryCommand = recognizeMemoryCommand(line);
  if (memoryCommand) return runMemoryCommand(deps, memoryCommand);

  // M6 (final-review): the explicit "search:" prefix — what Research Hub's
  // ask box always sends — is checked here, at the very top, next to the
  // slash-command check and before every other deterministic recognizer
  // (including create-item just below). Without this, "search: add a new
  // task in notion via api" matched `parseCreateItemCommand` and opened a
  // create-item draft instead of searching, contradicting "Research Hub
  // always searches". `parseSearchIntent` still does the actual parsing
  // (prefix stripped, query = the rest); this is just an ordering fix.
  if (/^search:/i.test(line)) {
    const explicitSearchIntent = parseSearchIntent(line);
    if (explicitSearchIntent) return substantive(await searchWeb(deps, { query: explicitSearchIntent.query }));
  }

  const timeBudgetCommand = parseTimeBudgetCommand(input.message);
  if (timeBudgetCommand) {
    const result = await declareTimeBudget({ store: deps.store, timeZone: deps.timeZone, now: deps.now }, timeBudgetCommand);
    if (!result.ok) return result;
    return { ok: true, value: { reply: result.value.receipt, receipts: [] } };
  }

  if (isPlanViewCommand(input.message)) {
    return showPlan({ store: deps.store, timeZone: deps.timeZone, now: deps.now }, {});
  }

  // Real-use fixes plan, Task 1: checked right after Plan-VIEW so the two
  // never race each other — `isPlanViewCommand`'s bare "plan"/"show my
  // plan" and `isPlanDayCommand`'s "plan my day"/"plan today" never match
  // the same line (pinned by `tests/chat-commands.test.ts`), so ordering
  // between them doesn't actually matter, but grouping the two Plan
  // commands together keeps the dispatch chain readable.
  if (isPlanDayCommand(input.message)) {
    emitStatus(deps, STATUS_CHECKING_TASKS);
    return substantive(await planDay(planDayDepsFrom(deps), {}));
  }

  if (isMidDayReflowCommand(input.message)) {
    emitStatus(deps, STATUS_CHECKING_TASKS);
    if (!getPlan(deps.store, localIsoDate(deps.now(), deps.timeZone))) {
      return { ok: true, value: { reply: NO_PLAN_TODAY_REPLY, receipts: [] } };
    }
    const requested = await requestReshuffle(
      { store: deps.store, timeZone: deps.timeZone, now: deps.now, readTasks: deps.readTasks, readCalendarEvents: deps.readCalendarEventsFn },
      { request: { kind: "reflow-now" } },
    );
    if (!requested.ok) return rejectedRequestReply(requested.error) ?? requested;
    return {
      ok: true,
      value: {
        reply: `${requested.value.proposal.suggested.summary} Approve to apply it, or discard to keep today's Plan as it is.`,
        receipts: [],
        question: requested.value.question,
        substantive: true,
      },
    };
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

  // Real-use fixes plan, Task 5 ("what's happening tomorrow"): checked
  // deterministically among the planning recognizers above, right after
  // why-prioritized — `parseDayViewCommand` (core/chat-commands.ts) only
  // ever matches a line that OPENS with a Calendar-query verb ("what's
  // happening"/"what do I have"/"what's on"), so it never collides with
  // `isCalendarEditCommand`'s own move/reschedule/create verbs (checked
  // later, below) or the cancel/delete/remove/clear verbs (which now reach
  // the tool loop) — "move my 3pm tomorrow to 4" and "cancel my meeting
  // with Alex tomorrow" both start with a verb this recognizer never
  // matches at all. `isPlanViewCommand`'s bare "plan"/"what's my plan" is
  // ALSO never reached here even in principle, since it's checked earlier
  // above and already returns before this line runs. A match here still
  // costs zero LLM calls: `resolveRelativeDate` is the same pure,
  // deterministic resolver Tasks 2/3 already use, not a model call — only a
  // genuinely resolvable trailing phrase (a real "today"/"tomorrow"/
  // weekday/month-day/ISO date) reaches `dayView`'s own Calendar read; an
  // unresolvable phrase (e.g. "what's on your mind") falls through to the
  // next recognizer exactly like a non-match here.
  const dayViewPhrase = parseDayViewCommand(input.message);
  if (dayViewPhrase !== undefined) {
    const resolvedDate = resolveRelativeDate(dayViewPhrase, { now: deps.now(), timeZone: deps.timeZone });
    if (resolvedDate !== undefined) {
      return dayView(
        { store: deps.store, timeZone: deps.timeZone, now: deps.now, readCalendarEventsForDate: deps.readCalendarEventsForDate },
        { date: resolvedDate },
      );
    }
  }

  // Story 8.4 — checked in the SAME order chat-cli.ts's loop used before
  // this story (F6, Epic 6 retro): save-search-result BEFORE create-item,
  // because its own looser Notion-mention trigger also matches "save"/
  // "file" verbs (e.g. "save that to my notion research vault" must file
  // the search result, not open a create-item draft).
  if (isSaveSearchResultCommand(input.message)) return saveSearchResult(deps, {});

  const createItemCommand = parseCreateItemCommand(input.message);
  if (createItemCommand) {
    const drafted = await tryDraftItem(deps, { ...createItemCommand, ...(await recallFor(deps, createItemCommand.request)) });
    if (!drafted.ok) return drafted;
    // `undefined`: no draft could be built from the line, so the tool loop handles it.
    if (drafted.value !== undefined) return { ok: true, value: drafted.value };
  }

  // Epic 10 (10.3, R8): routine declarations — before the plan-edit reply.
  const routineCommand = parseRoutineCommand(input.message);
  if (routineCommand) {
    if (!deps.connection) {
      return { ok: true, value: { reply: "I can't save routines right now.", receipts: [] } };
    }
    const routineResult = await manageRoutine({ connection: deps.connection }, routineCommand);
    if (!routineResult.ok) return routineResult;
    if (routineResult.value.handled) return { ok: true, value: { reply: routineResult.value.reply, receipts: [] } };
  }

  // Epic 10 (T7, R9): plan edits resolve deterministically, then preview as Approve/Discard.
  const planEdit = parsePlanEditCommand(input.message);
  if (planEdit) {
    const today = localIsoDate(deps.now(), deps.timeZone);
    const stored = getPlan(deps.store, today);
    if (!stored) {
      // "move my 3pm to 4" is a calendar edit when there's no Plan to move within.
      if (planEdit.kind !== "move") return { ok: true, value: { reply: NO_PLAN_TODAY_REPLY, receipts: [] } };
    } else {
      let tasks: readonly Task[] = [];
      let lunchEnd: string | undefined;
      try {
        if (planEdit.kind !== "move") tasks = (await deps.readTasks()).filter(isOpenTask);
        if (planEdit.when?.kind === "after-lunch") {
          const school = computeSchoolDayInputs(await deps.readCalendarEventsFn(), today, deps.timeZone, deps.store.withDb(readPlanningSettings));
          if (school.ok) lunchEnd = school.value.protectedWindows.find((w) => w.id.startsWith("school-protected:lunch:"))?.end;
        }
      } catch (err) {
        return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err), detail: err } };
      }
      const resolved = resolvePlanEdit(planEdit, {
        date: today,
        timeZone: deps.timeZone,
        nowMs: deps.now().getTime(),
        blocks: stored.data.blocks,
        tasks: tasks.map((t) => ({ id: t.id, title: t.title })),
        ...(lunchEnd !== undefined ? { lunchEnd } : {}),
      });
      if (resolved.kind === "reply") return { ok: true, value: { reply: resolved.reply, receipts: [] } };
      if (resolved.kind === "request") {
        emitStatus(deps, STATUS_CHECKING_TASKS);
        const requested = await requestReshuffle(
          { store: deps.store, timeZone: deps.timeZone, now: deps.now, readTasks: deps.readTasks, readCalendarEvents: deps.readCalendarEventsFn },
          { request: resolved.request },
        );
        if (!requested.ok) return rejectedRequestReply(requested.error) ?? requested;
        return {
          ok: true,
          value: {
            reply: `${requested.value.proposal.suggested.summary} Approve to apply it, or discard to keep today's Plan as it is.`,
            receipts: [],
            question: requested.value.question,
            substantive: true,
          },
        };
      }
    }
  }

  if (isPlanEditRequest(input.message)) {
    return { ok: true, value: { reply: PLAN_EDIT_HOW_TO_REPLY, receipts: [] } };
  }

  if (isCalendarEditCommand(input.message)) {
    const today = localIsoDate(deps.now(), deps.timeZone);
    const calendarResult = await tryCalendarCreate(deps, input.message, today);
    if (calendarResult) return calendarResult;
    // else: not actually a calendar edit ("move on to the next topic"),
    // or no draft could be built — fall through to the tool loop below.
  }

  // A deterministic, zero-model-call pre-check (`core/search-intent.ts`),
  // after every recognizer above and before the tool loop: a search-shaped
  // line goes straight to searchWeb.
  const searchIntent = parseSearchIntent(input.message);
  if (searchIntent) return substantive(await searchWeb(deps, { query: searchIntent.query }));

  // A bare yes/no while a change set is open has no typed path: the card is the only way to answer it.
  if (parseProposalAnswer(input.message) !== undefined && hasOpenProposalOfKind(deps.store, CHANGE_SET_PROPOSAL_KIND)) {
    return { ok: true, value: { reply: CHANGE_SET_USE_CARD_REPLY, receipts: [] } };
  }

  return runAgent(deps, input, reachedLlm);
}

/** The final step of routing: the tool loop. Everything no deterministic recognizer handled ends here. */
async function runAgent(deps: ChatTurnDeps, input: ChatTurnRequest, reachedLlm: { value: boolean }): Promise<Result<ChatTurnResponse, YohError>> {
  reachedLlm.value = true;
  // chatAgent emits its own "Searching the web…" status, so searchWeb runs without `emit`.
  const { emit: _emit, ...depsWithoutEmit } = deps;
  const searchWebForModel: ChatAgentDeps["searchWeb"] = async (query) => {
    const found = await searchWeb(depsWithoutEmit, { query });
    return found.ok ? { ok: true, value: { text: found.value.reply } } : found;
  };
  const recall = await recallFor(deps, input.message);
  return chatAgent(
    {
      llmClient: deps.llmClient,
      store: deps.store,
      ...(deps.connection ? { connection: deps.connection } : {}),
      timeZone: deps.timeZone,
      now: deps.now,
      readTasks: deps.readTasks,
      readCalendarEventsForDate: deps.readCalendarEventsForDate,
      searchMemory: deps.agentSearchMemory ?? (async () => ({ ok: true, value: { text: "Memory search isn't available right now." } })),
      searchWeb: searchWebForModel,
      ...(deps.emit ? { emit: deps.emit } : {}),
      ...(deps.log ? { log: deps.log } : {}),
    },
    {
      message: input.message,
      history: trimHistory(historyForModel(deps, input.message)),
      systemPrompt: resolveToneSystemPrompt(input.message, deps.webSearchAvailable ?? true, COMMANDS),
      ...recall,
    },
  );
}

/** Story 13.6: what Yoh remembers for this request, as `{ memory }` to spread into a draft or answer input; empty when the store is absent or down. */
async function recallFor(deps: ChatTurnDeps, requestText: string): Promise<{ memory?: MemoryContext }> {
  const recalled = await recallMemoryContext(deps, { requestText });
  return recalled.ok && recalled.value ? { memory: recalled.value.context } : {};
}

/** Joins consecutive same-role turns (an orphaned user turn from a failed exchange) so roles strictly alternate. */
function mergeSameRoleRuns(turns: readonly ChatTurn[]): readonly ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    const prev = out[out.length - 1];
    if (prev && prev.role === t.role) out[out.length - 1] = { role: prev.role, content: `${prev.content}\n\n${t.content}` };
    else out.push(t);
  }
  return out;
}

/** Today's stored turns (the last `MAX_CHAT_HISTORY_TURNS`), or just the current message when the store is absent or fails. */
function historyForModel(deps: ChatTurnDeps, message: string): readonly ChatTurn[] {
  const fallback: readonly ChatTurn[] = [{ role: "user", content: message }];
  if (!deps.chatHistory) return fallback;
  try {
    const turns = deps.chatHistory.turnsForDate(localIsoDate(deps.now(), deps.timeZone), MAX_CHAT_HISTORY_TURNS);
    const mapped: ChatTurn[] = turns.filter((t) => t.text.trim() !== "").map((t) => ({ role: t.role, content: t.text }));
    // The list must end with the current message: a failed user-turn write or a midnight rollover between write and read can leave it out.
    const last = mapped[mapped.length - 1];
    if (!last || last.role !== "user" || last.content !== message) mapped.push({ role: "user", content: message });
    return mergeSameRoleRuns(mapped);
  } catch (error) {
    deps.log?.({ level: "warn", event: "chat-turn.history-read-failed", detail: error instanceof Error ? error.message : String(error) });
    return fallback;
  }
}

/**
 * Story 8.7 (FR-42, UX-DR38): the ONE place a `/`-prefixed line resolves
 * against `commands.ts`'s registry — checked BEFORE every other recognizer,
 * so a slash line never falls through to Time Budget/Plan-view/etc. Matching
 * is case-insensitive, and a trailing word after the command name (e.g.
 * "/morning please") is ignored. An unknown command gets a neutral reply
 * listing every real command, never an error (AC).
 */
async function dispatchSlashCommand(deps: ChatTurnDeps, line: string): Promise<Result<ChatTurnResponse, YohError>> {
  const [name, ...rest] = line.split(/\s+/);
  const args = rest.join(" ");
  const match = COMMANDS.find((c) => c.name.toLowerCase() === name?.toLowerCase());
  if (!match) {
    const list = COMMANDS.map((c) => `${c.name} — ${c.description}`).join("\n");
    return { ok: true, value: { reply: `No command named "${name}".\n\nAvailable commands:\n${list}`, receipts: [] } };
  }
  switch (match.name) {
    case "/morning": {
      const result = await morningView(deps, {});
      if (!result.ok) return result;
      return { ok: true, value: { reply: formatMorningView(result.value), receipts: [], substantive: true, ...(result.value.patternQuestion ? { question: result.value.patternQuestion } : {}) } };
    }
    case "/night":
      return substantive(await startNightCloseOut(deps, {}));
    case "/plan":
      return substantive(await planDay(planDayDepsFrom(deps), {}));
    case "/sandbox": {
      const queue = await sandboxQueue(deps, { withOptions: true });
      if (!queue.ok) return queue;
      const card = firstCardView(queue.value.items, queue.value.options);
      if (!card) return { ok: true, value: { reply: "Nothing's missing a Due Date or Duration.", receipts: [] } };
      return { ok: true, value: { reply: "", receipts: [], sandboxCard: card } };
    }
    case "/remember":
    case "/forget": {
      const command = parseSlashMemoryCommand(match.name, args);
      if (!command) return { ok: true, value: { reply: `Say what to remember, like ${match.example}.`, receipts: [] } };
      return runMemoryCommand(deps, command);
    }
    default:
      // Unreachable while COMMANDS lists only /morning and /night — a
      // future epic's registry entry gets its own `case` when that story
      // lands.
      return { ok: true, value: { reply: `"${match.name}" isn't wired up yet.`, receipts: [] } };
  }
}

/**
 * `/morning`'s plain formatter — an unexported helper, exempt from AD-16's
 * `app/*.ts` export-shape rule since it's neither exported nor
 * `(deps, input) => Promise<Result<...>>`. Embeds only an open item's
 * `promptText` (Review Focus #4) — never a raw `proposal` object, even when
 * one is pending on a suggest-question.
 */
function formatMorningView(view: MorningViewResponse): string {
  if (!view.plan) return 'No Plan yet today. Type /plan (or say "plan my day") and I\'ll build it now.';
  const openItemsLine =
    view.openItems.length === 0
      ? "Nothing else open."
      : `${view.openItems.length} open item${view.openItems.length === 1 ? "" : "s"}: ` + view.openItems.map((i) => i.promptText).join("; ");
  return [view.plan.text, "", view.plan.reasoning, "", openItemsLine].filter((l) => l.length > 0).join("\n");
}

const MEMORY_UNREACHABLE_REPLY = "Couldn't reach memory right now.";

function reply(text: string, extra: Partial<ChatTurnResponse> = {}): Result<ChatTurnResponse, YohError> {
  return { ok: true, value: { reply: text, receipts: [], ...extra } };
}

/**
 * Story 13.4: a recognized memory command. `chatTurn` never files (E2): "remember"
 * only directs `chatExchange` (`memory`), which files after `done`. A store failure
 * is logged and answered; it never blocks the turn.
 */
function runMemoryCommand(deps: ChatTurnDeps, command: MemoryCommand): Result<ChatTurnResponse, YohError> {
  if (command.kind === "remember") return reply("Got it.", { memory: { kind: "remember", text: command.text } });
  const store = deps.memoryItems;
  if (!store) return reply(MEMORY_UNREACHABLE_REPLY);
  try {
    if (command.kind === "recall") return recallMemory(store, command.topic);
    return forgetMemory(deps, store, command.words);
  } catch (error) {
    deps.log?.({ level: "warn", event: "chat-turn.memory-command-failed", detail: error instanceof Error ? error.message : String(error) });
    return reply(MEMORY_UNREACHABLE_REPLY);
  }
}

function recallMemory(store: MemoryItemStore, topic: string): Result<ChatTurnResponse, YohError> {
  const items = store.searchRelevant(topic, MEMORY_FOLDERS_IN_ORDER, 20);
  if (items.length === 0) return reply(`Nothing in memory matches '${topic}'.`);
  const sections = MEMORY_FOLDERS_IN_ORDER.flatMap((folder) => {
    const inFolder = items.filter((i) => i.folder === folder);
    return inFolder.length === 0 ? [] : [`${memoryFolderLabel(folder)}\n${inFolder.map((i) => `- [${i.text.replace(/[\[\]]/g, "\\$&")}](#memory-item-${i.id})`).join("\n")}`];
  });
  return reply(sections.join("\n\n"));
}

function forgetMemory(deps: ChatTurnDeps, store: MemoryItemStore, words: string): Result<ChatTurnResponse, YohError> {
  let targets: MemoryItem[];
  if (words === "") {
    const receipt = deps.turn ? store.latestReceipt(deps.turn.conversationId, "remembered") : undefined;
    targets = (receipt?.itemIds ?? []).flatMap((id) => {
      const item = store.getItem(id);
      return item && item.status === "current" ? [item] : [];
    });
    if (targets.length === 0) return reply("Nothing to forget yet.");
  } else {
    targets = store.searchRelevant(words, MEMORY_FOLDERS_IN_ORDER, 10);
    if (targets.length === 0) return reply(`Nothing in memory matches '${words}'.`);
    if (targets.length > 1) {
      const requestId = `memory-forget:${randomUUID()}`;
      const promptText = `Which one should I forget for '${words}'?`;
      putOpenInteractionRequest(deps.store, requestId, {
        requestKind: "memory-forget",
        promptText,
        detail: { itemIds: targets.map((i) => i.id) },
        createdAt: deps.now().toISOString(),
      });
      const question = buildMemoryForgetQuestion(
        requestId,
        promptText,
        targets.map((i) => ({ id: i.id, label: `${i.text} \u00b7 ${memoryFolderLabel(i.folder)}` })),
      );
      return reply(`Several items match '${words}'.`, { question });
    }
  }
  const chainIds = targets.flatMap((item) => store.forget(item.id).chainIds);
  // A forgotten item can no longer be changed into a planning rule: close its open rule-change card.
  if (deps.store) for (const id of chainIds) withdrawRuleProposal(deps.store, id);
  const receipt = {
    receiptId: randomUUID(),
    kind: "forgot" as const,
    items: targets.map((i) => ({
      id: i.id,
      text: i.text,
      folder: i.folder,
      ...(i.scope !== undefined ? { scope: i.scope } : {}),
      ...(i.expiresOn !== undefined ? { expiresOn: i.expiresOn } : {}),
    })),
  };
  if (deps.turn) {
    store.putReceipt({
      receiptId: receipt.receiptId,
      conversationId: deps.turn.conversationId,
      userTurnId: deps.turn.userTurnId,
      kind: "forgot",
      itemIds: targets.map((i) => i.id),
      chainIds,
      createdAt: deps.now().toISOString(),
    });
  }
  return reply("Done.", { memory: { kind: "forgot", receipt, chainIds } });
}
