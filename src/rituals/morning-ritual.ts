/**
 * src/rituals/morning-ritual.ts
 *
 * The Morning Ritual (Story 1.10 / FR-1, FR-3): the first `rituals/*.ts`
 * file, and the place every `core/` + `adapters/` piece built so far is
 * finally assembled into one delivered artifact — a single ordered Plan,
 * rendered per DESIGN.md, pushed to Spencer's phone exactly once a day.
 *
 * ============================================================================
 * Orchestration (the shape this file commits to)
 * ============================================================================
 *
 * `runMorningRitual` runs these steps in order, short-circuiting on the
 * first that can't proceed. Every I/O edge is injected (`MorningRitualDeps`)
 * so the whole ritual is testable without a network, a clock, or a TTY;
 * `shell/ritual-cli.ts` is what binds the real adapters to these seams.
 *
 *  1. **Idempotence guard.** Read the `"morning"` ritual-run marker from
 *     `memory-store.ts`. If it already records today's LOCAL date, return
 *     `already-ran` immediately — no re-read, no re-plan, and above all no
 *     second notification (Story 1.10's second acceptance criterion). This
 *     is first so a duplicate cron trigger costs two SQLite reads and zero
 *     API calls.
 *  2. **Read Notion Tasks** (`readTasks`, may throw — AD-8).
 *  3. **Merge stored `TaskFieldOverride`s, run the Data-Completeness Gate,
 *     and sync the open interaction request** (`runDataCompletenessGate`,
 *     below — the same wiring `shell/chat-cli.ts` has used since Task 5,
 *     which now lives here; see "Where the gate wiring lives" below).
 *  4. **Decide whether there is anything to plan.** Per AD-11 an incomplete
 *     Task simply never becomes a `CompleteTask`, so it is absent from the
 *     Plan while every complete Task is planned normally — an incomplete
 *     Task never blocks the rest of the day (UX-DR10: "gate what you can,
 *     prompt for the rest"). Only when NO Task is complete is there nothing
 *     to build: that run returns `nothing-to-plan`, sends no notification,
 *     and deliberately does NOT write the ran-today marker, so a later
 *     trigger (after Spencer answers the open prompt in `chat-cli.ts`) can
 *     still produce the morning Plan rather than the day being burned by a
 *     run that produced nothing.
 *  5. **Read today's Calendar events** (`readCalendarEvents`, may throw).
 *     Deliberately after the gate, so a day with nothing plannable costs no
 *     Calendar API call.
 *  6. **Read today's declared Time Budget** (`getCurrentTimeBudget` +
 *     `core/time-budget.ts`'s `resolveTodayTimeBudget`, which reports a
 *     carried-forward value without ever expiring it). If Spencer has never
 *     declared one, this fails with `YohError.kind: "missing-field"` rather
 *     than inventing a total — `core/time-budget.ts` deliberately defines no
 *     default total (only the 70/15 work/break rhythm), and quietly guessing
 *     one would fabricate the single input FR-5 exists to get from Spencer.
 *  7. **Order by Derived Priority** (`core/derived-priority.ts`).
 *  8. **Fit into Work/Break blocks around the Calendar anchors**
 *     (`core/work-break-fit.ts`), starting at the instant the ritual runs.
 *  9. **Generate the reasoning line** (`core/plan-reasoning.ts`) — see the
 *     contract note below.
 * 10. **Assemble the `Plan`** per `types/domain.ts` (no new/parallel type;
 *     AD-9), stamping `version` as one past whatever Plan is already stored
 *     for the date (ordinarily none, given step 1).
 * 11. **Render it** (`renderPlan`, below — DESIGN.md's layout/color rules).
 * 12. **Persist the Plan and the ran-today marker**, THEN **send exactly one
 *     Pushover notification.** The order is deliberate: persisting first
 *     makes the notification at-most-once (Story 1.10's explicit criterion),
 *     at the documented cost that a Pushover outage means no notification
 *     that day rather than a retry. The `Result` failure and structured log
 *     line this returns are what Epic 5's AD-7 failure alerting will hang
 *     off; this task builds the shape, not the alert.
 *
 * ----------------------------------------------------------------------------
 * The `plan-reasoning.ts` contract
 * ----------------------------------------------------------------------------
 *
 * `generatePlanReasoning` re-derives the Derived Priority ordering itself,
 * and its doc comment requires being handed the exact same candidate
 * `tasks` set and the exact same `bumpLevels` that produced this Plan's
 * ordering — otherwise the sentence under the block list can describe a
 * different ordering than the one rendered above it. This file therefore
 * builds ONE `candidates` array (the gate's `completeTasks`) and ONE
 * `bumpLevels` reference (`deps.bumpLevels`), and passes those same two
 * values to `orderByDerivedPriority` and `generatePlanReasoning` alike;
 * `fitWorkBreakBlocks` receives the ordering derived from them. There is no
 * second, separately-filtered task list anywhere in this function.
 *
 * Known edge (documented rather than silently papered over): if the lead
 * Task is DEFERRED by `fitWorkBreakBlocks` because it cannot fit today's
 * remaining budget, the reasoning line still names it as leading the Plan
 * while no block for it appears. Filtering the deferred Tasks back out and
 * re-deriving would break the "same array" contract above AND could change
 * the ordering itself (`derived-priority.ts`'s secondary sub-scores are
 * normalized across the candidate set, so removing a member can reorder the
 * survivors). The contract is honored as written; the deferral wording is
 * left for whichever later story owns "here's what didn't fit today."
 *
 * ----------------------------------------------------------------------------
 * Where the gate wiring lives (moved here from `shell/chat-cli.ts`)
 * ----------------------------------------------------------------------------
 *
 * `applyTaskFieldOverride` / `mergeStoredOverrides` /
 * `syncDataCompletenessInteractionRequest` were written in
 * `shell/chat-cli.ts` by Task 5, whose own doc comment recorded why: "a
 * `rituals/*.ts` file would be the more natural home once one exists for
 * this concern, but none is owned by this task." This is that file, and this
 * ritual needs the exact same merge-then-gate-then-sync sequence chat-cli
 * does — duplicating a *stateful* sync that writes the same singleton
 * `"data-completeness"` request from two files would let the two drift.
 * They therefore live here now and `shell/chat-cli.ts` re-exports them
 * unchanged (AD-1 allows `shell -> rituals`, never the reverse), so nothing
 * about chat-cli's public surface or behavior changes.
 *
 * ----------------------------------------------------------------------------
 * Rendering lives here, not in `core/` or `shell/`
 * ----------------------------------------------------------------------------
 *
 * `renderPlan` is presentation, not business logic, so it must not go in
 * `core/` (AD-2). It also must not be private to `shell/ritual-cli.ts`:
 * Task 11 gives `chat-cli.ts` an on-demand "what's my plan" view that has to
 * render the identical thing. It is therefore a pure
 * `(plan, options) => string` exported from this `rituals/` file, which both
 * shells import (AD-1: `shell -> rituals`). The DESIGN.md color tokens
 * (`ACCENT`, `MUTED`, `RESET`) are exported from here for the same reason —
 * Task 5 had no shared home for them and kept a private copy in
 * `chat-cli.ts`; that copy is now gone.
 */
import {
  clearInteractionRequest,
  getCurrentTimeBudget,
  getOpenInteractionRequest,
  getPlan,
  getRitualRun,
  getTaskFieldOverride,
  putOpenInteractionRequest,
  putPlan,
  putRitualRun,
  type MemoryStore,
} from "../adapters/memory-store.ts";
import {
  checkDataCompleteness,
  type DataCompletenessGateResult,
  type MissingFieldReport,
} from "../core/data-completeness-gate.ts";
import { orderByDerivedPriority } from "../core/derived-priority.ts";
import { generatePlanReasoning } from "../core/plan-reasoning.ts";
import { resolveTodayTimeBudget } from "../core/time-budget.ts";
import { fitWorkBreakBlocks } from "../core/work-break-fit.ts";
import type {
  CalendarEvent,
  ExternalId,
  InteractionRequest,
  IsoDate,
  IsoDateTime,
  Plan,
  PlanBlock,
  PlanningFieldNames,
  Result,
  Task,
  TaskFieldOverride,
  YohError,
} from "../types/domain.ts";

// ============================================================================
// DESIGN.md color tokens (UX-DR1) — defined once, for every caller
// ============================================================================

/**
 * 24-bit ANSI truecolor escape for DESIGN.md's `colors.accent` (#5FAFFF).
 * Used ONLY for a section label — the Plan's header here, a prompt's label
 * in `chat-cli.ts` — never for emphasis inside body text.
 */
export const ACCENT = "\x1b[38;2;95;175;255m";

/**
 * 24-bit ANSI truecolor escape for DESIGN.md's `colors.muted` (#6B6B6B).
 * Used ONLY for the one-line Plan reasoning (UX-DR4), so the "why" reads as
 * a quiet aside rather than a competing headline.
 */
export const MUTED = "\x1b[38;2;107;107;107m";

/** Ends any of the above spans, returning to the terminal's own default body color (`colors.text-default`). */
export const RESET = "\x1b[0m";

/**
 * Whether to emit color at all. DESIGN.md is explicit that truecolor support
 * must not be assumed and that everything must degrade gracefully to plain
 * text — and UX-DR20 requires every color cue to be paired with plain-text
 * wording carrying the same meaning, which is what makes turning color off
 * entirely a lossless degradation rather than a loss of information.
 *
 * Honors the `NO_COLOR` convention and `TERM=dumb`, and otherwise defers to
 * whether the destination is an interactive terminal (a piped or redirected
 * stream — including the text that goes into a push notification — gets
 * plain text).
 */
export function shouldUseColor(
  env: Readonly<Record<string, string | undefined>> = process.env,
  isTty: boolean = process.stdout.isTTY === true,
): boolean {
  if (env["NO_COLOR"] !== undefined) return false;
  if (env["TERM"] === "dumb") return false;
  return isTty;
}

// ============================================================================
// Data-Completeness Gate wiring (moved from `shell/chat-cli.ts`, Task 5)
// ============================================================================

/** Human-readable labels for `PlanningFieldNames`, used only in prompt text — the gate itself (`core/data-completeness-gate.ts`) stays presentation-agnostic per its Implementer note. */
export const PLANNING_FIELD_LABELS: Record<PlanningFieldNames, string> = {
  estimatedDurationMinutes: "Estimated Duration",
  area: "Area",
  dueDate: "Due Date",
  status: "Status",
  energy: "Energy",
};

/**
 * Turns the gate's `MissingFieldReport[]` into the single combined prompt
 * text UX-DR10 requires: "one prompt may cover multiple missing fields
 * across multiple Tasks if needed" — never a bulk "clean up your whole
 * database" request, and never one prompt per Task. Pure/no I/O; the caller
 * applies the accent-color wrapping when actually printing it.
 */
export function buildMissingFieldsPromptText(incomplete: readonly MissingFieldReport[]): string {
  const subject = incomplete.length === 1 ? "this Task" : "these Tasks";
  const lines = incomplete.map((report) => {
    const fields = report.missingFields.map((field) => PLANNING_FIELD_LABELS[field]).join(", ");
    return `  - "${report.taskTitle}": ${fields}`;
  });
  return [`I need a bit more before I can plan around ${subject}:`, ...lines].join("\n");
}

/**
 * Merges a `TaskFieldOverride` onto `task`: every field the override sets
 * wins; every field it leaves unset keeps `task`'s own value (which may
 * itself still be `undefined`, if Spencer hasn't answered that one yet).
 * Pure — no I/O — but deliberately not inside `core/data-completeness-gate.ts`
 * per AD-2: the gate must not read `memory-store.ts`, so it cannot know
 * about overrides itself. The result is still a plain `Task`, never a
 * `CompleteTask` — AD-11 holds: only `checkDataCompleteness` may produce a
 * `CompleteTask`, and it's still the next call to it that does so once every
 * field is present, merged or otherwise.
 */
export function applyTaskFieldOverride(task: Task, override: TaskFieldOverride | undefined): Task {
  if (!override) return task;
  // `override`'s fields are typed as present-or-absent (not
  // present-with-possible-undefined) under `exactOptionalPropertyTypes`, so
  // spreading it after `task` only ever overwrites a field with a real
  // value, never with an explicit `undefined` — the cast documents that
  // runtime guarantee to the type checker, mirroring
  // `data-completeness-gate.ts`'s own `toCompleteTask` cast.
  return { ...task, ...override } as Task;
}

/**
 * Merges each Task's own stored `TaskFieldOverride` (if any) from
 * `memory-store.ts` onto it, returning the merged Task list — the
 * caller-side merge step applied before handing Tasks to the gate. A Task
 * with no stored override is returned unchanged.
 */
export function mergeStoredOverrides(store: MemoryStore, tasks: readonly Task[]): Task[] {
  return tasks.map((task) => applyTaskFieldOverride(task, getTaskFieldOverride(store, task.id)?.data));
}

/** The fixed, singleton `id` the Data-Completeness Gate's open interaction request is stored under (so multiple incomplete Tasks collapse into one request, per UX-DR10, rather than one row per Task). */
export const DATA_COMPLETENESS_REQUEST_ID = "data-completeness";

/**
 * Merges any stored `TaskFieldOverride`s onto `tasks` (so a
 * previously-answered field actually counts), runs the pure
 * Data-Completeness Gate over the result, then persists or clears the single
 * combined `"data-completeness"` interaction request in `memory-store.ts` to
 * match — the wiring the gate itself is forbidden from doing (AD-2/AD-11:
 * the gate must stay pure) — and returns the gate's own result so the caller
 * can go on to plan the Tasks that DID pass.
 *
 * - Every (merged) Task complete, no request currently open: no-op.
 * - Every (merged) Task complete, a request WAS open (Spencer answered the
 *   missing field(s), the override was stored, and the gate re-ran with the
 *   merged Task): the request is cleared — Story 1.5's "the interaction
 *   request is cleared" criterion.
 * - Any (merged) Task still incomplete: the request is opened (or replaced,
 *   if one is already open with stale content) naming exactly the missing
 *   field(s) on exactly the Tasks that have them — while the complete Tasks
 *   are still returned for planning (UX-DR10's "gate what you can, prompt
 *   for the rest").
 *
 * Returns the gate's `Result` rather than throwing on a malformed candidate
 * set (currently: duplicate Task ids), so a `rituals/*.ts` caller can convert
 * it per AD-8. `syncDataCompletenessInteractionRequest` below is the
 * throwing wrapper `shell/chat-cli.ts` has always used.
 */
export function runDataCompletenessGate(
  store: MemoryStore,
  tasks: readonly Task[],
): Result<DataCompletenessGateResult, YohError> {
  const merged = mergeStoredOverrides(store, tasks);
  const result = checkDataCompleteness(merged);
  if (!result.ok) return result;

  const existing = getOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID);

  if (result.value.incomplete.length === 0) {
    if (existing) {
      clearInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID, existing.version);
    }
    return result;
  }

  const request: InteractionRequest<{ incomplete: readonly MissingFieldReport[] }> = {
    requestKind: "data-completeness",
    promptText: buildMissingFieldsPromptText(result.value.incomplete),
    detail: { incomplete: result.value.incomplete },
    createdAt: new Date().toISOString(),
  };
  putOpenInteractionRequest(store, DATA_COMPLETENESS_REQUEST_ID, request);
  return result;
}

/**
 * `runDataCompletenessGate` with the throw-on-malformed-input behavior
 * `shell/chat-cli.ts` established in Task 5 and its callers still expect.
 * Kept as a separate wrapper (rather than changing that behavior) so this
 * move is behavior-preserving for `shell/`: AD-8's "never throws" rule binds
 * `core/*.ts`, not the shell, and chat-cli has no `Result` channel to
 * surface a duplicate-id bug through.
 */
export function syncDataCompletenessInteractionRequest(store: MemoryStore, tasks: readonly Task[]): void {
  const result = runDataCompletenessGate(store, tasks);
  if (!result.ok) {
    throw new Error(`chat-cli: data-completeness-gate rejected the candidate Task set: ${result.error.message}`);
  }
}

// ============================================================================
// renderPlan — DESIGN.md's Plan block list (UX-DR1..DR4, DR7, DR8, DR20)
// ============================================================================

/** DESIGN.md's `spacing.wrap-width` (`80ch`) — body wraps at roughly 80 characters so output stays readable without resizing the terminal. */
export const WRAP_WIDTH = 80;

/** The plain-text marker a `calendar-anchor` block carries so a fixed Calendar event reads as immovable WITHOUT relying on color or on the reader knowing about `PlanBlockKind` (UX-DR20). */
const ANCHOR_MARKER = "(fixed)";

export interface RenderPlanOptions {
  /** IANA zone the block times are rendered in. Per the Consistency Conventions, Plans are stored in UTC and converted to Spencer's local time only at this presentation edge. Defaults to the host's own zone. */
  readonly timeZone?: string;
  /** Emit ANSI color. Defaults to `shouldUseColor()` — i.e. off for a pipe, a redirect, `NO_COLOR`, or a notification body. */
  readonly color?: boolean;
  /** Column to wrap body text at, defaulting to `WRAP_WIDTH`. */
  readonly width?: number;
  /** Include the accent-labeled "Today's Plan for ..." header. `false` is what the push-notification body uses, since the notification's own title carries the label. */
  readonly includeHeader?: boolean;
}

/**
 * Renders `plan` as the plain monospace text DESIGN.md specifies, and
 * nothing else — no image content, no box-drawing characters, no rules or
 * ASCII dividers, no emoji, no celebratory flourish (UX-DR7, UX-DR8,
 * UX-DR20).
 *
 * Layout (UX-DR2: exactly one blank line between structural units):
 *
 *     Today's Plan for Saturday, August 22      <- {colors.accent} label
 *                                               <- one blank line
 *     09:00-10:10  Draft the quarterly memo     <- {colors.text-default}
 *     10:10-10:25  Break
 *     10:30-11:00  Standup (fixed)
 *                                               <- one blank line
 *     "Draft the quarterly memo" leads today... <- {colors.muted}
 *
 * One line per block, in `plan.blocks` order (which IS Plan order — this
 * function never re-sorts, so what it shows is what was assembled): a time
 * range, then the item, nothing else. A `calendar-anchor` block is suffixed
 * `(fixed)` so a fixed Calendar event reads as an immovable anchor rather
 * than something Yoh could reschedule; work and break blocks carry no such
 * marker.
 *
 * Pure and free of I/O beyond reading `Intl` — deliberately so, because
 * Task 11 (`chat-cli.ts`'s on-demand "what's my plan" view) calls this exact
 * function with the exact same signature.
 */
export function renderPlan(plan: Plan, options: RenderPlanOptions = {}): string {
  const timeZone = options.timeZone ?? hostTimeZone();
  const color = options.color ?? shouldUseColor();
  const width = options.width ?? WRAP_WIDTH;
  const includeHeader = options.includeHeader ?? true;

  const units: string[][] = [];

  if (includeHeader) {
    const header = `Today's Plan for ${formatPlanDate(plan.date)}`;
    units.push(wrapText(header, width).map((line) => paint(line, ACCENT, color)));
  }

  units.push(
    plan.blocks.length === 0
      ? ["Nothing is scheduled in this Plan."]
      : plan.blocks.flatMap((block) => renderBlockLine(block, timeZone, width)),
  );

  if (plan.reasoning.length > 0) {
    units.push(wrapText(plan.reasoning, width).map((line) => paint(line, MUTED, color)));
  }

  // One blank line between each structural unit, and no trailing blank —
  // "enough to scan, not so much that a short Plan feels sparse."
  return units.map((unit) => unit.join("\n")).join("\n\n");
}

/** One block's line(s): `HH:MM-HH:MM  Item`, wrapped with a hanging indent under the item column. */
function renderBlockLine(block: PlanBlock, timeZone: string, width: number): string[] {
  const range = `${formatLocalTime(block.start, timeZone)}-${formatLocalTime(block.end, timeZone)}`;
  const item = block.kind === "calendar-anchor" ? `${block.label} ${ANCHOR_MARKER}` : block.label;
  return wrapWithHangingIndent(`${range}  `, item, width);
}

function paint(text: string, colorCode: string, enabled: boolean): string {
  return enabled ? `${colorCode}${text}${RESET}` : text;
}

/**
 * Greedy word wrap at `width` columns. A single token longer than the
 * available width is left intact on its own line rather than broken
 * mid-word — a truncated or hyphen-split Task title reads as a different
 * Task, which is a worse failure than one over-long line.
 */
function wrapText(text: string, width: number): string[] {
  return wrapWithHangingIndent("", text, width);
}

/**
 * Wraps `text` at `width`, prefixing the first line with `prefix` and every
 * continuation line with a run of spaces the same length — so a wrapped
 * block line hangs under the item column instead of colliding with the time
 * range.
 */
function wrapWithHangingIndent(prefix: string, text: string, width: number): string[] {
  const indent = " ".repeat(prefix.length);
  const available = Math.max(1, width - prefix.length);
  const lines: string[] = [];
  let current = "";

  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= available) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  lines.push(current);

  // `.replace` strips trailing spaces, which only ever appear when `text` is
  // empty (a Notion Task whose title property is blank reaches
  // `notion-adapter.ts`'s `getTitle` as `""`) — emitting a line of invisible
  // padding would be sloppy terminal output for no benefit.
  return lines.map((line, index) =>
    (index === 0 ? `${prefix}${line}` : `${indent}${line}`).replace(/[ \t]+$/, ""),
  );
}

// ============================================================================
// Date/time formatting (the local-time presentation edge)
// ============================================================================

function hostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** `"2026-08-22"` -> `"Saturday, August 22"`. Formatted in UTC against the date's own midnight so no zone offset can shift the printed day off `plan.date`. */
function formatPlanDate(date: IsoDate): string {
  const [year, month, day] = date.split("-").map(Number);
  const instant = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(instant);
}

/** A stored UTC `IsoDateTime` as `HH:MM` wall-clock time in `timeZone`. */
function formatLocalTime(instant: IsoDateTime, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/**
 * The LOCAL calendar date of `instant` in `timeZone`. "Today" must be
 * Spencer's own calendar day, never the UTC one — the same reasoning
 * `calendar-adapter.ts` documents at length for its own day window. Computed
 * from `Intl` rather than imported from that adapter, whose helpers are
 * private to it (mirroring the small, deliberate duplications already
 * present between `core/time-budget.ts` and `core/derived-priority.ts`).
 */
export function localIsoDate(instant: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// ============================================================================
// runMorningRitual — the orchestration itself
// ============================================================================

/** The ritual id the "already ran today" marker is stored under in `memory-store.ts`. */
export const MORNING_RITUAL_ID = "morning";

/**
 * The notification's title. Plain text: DESIGN.md's
 * `{components.notification}` asks for `{colors.accent}` emphasis "where the
 * platform supports styled notification text", and Pushover titles support
 * no styling at all — so per UX-DR20 the cue is carried by the wording
 * itself, which names the Plan as plainly as the color would have.
 */
export const NOTIFICATION_TITLE = "Today's Plan";

/** What `MorningRitualDeps.sendNotification` receives — the `adapters/notification-adapter.ts` message shape, minus its credentials. */
export interface PlanNotification {
  readonly title: string;
  readonly message: string;
}

/** One structured log line. AD-7's real failure alerting is Epic 5; this is the seam it will read from. */
export interface MorningRitualLogEntry {
  readonly level: "info" | "warn" | "error";
  readonly event: string;
  readonly detail?: unknown;
}

/**
 * Every input and I/O edge the Morning Ritual needs, injected rather than
 * constructed here: `shell/ritual-cli.ts` binds the real Notion, Calendar,
 * and Pushover adapters to these seams, and tests bind fakes. `readTasks`
 * and `readCalendarEvents` are expected to throw on I/O failure (AD-8) —
 * catching that is this file's job, not theirs.
 */
export interface MorningRitualDeps {
  readonly store: MemoryStore;
  /** `adapters/notion-adapter.ts`'s `readNotionTasks`, pre-bound to its client/config. Throws on I/O failure. */
  readonly readTasks: () => Promise<readonly Task[]>;
  /** `adapters/calendar-adapter.ts`'s `readCalendarEvents`, pre-bound to its client/config. Throws on I/O failure. */
  readonly readCalendarEvents: () => Promise<readonly CalendarEvent[]>;
  /** `adapters/notification-adapter.ts`'s `sendPushoverNotification`, pre-bound to its config. Throws on I/O failure. */
  readonly sendNotification: (notification: PlanNotification) => Promise<void>;
  /** Injectable clock — never `new Date()` inline, so a test can pin the day. */
  readonly now: () => Date;
  /** Spencer's IANA timezone, defining both "today" and the rendered wall-clock times. */
  readonly timeZone: string;
  /** Slip-Bump levels (Task 17 / FR-11). Threaded through to BOTH the ordering and the reasoning line so they can never disagree. */
  readonly bumpLevels?: Readonly<Record<ExternalId, number>>;
  readonly log?: (entry: MorningRitualLogEntry) => void;
  /** Forces color on/off for the returned `rendered` text; defaults to `shouldUseColor()`. The notification body is always plain. */
  readonly color?: boolean;
}

/** What one Morning Ritual run did. Discriminated on `status` so a caller can't confuse "delivered" with "skipped". */
export type MorningRitualOutcome =
  | {
      readonly status: "already-ran";
      readonly date: IsoDate;
      readonly planId: string | undefined;
    }
  | {
      readonly status: "nothing-to-plan";
      readonly date: IsoDate;
      readonly incompleteTaskIds: readonly ExternalId[];
    }
  | {
      readonly status: "delivered";
      readonly date: IsoDate;
      readonly plan: Plan;
      /** The Plan as `renderPlan` produced it, for the CLI to print. */
      readonly rendered: string;
      /** Tasks that could not fit today's Time Budget and were left for a future Plan (never force-fit). */
      readonly deferredTaskIds: readonly ExternalId[];
      /** Tasks the Data-Completeness Gate held back; an open interaction request names them. */
      readonly incompleteTaskIds: readonly ExternalId[];
    };

function failure(kind: YohError["kind"], message: string, detail?: unknown): Result<never, YohError> {
  return { ok: false, error: detail === undefined ? { kind, message } : { kind, message, detail } };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Generates and delivers today's Morning Plan. See the module docstring for
 * the full step-by-step orchestration and the reasoning behind each ordering
 * choice.
 *
 * Per AD-8 this is one of the two layers allowed to catch an adapter's
 * throw: every `deps.readTasks` / `deps.readCalendarEvents` /
 * `deps.sendNotification` call, and every `memory-store.ts` write (which can
 * throw `ConflictError` under AD-10 concurrency with `chat-cli.ts`), is
 * wrapped and converted into a `Result` failure plus a structured log line.
 * Nothing thrown from an adapter escapes this function.
 */
export async function runMorningRitual(deps: MorningRitualDeps): Promise<Result<MorningRitualOutcome, YohError>> {
  const log = deps.log ?? ((): void => {});
  const nowDate = deps.now();
  const nowIso = nowDate.toISOString();
  const today = localIsoDate(nowDate, deps.timeZone);

  // --- 1. Idempotence guard -------------------------------------------------
  const lastRun = getRitualRun(deps.store, MORNING_RITUAL_ID);
  if (lastRun?.data.date === today) {
    log({ level: "info", event: "morning-ritual.already-ran", detail: { date: today } });
    return { ok: true, value: { status: "already-ran", date: today, planId: lastRun.data.planId } };
  }

  // --- 2. Read Notion Tasks (AD-8 boundary) ---------------------------------
  let rawTasks: readonly Task[];
  try {
    rawTasks = await deps.readTasks();
  } catch (err) {
    log({ level: "error", event: "morning-ritual.read-tasks-failed", detail: describeError(err) });
    return failure("unreachable", `morning-ritual: could not read Notion Tasks — ${describeError(err)}`, err);
  }

  // --- 3. Merge overrides, gate, sync the interaction request ---------------
  let gate: Result<DataCompletenessGateResult, YohError>;
  try {
    gate = runDataCompletenessGate(deps.store, rawTasks);
  } catch (err) {
    log({ level: "error", event: "morning-ritual.gate-sync-failed", detail: describeError(err) });
    return failure("conflict", `morning-ritual: could not record the Data-Completeness prompt — ${describeError(err)}`, err);
  }
  if (!gate.ok) {
    log({ level: "error", event: "morning-ritual.gate-rejected", detail: gate.error });
    return gate;
  }

  const candidates = gate.value.completeTasks;
  const incompleteTaskIds = gate.value.incomplete.map((report) => report.taskId);

  // --- 4. Anything to plan? (AD-11 / UX-DR10) -------------------------------
  if (candidates.length === 0) {
    log({ level: "info", event: "morning-ritual.nothing-to-plan", detail: { date: today, incompleteTaskIds } });
    return { ok: true, value: { status: "nothing-to-plan", date: today, incompleteTaskIds } };
  }

  // --- 5. Read today's Calendar events (AD-8 boundary) ----------------------
  let calendarEvents: readonly CalendarEvent[];
  try {
    calendarEvents = await deps.readCalendarEvents();
  } catch (err) {
    log({ level: "error", event: "morning-ritual.read-calendar-failed", detail: describeError(err) });
    return failure("unreachable", `morning-ritual: could not read today's Calendar events — ${describeError(err)}`, err);
  }

  // --- 6. Today's declared Time Budget --------------------------------------
  const storedBudget = getCurrentTimeBudget(deps.store);
  const resolvedBudget = resolveTodayTimeBudget(storedBudget?.data, today);
  if (!resolvedBudget) {
    log({ level: "warn", event: "morning-ritual.no-time-budget", detail: { date: today } });
    return failure(
      "missing-field",
      "morning-ritual: no Time Budget has been declared yet — tell Yoh how much time you have (e.g. `time budget 6 hours` in chat) and re-run the Morning Ritual",
    );
  }
  if (resolvedBudget.carriedForward) {
    log({
      level: "info",
      event: "morning-ritual.time-budget-carried-forward",
      detail: { declaredOn: resolvedBudget.budget.date, today },
    });
  }

  // --- 7-9. Order, fit, and explain — from ONE candidates/bumpLevels pair ---
  const ordered = orderByDerivedPriority(candidates, today, deps.bumpLevels);
  if (!ordered.ok) {
    log({ level: "error", event: "morning-ritual.ordering-rejected", detail: ordered.error });
    return ordered;
  }

  const fitted = fitWorkBreakBlocks({
    tasks: ordered.value,
    budget: resolvedBudget.budget,
    calendarEvents,
    startTime: nowIso,
  });
  if (!fitted.ok) {
    log({ level: "error", event: "morning-ritual.fitting-rejected", detail: fitted.error });
    return fitted;
  }

  // The SAME `candidates` array and the SAME `bumpLevels` reference that
  // produced `ordered` above — see the module docstring's contract note.
  const reasoning = generatePlanReasoning({
    tasks: candidates,
    today,
    ...(deps.bumpLevels ? { bumpLevels: deps.bumpLevels } : {}),
  });
  if (!reasoning.ok) {
    log({ level: "error", event: "morning-ritual.reasoning-rejected", detail: reasoning.error });
    return reasoning;
  }

  // --- 10. Assemble the Plan (AD-9: domain.ts's own shape) ------------------
  const existingPlan = getPlan(deps.store, today);
  const plan: Plan = {
    id: `plan-${today}`,
    date: today,
    blocks: fitted.value.blocks,
    reasoning: reasoning.value,
    version: (existingPlan?.data.version ?? 0) + 1,
    createdAt: existingPlan?.data.createdAt ?? nowIso,
    updatedAt: nowIso,
  };

  // --- 11. Render -----------------------------------------------------------
  const rendered = renderPlan(plan, {
    timeZone: deps.timeZone,
    ...(deps.color === undefined ? {} : { color: deps.color }),
  });

  // --- 12a. Persist BEFORE notifying (at-most-once) -------------------------
  try {
    putPlan(deps.store, plan);
    putRitualRun(deps.store, MORNING_RITUAL_ID, { date: today, ranAt: nowIso, planId: plan.id });
  } catch (err) {
    log({ level: "error", event: "morning-ritual.persist-failed", detail: describeError(err) });
    return failure("conflict", `morning-ritual: could not persist today's Plan — ${describeError(err)}`, err);
  }

  // --- 12b. Send exactly one notification -----------------------------------
  try {
    await deps.sendNotification({
      title: NOTIFICATION_TITLE,
      // The Plan's block list plus its reasoning line, plain text: the
      // notification's own title already carries the label, and a push
      // notification must never carry ANSI escapes. `width` is unbounded
      // here on purpose — DESIGN.md's 80-column wrap exists so terminal
      // output stays readable without resizing, but a phone reflows text to
      // its own screen width, so pre-wrapping at 80 would only produce
      // ragged double-wrapped lines (and would split the reasoning line).
      message: renderPlan(plan, {
        timeZone: deps.timeZone,
        color: false,
        includeHeader: false,
        width: Number.POSITIVE_INFINITY,
      }),
    });
  } catch (err) {
    log({ level: "error", event: "morning-ritual.notify-failed", detail: describeError(err) });
    return failure("unreachable", `morning-ritual: could not send today's Plan notification — ${describeError(err)}`, err);
  }

  log({
    level: "info",
    event: "morning-ritual.delivered",
    detail: { date: today, planId: plan.id, blocks: plan.blocks.length, deferred: fitted.value.deferredTaskIds.length },
  });

  return {
    ok: true,
    value: {
      status: "delivered",
      date: today,
      plan,
      rendered,
      deferredTaskIds: fitted.value.deferredTaskIds,
      incompleteTaskIds,
    },
  };
}
