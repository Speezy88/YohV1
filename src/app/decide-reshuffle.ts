/**
 * src/app/decide-reshuffle.ts
 *
 * Approve or discard the open reshuffle preview by proposal id, for the
 * HTTP routes. Looks the stored proposal up, then hands off to
 * `approveReshuffle` / `discardReshuffle`.
 */
import { listOpenReshuffleProposals } from "../adapters/reshuffle-proposal-store.ts";
import { toReshufflePreviewView } from "../core/reshuffle-preview.ts";
import { toFixedBlocks } from "../core/calendar-blocks.ts";
import { requestReshuffle, type RequestReshuffleDeps } from "./request-reshuffle.ts";
import { approveReshuffle, discardReshuffle, type ApproveReshuffleDeps } from "./approve-reshuffle.ts";
import type { ReshuffleApproveResponse, ReshuffleResponse, ReshuffleDecisionRequest, ReshuffleDiscardResponse } from "../types/api.ts";
import type { ReshuffleRequest, Result, YohError } from "../types/domain.ts";

const EXPIRED_COPY = "That preview expired. Ask again or drag the block again.";

export async function approveReshuffleById(
  deps: ApproveReshuffleDeps,
  input: ReshuffleDecisionRequest,
): Promise<Result<ReshuffleApproveResponse, YohError>> {
  const open = listOpenReshuffleProposals(deps.store).find((o) => o.proposal.id === input.proposalId);
  if (!open) return { ok: false, error: { kind: "stale-proposal", message: EXPIRED_COPY } };
  const result = await approveReshuffle(deps, { proposal: open.proposal, requestId: open.requestId });
  if (!result.ok) return result;
  if (result.value.status === "applied") return { ok: true, value: { status: "applied", calendarFailedBlockIds: result.value.calendarFailedBlockIds } };
  const recomputed = result.value;
  const nowMs = deps.now().getTime();
  const fixed = await fixedBlocksNow(deps);
  const fresh = listOpenReshuffleProposals(deps.store).find((o) => o.requestId === recomputed.question.requestId);
  const preview = fresh
    ? toReshufflePreviewView(fresh.proposal, fixed, nowMs)
    : toReshufflePreviewView({ ...open.proposal, suggested: recomputed.preview }, fixed, nowMs);
  return { ok: true, value: { status: "recomputed", preview, question: result.value.question } };
}

export async function discardReshuffleById(
  deps: Pick<ApproveReshuffleDeps, "store">,
  input: ReshuffleDecisionRequest,
): Promise<Result<ReshuffleDiscardResponse, YohError>> {
  const open = listOpenReshuffleProposals(deps.store).find((o) => o.proposal.id === input.proposalId);
  if (!open) return { ok: true, value: { discarded: true } };
  return discardReshuffle({ store: deps.store }, { proposal: open.proposal, requestId: open.requestId });
}

async function fixedBlocksNow(deps: RequestReshuffleDeps) {
  const nowMs = deps.now().getTime();
  try {
    return toFixedBlocks(await deps.readCalendarEvents(), nowMs);
  } catch {
    return []; // The preview still renders its own blocks without the fixed events.
  }
}

/** Opens a reshuffle preview and returns it with its Approve / Discard question. */
export async function requestReshuffleView(
  deps: RequestReshuffleDeps,
  input: ReshuffleRequest,
): Promise<Result<ReshuffleResponse, YohError>> {
  const result = await requestReshuffle(deps, { request: input });
  if (!result.ok) return result;
  const preview = toReshufflePreviewView(result.value.proposal, await fixedBlocksNow(deps), deps.now().getTime());
  return { ok: true, value: { preview, question: result.value.question } };
}
