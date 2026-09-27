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
import {
  clearInteractionRequest,
  clearTimeBudgetDeferralStreak,
  ConflictError,
  getCurrentTimeBudget,
  getOpenInteractionRequest,
  mergeTaskFieldOverride,
  putTimeBudget,
  type MemoryStore,
} from "../adapters/memory-store.ts";
import { parsePlanningFieldValue, PLANNING_FIELD_LABELS } from "../core/planning-field-value.ts";
import type { CalendarEditProposal } from "./calendar-edit.ts";
import type {
  CalendarEditChange,
  FieldValueSuggestion,
  NotionDatabaseTarget,
  NotionPageDraft,
  PlanningFieldNames,
  Proposal,
  Result,
  Task,
  TaskFieldOverride,
  TimeBudget,
  YohError,
} from "../types/domain.ts";
import type { ConfirmProposalResponse } from "../types/api.ts";

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
      return { ok: false, error: { kind: "validation", message: `confirm-proposal: ${reparsed.message}` } };
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
    const applied = await deps.applyCalendarEdit(proposal as Proposal<CalendarEditChange>);
    clearRequestIfGiven(deps.store, requestId);
    if (!applied.ok) return applied;
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
