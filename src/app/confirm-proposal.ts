/**
 * src/app/confirm-proposal.ts
 *
 * Story 8.2, AD-3/AD-16: the single confirm path for every Proposal kind,
 * regardless of which interactive surface confirmed it (FR-48). `apply`/
 * `ProposalEntityAccessor`/`timeBudgetEntityAccessor` are moved here
 * verbatim from `shell/chat-cli.ts` (originally Task 23 / Story 4.2) — this
 * is now the ONLY place `apply(proposal)` is called from, per AD-3's own
 * wording. The other three Proposal kinds never go through this generic
 * accessor pattern (AD-3's own note: "apply(proposal) is a pattern name,
 * not one literal shared signature") — each calls its write function
 * directly with the Proposal's EXTRACTED payload:
 *  - `"field-value"` (FR-25) re-validates the suggested value through
 *    `parsePlanningFieldValue` (defense in depth — an echoed proposal from a
 *    network client is never trusted at its claimed type) and writes via
 *    `updateTaskField` + `mergeTaskFieldOverride`.
 *  - `"notion-page-draft"` (FR-26) calls `createPage(database, properties)`
 *    directly — a create has no live entity to re-check (AD-3).
 *  - `"calendar-edit"` (FR-27) calls `applyCalendarEdit(proposal)` directly,
 *    which already does its own live-etag staleness check internally
 *    (`calendar-adapter.ts`).
 *
 * Every write dependency is OPTIONAL on `ConfirmProposalDeps` — each caller
 * wires only what its own call site needs, and a kind whose matching
 * dependency isn't configured returns a clear `unreachable` Result failure
 * rather than throwing (this codebase's existing "throws only if actually
 * invoked" injection convention).
 */
import { randomUUID } from "node:crypto";
import {
  clearInteractionRequest,
  clearTimeBudgetDeferralStreak,
  ConflictError,
  getCurrentTimeBudget,
  getOpenInteractionRequest,
  mergeTaskFieldOverride,
  putTimeBudget,
  type MemoryStore,
  PLAN_TOPIC,
} from "../adapters/memory-store.ts";
import { writeStructuredLog } from "../adapters/logger.ts";
import { MEMORY_TOPIC } from "../adapters/chat-store.ts";
import { readPlanningSettings, writeSettingInTx } from "../adapters/settings-store.ts";
import { appendOutboxInTx } from "../adapters/notification-store.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { currentRuleValue, validateProposedRuleValue } from "../core/planning-settings.ts";
import { describePattern } from "../core/pattern-detect.ts";
import { isOlderThanDays, PATTERN_PROPOSAL_TTL_DAYS, RULE_PROPOSAL_TTL_DAYS } from "../core/proposal-ttl.ts";
import { ruleChangeConfirmedCopy, ruleChangeDeclinedCopy, ruleValuesEqual } from "../core/rule-change.ts";
import { parsePlanningFieldValue, PLANNING_FIELD_LABELS } from "../core/planning-field-value.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import { approveReshuffle, discardReshuffle, type ApproveReshuffleDeps } from "./approve-reshuffle.ts";
import type { CalendarEditProposal } from "./calendar-edit.ts";
import type {
  CalendarEditChange,
  FieldValueSuggestion,
  NotionDatabaseTarget,
  NotionPageDraft,
  PlanningFieldNames,
  Proposal,
  ReshufflePreview,
  Result,
  PatternProposal,
  RuleChange,
  RuleSettingValue,
  Task,
  TaskFieldOverride,
  TimeBudget,
  YohError,
} from "../types/domain.ts";
import type { ConfirmProposalResponse } from "../types/api.ts";

/** The outbox topic the Calendar Day View and Home's own Plan block re-fetch on (`app/check-off.ts`, `rituals/morning-ritual.ts`, `rituals/mid-day-reflow.ts` all already write it). */
/**
 * Task 8: the local calendar date `PLAN_TOPIC`'s hint should carry after a
 * confirmed `"calendar-edit"`, so `web/src/lib/calendarDay.ts`'s per-date
 * cache refetches the right day instead of every cached date. `"move"` and
 * `"create"` both carry a real start; `"resize"` carries only `newEnd` (its
 * own start isn't part of `CalendarEditChange` — there's deliberately no
 * `"delete"` variant either, see that type's own doc comment) — `undefined`
 * for either of those, same as a date this can't derive for any other
 * reason, tells the caller to fall back to a topic-only hint (no entityId),
 * which `calendarDay.ts` treats as "refetch every cached date."
 */
function calendarEditEventDate(change: CalendarEditChange, timeZone: string): string | undefined {
  switch (change.kind) {
    case "move":
      return localIsoDate(new Date(change.newStart), timeZone);
    case "create":
      return localIsoDate(new Date(change.start), timeZone);
    case "resize":
      return undefined;
  }
}

// ============================================================================
// Moved verbatim from chat-cli.ts (originally Task 23 / Story 4.2, AD-3) —
// the generic accessor pattern, reserved for a kind that re-reads a live,
// mutable singleton entity (today: only "time-budget-change").
// ============================================================================

/**
 * The minimal seam `apply` needs to re-read a Proposal's live entity and,
 * once Spencer has confirmed, write the suggested change — injected per
 * Proposal `kind` (`timeBudgetEntityAccessor` below is the one worked
 * example). This is what keeps `apply` itself generic over `Proposal<T>`: a
 * future Proposal kind that genuinely needs live-entity re-reads supplies
 * its own accessor without any change to `apply`. Module-private —
 * NEVER exported: `tests/layering-rules.test.ts`'s AD-16 rule fails any
 * exported `app/*.ts` function not shaped `(deps, input) => Promise<Result<...>>`,
 * and this doesn't qualify. `confirmProposal` (below) is the only public
 * seam; its own test suite exercises this indirectly (a store wrapped to
 * simulate a genuine concurrent write).
 */
interface ProposalEntityAccessor<T> {
  /** The live entity's CURRENT version, formatted the same way `Proposal.entityVersion` already is (a `string`) — `undefined` if the entity no longer exists at all. Always re-reads; never returns a cached/stale value. */
  readonly currentVersion: () => string | undefined;
  /** Applies `suggested` against the live entity. `apply` calls this ONLY after confirming `currentVersion()` still matches `proposal.entityVersion` — never speculatively. */
  readonly applyChange: (suggested: T) => void;
}

/**
 * The generic Propose-Don't-Impose confirm/apply pathway AD-3 reserves for a
 * kind that re-reads a live, mutable entity (today: only
 * `"time-budget-change"`). `answer: false` applies nothing and reports
 * `"declined"` without even consulting `accessor`. `answer: true` re-reads
 * the live entity's CURRENT version and compares it against
 * `proposal.entityVersion` — a mismatch (including the entity no longer
 * existing, which reads as `undefined`) rejects with
 * `YohError.kind: "stale-proposal"` WITHOUT calling `accessor.applyChange`.
 * `accessor.applyChange` is never allowed to escape as an unhandled throw: a
 * genuine `ConflictError` (AD-10's optimistic-concurrency check, e.g. a
 * concurrent write racing `ritual-cli.ts`) is reported via its own
 * `.yohError` (`kind: "conflict"`); any other thrown value is wrapped as
 * `kind: "unreachable"`. Module-private — never exported, same reasoning
 * as `ProposalEntityAccessor` above.
 */
async function apply<T>(
  proposal: Proposal<T>,
  answer: boolean,
  accessor: ProposalEntityAccessor<T>,
): Promise<Result<"applied" | "declined", YohError>> {
  if (!answer) {
    return { ok: true, value: "declined" };
  }

  const liveVersion = accessor.currentVersion();
  if (liveVersion !== proposal.entityVersion) {
    return {
      ok: false,
      error: {
        kind: "stale-proposal",
        message: `confirm-proposal: proposal "${proposal.id}" is stale — the live entity's version (${
          liveVersion ?? "none, it no longer exists"
        }) no longer matches the version this proposal was generated against (${proposal.entityVersion})`,
        detail: {
          proposalId: proposal.id,
          entityId: proposal.entityId,
          expectedVersion: proposal.entityVersion,
          actualVersion: liveVersion,
        },
      },
    };
  }

  try {
    accessor.applyChange(proposal.suggested);
  } catch (err) {
    if (err instanceof ConflictError) {
      return { ok: false, error: err.yohError };
    }
    return {
      ok: false,
      error: {
        kind: "unreachable",
        message: `confirm-proposal: applying proposal "${proposal.id}" failed — ${err instanceof Error ? err.message : String(err)}`,
        detail: err,
      },
    };
  }

  return { ok: true, value: "applied" };
}

/**
 * `apply`'s accessor for `"time-budget-change"` — re-reads the live
 * singleton Time Budget row fresh on every call (never caches it) and
 * applies a suggested change by merging `suggested` onto the live row's own
 * data before persisting via `putTimeBudget` — the same "put" primitive
 * `declareTimeBudget` uses for Spencer's own explicit declarations, so an
 * applied Proposal reads back identically to Spencer having typed the
 * change himself. Module-private — never exported, same reasoning as
 * `apply`/`ProposalEntityAccessor` above.
 */
function timeBudgetEntityAccessor(store: MemoryStore): ProposalEntityAccessor<Partial<TimeBudget>> {
  return {
    currentVersion: () => {
      const current = getCurrentTimeBudget(store);
      return current ? String(current.version) : undefined;
    },
    applyChange: (suggested) => {
      const current = getCurrentTimeBudget(store);
      if (!current) {
        throw new Error("confirm-proposal: cannot apply a Time Budget proposal — no current Time Budget exists to change");
      }
      putTimeBudget(store, { ...current.data, ...suggested });
    },
  };
}

// ============================================================================
// confirmProposal — the single confirm path (this story's own new logic)
// ============================================================================

/** Structural twin of the memory-item store's PatternState (this file may not import that store). */
interface PatternStateLike {
  kind: string;
  area: string;
  pendingProposalId?: string;
  declinedAt?: string;
  lastOfferedOn?: string;
  confirmedAt?: string;
}

export interface ConfirmProposalDeps {
  readonly store: MemoryStore;
  /** `notion-adapter.ts`'s `updateTaskField`, pre-bound to its client/config — required only for the `"field-value"` kind. */
  readonly updateTaskField?: (
    taskId: string,
    field: PlanningFieldNames,
    value: NonNullable<Task[PlanningFieldNames]>,
  ) => Promise<Result<void, YohError>>;
  /** `notion-adapter.ts`'s `createPage`, pre-bound — required only for the `"notion-page-draft"` kind. */
  readonly createPage?: (
    database: NotionDatabaseTarget,
    properties: Readonly<Record<string, string>>,
  ) => Promise<Result<{ readonly pageId: string; readonly url?: string }, YohError>>;
  /** `calendar-adapter.ts`'s `applyCalendarEdit`, pre-bound — required only for the `"calendar-edit"` kind. */
  readonly applyCalendarEdit?: (
    proposal: Proposal<CalendarEditChange>,
  ) => Promise<Result<{ readonly eventId: string; readonly calendarId: string }, YohError>>;
  /** Task 8: for the one `plan` outbox hint appended after a confirmed `"calendar-edit"` (mirrors `update-task.ts`'s/`save-search-result.ts`'s identical `deps.connection?.writeTx(...)` convention). Absent — never hints (tests, or a caller that doesn't care). */
  readonly connection?: SqliteConnection;
  /** Task 8: Spencer's host timezone, so the hint's `entityId` is the edited event's LOCAL calendar date, not its UTC one. Required only alongside `connection` for a `"calendar-edit"` proposal — absent, the hint still fires but with no entityId (calendarDay.ts then refetches every cached date). */
  readonly timeZone?: string;
  /** Required only for the `"reshuffle"` kind: everything `approveReshuffle` needs besides `store`. */
  readonly reshuffle?: Omit<ApproveReshuffleDeps, "store">;
  /** Required only for the `"rule-change"` kind: marks the raising memory item confirmed/declined. */
  readonly memoryItems?: {
    setRuleChange(id: string, ruleChange: "none" | "pending" | "confirmed" | "declined"): void;
    /** Required only for the `"pattern"` kind. */
    insert?(input: { folder: "patterns"; text: string; origin: "inferred"; ruleChange: "none" | "confirmed"; at?: string }): { readonly id: string };
    getPatternState?(kind: string, area: string): PatternStateLike | undefined;
    putPatternState?(state: PatternStateLike): void;
  };
  /** Clock for the rule-change 7-day expiry; defaults to the real clock. */
  readonly now?: () => Date;
}

export interface ConfirmProposalInput {
  readonly proposal: Proposal<unknown>;
  readonly accept: boolean;
  /** When given, clears this interaction request after the proposal resolves — applied, declined, or rejected (matches `chat-cli.ts`'s prior `answerProposalRequest` behavior exactly: a stale/failed proposal is told to Spencer plainly and cleared, not re-surfaced forever against a snapshot that can never match again). */
  readonly requestId?: string;
}

function clearRequestIfGiven(store: MemoryStore, requestId: string | undefined): void {
  if (!requestId) return;
  const current = getOpenInteractionRequest(store, requestId);
  if (current) clearInteractionRequest(store, requestId, current.version);
}

function missingDependency(kind: string, dependency: string): Result<ConfirmProposalResponse, YohError> {
  return {
    ok: false,
    error: {
      kind: "unreachable",
      message: `confirm-proposal: no "${dependency}" dependency configured — cannot confirm a "${kind}" proposal`,
    },
  };
}

function staleRuleProposal(message: string): Result<ConfirmProposalResponse, YohError> {
  return { ok: false, error: { kind: "stale-proposal", message } };
}

/**
 * `"rule-change"` (Story 13.8, AD-29): a Yes writes the planning override
 * through `writeSettingInTx` and confirms the raising memory item in ONE
 * transaction; a No or an expired/stale/invalid one writes no planning.
 * Reads no memory text — only the item id from the stored payload.
 */
/** Clears the request first (the caller), then sets the item state; a gone item (forgotten/purged) is logged and skipped. */
function setItemStateOrLog(deps: ConfirmProposalDeps, itemId: string, state: "none" | "declined"): void {
  try {
    deps.memoryItems?.setRuleChange(itemId, state);
  } catch (error) {
    writeStructuredLog({ level: "warn", event: "confirm-proposal.rule-item-missing", detail: { itemId, message: error instanceof Error ? error.message : String(error) } });
  }
}

function confirmRuleChange(
  deps: ConfirmProposalDeps,
  proposal: Proposal<RuleChange>,
  accept: boolean,
  requestId: string | undefined,
): Result<ConfirmProposalResponse, YohError> {
  const change = proposal.suggested;
  if (!accept) {
    clearRequestIfGiven(deps.store, requestId);
    setItemStateOrLog(deps, change.memoryItemId, "declined");
    return { ok: true, value: { applied: false, receipts: [], message: ruleChangeDeclinedCopy(change) } };
  }
  if (!deps.connection || !deps.memoryItems) {
    clearRequestIfGiven(deps.store, requestId);
    return missingDependency(proposal.kind, deps.connection ? "memoryItems" : "connection");
  }
  const memoryItems = deps.memoryItems;
  const now = deps.now ? deps.now() : new Date();
  if (isOlderThanDays(proposal.createdAt, now, RULE_PROPOSAL_TTL_DAYS)) {
    clearRequestIfGiven(deps.store, requestId);
    setItemStateOrLog(deps, change.memoryItemId, "declined");
    return staleRuleProposal("confirm-proposal: that rule change expired");
  }
  const area = typeof change.value === "object" && "area" in change.value ? change.value.area : undefined;
  const settings = deps.store.withDb(readPlanningSettings);
  if (!ruleValuesEqual(currentRuleValue(settings, change.key, area), change.previous)) {
    clearRequestIfGiven(deps.store, requestId);
    setItemStateOrLog(deps, change.memoryItemId, "none");
    return staleRuleProposal("confirm-proposal: that setting changed since the proposal");
  }
  const checked = validateProposedRuleValue(settings, change.key, change.value);
  if (!checked.ok) {
    clearRequestIfGiven(deps.store, requestId);
    return checked;
  }
  try {
    deps.connection.writeTx((db) => {
      writeSettingInTx(db, change.key, checked.value);
      appendOutboxInTx(db, { topic: MEMORY_TOPIC, entityId: change.key });
      memoryItems.setRuleChange(change.memoryItemId, "confirmed");
    });
  } catch (error) {
    return { ok: false, error: { kind: "unreachable", message: error instanceof Error ? error.message : "confirm-proposal: rule change failed" } };
  }
  clearRequestIfGiven(deps.store, requestId);
  return { ok: true, value: { applied: true, receipts: [], message: ruleChangeConfirmedCopy(change) } };
}

/**
 * `"pattern"` (Story 13.13): a Yes files a Patterns item (and, for an
 * overrun, the `areaDurationPadding` override) in ONE transaction; a No,
 * an expiry or a moved-on `pattern_state` writes nothing. Reads no memory text.
 */
function confirmPattern(
  deps: ConfirmProposalDeps,
  proposal: Proposal<PatternProposal>,
  accept: boolean,
  requestId: string | undefined,
): Result<ConfirmProposalResponse, YohError> {
  const p = proposal.suggested;
  const items = deps.memoryItems;
  if (!deps.connection || !items?.insert || !items.getPatternState || !items.putPatternState) {
    clearRequestIfGiven(deps.store, requestId);
    return missingDependency(proposal.kind, deps.connection ? "memoryItems" : "connection");
  }
  const { insert, getPatternState, putPatternState } = items;
  const now = deps.now ? deps.now() : new Date();
  const nowIso = now.toISOString();
  const existing = getPatternState.call(items, p.kind, p.area) ?? { kind: p.kind, area: p.area };
  const { pendingProposalId: _pending, ...rest } = existing;
  // Withdraw the card and record declinedAt together: a failed state write must not leave a cleared card behind.
  const withdrawAsDeclined = (connection: SqliteConnection): Result<null, YohError> => {
    try {
      connection.writeTx(() => {
        clearRequestIfGiven(deps.store, requestId);
        if (existing.pendingProposalId === proposal.id) putPatternState.call(items, { ...rest, declinedAt: nowIso });
      });
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(error) } };
    }
  };
  if (!accept) {
    const declined = withdrawAsDeclined(deps.connection);
    if (!declined.ok) return declined;
    return { ok: true, value: { applied: false, receipts: [], message: "Okay. I won't ask about that again for a while." } };
  }
  if (isOlderThanDays(proposal.createdAt, now, PATTERN_PROPOSAL_TTL_DAYS)) {
    const declined = withdrawAsDeclined(deps.connection);
    if (!declined.ok) return declined;
    return staleRuleProposal("confirm-proposal: that pattern expired");
  }
  if (existing.pendingProposalId !== proposal.id) {
    clearRequestIfGiven(deps.store, requestId);
    return staleRuleProposal("confirm-proposal: that pattern is no longer pending");
  }
  const overrun = p.kind === "area-overrun";
  let padding: RuleSettingValue | undefined;
  if (overrun) {
    const settings = deps.store.withDb(readPlanningSettings);
    const checked = validateProposedRuleValue(settings, "areaDurationPadding", { area: p.area, minutes: p.paddingMinutes ?? 0 });
    if (!checked.ok) {
      clearRequestIfGiven(deps.store, requestId);
      return checked;
    }
    padding = checked.value;
  }
  const text = describePattern(p).headline.replace(/^Yoh noticed /, "");
  let itemId: string;
  try {
    itemId = deps.connection.writeTx((db) => {
      if (padding !== undefined) {
        writeSettingInTx(db, "areaDurationPadding", padding);
        appendOutboxInTx(db, { topic: MEMORY_TOPIC, entityId: "areaDurationPadding" });
      }
      const item = insert.call(items, { folder: "patterns", text, origin: "inferred", ruleChange: overrun ? "confirmed" : "none", at: nowIso });
      putPatternState.call(items, { ...rest, confirmedAt: nowIso });
      return item.id;
    });
  } catch (error) {
    return { ok: false, error: { kind: "unreachable", message: error instanceof Error ? error.message : "confirm-proposal: pattern failed" } };
  }
  clearRequestIfGiven(deps.store, requestId);
  return {
    ok: true,
    value: {
      applied: true,
      receipts: [],
      message: overrun ? `Planning ${p.paddingMinutes ?? 0} extra min for ${p.area} Tasks. Revert it on the Memory page.` : "Noted.",
      receipt: { receiptId: randomUUID(), kind: "remembered", items: [{ id: itemId, text, folder: "patterns" }] },
    },
  };
}

export async function confirmProposal(
  deps: ConfirmProposalDeps,
  input: ConfirmProposalInput,
): Promise<Result<ConfirmProposalResponse, YohError>> {
  const { proposal, accept, requestId } = input;

  // "time-budget-change" (FR-5/FR-16): the one kind that re-reads a live,
  // mutable entity through the generic apply()/accessor pattern.
  if (proposal.kind === "time-budget-change") {
    const result = await apply(proposal as Proposal<Partial<TimeBudget>>, accept, timeBudgetEntityAccessor(deps.store));
    // Review fix, Important #1 (preserved): the deferral streak resets once
    // Spencer has genuinely answered — applied OR declined — never on a
    // stale/error rejection, where he never got to genuinely decide.
    if (result.ok) clearTimeBudgetDeferralStreak(deps.store);
    clearRequestIfGiven(deps.store, requestId);
    if (!result.ok) return result;
    return {
      ok: true,
      value: {
        applied: result.value === "applied",
        receipts: result.value === "applied" ? ["Done — I've updated your Time Budget."] : [],
      },
    };
  }

  if (proposal.kind === "reshuffle") {
    const reshuffleProposal = proposal as Proposal<ReshufflePreview>;
    if (!accept) {
      const discarded = await discardReshuffle({ store: deps.store }, { proposal: reshuffleProposal, ...(requestId ? { requestId } : {}) });
      if (!discarded.ok) return discarded;
      return { ok: true, value: { applied: false, receipts: [] } };
    }
    if (!deps.reshuffle) {
      clearRequestIfGiven(deps.store, requestId);
      return missingDependency(proposal.kind, "reshuffle");
    }
    const approved = await approveReshuffle(
      { ...deps.reshuffle, store: deps.store },
      { proposal: reshuffleProposal, ...(requestId ? { requestId } : {}) },
    );
    if (!approved.ok) return approved;
    if (approved.value.status === "recomputed") {
      return {
        ok: true,
        value: {
          applied: false,
          receipts: ["Your Plan or calendar changed since that preview, so I made a fresh one. Approve it to apply."],
          question: approved.value.question,
        },
      };
    }
    const failed = approved.value.calendarFailedBlockIds.length;
    return {
      ok: true,
      value: {
        applied: true,
        receipts: [
          failed > 0
            ? "Your Plan is updated, but I couldn't update your calendar for some blocks."
            : "Done — I've updated today's Plan and your calendar.",
        ],
      },
    };
  }

  if (proposal.kind === "rule-change") {
    return confirmRuleChange(deps, proposal as Proposal<RuleChange>, accept, requestId);
  }

  if (proposal.kind === "pattern") {
    return confirmPattern(deps, proposal as Proposal<PatternProposal>, accept, requestId);
  }

  // Every other kind: extracted-payload write functions, no generic
  // accessor. A decline is identical across all three — nothing is ever
  // written, and the write dependency isn't even required to be configured.
  if (!accept) {
    clearRequestIfGiven(deps.store, requestId);
    return { ok: true, value: { applied: false, receipts: [] } };
  }

  if (proposal.kind === "field-value") {
    if (!deps.updateTaskField) {
      clearRequestIfGiven(deps.store, requestId);
      return missingDependency(proposal.kind, "updateTaskField");
    }
    const suggestion = proposal.suggested as FieldValueSuggestion;
    // Defense in depth (Review Focus #1): the wire payload is untyped JSON —
    // an echoed proposal's claimed `value` is never trusted at face value,
    // even though TypeScript's `NonNullable<Task[...]>` says it should
    // already be well-typed. Re-parsing through the SAME parser a typed
    // answer uses means an echoed proposal can never write anything a typed
    // answer couldn't (AD-11).
    //
    // Final-review fix (Important #1): this function does NOT itself
    // cross-check `suggestion.taskId`/`.field` against anything — it trusts
    // the caller for identity. That's deliberate: this is the one confirm
    // path every Proposal kind resolves through (FR-48), including
    // `app/answer-open-item.ts`'s `"proposal"` kind, which never has a
    // "pending (taskId, field)" of its own to check against. FR-25's own
    // caller (`app/answer-data-completeness.ts`) is the one that KNOWS what's
    // pending, so it verifies `suggestion.taskId`/`.field` match the current
    // pending question BEFORE ever calling this with `accept: true` —
    // without that check, a client could echo a proposal naming a different
    // Task/field than the one it's actually answering.
    const reparsed = parsePlanningFieldValue(suggestion.field, String(suggestion.value));
    if (!reparsed.ok) {
      clearRequestIfGiven(deps.store, requestId);
      // `reparsed.message` (core/planning-field-value.ts) is already a
      // plain, Spencer-facing sentence — never re-prefixed with this
      // module's own internal name (Task 4: `core/error-copy.ts`'s
      // validation branch keeps an already-plain sentence verbatim, but
      // only if nothing here glues an adapter-style prefix back onto it
      // first).
      return { ok: false, error: { kind: "validation", message: reparsed.message } };
    }
    const written = await deps.updateTaskField(suggestion.taskId, suggestion.field, reparsed.value as NonNullable<Task[PlanningFieldNames]>);
    clearRequestIfGiven(deps.store, requestId);
    if (!written.ok) return written;
    mergeTaskFieldOverride(deps.store, suggestion.taskId, { [suggestion.field]: reparsed.value } as TaskFieldOverride);
    // Important fix: restores the exact receipt wording `answer-data-
    // completeness.ts`'s own blind-ask branch already uses (a typed FR-24
    // answer and an accepted FR-25 suggestion must read identically — the
    // whole point of routing both through the same field/value write) —
    // the human-readable label (`PLANNING_FIELD_LABELS`), never the raw
    // internal field name.
    const label = PLANNING_FIELD_LABELS[suggestion.field];
    return {
      ok: true,
      value: { applied: true, receipts: [`${suggestion.taskTitle} — ${label}: set to "${String(reparsed.value)}".`] },
    };
  }

  if (proposal.kind === "notion-page-draft") {
    if (!deps.createPage) {
      clearRequestIfGiven(deps.store, requestId);
      return missingDependency(proposal.kind, "createPage");
    }
    const draft = proposal.suggested as NotionPageDraft;
    const created = await deps.createPage(draft.database, draft.properties);
    clearRequestIfGiven(deps.store, requestId);
    if (!created.ok) return created;
    return {
      ok: true,
      // NOTE: never falls back to `proposal.entityId` for the title — per
      // Ruling #4 that's the proposal's own internal id for a create-type
      // proposal (e.g. "create-Tasks-123"), not anything Spencer-facing.
      value: { applied: true, receipts: [`Created "${draft.properties["title"] ?? "a new item"}" in ${draft.database}.`] },
    };
  }

  if (proposal.kind === "calendar-edit") {
    if (!deps.applyCalendarEdit) {
      clearRequestIfGiven(deps.store, requestId);
      return missingDependency(proposal.kind, "applyCalendarEdit");
    }
    const calendarChange = proposal as Proposal<CalendarEditChange>;
    const applied = await deps.applyCalendarEdit(calendarChange);
    clearRequestIfGiven(deps.store, requestId);
    if (!applied.ok) return applied;
    // Task 8 (Plan hint after a calendar edit): a topic-only hint (no
    // entityId) when the date can't be derived — `calendarDay.ts` then
    // refetches every date it has cached rather than guessing at one.
    if (deps.connection) {
      const date = deps.timeZone ? calendarEditEventDate(calendarChange.suggested, deps.timeZone) : undefined;
      deps.connection.writeTx((db) => appendOutboxInTx(db, { topic: PLAN_TOPIC, entityId: date ?? "" }));
    }
    // Post-review fix, Important #2 (re-review, AD-9): `proposal.reason` is
    // the FUTURE-tense confirm question ("Create "..." on ...–...?") —
    // reusing it verbatim here showed Spencer his own question back as if
    // it were a receipt. `app/calendar-edit.ts` now always sets
    // `receiptText` (a real, past-tense statement) on every "calendar-edit"
    // proposal it persists, via the ADDITIVE `CalendarEditProposal` type
    // (never a widened `Proposal<T>` — AD-9 forbids that) — this cast reads
    // it back the same way the `Proposal<CalendarEditChange>` cast just
    // above already does for `suggested`. The `?? proposal.reason` fallback
    // is a genuine, non-defensive-only path: a proposal persisted before
    // this fix landed (or a hand-built one in a test) may still have no
    // `receiptText` at all.
    const calendarProposal = proposal as CalendarEditProposal;
    return { ok: true, value: { applied: true, receipts: [calendarProposal.receiptText ?? proposal.reason] } };
  }

  clearRequestIfGiven(deps.store, requestId);
  return { ok: false, error: { kind: "validation", message: `confirm-proposal: unrecognized proposal kind "${proposal.kind}"` } };
}
