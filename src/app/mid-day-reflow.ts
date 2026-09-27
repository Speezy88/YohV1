/**
 * src/app/mid-day-reflow.ts
 *
 * Story 8.3 (AD-16). Moved from `shell/chat-cli.ts`'s `midDayReflowCommand`.
 * Forces `color: false` on the `runMidDayReflow` call — `ChatTurnResponse
 * .reply` is pinned ANSI-free (C2), so the on-demand Mid-Day Re-Flow view
 * loses its terminal color as a result (accepted per this story's plan).
 *
 * Also exports `runReflow` (Controller ruling): the ONE call site for
 * `rituals/mid-day-reflow.ts`'s `runMidDayReflow` in all of `src/`.
 * `app/blocker-report.ts`'s `reportBlocker` calls this wrapper too (with
 * `blockerReported: true`) rather than importing the ritual itself, so
 * `tests/mid-day-reflow.test.ts`'s structural "sole caller" check still has
 * a single, meaningful file to name.
 */
import { errorCopy } from "../core/error-copy.ts";
import { runMidDayReflow, type MidDayReflowOutcome } from "../rituals/mid-day-reflow.ts";
import type { MemoryStore } from "../adapters/memory-store.ts";
import type { ChatTurnResponse } from "../types/api.ts";
import type { Result, Task, YohError } from "../types/domain.ts";

export interface MidDayReflowAppDeps {
  readonly store: MemoryStore;
  readonly timeZone: string;
  readonly now: () => Date;
  readonly readTasks: () => Promise<readonly Task[]>;
}

export interface RunReflowInput {
  readonly blockerReported?: boolean;
}

/**
 * The one call site for `rituals/mid-day-reflow.ts`'s `runMidDayReflow` in
 * all of `src/` — `reflowDay` (below) and `app/blocker-report.ts`'s
 * `reportBlocker` both call this instead of importing the ritual directly.
 */
export async function runReflow(
  deps: MidDayReflowAppDeps,
  input: RunReflowInput,
): Promise<Result<MidDayReflowOutcome, YohError>> {
  return runMidDayReflow({
    store: deps.store,
    readTasks: deps.readTasks,
    now: deps.now,
    timeZone: deps.timeZone,
    color: false,
    ...(input.blockerReported !== undefined ? { blockerReported: input.blockerReported } : {}),
  });
}

/**
 * Answers a Mid-Day Re-Flow trigger. Per UX-DR11, a successful re-flow
 * returns ONLY `outcome.rendered` — the short, remainder-only block that
 * function already built — never the whole day's Plan again.
 */
export async function reflowDay(
  deps: MidDayReflowAppDeps,
  _input: Record<string, never>,
): Promise<Result<ChatTurnResponse, YohError>> {
  const result = await runReflow(deps, {});

  if (!result.ok) {
    return { ok: false, error: { kind: result.error.kind, message: errorCopy(result.error) } };
  }

  switch (result.value.status) {
    case "no-plan-today":
      return { ok: true, value: { reply: "There's no Plan for today yet to re-flow.", receipts: [] } };
    case "nothing-to-reflow":
      return { ok: true, value: { reply: "Nothing left to re-flow — everything remaining is already accounted for.", receipts: [] } };
    case "reflowed":
      return { ok: true, value: { reply: result.value.rendered, receipts: [] } };
  }
}
