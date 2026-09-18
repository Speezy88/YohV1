/**
 * src/types/domain.ts
 *
 * Shared domain types for Yoh. Authored and locked first per AD-9 of the
 * Architecture Spine: every other file in the tree imports from here rather
 * than declaring its own parallel shape. No file may locally redeclare,
 * widen, or shadow a type this file exports — extend this file instead.
 *
 * This file is type-only (erasable syntax only, no enums/namespaces/param
 * properties) so Node's native TypeScript type-stripping can run it directly
 * with zero emitted JavaScript, per the Architecture Spine's Stack table
 * (no build step; `tsc --noEmit` is used for type-checking only).
 */

// ============================================================================
// Primitives
// ============================================================================

/**
 * ISO-8601 UTC timestamp (e.g. "2026-08-22T13:04:00.000Z"). Per the
 * Architecture Spine's Consistency Conventions, dates are ISO-8601 UTC
 * internally everywhere in `core/` and storage, converted to Spencer's local
 * timezone only at the `shell/`/notification edge.
 */
export type IsoDateTime = string;

/**
 * ISO-8601 calendar date with no time-of-day component (e.g. "2026-08-22"),
 * used where only a date is meaningful — a Task's Due Date, a Plan's date,
 * a Time Budget's date.
 */
export type IsoDate = string;

/**
 * An opaque external id (a Notion page id, a Google Calendar event id, or a
 * Yoh-internal id such as `PlanBlock.id`). Per the Consistency Conventions,
 * ids are never parsed or assumed to have internal structure.
 */
export type ExternalId = string;

// ============================================================================
// Result / Error (AD-8)
// ============================================================================

/**
 * Discriminated union result type. Every `core/*.ts` function returns
 * `Result<T, YohError>` and never throws (AD-8). `adapters/*.ts` functions
 * may throw on I/O failure; `rituals/*.ts` is the only layer allowed to
 * catch an adapter's throw and convert it into a `Result` failure.
 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/**
 * The full set of `YohError.kind` values. AD-8 requires at minimum:
 * `missing-field`, `auth-expired`, `unreachable`, `rate-limited`,
 * `validation`, `stale-proposal` (AD-3), `conflict` (AD-10). This file is
 * the only place new kinds may be added — extend this union, never shadow
 * it with a narrower or parallel error type elsewhere.
 */
export type YohErrorKind =
  | "missing-field"
  | "auth-expired"
  | "unreachable"
  | "rate-limited"
  | "validation"
  | "stale-proposal"
  | "conflict";

/**
 * The error type carried by every failing `Result` in the system.
 * `detail` is an escape hatch for context a specific failure site wants to
 * attach (e.g. the field name that was missing, the raw adapter error) —
 * callers should not depend on its shape beyond `kind` and `message`.
 */
export interface YohError {
  readonly kind: YohErrorKind;
  readonly message: string;
  readonly detail?: unknown;
}

// ============================================================================
// Task / CompleteTask (FR-1, FR-4, AD-11)
// ============================================================================

/**
 * Energy level a Task requires. A fixed enum (unlike `Area`, which is
 * free-form) because Energy fit is one of FR-2's secondary scoring factors
 * and needs a closed set of values to score against.
 */
export type Energy = "low" | "medium" | "high";

/**
 * Area is a free-form grouping value taken verbatim from Spencer's own
 * Notion "Area" property (e.g. "Work", "Health", "Errands") — not a fixed
 * enum, since it's Spencer's own taxonomy, not Yoh's.
 */
export type Area = string;

/**
 * TaskStatus, written back to Notion exclusively via `setTaskStatus`
 * (AD-12). Includes at minimum `completed` and `slipped` per the Task 1
 * brief, plus the not-yet-closed states a Task needs before Night Ritual
 * close-out:
 *  - `not-started`: default state, nothing done yet.
 *  - `in-progress`: Spencer has started but not finished the Task.
 *  - `completed`: closed out as done (Night Ritual close-out, FR-12).
 *  - `slipped`: closed out as not done; feeds Slip-Bump (FR-11) and Derived
 *    Priority.
 */
export type TaskStatus = "not-started" | "in-progress" | "completed" | "slipped";

/**
 * The set of Task fields FR-4's Data-Completeness Gate requires before a
 * Task can enter Plan assembly. Exported (Task 5) so
 * `core/data-completeness-gate.ts` — the sole producer of `CompleteTask`
 * (AD-11) — and its `shell/chat-cli.ts` caller can reference the exact field
 * name set (e.g. to iterate it, or to label a missing field in a prompt)
 * without redeclaring a parallel list that could drift out of sync with
 * `CompleteTask`'s own derivation below.
 */
export type PlanningFieldNames = "estimatedDurationMinutes" | "area" | "dueDate" | "status" | "energy";

/**
 * Task — the raw shape read from Notion (`notion-adapter.ts`). The five
 * planning fields FR-4 requires (Estimated Duration, Area, Due Date,
 * Status, Energy) are optional here because a real Notion Task row may be
 * missing any of them; the Data-Completeness Gate
 * (`core/data-completeness-gate.ts`, AD-11) is the only function allowed to
 * upgrade a `Task` into a `CompleteTask` once every planning field is
 * present, and every function downstream of the gate accepts `CompleteTask`
 * only.
 */
export interface Task {
  readonly id: ExternalId;
  readonly title: string;
  readonly estimatedDurationMinutes?: number;
  readonly area?: Area;
  readonly dueDate?: IsoDate;
  readonly status?: TaskStatus;
  readonly energy?: Energy;
  /**
   * The id of the `Project` this Task is grouped under in Notion (its
   * "Project" relation property), if any. Added by Task 3
   * (`notion-adapter.ts`) — not one of FR-4's five planning fields (it's
   * intentionally excluded from `PlanningFieldNames`/`CompleteTask`), and
   * per Story 1.3's acceptance criteria it feeds no priority or scheduling
   * logic in this story; it exists purely so a Project can be joined back
   * onto a Task for display/grouping.
   */
  readonly projectId?: ExternalId;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/**
 * Project — organizational metadata read from Notion's Projects database
 * alongside Tasks (`notion-adapter.ts`, Task 3/Story 1.3). Added because no
 * task before this one needed a representation of Notion's Project
 * grouping. Deliberately minimal (id + name only): per Story 1.3's
 * acceptance criteria, Projects are returned as organizational metadata
 * only — nothing about a Project feeds Derived Priority or Plan assembly in
 * this story, so this type carries nothing beyond what a grouping label
 * needs. Extend here, not with a parallel type, if a later story needs more.
 */
export interface Project {
  readonly id: ExternalId;
  readonly name: string;
}

/**
 * CompleteTask — the shape the Data-Completeness Gate (AD-11) produces.
 * Derived from `Task` by making the planning fields required (via
 * `Required<Pick<...>>`) rather than re-listing them, so `CompleteTask`
 * cannot drift out of sync with `Task`'s own field names/types. Every
 * function downstream of the gate (`derived-priority.ts`, `work-break-fit.ts`,
 * `plan-reasoning.ts`) accepts `CompleteTask`, never `Task`, in its
 * signature — a Task with a missing required field cannot type-check its
 * way into Plan assembly.
 */
export interface CompleteTask
  extends Omit<Task, PlanningFieldNames>,
    Required<Pick<Task, PlanningFieldNames>> {}

/**
 * TaskFieldOverride — a partial map of planning-field-name to a
 * Spencer-answered value for one Task, stored by `memory-store.ts` (Task 5's
 * fix: `kind: "task-field-override"`, keyed by `Task.id`) once Spencer
 * answers a Data-Completeness prompt for that field. Deliberately `Partial`
 * (not `Required`, unlike `CompleteTask` above): a Task can accumulate
 * overrides for its missing fields one at a time across several answered
 * prompts, so a partially-answered Task is a legitimate intermediate state.
 *
 * This is NOT itself a `CompleteTask`, and merging one onto a raw `Task`
 * (`rituals/data-completeness.ts`'s `applyTaskFieldOverride`) still only
 * ever produces a plain `Task` — AD-11 still holds: only
 * `core/data-completeness-gate.ts`'s `checkDataCompleteness` may upgrade the
 * merged result into a `CompleteTask`. The merge step itself lives in
 * `rituals/data-completeness.ts`, not the gate, per AD-2 (the gate stays
 * pure/I-O-free and must not read `memory-store.ts` itself).
 */
export type TaskFieldOverride = Partial<Pick<Task, PlanningFieldNames>>;

/**
 * FieldValueSuggestion — FR-25's inferred-value payload. `llm-adapter.ts`'s
 * `suggestFieldValue` returns this when it can confidently infer a missing
 * planning field's value from Spencer's own recent chat lines (AD-11:
 * generated lazily, at `chat-cli.ts` display time, never at ritual time).
 * `taskTitle` rides alongside `taskId` for the same reason
 * `MissingFieldReport` does — so a caller can render a confirmation prompt
 * without a separate Task lookup. `reason` is Claude's own short
 * justification for the inference (what Spencer actually said).
 */
export interface FieldValueSuggestion {
  readonly taskId: ExternalId;
  readonly taskTitle: string;
  readonly field: PlanningFieldNames;
  readonly value: NonNullable<Task[PlanningFieldNames]>;
  readonly reason: string;
}

// ============================================================================
// Plan / PlanBlock (FR-1, FR-6–FR-8, AD-9)
// ============================================================================

/**
 * What a PlanBlock represents on the day's timeline:
 *  - `work`: a block of focused time on a specific Task (`taskId` set).
 *  - `break`: a work/break-rhythm rest block (FR-6–FR-8), no Task attached.
 *  - `calendar-anchor`: a fixed Google Calendar event the Plan is built
 *    around, not a block Yoh can reschedule (FR-1).
 */
export type PlanBlockKind = "work" | "break" | "calendar-anchor";

/**
 * PlanBlock carries a stable `id` (AD-9). Every reference to a PlanBlock —
 * lookup, update, reorder, in `slip-bump.ts`, `night-ritual.ts`, or
 * `mid-day-reflow.ts` alike — must address it by this `id`, never by array
 * position.
 */
export interface PlanBlock {
  readonly id: string;
  readonly kind: PlanBlockKind;
  readonly start: IsoDateTime;
  readonly end: IsoDateTime;
  /** Set when `kind` is `"work"`; absent for `"break"` and `"calendar-anchor"` blocks. */
  readonly taskId?: ExternalId;
  /** Short human-readable label shown in the Plan notification (Task title, "Break", or the Calendar event's own title). */
  readonly label: string;
}

/**
 * Plan — one ordered Plan per day (FR-1), assembled from CompleteTasks and
 * fixed Calendar events. `version` supports the optimistic-concurrency
 * write pattern `memory-store.ts` implements per AD-10 (checked on every
 * read-modify-write sequence, e.g. Mid-Day Re-Flow updating blocks
 * concurrently with a Night Ritual close-out).
 */
export interface Plan {
  readonly id: string;
  readonly date: IsoDate;
  readonly blocks: readonly PlanBlock[];
  /** FR-3's one-line reasoning for why the Plan is ordered/shaped this way. */
  readonly reasoning: string;
  readonly version: number;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

// ============================================================================
// CalendarEvent (FR-1, AD-10)
// ============================================================================

/**
 * CalendarEvent — a single event read from Spencer's primary Google
 * Calendar (`calendar-adapter.ts`, Task 4/Story 1.4), used to build a Plan's
 * `calendar-anchor` PlanBlocks (FR-1) around Spencer's real fixed
 * commitments. Added because no earlier task needed a representation of a
 * raw Calendar event; deliberately minimal (id + title + start/end) since
 * Story 1.4's acceptance criteria requires only "every one of today's
 * events with start/end time" — extend here, not with a parallel type, if a
 * later story needs more (e.g. attendees, location). `start`/`end` are
 * `IsoDateTime` (UTC), converted from the Calendar API's own
 * `dateTime`/`date` event-time shape by `calendar-adapter.ts`.
 */
export interface CalendarEvent {
  readonly id: ExternalId;
  /** The event's title (Google Calendar's own "summary" field), used as `PlanBlock.label` for `calendar-anchor` blocks. */
  readonly title: string;
  readonly start: IsoDateTime;
  readonly end: IsoDateTime;
}

// ============================================================================
// TimeBudget (FR-5, FR-7)
// ============================================================================

/**
 * TimeBudget — Spencer's declared available time for a given day (FR-5),
 * used to fit Plan Blocks via the clock-based work/break rhythm (FR-6–FR-8),
 * defaulting to 70/15.
 */
export interface TimeBudget {
  readonly date: IsoDate;
  readonly totalMinutes: number;
  readonly workMinutes: number;
  readonly breakMinutes: number;
}

// ============================================================================
// Proposal<T> (AD-3 — Propose-Don't-Impose)
// ============================================================================

/**
 * Proposal<T> — the durable, versioned shape any function returns instead
 * of directly applying a suggested behavior or budget change (AD-3): a
 * learned pattern (FR-16) or a suggested Time Budget change (FR-5). Persisted
 * by `memory-store.ts` as an open interaction request until Spencer answers
 * yes/no in `chat-cli.ts`, which then calls the matching `apply(proposal)`
 * function.
 *
 * `entityVersion` is the snapshot/version of the entity this proposal would
 * change, captured at proposal-creation time; `apply` must re-read the live
 * entity and reject with `YohError.kind: "stale-proposal"` if its current
 * version no longer matches this snapshot.
 */
export interface Proposal<T> {
  readonly id: string;
  /** What kind of change this proposes, e.g. "time-budget-change", "learned-pattern". Free-form per proposer — not a fixed enum, since new proposal kinds may be added by later tasks without touching this type. */
  readonly kind: string;
  /** The id of the entity this proposal would change (e.g. a TimeBudget's date, a Task's id). */
  readonly entityId: string;
  /** The entity's version/updated-at snapshot at proposal-creation time, checked by `apply` for staleness. */
  readonly entityVersion: string;
  /** The suggested change itself. */
  readonly suggested: T;
  /** Human-readable reason shown to Spencer when the proposal is surfaced. */
  readonly reason: string;
  readonly createdAt: IsoDateTime;
}

// ============================================================================
// InteractionRequest<T> (AD-5 — durable, indefinitely-waiting prompts)
// ============================================================================

/**
 * InteractionRequest — the generic "Yoh needs an answer from Spencer before
 * it can proceed" envelope AD-5 requires `memory-store.ts` to persist as an
 * open interaction request, and `chat-cli.ts` to surface before accepting
 * any unrelated input (UX-DR5). Introduced by Task 5 (the Data-Completeness
 * Gate, FR-4) as the first of several prompt kinds sharing this pattern —
 * later tasks (Night close-out FR-12–FR-14, Self-Check FR-17,
 * Propose-Don't-Impose AD-3) persist their own prompts through the same
 * shape rather than each inventing a parallel one. A `Proposal<T>` (above)
 * is itself surfaced this way: AD-3 says "`memory-store.ts` persists every
 * open `Proposal` as an open interaction request", i.e. a proposal is
 * wrapped as this type's `detail` payload with `requestKind: "proposal"`.
 *
 * `memory-store.ts` stores each `InteractionRequest` as a `records` row
 * keyed by `(kind: "interaction-request", id)`; `id` is chosen by the
 * requester (e.g. a fixed singleton id like `"data-completeness"` so
 * multiple incomplete Tasks collapse into the one open request UX-DR10
 * requires, rather than one row per Task) and doubles as the handle
 * `chat-cli.ts` clears once Spencer answers (UX-DR20: no timeout ever
 * expires an open request — it waits indefinitely for that clear).
 */
export interface InteractionRequest<TDetail = unknown> {
  /** What this request is about, e.g. "data-completeness", "night-close-out", "self-check", "proposal". Free-form per requester, not a fixed enum — mirrors `Proposal.kind`'s own free-form design so a later task can add a new request kind without touching this shape. */
  readonly requestKind: string;
  /** The accent-labeled prompt line(s) `chat-cli.ts` renders verbatim before accepting other input (UX-DR5, UX-DR10). */
  readonly promptText: string;
  /** Structured payload specific to `requestKind`, for a caller that wants to act on the answer programmatically (e.g. which Task fields are missing on which Tasks) — like `YohError.detail`, callers should not depend on its shape beyond what they themselves wrote. */
  readonly detail?: TDetail;
  readonly createdAt: IsoDateTime;
}

// ============================================================================
// Escalate-Under-Strain (AD-6)
// ============================================================================

/**
 * EscalationCurve — the per-consumer shape (cap, step) that
 * `computeEscalation` applies to a strain count. `slip-bump.ts`,
 * `self-check.ts`, and `tone.ts` each supply their own curve; the curve
 * shape itself is shared and defined once here (AD-6).
 */
export interface EscalationCurve {
  /** The maximum escalation level this curve ever produces, regardless of strainCount. */
  readonly cap: number;
  /** The amount the escalation level increases per additional strain event. */
  readonly step: number;
}

/**
 * EscalationLevel — the result of `computeEscalation(strainCount, curve)`.
 * `value` is always a non-negative number no greater than `curve.cap`;
 * `atCap` is a convenience flag so a consumer (e.g. `tone.ts` choosing its
 * most intense phrasing) doesn't need to recompute the comparison itself.
 *
 * Implementer's note (Task 1, flagged for the escalate-under-strain.ts
 * task to confirm): this shape is a reasonable-default reading of AD-6's
 * one-line signature, not dictated verbatim by the spine. If
 * `escalate-under-strain.ts` needs a different/richer shape, extend this
 * interface rather than forking a parallel type.
 */
export interface EscalationLevel {
  readonly value: number;
  readonly atCap: boolean;
}
