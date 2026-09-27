/**
 * src/app/blocker-report.ts
 *
 * Story 8.3 (AD-16). Moved from `shell/chat-cli.ts`'s `blockerReportCommand`.
 * Unlike plan-view/mid-day-reflow, `buildBlockerConfirmationLine`'s output
 * is already a fixed plain sentence with no color option — nothing to strip
 * here.
 *
 * Calls `app/mid-day-reflow.ts`'s `runReflow` wrapper (with
 * `blockerReported: true`), never `rituals/mid-day-reflow.ts`'s own core
 * re-flow function directly (Controller ruling) — that keeps this file from
 * naming that function's identifier at all, so
 * `tests/mid-day-reflow.test.ts`'s structural "sole caller" check still
 * finds exactly one file, `app/mid-day-reflow.ts`.
 */
import { runReflow, type MidDayReflowAppDeps } from "./mid-day-reflow.ts";
import { buildBlockerConfirmationLine } from "../rituals/mid-day-reflow.ts";
import type { ChatTurnResponse } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";

/**
 * Answers a Blocker report: reschedules immediately (per AD-3, no
 * confirmation gate) and returns ONLY a single confirmation line, per
 * UX-DR12 — never the fuller multi-line UX-DR11 rendering `reflowDay` uses.
 * No suggestions for resolving the underlying obstacle, no commentary or
 * judgment.
 */
export async function reportBlocker(
  deps: MidDayReflowAppDeps,
  _input: Record<string, never>,
): Promise<Result<ChatTurnResponse, YohError>> {
  const result = await runReflow(deps, { blockerReported: true });

  if (!result.ok) {
    return { ok: false, error: { kind: result.error.kind, message: `I couldn't reschedule around that: ${result.error.message}` } };
  }

  switch (result.value.status) {
    case "no-plan-today":
      return { ok: true, value: { reply: "There's no Plan for today yet to reschedule.", receipts: [] } };
    case "nothing-to-reflow":
      return { ok: true, value: { reply: "Nothing needed rescheduling.", receipts: [] } };
    case "reflowed":
      return { ok: true, value: { reply: buildBlockerConfirmationLine(result.value), receipts: [] } };
  }
}
