/**
 * src/app/night-close-out.ts
 *
 * Story 8.7 (FR-12–FR-14, AD-5 Phase 2): `/night`'s entry point. Ensures
 * tonight's `night-close-out` interaction request exists — reusing it
 * untouched if `night-prompt` (or an earlier `/night` turn) already opened
 * it for TODAY, building it fresh (excluding Tasks `completion-log.ts`
 * already shows completed today, Story 7.9/FR-41) otherwise — and returns
 * its first pending question. Every subsequent answer goes through
 * `app/answer-open-item.ts`'s `answerOpenItem` → `answer-night-close-out.ts`'s
 * `answerNightCloseOut`, exactly like any other open item; this file's only
 * job is making sure there IS one to answer.
 */
import { getPlan, putOpenInteractionRequest, type MemoryStore } from "../adapters/memory-store.ts";
import {
  buildNightCloseOutPromptText,
  collectNightCloseOutTasks,
  isNightCloseOutRequestOpenFor,
  NIGHT_CLOSE_OUT_REQUEST_ID,
  type NightCloseOutRequestDetail,
} from "../rituals/night-ritual.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import { surfaceOpenItems, type SurfaceOpenItemsDeps } from "./surface-open-items.ts";
import type { ChatTurnResponse } from "../types/api.ts";
import type { ExternalId, InteractionRequest, Result, YohError } from "../types/domain.ts";

export interface NightCloseOutDeps extends SurfaceOpenItemsDeps {
  readonly store: MemoryStore;
  readonly now: () => Date;
  readonly timeZone: string;
  /**
   * Story 7.9 (FR-41): excludes Tasks already completed today — the same
   * seam `NightPromptRitualDeps` has. A throw is caught (a local SQLite
   * hiccup must not block the close-out) and treated as "nothing
   * completed" rather than blocking the close-out.
   */
  readonly getCompletedTaskIdsToday: () => ReadonlySet<ExternalId>;
}

/** `/night`'s entry point (C3): ensures tonight's close-out request exists and returns its first question. */
export async function startNightCloseOut(deps: NightCloseOutDeps, _input: Record<string, never>): Promise<Result<ChatTurnResponse, YohError>> {
  const today = localIsoDate(deps.now(), deps.timeZone);

  if (!isNightCloseOutRequestOpenFor(deps.store, today)) {
    const plan = getPlan(deps.store, today);
    if (!plan) {
      return { ok: true, value: { reply: "No Plan has been generated for today yet — nothing to close out.", receipts: [] } };
    }

    let completedToday: ReadonlySet<ExternalId>;
    try {
      completedToday = deps.getCompletedTaskIdsToday();
    } catch {
      completedToday = new Set(); // fail closed: nothing excluded, close-out still proceeds.
    }

    const tasks = collectNightCloseOutTasks(plan.data, completedToday);
    if (tasks.length === 0) {
      return { ok: true, value: { reply: "Nothing to close out — every Task from today's Plan is already accounted for.", receipts: [] } };
    }

    const request: InteractionRequest<NightCloseOutRequestDetail> = {
      requestKind: "night-close-out",
      promptText: buildNightCloseOutPromptText(tasks),
      detail: { date: today, tasks },
      createdAt: deps.now().toISOString(),
    };
    putOpenInteractionRequest(deps.store, NIGHT_CLOSE_OUT_REQUEST_ID, request);
  }

  const openItems = await surfaceOpenItems(deps, {});
  if (!openItems.ok) return openItems;
  const item = openItems.value.items.find((i) => i.requestKind === "night-close-out");
  if (!item) {
    // A genuine, narrow race: the request was answered/cleared between the
    // check above and this read. Report plainly rather than throw — the
    // next `/night` (or the ritual) tries again.
    return { ok: true, value: { reply: "Tonight's close-out is already handled.", receipts: [] } };
  }
  return { ok: true, value: { reply: "", receipts: [], question: item.question } };
}
