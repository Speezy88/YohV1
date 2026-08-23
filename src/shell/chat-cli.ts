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
 * Known scope limitation (Task 5, documented rather than silently glossed
 * over): once Spencer answers a Data-Completeness prompt, this file only
 * performs the mechanical "clear the interaction request" half of the
 * persist/surface/clear cycle. Actually applying the answered value back
 * onto the Task isn't built yet — there is no field-override store, and per
 * AD-12 `notion-adapter.ts`'s write surface is Status-only, so a non-Status
 * field can't be written back to Notion at all. A later task (real free-text
 * NLU is Task 13) is expected to add that application step on top of this
 * same surface/clear mechanism.
 */
import { createInterface } from "node:readline";
import {
  clearInteractionRequest,
  createMemoryStore,
  getOpenInteractionRequest,
  listOpenInteractionRequests,
  putOpenInteractionRequest,
  type MemoryStore,
} from "../adapters/memory-store.ts";
import { checkDataCompleteness, type MissingFieldReport } from "../core/data-completeness-gate.ts";
import type { InteractionRequest, PlanningFieldNames, Task } from "../types/domain.ts";

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
// syncDataCompletenessInteractionRequest — thin gate -> memory-store wiring
// ============================================================================

/** The fixed, singleton `id` the Data-Completeness Gate's open interaction request is stored under (so multiple incomplete Tasks collapse into one request, per UX-DR10, rather than one row per Task). */
export const DATA_COMPLETENESS_REQUEST_ID = "data-completeness";

/**
 * Runs the pure Data-Completeness Gate over `tasks`, then persists or
 * clears the single combined `"data-completeness"` interaction request in
 * `memory-store.ts` to match — the wiring the gate itself is forbidden from
 * doing (AD-2/AD-11: the gate must stay pure). This is a thin orchestration
 * function living in `shell/` per the Task 5 brief's Implementer note (a
 * `rituals/*.ts` file would be the more natural home once one exists for
 * this concern, but none is owned by this task).
 *
 * - Every Task complete, no request currently open: no-op.
 * - Every Task complete, a request WAS open (Spencer answered the missing
 *   field(s) and the gate re-ran with an updated Task): the request is
 *   cleared — Story 1.5's "the interaction request is cleared" criterion.
 * - Any Task incomplete: the request is opened (or replaced, if one is
 *   already open with stale content) naming exactly the missing field(s) on
 *   exactly the Tasks that have them.
 */
export function syncDataCompletenessInteractionRequest(store: MemoryStore, tasks: readonly Task[]): void {
  const result = checkDataCompleteness(tasks);
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
 * Surfaces every currently open interaction request, one at a time, each
 * blocking for Spencer's answer before moving to the next — AD-5's "an open
 * confirmation blocks the chat flow rather than queuing silently alongside
 * something else." There is no timeout anywhere in this loop (UX-DR20):
 * `io.readLine` is awaited indefinitely, and a blank answer re-prompts
 * rather than clearing the request or giving up.
 *
 * At this stage (Task 5 — see module docstring's scope-limitation note),
 * clearing a request is purely mechanical: any non-empty answer clears it.
 * Returns once no interaction request remains open, or once `io.readLine`
 * reports EOF (stdin closed) — whichever comes first.
 */
export async function surfaceOpenInteractionRequests(store: MemoryStore, io: ChatCliIo): Promise<void> {
  for (;;) {
    const open = listOpenInteractionRequests(store);
    if (open.length === 0) return;
    const next = open[0]!;

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
