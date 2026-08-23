/**
 * src/shell/chat-cli.ts
 *
 * The single on-demand REPL entry point (AD-5), and — per that same AD —
 * "the only place an open interaction request or open `Proposal` gets
 * resolved." Task 5 (Story 1.5) builds only enough of it to establish the
 * prompt-surfacing pattern AD-5/UX-DR20 require: on start, and before
 * accepting any unrelated input, it surfaces every currently open
 * interaction request from `memory-store.ts`, blocking indefinitely (no
 * timeout — UX-DR20) until each is answered. Later tasks (11, 19, 22, 23)
 * extend this file with on-demand Plan viewing, Mid-Day Re-Flow triggers,
 * Blocker reports, Time Budget changes, and free-text routing via
 * `llm-adapter.ts` (Task 13) — none of that exists yet.
 *
 * Per AD-1, this shell file contains no core/ritual logic itself: the pure
 * gate logic lives in `core/data-completeness-gate.ts`, and
 * `syncDataCompletenessInteractionRequest` below is the thin
 * gate-output-to-memory-store wiring the Task 5 brief's Implementer note
 * calls for (the gate itself must stay pure/I-O-free per AD-2/AD-11, so this
 * wiring — reading the gate's `Result`, then persisting or clearing an
 * `InteractionRequest` — happens here rather than in the gate).
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
 * override-merge step lives here (`shell/`), not inside
 * `data-completeness-gate.ts`, per AD-2 — the gate stays pure and must not
 * read `memory-store.ts` itself.
 */
import { createInterface } from "node:readline";
import {
  clearInteractionRequest,
  createMemoryStore,
  getOpenInteractionRequest,
  getTaskFieldOverride,
  listOpenInteractionRequests,
  mergeTaskFieldOverride,
  putOpenInteractionRequest,
  type MemoryStore,
  type StoredRecord,
} from "../adapters/memory-store.ts";
import { checkDataCompleteness, type MissingFieldReport } from "../core/data-completeness-gate.ts";
import type { InteractionRequest, PlanningFieldNames, Task, TaskFieldOverride } from "../types/domain.ts";

// ============================================================================
// Rendering constants (UX-DR1, UX-DR5, DESIGN.md's `colors.accent: '#5FAFFF'`)
// ============================================================================

/** 24-bit ANSI truecolor escape for DESIGN.md's `colors.accent` (#5FAFFF) — the "accent-colored prompt line" Story 1.5's acceptance criteria and UX-DR5 require. */
const ACCENT = "\x1b[38;2;95;175;255m";
const RESET = "\x1b[0m";

/** Human-readable labels for `PlanningFieldNames`, used only in prompt text — the gate itself (`core/data-completeness-gate.ts`) stays presentation-agnostic per its Implementer note. */
const PLANNING_FIELD_LABELS: Record<PlanningFieldNames, string> = {
  estimatedDurationMinutes: "Estimated Duration",
  area: "Area",
  dueDate: "Due Date",
  status: "Status",
  energy: "Energy",
};

// ============================================================================
// buildMissingFieldsPromptText — pure prompt-text formatting
// ============================================================================

/**
 * Turns the gate's `MissingFieldReport[]` into the single combined prompt
 * text UX-DR10 requires: "one prompt may cover multiple missing fields
 * across multiple Tasks if needed" — never a bulk "clean up your whole
 * database" request, and never one prompt per Task. Pure/no I/O; the caller
 * (`surfaceOpenInteractionRequests`, below) applies the accent-color
 * wrapping when actually printing it.
 */
export function buildMissingFieldsPromptText(incomplete: readonly MissingFieldReport[]): string {
  const subject = incomplete.length === 1 ? "this Task" : "these Tasks";
  const lines = incomplete.map((report) => {
    const fields = report.missingFields.map((field) => PLANNING_FIELD_LABELS[field]).join(", ");
    return `  - "${report.taskTitle}": ${fields}`;
  });
  return [`I need a bit more before I can plan around ${subject}:`, ...lines].join("\n");
}

// ============================================================================
// TaskFieldOverride merging — the answer-application half of the cycle
// ============================================================================

/**
 * Merges a `TaskFieldOverride` onto `task`: every field the override sets
 * wins; every field it leaves unset keeps `task`'s own value (which may
 * itself still be `undefined`, if Spencer hasn't answered that one yet).
 * Pure — no I/O — but lives here rather than in `core/data-completeness-gate.ts`
 * per AD-2/the fix's own direction: the gate must not read `memory-store.ts`,
 * so it cannot know about overrides itself. The result is still a plain
 * `Task`, never a `CompleteTask` — AD-11 holds: only
 * `checkDataCompleteness` may produce a `CompleteTask`, and it's still the
 * next call to it (in `syncDataCompletenessInteractionRequest`, below) that
 * does so once every field is present, merged or otherwise.
 */
export function applyTaskFieldOverride(task: Task, override: TaskFieldOverride | undefined): Task {
  if (!override) return task;
  // `override`'s fields are typed as present-or-absent (not
  // present-with-possible-undefined) under `exactOptionalPropertyTypes`, so
  // spreading it after `task` only ever overwrites a field with a real
  // value, never with an explicit `undefined` — the cast documents that
  // runtime guarantee to the type checker, mirroring
  // `data-completeness-gate.ts`'s own `toCompleteTask` cast.
  return { ...task, ...override } as Task;
}

/**
 * Merges each Task's own stored `TaskFieldOverride` (if any) from
 * `memory-store.ts` onto it, returning the merged Task list — the
 * "caller-side merge step" the Task 5 fix calls for, applied before handing
 * Tasks to the gate. A Task with no stored override is returned unchanged.
 */
export function mergeStoredOverrides(store: MemoryStore, tasks: readonly Task[]): Task[] {
  return tasks.map((task) => applyTaskFieldOverride(task, getTaskFieldOverride(store, task.id)?.data));
}

// ============================================================================
// syncDataCompletenessInteractionRequest — thin gate -> memory-store wiring
// ============================================================================

/** The fixed, singleton `id` the Data-Completeness Gate's open interaction request is stored under (so multiple incomplete Tasks collapse into one request, per UX-DR10, rather than one row per Task). */
export const DATA_COMPLETENESS_REQUEST_ID = "data-completeness";

/**
 * Merges any stored `TaskFieldOverride`s onto `tasks` (so a
 * previously-answered field actually counts), then runs the pure
 * Data-Completeness Gate over the result, then persists or clears the
 * single combined `"data-completeness"` interaction request in
 * `memory-store.ts` to match — the wiring the gate itself is forbidden from
 * doing (AD-2/AD-11: the gate must stay pure). This is a thin orchestration
 * function living in `shell/` per the Task 5 brief's Implementer note (a
 * `rituals/*.ts` file would be the more natural home once one exists for
 * this concern, but none is owned by this task).
 *
 * - Every (merged) Task complete, no request currently open: no-op.
 * - Every (merged) Task complete, a request WAS open (Spencer answered the
 *   missing field(s), the override was stored, and the gate re-ran with the
 *   merged Task): the request is cleared — Story 1.5's "the interaction
 *   request is cleared" criterion.
 * - Any (merged) Task still incomplete: the request is opened (or replaced,
 *   if one is already open with stale content) naming exactly the missing
 *   field(s) on exactly the Tasks that have them.
 */
export function syncDataCompletenessInteractionRequest(store: MemoryStore, tasks: readonly Task[]): void {
  const merged = mergeStoredOverrides(store, tasks);
  const result = checkDataCompleteness(merged);
  if (!result.ok) {
    // A malformed candidate set (currently: duplicate Task ids) — not a
    // per-Task missing-field case this function can meaningfully turn into
    // a prompt. Surfacing this as a thrown error matches AD-8's rule that
    // only `core/*.ts` must never throw; this file is `shell/`.
    throw new Error(`chat-cli: data-completeness-gate rejected the candidate Task set: ${result.error.message}`);
  }

  const existing = getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID);

  if (result.value.incomplete.length === 0) {
    if (existing) {
      clearInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID, existing.version);
    }
    return;
  }

  const request: InteractionRequest<{ incomplete: readonly MissingFieldReport[] }> = {
    requestKind: "data-completeness",
    promptText: buildMissingFieldsPromptText(result.value.incomplete),
    detail: { incomplete: result.value.incomplete },
    createdAt: new Date().toISOString(),
  };
  putOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID, request);
}

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

/**
 * The minimal REPL loop (Task 5): on start, and before processing every
 * subsequent line of input, surfaces any open interaction request(s) first
 * (AD-5). Free-text NLU/LLM routing (what an "unrelated command" actually
 * does) is Task 13 — this loop only acknowledges other input for now, per
 * the Task 5 brief's "does not need real free-text NLU/LLM routing yet".
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
