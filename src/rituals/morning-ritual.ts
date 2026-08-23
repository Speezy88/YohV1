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
 *     If step 1.5 (below) found a pending unchecked night to display, its
 *     notice is prepended as a leading unit ahead of the Plan (Task 21).
 * 12. **Persist the Plan**, then **send exactly one Pushover notification**
 *     (`buildNotificationBody` keeps it inside Pushover's real size limit,
 *     budgeted around the unchecked-night notice's own length when one is
 *     present), then **write the ran-today marker**, then — only once that
 *     marker write succeeds — **stamp the displayed unchecked night as
 *     shown** (Task 21's `UncheckedDay.shownAt`, so UX-DR14's "shown once"
 *     holds). The order is deliberate — see the comments at each step: the
 *     Plan is saved before the send so a delivery failure can't lose it, the
 *     ran-today marker is written after the send so a transient Pushover
 *     failure is retried by the next trigger instead of permanently burning
 *     the day, and `shownAt` is stamped LAST of all so a failed send never
 *     burns Spencer's one guaranteed look at it either. The `Result` failure
 *     and structured log line this returns are what Epic 5's AD-7 failure
 *     alerting will hang off; this task builds the shape, not the alert.
 *
 * Between 8 and 9 there is one more gate: if `fitWorkBreakBlocks` deferred
 * EVERY Task (nothing fit the budget), the run returns `nothing-fits` rather
 * than a Plan with no Tasks in it — see that outcome's own doc comment.
 *
 * ----------------------------------------------------------------------------
 * Step 1.5 — the unchecked-day flag (Task 21 / Story 3.3, FR-14, UX-DR14)
 * ----------------------------------------------------------------------------
 *
 * **Post-review redesign.** The first version of this step DETECTED
 * "was yesterday unchecked" here, by re-reading `rituals/night-ritual.ts`'s
 * `night-escalate` marker and the close-out request singleton. That was
 * wrong on two counts a code review caught: (1) it violated AC1's own
 * wording ("marks the day as unchecked ... when the cap is reached") by
 * deferring the actual marking to the following morning instead of the
 * moment the cap was spent, and (2) both of the singletons it re-read get
 * silently overwritten by the very NEXT night's own `night-prompt`/
 * `night-escalate` runs — so if THIS run didn't happen to reach
 * `"delivered"` on the one morning the inference was still valid, the
 * unchecked night was never recorded anywhere and was gone for good.
 *
 * Detection now happens in `rituals/night-ritual.ts`'s
 * `runNightEscalateRitual`, at the moment it confirms the cap is genuinely
 * spent — see that function's own "Recording the unchecked day" doc
 * comment. This file's job is DISPLAY ONLY: right after the idempotence
 * guard, `listUncheckedDays(deps.store)` (a plain `memory-store.ts` read —
 * no injected seam needed, no cross-file import of `night-ritual.ts`
 * either, since detection no longer lives here at all) is scanned for the
 * OLDEST record with no `shownAt` yet. If one exists, the eventual
 * `"delivered"` outcome carries its notice, and ONLY once that outcome's
 * notification genuinely sends does this file stamp `shownAt`
 * (`markUncheckedDayShown`) so it never shows again.
 *
 * Because the lookup is "oldest not-yet-shown," not "yesterday
 * specifically," a run that never reaches `"delivered"`
 * (`nothing-to-plan`/`nothing-fits`, any failure, or simply not running
 * that day) DELAYS the display rather than losing it: the very next
 * `"delivered"` run, however many days later, still finds the same
 * still-unshown record and shows it. A later night ALSO going unchecked in
 * the meantime does not supersede or lose the earlier one either — it is
 * simply a second row in the same `listUncheckedDays` scan, shown in its
 * own turn (oldest first) on a subsequent delivered morning. Nothing about
 * this design can silently drop an already-recorded unchecked night; the
 * only remaining "gap" is honest and bounded to the delay itself.
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
 * Deferral is handled WITHOUT breaking that contract. `fitWorkBreakBlocks`
 * may defer a Task that cannot fit the remaining budget, leaving it out of
 * the Plan; naming such a Task as "leading today's Plan" would describe a
 * position that doesn't exist. Re-deriving over a filtered array would fix
 * the sentence but break the contract above — and could change the ordering
 * itself, since `derived-priority.ts`'s secondary sub-scores are normalized
 * across the candidate set, so removing a member can reorder the survivors.
 * Instead, `generatePlanReasoning`'s `eligibleTaskIds` parameter (added by
 * this task, additively) narrows only WHICH Task the sentence may describe,
 * leaving the derivation over the full set exactly as the contract requires.
 * This file passes the ids that actually got a `work` PlanBlock.
 *
 * ----------------------------------------------------------------------------
 * Where the gate wiring lives
 * ----------------------------------------------------------------------------
 *
 * NOT here. The merge-then-gate-then-sync sequence is its own capability
 * with two callers in two layers (this file and `shell/chat-cli.ts`), so per
 * AD-9 it lives in its own file, `rituals/data-completeness.ts`, which both
 * import directly. See that file's docstring for the full history.
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
 * `chat-cli.ts`; that copy is now gone. They stay with the renderer that is
 * their heaviest user rather than moving to a file of their own: Task 11
 * imports `renderPlan` from here regardless, so this costs `chat-cli.ts` no
 * coupling it doesn't already have.
 */
import {
  getCurrentTimeBudget,
  getPlan,
  getRitualRun,
  listUncheckedDays,
  markUncheckedDayShown,
  putPlan,
  putRitualRun,
  type MemoryStore,
  type UncheckedDay,
} from "../adapters/memory-store.ts";
import { PUSHOVER_MESSAGE_LIMIT, PUSHOVER_TITLE_LIMIT } from "../adapters/notification-adapter.ts";
import type { DataCompletenessGateResult } from "../core/data-completeness-gate.ts";
import { orderByDerivedPriority } from "../core/derived-priority.ts";
import { generatePlanReasoning } from "../core/plan-reasoning.ts";
import { resolveTodayTimeBudget } from "../core/time-budget.ts";
import { fitWorkBreakBlocks } from "../core/work-break-fit.ts";
import { runDataCompletenessGate } from "./data-completeness.ts";
import type {
  CalendarEvent,
  ExternalId,
  IsoDate,
  IsoDateTime,
  Plan,
  PlanBlock,
  Result,
  Task,
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

/**
 * 24-bit ANSI truecolor escape for DESIGN.md's `colors.attention` (#D08A3E)
 * — a warm amber, deliberately not red (DESIGN.md: "Yoh escalates under
 * strain, it doesn't alarm"). Reserved for exactly the two moments
 * DESIGN.md names ("Do reserve `{colors.attention}` for genuine escalation
 * moments — using it more broadly would blunt the one signal it's meant to
 * carry"): Night Ritual's second, escalated close-out attempt
 * (`rituals/night-ritual.ts`'s `night-escalate` half, Task 20) and the
 * unchecked-day flag (Task 21). First used by Task 20 — added here, not a
 * private copy in that file, for the same reason `ACCENT`/`MUTED` live here
 * rather than in `chat-cli.ts`: this is the established shared color-token
 * home every other file already imports from.
 */
export const ATTENTION = "\x1b[38;2;208;138;62m";

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
// The unchecked-day flag (Task 21 / Story 3.3, FR-14, UX-DR14)
// ============================================================================

/**
 * Plain-text degradation of `{colors.attention}` for the unchecked-day
 * flag, for the one destination in this file that cannot render ANSI color
 * at all: the Pushover push-notification body (`buildNotificationBody`'s
 * own contract: "the notification body is always plain"). This is the same
 * literal marker `rituals/night-ritual.ts`'s `ATTENTION_TEXT_MARKER` uses
 * for its own un-stylable SMTP escalation email, duplicated here rather
 * than imported — the two files' own literal constants stay independent so
 * neither file needs a value-level import of the other. Mirrors the
 * "small, deliberate duplications" precedent this codebase already uses
 * (`localIsoDate`'s own doc comment, above).
 */
export const UNCHECKED_NIGHT_TEXT_MARKER = "ATTENTION:";

/**
 * Renders the "last night wasn't closed out" notice — UX-DR6's `ATTENTION`
 * color marker (DESIGN.md reserves it for exactly two moments: Night
 * Ritual's second, escalated close-out attempt, Task 20; and this, the
 * unchecked-day flag, Task 21), paired with the plain-text
 * `UNCHECKED_NIGHT_TEXT_MARKER` wording per UX-DR20 so the meaning survives
 * with color off. Names every rolled-forward Task by title (this story's
 * own resolution of "mandatory Blocker(s)" — see
 * `rituals/night-ritual.ts`'s `runNightEscalateRitual` doc comment for the
 * full reasoning; `day` here is the exact `UncheckedDay` record that
 * function wrote, read back via `memory-store.ts`). Pure formatting, no
 * I/O — mirrors `night-ritual.ts`'s own `renderNightEscalateNotice`. Takes
 * only the two fields it actually needs (`Pick`, not the full
 * `UncheckedDay`) so a caller doesn't need to fabricate `recordedAt`/
 * `shownAt` just to render a notice.
 */
export function renderUncheckedNightNotice(
  day: Pick<UncheckedDay, "date" | "rolledForwardTasks">,
  options: { readonly color?: boolean } = {},
): string {
  const color = options.color ?? shouldUseColor();
  const titles = day.rolledForwardTasks.map((t) => t.taskTitle).join(", ");
  const text = `${UNCHECKED_NIGHT_TEXT_MARKER} ${formatPlanDate(day.date)} wasn't closed out — rolled forward: ${
    titles.length > 0 ? titles : "nothing named"
  }.`;
  return paint(text, ATTENTION, color);
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

/**
 * Builds the push-notification body: the Plan's block list plus its
 * reasoning line, plain text, guaranteed to fit `limit` characters.
 *
 * `width` is unbounded on purpose — DESIGN.md's 80-column wrap exists so
 * TERMINAL output stays readable without resizing, but a phone reflows text
 * to its own screen width, so pre-wrapping at 80 would only produce ragged
 * double-wrapped lines (and would split the reasoning line mid-sentence).
 *
 * Length, though, is a hard external constraint: Pushover rejects a message
 * over `PUSHOVER_MESSAGE_LIMIT` outright, and a busy day (a dozen blocks
 * carrying full Notion titles) genuinely reaches it. A rejected send is
 * especially costly here because it means the day's ONLY notification is
 * lost, so this function never hands the adapter something over the limit:
 * it drops whole block lines from the END (the latest blocks — the ones
 * furthest from "what do I do next") and says plainly how many it dropped.
 *
 * The reasoning line is preserved in preference to blocks, because DESIGN.md
 * names it as the notification body's required content
 * (`{components.notification}`); only if it alone still doesn't fit is it
 * itself truncated with an ellipsis, which is the last resort.
 */
export function buildNotificationBody(
  plan: Plan,
  timeZone: string,
  limit: number = PUSHOVER_MESSAGE_LIMIT,
): string {
  const blockLines = plan.blocks.flatMap((block) =>
    renderBlockLine(block, timeZone, Number.POSITIVE_INFINITY),
  );
  const tail = plan.reasoning.length > 0 ? `\n\n${plan.reasoning}` : "";

  const full = `${blockLines.join("\n")}${tail}`;
  if (full.length <= limit) return full;

  // Drop block lines from the end until the body (plus an honest "and N
  // more" note) fits. `kept` counts down rather than searching, so this
  // always terminates and always lands under the limit.
  for (let kept = blockLines.length - 1; kept >= 0; kept--) {
    const dropped = blockLines.length - kept;
    const note = `... and ${dropped} more block${dropped === 1 ? "" : "s"} — see the terminal for the full Plan.`;
    const candidate = `${[...blockLines.slice(0, kept), note].join("\n")}${tail}`;
    if (candidate.length <= limit) return candidate;
  }

  // Even zero blocks plus the reasoning line is too long — truncate the
  // reasoning itself rather than emit something the adapter will refuse.
  return `${plan.reasoning.slice(0, Math.max(0, limit - 1))}…`.slice(0, limit);
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
      /**
       * Every plannable Task was deferred — nothing fit today's Time Budget,
       * so there is no ordered Plan to send. Deliberately its own outcome
       * rather than a `delivered` Plan with an empty block list: a
       * notification reading "Nothing is scheduled" above a sentence about
       * which Task "leads today's Plan" would be self-contradictory, and
       * FR-3's reasoning line has no lead item's position to explain when no
       * item has a position. Like `nothing-to-plan`, this writes no
       * ran-today marker, so raising the Time Budget and re-triggering can
       * still produce a real Plan today.
       */
      readonly status: "nothing-fits";
      readonly date: IsoDate;
      readonly deferredTaskIds: readonly ExternalId[];
      readonly incompleteTaskIds: readonly ExternalId[];
    }
  | {
      readonly status: "delivered";
      readonly date: IsoDate;
      readonly plan: Plan;
      /**
       * The Plan as `renderPlan` produced it, for `shell/ritual-cli.ts` to
       * print — with the unchecked-night notice (Task 21), when present,
       * prepended ahead of it as its own leading unit. See the "Task 21"
       * comments inside `runMorningRitual` below for why this is folded
       * into `rendered` rather than kept as a fully separate field: it is
       * the one string that reaches the terminal/log verbatim, so the flag
       * shows exactly where it would otherwise be missed if a caller forgot
       * to check `uncheckedNight` separately.
       */
      readonly rendered: string;
      /** Tasks that could not fit today's Time Budget and were left for a future Plan (never force-fit). */
      readonly deferredTaskIds: readonly ExternalId[];
      /** Tasks the Data-Completeness Gate held back; an open interaction request names them. */
      readonly incompleteTaskIds: readonly ExternalId[];
      /**
       * Present exactly when this run found a pending unchecked night
       * (`memory-store.ts`'s `UncheckedDay`, `shownAt` still unset — the
       * OLDEST such record, not necessarily last night specifically, see
       * step 1.5's own doc comment) and is displaying it for the first (and
       * only) time (UX-DR14: "shown once, not a standing repeating
       * reminder") — `undefined` on every ordinary morning, including every
       * one before this task and every subsequent morning after the one
       * that showed it. Exposed as its own field (in addition to being
       * folded into `rendered`/the notification body) so a caller — and
       * this file's own tests — can assert on it directly rather than
       * parsing rendered text.
       */
      readonly uncheckedNight?: UncheckedDay;
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

  // --- 1.5. Find the oldest not-yet-shown unchecked night (Task 21 review
  // fix / Story 3.3, FR-14, UX-DR14) -----------------------------------------
  // A pure read, done early and cheaply (no Notion/Calendar call needed).
  // DETECTION already happened elsewhere and earlier — rituals/
  // night-ritual.ts's runNightEscalateRitual writes the durable
  // `UncheckedDay` record itself, at the moment it confirms the escalation
  // cap is genuinely spent (see that function's own doc comment). This
  // file's only job is DISPLAY: scan every currently-recorded UncheckedDay
  // for the oldest one whose `shownAt` is still unset. Nothing is WRITTEN
  // yet here — whether this run ultimately reaches "delivered" (the only
  // outcome that actually shows Spencer anything) is decided by everything
  // below; `shownAt` is only ever stamped once a Plan carrying this notice
  // is actually sent (see step 12 below). A run that ends in
  // `nothing-to-plan`/`nothing-fits` (or fails outright) therefore shows
  // nothing this trigger, but writes nothing either — the SAME
  // still-unshown record is found again by whichever LATER run finally
  // reaches "delivered," however many days that takes. This is what turns
  // a multi-day gap into a delay rather than the permanent loss the first
  // version of this task had (see the module docstring's own "Step 1.5"
  // section for the full post-review story).
  const oldestUnshown = listUncheckedDays(deps.store)
    .filter((r) => r.data.shownAt === undefined)
    .sort((a, b) => a.data.date.localeCompare(b.data.date))[0];
  const uncheckedNight = oldestUnshown?.data;
  if (uncheckedNight) {
    log({
      level: "info",
      event: "morning-ritual.unchecked-night-pending",
      detail: { date: uncheckedNight.date, taskCount: uncheckedNight.rolledForwardTasks.length },
    });
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

  // Which Tasks actually made it into the Plan. Read off the emitted blocks
  // rather than inverting `deferredTaskIds`, so this is direct evidence of
  // "has a block in this Plan" rather than a second derivation that could
  // disagree with the rendered output.
  const plannedTaskIds = new Set<ExternalId>(
    fitted.value.blocks.flatMap((block) =>
      block.kind === "work" && block.taskId !== undefined ? [block.taskId] : [],
    ),
  );

  // Every plannable Task was deferred — see `"nothing-fits"`'s doc comment.
  if (plannedTaskIds.size === 0) {
    log({
      level: "info",
      event: "morning-ritual.nothing-fits",
      detail: { date: today, deferred: fitted.value.deferredTaskIds.length, budget: resolvedBudget.budget.totalMinutes },
    });
    return {
      ok: true,
      value: {
        status: "nothing-fits",
        date: today,
        deferredTaskIds: fitted.value.deferredTaskIds,
        incompleteTaskIds,
      },
    };
  }

  // The SAME `candidates` array and the SAME `bumpLevels` reference that
  // produced `ordered` above — see the module docstring's contract note.
  // `eligibleTaskIds` narrows only WHICH Task the sentence describes, never
  // the scoring: a Task that got deferred must not be described as leading
  // a Plan it has no block in.
  const reasoning = generatePlanReasoning({
    tasks: candidates,
    today,
    eligibleTaskIds: plannedTaskIds,
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

  // --- 11. Render -------------------------------------------------------------
  // Task 21: the unchecked-night notice (when present) is prepended as its
  // own leading unit, ahead of the Plan itself — see `MorningRitualOutcome`'s
  // `"delivered"` variant doc comment for why it is folded into `rendered`
  // rather than left as a field callers must remember to check separately.
  const planRendered = renderPlan(plan, {
    timeZone: deps.timeZone,
    ...(deps.color === undefined ? {} : { color: deps.color }),
  });
  const noticeColor = deps.color ?? shouldUseColor();
  const rendered = uncheckedNight
    ? `${renderUncheckedNightNotice(uncheckedNight, { color: noticeColor })}\n\n${planRendered}`
    : planRendered;

  // --- 12a. Persist the generated Plan --------------------------------------
  // Before the send, so a delivery failure never loses the Plan itself.
  try {
    putPlan(deps.store, plan);
  } catch (err) {
    log({ level: "error", event: "morning-ritual.persist-failed", detail: describeError(err) });
    return failure("conflict", `morning-ritual: could not persist today's Plan — ${describeError(err)}`, err);
  }

  // --- 12b. Send exactly one notification -----------------------------------
  // The unchecked-night notice (Task 21), when present, is prepended to the
  // plain-text notification body too — the ONE destination in this function
  // that cannot render ANSI at all, hence `renderUncheckedNightNotice`'s own
  // `color: false` here rather than `noticeColor` above. Its length is
  // subtracted from `buildNotificationBody`'s own limit budget FIRST, so the
  // combined body still never exceeds Pushover's real size limit — a
  // silently-too-long combined message would risk losing the whole
  // notification, notice included, exactly the failure mode
  // `buildNotificationBody`'s own doc comment already guards against for the
  // Plan body alone.
  const noticePlain = uncheckedNight ? renderUncheckedNightNotice(uncheckedNight, { color: false }) : undefined;
  const planBodyLimit = noticePlain
    ? Math.max(0, PUSHOVER_MESSAGE_LIMIT - noticePlain.length - 2)
    : PUSHOVER_MESSAGE_LIMIT;
  const notificationBody = noticePlain
    ? `${noticePlain}\n\n${buildNotificationBody(plan, deps.timeZone, planBodyLimit)}`
    : buildNotificationBody(plan, deps.timeZone);
  try {
    await deps.sendNotification({
      title: NOTIFICATION_TITLE.slice(0, PUSHOVER_TITLE_LIMIT),
      message: notificationBody,
    });
  } catch (err) {
    log({ level: "error", event: "morning-ritual.notify-failed", detail: describeError(err) });
    return failure("unreachable", `morning-ritual: could not send today's Plan notification — ${describeError(err)}`, err);
  }

  // --- 12c. Mark the day done, AFTER a confirmed delivery -------------------
  // Deliberately after the send, not before. Writing it first would make the
  // notification strictly at-most-once, but at the cost that ANY transient
  // Pushover failure (a network blip, a brief outage) permanently burns the
  // day: every later trigger would return `already-ran` and Spencer would
  // simply never get a Plan, with nothing visible to tell him why. Writing
  // it after means a failed send is retried by the next trigger — which
  // re-reads and re-fits against the current time, so the retry delivers a
  // Plan that is still accurate rather than a stale one.
  //
  // The residual risk this accepts: if the send succeeds and THIS write then
  // throws, the next trigger sends a second notification. That window is a
  // local SQLite write on a singleton row only this ritual ever writes,
  // immediately after a successful network call — far narrower than the
  // outage window it replaces, and it fails loud rather than silent.
  try {
    putRitualRun(deps.store, MORNING_RITUAL_ID, { date: today, ranAt: nowIso, planId: plan.id });
  } catch (err) {
    log({ level: "error", event: "morning-ritual.mark-run-failed", detail: describeError(err) });
    return failure("conflict", `morning-ritual: today's Plan was sent but could not be marked delivered — ${describeError(err)}`, err);
  }

  // --- 12d. Stamp the displayed unchecked night as shown, AFTER a confirmed
  // delivery (Task 21, post-review fix) ---------------------------------------
  // Deliberately the LAST write, after the notification has genuinely been
  // sent and the day itself is marked delivered — `shownAt` is what makes
  // UX-DR14's "shown once" hold (see step 1.5's own comment and
  // `memory-store.ts`'s `UncheckedDay.shownAt` doc comment): stamping it any
  // earlier would risk marking the flag "shown" for a run that then fails to
  // actually deliver anything (e.g. a `sendNotification` failure a few lines
  // above), silently burning Spencer's one guaranteed look at it. A failed
  // send above already returns before reaching here, so a later retry still
  // finds this same record with `shownAt` unset and gets a fresh chance to
  // show it. The RECORD itself was already written earlier — by
  // `rituals/night-ritual.ts`'s `runNightEscalateRitual`, at cap-spend time
  // — this step only ever patches `shownAt` onto it (`markUncheckedDayShown`,
  // which throws if the record is somehow already gone — genuinely
  // unexpected, since nothing in this codebase deletes an `UncheckedDay`
  // row).
  if (uncheckedNight) {
    try {
      markUncheckedDayShown(deps.store, uncheckedNight.date, nowIso);
    } catch (err) {
      log({ level: "error", event: "morning-ritual.unchecked-day-mark-shown-failed", detail: describeError(err) });
      return failure(
        "conflict",
        `morning-ritual: today's Plan was sent but the unchecked-night flag for ${uncheckedNight.date} could not be marked shown — ${describeError(err)}`,
        err,
      );
    }
  }

  log({
    level: "info",
    event: "morning-ritual.delivered",
    detail: {
      date: today,
      planId: plan.id,
      blocks: plan.blocks.length,
      deferred: fitted.value.deferredTaskIds.length,
      uncheckedNightDate: uncheckedNight?.date,
    },
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
      ...(uncheckedNight ? { uncheckedNight } : {}),
    },
  };
}
