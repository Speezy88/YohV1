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
  createMemoryStore,
  getOpenInteractionRequest,
  getPlan,
  listOpenInteractionRequests,
  mergeTaskFieldOverride,
  putTimeBudget,
  type MemoryStore,
  type StoredRecord,
} from "../adapters/memory-store.ts";
import {
  answerGeneralQuestion,
  createAnthropicMessagesClient,
  loadLlmAdapterConfigFromEnv,
  type AnthropicMessagesClient,
} from "../adapters/llm-adapter.ts";
import { readNotionTasks } from "../adapters/notion-adapter.ts";
import type { MissingFieldReport } from "../core/data-completeness-gate.ts";
import { shapeDeclaredTimeBudget } from "../core/time-budget.ts";
import { resolveToneSystemPrompt } from "../core/tone.ts";
import { DATA_COMPLETENESS_REQUEST_ID, PLANNING_FIELD_LABELS } from "../rituals/data-completeness.ts";
import { buildBlockerConfirmationLine, runMidDayReflow } from "../rituals/mid-day-reflow.ts";
import { ACCENT, localIsoDate, renderPlan, RESET } from "../rituals/morning-ritual.ts";
import type {
  InteractionRequest,
  IsoDate,
  PlanningFieldNames,
  Result,
  Task,
  TaskFieldOverride,
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

/**
 * Answers the single combined `"data-completeness"` interaction request:
 * shows its (already-built) combined prompt line, then asks one follow-up
 * question per missing field per Task named in its `detail.incomplete`
 * payload, in order. Each answer is parsed via `parseFieldAnswer` and, once
 * valid, immediately persisted as a `TaskFieldOverride`
 * (`mergeTaskFieldOverride`) — so a later field's answer isn't lost even if
 * stdin closes partway through. An unparseable or blank answer re-prompts
 * the SAME question indefinitely (UX-DR20) rather than skipping it or
 * storing anything.
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
): Promise<boolean> {
  const detail = record.data.detail as { readonly incomplete?: readonly MissingFieldReport[] } | undefined;
  const incomplete = detail?.incomplete ?? [];

  io.writeLine(`${ACCENT}${record.data.promptText}${RESET}`);

  for (const report of incomplete) {
    for (const field of report.missingFields) {
      for (;;) {
        const label = PLANNING_FIELD_LABELS[field];
        const answer = await io.readLine(`  ${report.taskTitle} — ${label}: `);
        if (answer === null) return false; // stdin closed mid-answer.
        if (answer.trim().length === 0) continue; // wait indefinitely (UX-DR20): re-ask, don't skip.

        const parsed = parseFieldAnswer(field, answer);
        if (!parsed.ok) {
          io.writeLine(parsed.message);
          continue; // re-ask the SAME question — an unparseable answer is not an answer.
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
 * answer, persist it as a `TaskFieldOverride`, only then clear). Any other
 * open request (a future Night close-out / Self-Check / Proposal prompt,
 * none of which exist yet) falls back to the purely mechanical
 * surface-then-clear-on-any-non-empty-answer behavior this file established
 * before the fix — a later task is expected to add its own typed
 * answer-application step the same way this file now does for
 * data-completeness.
 *
 * Returns once no interaction request remains open, or once `io.readLine`
 * reports EOF (stdin closed) — whichever comes first.
 */
export async function surfaceOpenInteractionRequests(store: MemoryStore, io: ChatCliIo): Promise<void> {
  for (;;) {
    const open = listOpenInteractionRequests(store);
    if (open.length === 0) return;
    const next = open[0]!;

    if (next.id === DATA_COMPLETENESS_REQUEST_ID && next.data.requestKind === "data-completeness") {
      const resolved = await answerDataCompletenessRequest(store, io, next);
      if (!resolved) return; // EOF mid-answer.
      continue;
    }

    io.writeLine(`${ACCENT}${next.data.promptText}${RESET}`);
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
 * already uses. It's OPTIONAL (unlike `store`/`io`/`timeZone`/`llmClient`)
 * so every pre-Task-15 test call site above keeps compiling unchanged; its
 * default throws only if a test that never exercises the Mid-Day Re-Flow
 * command somehow reaches it anyway, which would itself be a bug worth
 * surfacing loudly rather than silently. The real entrypoint (`main`,
 * below) always supplies a real one.
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
): Promise<void> {
  await surfaceOpenInteractionRequests(store, io);

  for (;;) {
    const line = await io.readLine("yoh> ");
    if (line === null) return;

    // Re-check before processing anything else — a ritual running
    // concurrently (AD-10) may have opened a new interaction request since
    // the last check.
    await surfaceOpenInteractionRequests(store, io);

    if (line.trim().length === 0) continue;

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

    try {
      const response = await answerGeneralQuestion(llmClient, line, resolveToneSystemPrompt(line));
      io.writeLine(response);
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
    return (await readNotionTasks(notionClient, { tasksDataSourceId, projectsDataSourceId })).tasks;
  };
  try {
    await runChatCli(store, io, timeZone, llmClient, () => new Date(), readTasks);
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
