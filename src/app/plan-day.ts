/**
 * src/app/plan-day.ts
 *
 * Real-use fixes plan, Task 1: "Plan my day on demand" — `/plan` and the
 * "plan my day" family of chat phrasings (`core/chat-commands.ts`'s
 * `isPlanDayCommand`). Spencer's app never had a Plan on a day he opened it
 * late, because nothing could generate one on demand — the 6am cron
 * (`rituals/morning-ritual.ts` via `shell/ritual-cli.ts`) was the only
 * caller. This file is the second one.
 *
 * `planDay` runs the exact same `runMorningRitual` pipeline the 6am cron
 * triggers — same Data-Completeness Gate, Derived Priority ordering,
 * Work/Break fitting, reasoning line, and Yoh-Plan Calendar write. The ONLY
 * difference from a real cron run is `sendNotification`, which this file
 * hardcodes to a no-op: an on-demand run never sends a Pushover push
 * (Spencer, 2026-09-27 — the morning Plan reaches him in the app only; see
 * `shell/ritual-cli/morning-deps.ts`'s own `sendNotification`, already a
 * no-op for the 6am cron run too, for the same reason). `PlanDayDeps` names
 * no notification-capable dependency at all (mirrors `app/morning-view.ts`'s
 * own "structurally cannot" guarantee), so there is no seam through which a
 * push could even accidentally be wired back in — pinned by
 * `tests/plan-day.test.ts`.
 *
 * ----------------------------------------------------------------------------
 * Idempotence with the 6am cron, and the dead-man's-switch
 * ----------------------------------------------------------------------------
 *
 * `runMorningRitual`'s own idempotence guard (the `"morning"` ritual-run
 * marker, `MORNING_RITUAL_ID`) is the ONE source of truth for "has today's
 * Plan already been built." Whichever caller — this on-demand run, or the
 * 6am cron via `shell/ritual-cli.ts` — reaches it FIRST on a given host-TZ
 * day wins: it builds and persists the Plan and writes the marker; every
 * later caller that same day (cron or another `/plan`) gets
 * `"already-ran"`, with no second Plan and no second push. This file adds
 * its own cheap `getPlan` pre-check purely so a REPEAT `/plan` the same day
 * — the overwhelmingly common case, Spencer asking twice — never re-reads
 * Notion/Calendar at all; it does not change that guarantee, which
 * `runMorningRitual` already provides on its own (exercised directly by
 * `tests/plan-day.test.ts`'s own cron-interaction test, with no pre-check
 * involved).
 *
 * The dead-man's-switch (`shell/ritual-cli.ts`'s `RitualInvocation` marker,
 * checked by `checkDailyRitualMissedRun`) is untouched by this file on
 * purpose. That marker is written only by `runRitualCli`'s
 * `withFailureAlert` wrapper, around the CRON entry point — never by
 * `runMorningRitual` itself — and `planDay` calls `runMorningRitual`
 * directly, never through `ritual-cli.ts`. So an on-demand run can neither
 * fake a missed cron invocation as "seen" nor be mistaken for one: the
 * dead-man's-switch keeps measuring only whether the REAL cron trigger is
 * still firing, exactly as before this file existed.
 */
import { getPlan, listSlipHistories, type MemoryStore } from "../adapters/memory-store.ts";
import type { LogEntry } from "../adapters/logger.ts";
import { runMorningRitual } from "../rituals/morning-ritual.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import { errorCopy } from "../core/error-copy.ts";
import { computeSlipBumpLevels } from "../core/slip-bump.ts";
import { surfaceOpenItems, type SurfaceOpenItemsDeps } from "./surface-open-items.ts";
import type { ChatTurnResponse, OpenItem } from "../types/api.ts";
import type { CalendarEvent, ExternalId, Plan, PlanBlock, Result, Task, YohError } from "../types/domain.ts";

export interface PlanDayDeps extends SurfaceOpenItemsDeps {
  readonly store: MemoryStore;
  readonly timeZone: string;
  readonly now: () => Date;
  /** `adapters/notion-adapter.ts`'s `readNotionTasks`, pre-bound. Throws on I/O failure (AD-8) — `runMorningRitual` catches it. */
  readonly readTasks: () => Promise<readonly Task[]>;
  /** `adapters/calendar-adapter.ts`'s `readCalendarEvents`, pre-bound. Throws on I/O failure (AD-8) — `runMorningRitual` catches it. */
  readonly readCalendarEvents: () => Promise<readonly CalendarEvent[]>;
  /** `adapters/calendar-adapter.ts`'s `writeTodaysPlanToCalendar`, pre-bound. Optional — a test that doesn't care about the Yoh-Plan Calendar sync need not stub it. */
  readonly writeCalendarPlan?: (blocks: readonly PlanBlock[]) => Promise<void>;
  readonly log?: (entry: LogEntry) => void;
}

/**
 * The `bumpLevels` bridge (Task 19; `shell/ritual-cli/morning-deps.ts`'s own
 * doc comment has the full history): every currently-stored `SlipHistory`
 * row turned into a `taskId -> consecutiveSlipCount` map, then the REAL
 * `core/slip-bump.ts` computation over it. Deliberately NOT threaded through
 * `PlanDayDeps` (unlike `readTasks`/`readCalendarEvents`/`writeCalendarPlan`,
 * which need real credentials only `shell/` can bind): this is pure
 * computation over `store` alone, so `planDay` computes it itself, fresh,
 * every call — a `shell/server.ts` process runs for days, and a Task marked
 * "slipped" through `/night` earlier the SAME process run must still show up
 * bumped in a LATER on-demand `/plan`, not just after the next restart. A
 * small, deliberate duplication of `shell/ritual-cli/morning-deps.ts`'s own
 * identical loop (AD-1 forbids `app/` importing `shell/`, so sharing it
 * outright isn't an option) — mirrors this codebase's established
 * "`localIsoDate`/`currentIsoDate`" precedent for the same layering reason.
 */
function computeBumpLevels(store: MemoryStore): Readonly<Record<ExternalId, number>> {
  const slipCounts: Record<ExternalId, number> = {};
  for (const record of listSlipHistories(store)) {
    slipCounts[record.id] = record.data.consecutiveSlipCount;
  }
  return computeSlipBumpLevels(slipCounts);
}

/** A one-line, deterministic summary of an already-built Plan — no times, no colors, just enough to confirm "yes, this exists" (UX: the full Plan is one `/morning` or a Home glance away). */
function summarizePlan(plan: Plan): string {
  const workTaskIds = new Set<ExternalId>();
  for (const b of plan.blocks) {
    if (b.kind === "work" && b.taskId !== undefined) workTaskIds.add(b.taskId);
  }
  const taskCount = workTaskIds.size;
  return `${taskCount} Task${taskCount === 1 ? "" : "s"} scheduled across ${plan.blocks.length} block${plan.blocks.length === 1 ? "" : "s"}.`;
}

function alreadyExistsReply(plan: Plan): ChatTurnResponse {
  return {
    reply: `You already have a Plan for today — ${summarizePlan(plan)} Say "I'm behind" if you want me to re-fit the rest of the day.`,
    receipts: [],
  };
}

/** The Data-Completeness open item, if one is currently open — mirrors `app/night-close-out.ts`'s own `surfaceOpenItems` + `find` pattern. */
async function dataCompletenessOpenItem(deps: PlanDayDeps): Promise<OpenItem | undefined> {
  const openItems = await surfaceOpenItems(deps, {});
  if (!openItems.ok) return undefined;
  return openItems.value.items.find((i) => i.requestKind === "data-completeness");
}

/** `/plan`'s entry point (real-use fixes plan, Task 1): builds today's Plan on demand, or reports it's already built. Never a push (see the module doc comment). */
export async function planDay(deps: PlanDayDeps, _input: Record<string, never>): Promise<Result<ChatTurnResponse, YohError>> {
  const today = localIsoDate(deps.now(), deps.timeZone);

  // The cheap pre-check (see the module doc comment) — avoids a
  // Notion/Calendar read entirely on the common "asked twice" case.
  const existing = getPlan(deps.store, today);
  if (existing) {
    return { ok: true, value: alreadyExistsReply(existing.data) };
  }

  const outcome = await runMorningRitual({
    store: deps.store,
    readTasks: deps.readTasks,
    readCalendarEvents: deps.readCalendarEvents,
    // /plan never pushes (Spencer, 2026-09-27) — same no-op the 6am cron's
    // own deps already bind (`shell/ritual-cli/morning-deps.ts`).
    sendNotification: async () => {},
    now: deps.now,
    timeZone: deps.timeZone,
    // `ChatTurnResponse.reply` is pinned ANSI-free (C2) — same convention
    // `app/plan-view.ts`/`app/mid-day-reflow.ts` already use.
    color: false,
    bumpLevels: computeBumpLevels(deps.store),
    ...(deps.writeCalendarPlan ? { writeCalendarPlan: deps.writeCalendarPlan } : {}),
    ...(deps.log ? { log: deps.log } : {}),
    // Story 9.4: the needs-data notification must fire from an on-demand
    // /plan run exactly as it does from the 6am cron run — it's in-app
    // only (never a Pushover push), so /plan's own "no push" carve-out
    // doesn't apply to it. `deps.connection` is already carried on
    // `PlanDayDeps` (inherited from `SurfaceOpenItemsDeps`, used today for
    // FR-25's inference); this is simply its second consumer.
    ...(deps.connection ? { connection: deps.connection } : {}),
  });

  if (!outcome.ok) {
    return { ok: false, error: { kind: outcome.error.kind, message: errorCopy(outcome.error) } };
  }

  switch (outcome.value.status) {
    case "already-ran": {
      // A narrow race only (see the module doc comment's pre-check) — by
      // the time this resolves, a concurrent cron run or another /plan
      // already delivered today's Plan. Re-read it fresh rather than
      // fabricate a summary from nothing.
      const stored = getPlan(deps.store, outcome.value.date);
      return {
        ok: true,
        value: stored
          ? alreadyExistsReply(stored.data)
          : { reply: 'Today\'s Plan was just generated elsewhere — say "what\'s my plan" to see it.', receipts: [] },
      };
    }
    case "nothing-to-plan": {
      const item = await dataCompletenessOpenItem(deps);
      return {
        ok: true,
        value: {
          reply: item?.promptText ?? "I don't have anything to plan yet — every Task is missing information I need before I can schedule any of them.",
          receipts: [],
          ...(item ? { question: item.question } : {}),
        },
      };
    }
    case "nothing-fits": {
      const item = await dataCompletenessOpenItem(deps);
      return {
        ok: true,
        value: {
          reply: 'Nothing fit today\'s Time Budget — every Task got deferred. Raise your Time Budget (e.g. "time budget 8 hours") and say "plan my day" again.',
          receipts: [],
          ...(item ? { question: item.question } : {}),
        },
      };
    }
    case "delivered": {
      const item = outcome.value.incompleteTaskIds.length > 0 ? await dataCompletenessOpenItem(deps) : undefined;
      return {
        ok: true,
        value: { reply: outcome.value.rendered, receipts: [], ...(item ? { question: item.question } : {}) },
      };
    }
  }
}
