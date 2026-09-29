/**
 * src/app/approve-reshuffle.ts
 *
 * Applies or discards the one open reshuffle preview. Approve re-reads the
 * stored Plan and the live calendar; if either moved on (or the preview
 * expired) it recomputes instead of writing. Otherwise it writes the Plan,
 * the `plan` hint and the request clear in ONE transaction, then syncs the
 * Yoh Plan calendar through the narrow `writeCalendarPlan` seam and says so
 * plainly when any block failed. Discard clears the request and nothing else.
 */
import {
  clearInteractionRequestInTx,
  getOpenInteractionRequest,
  getPlan,
  PLAN_TOPIC,
  putPlan,
  clearInteractionRequest,
  ConflictError,
  type MemoryStore,
} from "../adapters/memory-store.ts";
import { appendOutboxInTx, createNotificationInTx } from "../adapters/notification-store.ts";
import { replaceDayPinsAndDropsInTx } from "../adapters/plan-state-store.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { calendarVersionHash, isProposalExpired } from "../core/reshuffle-preview.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import { requestReshuffle, type RequestReshuffleDeps } from "./request-reshuffle.ts";
import type { OpenItemQuestion } from "../types/api.ts";
import type { CalendarEvent, PlanBlock, Proposal, ReshufflePreview, Result, YohError } from "../types/domain.ts";

export interface ApproveReshuffleDeps extends RequestReshuffleDeps {
  readonly store: MemoryStore;
  readonly connection: SqliteConnection;
  /** `writeTodaysPlanToCalendar`, pre-bound. Receives only non-anchor blocks; returns per-block outcome. */
  readonly writeCalendarPlan?: (blocks: readonly PlanBlock[]) => Promise<{ readonly written: readonly string[]; readonly failed: readonly string[] }>;
}

export interface ApproveReshuffleInput {
  readonly proposal: Proposal<ReshufflePreview>;
  /** The open interaction request to clear (`proposal:<id>` when omitted). */
  readonly requestId?: string;
}

export type ApproveReshuffleOutput =
  | { readonly status: "recomputed"; readonly preview: ReshufflePreview; readonly question: OpenItemQuestion }
  | { readonly status: "applied"; readonly calendarFailedBlockIds: readonly string[] };

function clearRequest(store: MemoryStore, requestId: string): void {
  const current = getOpenInteractionRequest(store, requestId);
  if (current) clearInteractionRequest(store, requestId, current.version);
}

async function recompute(
  deps: ApproveReshuffleDeps,
  proposal: Proposal<ReshufflePreview>,
  requestId: string,
): Promise<Result<ApproveReshuffleOutput, YohError>> {
  const fresh = await requestReshuffle(deps, { request: proposal.suggested.request });
  if (!fresh.ok) {
    try {
      clearRequest(deps.store, requestId);
    } catch {
      // The old preview is already unusable; a failed clear is retried on the next request.
    }
    return fresh;
  }
  return { ok: true, value: { status: "recomputed", preview: fresh.value.proposal.suggested, question: fresh.value.question } };
}

export async function approveReshuffle(
  deps: ApproveReshuffleDeps,
  input: ApproveReshuffleInput,
): Promise<Result<ApproveReshuffleOutput, YohError>> {
  const { proposal } = input;
  const requestId = input.requestId ?? `proposal:${proposal.id}`;
  const preview = proposal.suggested;
  const nowDate = deps.now();
  const today = localIsoDate(nowDate, deps.timeZone);

  let events: readonly CalendarEvent[];
  try {
    events = await deps.readCalendarEvents();
  } catch (err) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(err), detail: err } };
  }

  const stored = getPlan(deps.store, today);
  const stale =
    isProposalExpired(proposal.createdAt, nowDate) ||
    preview.date !== today ||
    !stored ||
    stored.data.version !== preview.planVersion ||
    calendarVersionHash(events) !== preview.calendarVersion;
  if (stale || !stored) return recompute(deps, proposal, requestId);

  if (preview.rejectedReason !== undefined) {
    return { ok: false, error: { kind: "validation", message: preview.rejectedReason } };
  }

  const nowIso = nowDate.toISOString();
  const nextPlan = { ...stored.data, blocks: preview.blocks, version: stored.data.version + 1, updatedAt: nowIso };
  try {
    putPlan(deps.store, nextPlan, (db) => {
      replaceDayPinsAndDropsInTx(db, today, preview.pins, preview.drops);
      appendOutboxInTx(db, { topic: PLAN_TOPIC, entityId: today });
      clearInteractionRequestInTx(db, requestId);
    });
  } catch (err) {
    if (err instanceof ConflictError) return recompute(deps, proposal, requestId);
    return { ok: false, error: { kind: "conflict", message: errorCopyForThrown(err), detail: err } };
  }

  const toSync = preview.blocks.filter((b) => b.kind !== "calendar-anchor");
  let failedIds: readonly string[] = [];
  if (deps.writeCalendarPlan) {
    try {
      failedIds = (await deps.writeCalendarPlan(toSync)).failed;
    } catch {
      failedIds = toSync.map((b) => b.id);
    }
  }
  if (failedIds.length > 0) {
    const body = "Your Plan is updated, but I couldn't update your calendar for some blocks. Open Home to see the current Plan.";
    try {
      deps.connection.writeTx((db) =>
        createNotificationInTx(db, {
          kind: "reshuffle-apply-failed",
          title: "Couldn't update your calendar",
          body,
          deepLink: "home",
          createdAt: nowIso,
        }),
      );
    } catch {
      // The failed ids are still returned to the caller.
    }
  }
  return { ok: true, value: { status: "applied", calendarFailedBlockIds: failedIds } };
}

/** Discard: clears the request. Nothing else is written. */
export async function discardReshuffle(
  deps: { readonly store: MemoryStore },
  input: ApproveReshuffleInput,
): Promise<Result<{ readonly discarded: true }, YohError>> {
  try {
    clearRequest(deps.store, input.requestId ?? `proposal:${input.proposal.id}`);
  } catch (err) {
    return { ok: false, error: { kind: "conflict", message: errorCopyForThrown(err), detail: err } };
  }
  return { ok: true, value: { discarded: true } };
}
