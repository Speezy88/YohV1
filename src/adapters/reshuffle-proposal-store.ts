/**
 * src/adapters/reshuffle-proposal-store.ts
 *
 * Read-only lookup of the open `reshuffle` proposals held as interaction
 * requests. Requesting, approving and discarding stay in `app/`.
 */
import { listOpenInteractionRequests, type MemoryStore } from "./memory-store.ts";
import type { Proposal, ReshufflePreview } from "../types/domain.ts";

export interface OpenReshuffleProposal {
  readonly requestId: string;
  readonly requestVersion: number;
  readonly proposal: Proposal<ReshufflePreview>;
}

export function listOpenReshuffleProposals(store: MemoryStore): OpenReshuffleProposal[] {
  const found: OpenReshuffleProposal[] = [];
  for (const record of listOpenInteractionRequests(store)) {
    if (record.data.requestKind !== "proposal") continue;
    const stored = (record.data.detail as { readonly proposal?: Proposal<unknown> } | undefined)?.proposal;
    if (stored?.kind === "reshuffle") {
      found.push({ requestId: record.id, requestVersion: record.version, proposal: stored as Proposal<ReshufflePreview> });
    }
  }
  return found;
}
