/**
 * src/app/why-prioritized.ts
 *
 * Story 8.3 (AD-16). Moved from `shell/chat-cli.ts`'s `whyPrioritizedCommand`.
 * Adds a `readTasks()` try/catch chat-cli.ts's original call site never
 * had — compelled by AD-8/the `app/` layer's own rule that it must catch
 * adapter throws and convert them to `Result`.
 */
import { getSlipHistory, type MemoryStore } from "../adapters/memory-store.ts";
import { computeSlipBumpLevel } from "../core/slip-bump.ts";
import type { ChatTurnResponse } from "../types/api.ts";
import type { Result, Task, YohError } from "../types/domain.ts";

export interface WhyPrioritizedDeps {
  readonly store: MemoryStore;
  readonly readTasks: () => Promise<readonly Task[]>;
}

export interface ExplainPriorityInput {
  readonly taskName: string;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Answers a Slip-Bump lineage-view request (UX-DR19): finds the named Task
 * (case-insensitive exact match on title — a documented starting heuristic)
 * among `deps.readTasks()`'s result, then shows its current Slip-Bump
 * lineage — its consecutive-slip count, most recent slip date, and the
 * resulting bump level/cap status from `core/slip-bump.ts`'s
 * `computeSlipBumpLevel` (AD-6).
 *
 * A Task with no stored `SlipHistory` (never slipped, or its history was
 * cleared on completion) is reported as having no Slip-Bump applied, rather
 * than a bump level of a bare `0` with no explanation. A name that matches
 * no Task says so plainly rather than silently doing nothing.
 */
export async function explainPriority(
  deps: WhyPrioritizedDeps,
  input: ExplainPriorityInput,
): Promise<Result<ChatTurnResponse, YohError>> {
  let tasks: readonly Task[];
  try {
    tasks = await deps.readTasks();
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: `I couldn't check why that's prioritized: ${describeError(err)}` } };
  }

  const normalized = input.taskName.trim().toLowerCase();
  const task = tasks.find((t) => t.title.trim().toLowerCase() === normalized);
  if (!task) {
    return { ok: true, value: { reply: `I couldn't find a Task named "${input.taskName}".`, receipts: [] } };
  }

  const history = getSlipHistory(deps.store, task.id);
  if (!history || history.data.consecutiveSlipCount <= 0) {
    return { ok: true, value: { reply: `"${task.title}" hasn't slipped recently — no Slip-Bump applied.`, receipts: [] } };
  }

  const { consecutiveSlipCount, lastSlipDate } = history.data;
  const level = computeSlipBumpLevel(consecutiveSlipCount);
  const dayWord = consecutiveSlipCount === 1 ? "day" : "days";
  const capNote = level.atCap ? " — at its Slip-Bump cap" : "";
  return {
    ok: true,
    value: {
      reply: `"${task.title}" has slipped ${consecutiveSlipCount} consecutive ${dayWord} (last slipped ${lastSlipDate}) — current Slip-Bump level ${level.value}${capNote}.`,
      receipts: [],
    },
  };
}
