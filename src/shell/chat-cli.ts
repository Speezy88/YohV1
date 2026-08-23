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
 * showed. Later tasks (19, 22, 23) still extend this file with Mid-Day
 * Re-Flow triggers, Blocker reports, and free-text routing via
 * `llm-adapter.ts` (Task 13) — none of that exists yet.
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
import type { MissingFieldReport } from "../core/data-completeness-gate.ts";
import { shapeDeclaredTimeBudget } from "../core/time-budget.ts";
import { DATA_COMPLETENESS_REQUEST_ID, PLANNING_FIELD_LABELS } from "../rituals/data-completeness.ts";
import { ACCENT, renderPlan, RESET } from "../rituals/morning-ritual.ts";
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
 * NOT real free-text NLU. Task 13 replaces this with real LLM-based routing
 * without changing this task's observable behavior: declaring "6 hours"
 * persists a 360-minute budget for today regardless of how the command
 * arrives at that parsed value.
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

/** Today's calendar date, ISO-8601 (`YYYY-MM-DD`), per the Consistency Conventions — Spencer's declaration is always "for today." */
function currentIsoDate(): IsoDate {
  return new Date().toISOString().slice(0, 10);
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
 * replaces this with real LLM-based intent routing without changing this
 * task's observable behavior.
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

/**
 * The minimal REPL loop (Task 5, extended by Task 6): on start, and before
 * processing every subsequent line of input, surfaces any open interaction
 * request(s) first (AD-5). Then checks whether the line is a Time Budget
 * declare/change command (`parseTimeBudgetCommand`) and, if so, validates
 * and persists it (`declareTimeBudget`) rather than falling through to the
 * free-text placeholder. Real free-text NLU/LLM routing for everything else
 * (what an "unrelated command" actually does) is Task 13.
 */
export async function runChatCli(store: MemoryStore, io: ChatCliIo): Promise<void> {
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
      const result = declareTimeBudget(store, timeBudgetCommand.totalMinutes, currentIsoDate());
      if (result.ok) {
        io.writeLine(`Got it — today's Time Budget is set to ${formatMinutesForDisplay(result.value.data.totalMinutes)}.`);
      } else {
        io.writeLine(`I couldn't set that Time Budget: ${result.error.message}`);
      }
      continue;
    }

    if (isPlanViewCommand(line)) {
      showPlanCommand(store, io, currentIsoDate());
      continue;
    }

    io.writeLine("(free-text routing arrives in a later task — nothing to do with that yet)");
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

/** Real entrypoint: wires a real `MemoryStore` (per `MEMORY_DB_PATH`, defaulting to `./data/yoh-memory.db` — same default `.env.example` documents) to real stdin/stdout, and runs the REPL loop. Accepts an injectable `env` map (mirroring `token-store.ts`'s `loadGoogleOAuthConfigFromEnv`) so tests never need to mutate real `process.env`. */
export async function main(env: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  const databasePath = env["MEMORY_DB_PATH"] || "./data/yoh-memory.db";
  const store = createMemoryStore({ databasePath });
  const io = createNodeIo();
  try {
    await runChatCli(store, io);
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
