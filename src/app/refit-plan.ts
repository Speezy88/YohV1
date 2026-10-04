/**
 * src/app/refit-plan.ts
 *
 * "Re-fit the rest of today" as one step for a chat change set: preview a
 * `reflow-now` reshuffle, then approve it. A change set the user already
 * confirmed is the approval, so no reshuffle card is left open beside it.
 */
import { clearInteractionRequest, getOpenInteractionRequest } from "../adapters/memory-store.ts";
import type { MemoryStore } from "../adapters/memory-store.ts";
import { approveReshuffle, type ApproveReshuffleDeps } from "./approve-reshuffle.ts";
import { requestReshuffle } from "./request-reshuffle.ts";
import type { Result, YohError } from "../types/domain.ts";

export type RefitPlanDeps = ApproveReshuffleDeps;

function clearRequest(store: MemoryStore, requestId: string): void {
  try {
    const current = getOpenInteractionRequest(store, requestId);
    if (current) clearInteractionRequest(store, requestId, current.version);
  } catch {
    // A failed clear is retried when the request expires; it must not mask the real outcome.
  }
}

export async function refitPlan(deps: RefitPlanDeps, _input: Record<string, never>): Promise<Result<{ reply: string }, YohError>> {
  const requested = await requestReshuffle(deps, { request: { kind: "reflow-now" } });
  if (!requested.ok) return requested;
  const requestId = requested.value.question.requestId;
  const approved = await approveReshuffle(deps, { proposal: requested.value.proposal, requestId });
  if (approved.ok && approved.value.status === "applied") {
    const summary = requested.value.proposal.suggested.summary;
    // Same sentence the reshuffle approve path gives when some calendar blocks failed to sync.
    const reply = approved.value.calendarFailedBlockIds.length > 0 ? `${summary} Your Plan is updated, but I couldn't update your calendar for some blocks.` : summary;
    return { ok: true, value: { reply } };
  }
  clearRequest(deps.store, requestId);
  if (!approved.ok) return approved;
  if (approved.value.status === "recomputed") clearRequest(deps.store, approved.value.question.requestId);
  return { ok: false, error: { kind: "validation", message: "Your Plan or Calendar changed while I was re-fitting, so I left the Plan as it was." } };
}
