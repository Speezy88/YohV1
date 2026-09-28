/**
 * src/rituals/ritual-shared.ts
 *
 * Final whole-branch review, Finding 3. `night-ritual.ts`, `self-check.ts`,
 * and `mid-day-reflow.ts` had all come to import date/color/notification
 * helpers from `rituals/morning-ritual.ts` — exactly the "shared utils file
 * becomes a bottleneck" anti-pattern AD-9 itself names (for the narrower
 * case of `PlanBlock` addressed by `.id`, never position, but the same
 * principle applies to file organization: a file literally named for ONE
 * ritual should not be every OTHER ritual's dependency for basic
 * date/color/notification plumbing). This file is the neutral home those
 * genuinely shared, non-morning-specific pieces were extracted into.
 *
 * **A pure move — no behavior change.** Every export below is unchanged in
 * name, signature, and behavior from its original home in
 * `morning-ritual.ts`; the doc comments are carried over verbatim (or
 * near-verbatim, where a comment referenced "this file" and now needs to
 * name its new home). `morning-ritual.ts` itself still needs some of
 * these (`renderBlockLine`/`paint`/`formatPlanDate`, used by its own
 * `buildNotificationBody`/`renderUncheckedNightNotice`) — those are
 * re-imported from here rather than kept as a second private copy, so this
 * really is the ONE place each of these lives.
 *
 * Import direction: every `rituals/*.ts` file — `morning-ritual.ts`
 * included — imports FROM this file; this file imports nothing from any
 * other `rituals/*.ts` file (AD-1's `rituals -> {core, adapters}` layering,
 * applied within `rituals/*.ts` itself: this is deliberately the leaf every
 * sibling ritual file depends on, never the reverse).
 */
import type { CompleteTask, IsoDate, IsoDateTime, Plan, PlanBlock, RefiningFieldNames } from "../types/domain.ts";

// ============================================================================
// missingRefiningFor — the one CompleteTask -> missingRefining tagging rule
// ============================================================================

/**
 * Story 9.1 (AD-11 amended) — the list of Refining Fields (Area, Energy)
 * `task` is missing, in the fixed `["area", "energy"]` order — `undefined`
 * (never `[]`) when neither is missing. `core/work-break-fit.ts` itself has
 * no Refining-field awareness (it only ever sees `estimatedDurationMinutes`/
 * `dueDate`/`id`/`title`), so this is where a `"work"` `PlanBlock` actually
 * gets tagged with `missingRefining` — the one place a `CompleteTask`'s own
 * `Refining<T>` state is read back off after the gate.
 *
 * Polish-5 Task 1: moved here from being duplicated verbatim in both
 * `morning-ritual.ts` and `mid-day-reflow.ts` (each builds a `"work"`
 * `PlanBlock` from a gated `CompleteTask` and needs the identical tagging
 * rule) — this is now the one place it lives; both files import it from
 * here rather than keeping their own copy.
 */
export function missingRefiningFor(task: CompleteTask): readonly RefiningFieldNames[] | undefined {
  const missing: RefiningFieldNames[] = [];
  if (task.area.kind === "missing") missing.push("area");
  if (task.energy.kind === "missing") missing.push("energy");
  return missing.length > 0 ? missing : undefined;
}

// ============================================================================
// DESIGN.md color tokens (UX-DR1) — defined once, for every caller
// ============================================================================

/**
 * 256-color (8-bit) ANSI escape for DESIGN.md's `colors.accent` (#5FAFFF).
 * Used ONLY for a section label — the Plan's header here — never for
 * emphasis inside body text.
 *
 * Was a 24-bit truecolor escape (`\x1b[38;2;95;175;255m`) until real-world
 * testing found it rendering as an unintended color in Apple's Terminal.app,
 * which has long had unreliable support for 24-bit truecolor SGR codes.
 * 256-color mode is universally supported (including Terminal.app) and, for
 * this exact color, lossless: xterm's 256-color cube is built from the same
 * six steps [0, 95, 135, 175, 215, 255] per channel, and (95, 175, 255) is
 * exactly index 75 in that cube (16 + 36*1 + 6*3 + 5) — not an approximation.
 */
export const ACCENT = "\x1b[38;5;75m";

/**
 * 256-color (8-bit) ANSI escape for DESIGN.md's `colors.muted` (#6B6B6B).
 * Used ONLY for the one-line Plan reasoning (UX-DR4), so it reads as a
 * quiet aside rather than a competing headline.
 *
 * Same Terminal.app-compatibility switch as `ACCENT` above. #6B6B6B
 * (107,107,107) doesn't land exactly on a 256-color cube step, so this uses
 * the nearest entry on xterm's 24-step grayscale ramp instead: index 242 is
 * RGB(108,108,108) — a 1-in-255 difference per channel, invisible in
 * practice.
 */
export const MUTED = "\x1b[38;5;242m";

/**
 * 256-color (8-bit) ANSI escape for DESIGN.md's `colors.attention` (#D08A3E)
 * — a warm amber, deliberately not red (DESIGN.md: "Yoh escalates under
 * strain, it doesn't alarm"). Reserved for exactly the two moments
 * DESIGN.md names ("Do reserve `{colors.attention}` for genuine escalation
 * moments — using it more broadly would blunt the one signal it's meant to
 * carry"): Night Ritual's second, escalated close-out attempt
 * (`rituals/night-ritual.ts`'s `night-escalate` half, Task 20) and the
 * unchecked-day flag (`rituals/morning-ritual.ts`'s Task 21). First used by
 * Task 20 — kept in this shared home (not a private copy per file) for the
 * same reason `ACCENT`/`MUTED` live here: it is the established shared
 * color-token home every ritual file imports from.
 *
 * Same Terminal.app-compatibility switch as `ACCENT`/`MUTED` above. #D08A3E
 * (208,138,62) doesn't land exactly on a cube step either; nearest cube
 * entry is index 173, RGB(215,135,95) — a slightly more salmon amber than
 * the truecolor original, still clearly the same warm, non-alarming hue.
 */
export const ATTENTION = "\x1b[38;5;173m";

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

/** The plain-text marker a `calendar-anchor` block carries so a fixed Calendar event reads as immovable WITHOUT relying on color or on the reader knowing about `PlanBlockKind` (UX-DR20). */
const ANCHOR_MARKER = "(fixed)";

/** DESIGN.md's `spacing.wrap-width` (`80ch`) — `renderPlan`'s own default wrap column, so output stays readable without resizing the terminal. (Story 8.9: this was `WRAP_WIDTH`, a constant `shell/chat-cli.ts` also imported directly for its own divider line; now private to this file, since `chat-cli.ts` was retired and no other caller ever needed it.) */
const PLAN_WRAP_WIDTH = 80;

export interface RenderPlanOptions {
  /** IANA zone the block times are rendered in. Per the Consistency Conventions, Plans are stored in UTC and converted to Spencer's local time only at this presentation edge. Defaults to the host's own zone. */
  readonly timeZone?: string;
  /** Emit ANSI color. Defaults to `shouldUseColor()` — i.e. off for a pipe, a redirect, `NO_COLOR`, or a notification body. */
  readonly color?: boolean;
  /** Column to wrap body text at, defaulting to `PLAN_WRAP_WIDTH`. */
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
 * Pure and free of I/O beyond reading `Intl` — deliberately so: this exact
 * function is called by `rituals/morning-ritual.ts`'s delivery path,
 * `rituals/mid-day-reflow.ts`'s remainder-of-day view, and (Story 8.9,
 * moved from `shell/chat-cli.ts`) `app/plan-view.ts`'s on-demand "what's my
 * plan" view, all with the identical signature.
 */
export function renderPlan(plan: Plan, options: RenderPlanOptions = {}): string {
  const timeZone = options.timeZone ?? hostTimeZone();
  const color = options.color ?? shouldUseColor();
  const width = options.width ?? PLAN_WRAP_WIDTH;
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

/**
 * One block's line(s): `HH:MM-HH:MM  Item`, wrapped with a hanging indent
 * under the item column. Exported (not private to `renderPlan`) because
 * `morning-ritual.ts`'s `buildNotificationBody` needs the identical
 * per-block rendering for the push-notification body.
 */
export function renderBlockLine(block: PlanBlock, timeZone: string, width: number): string[] {
  const range = `${formatLocalTime(block.start, timeZone)}-${formatLocalTime(block.end, timeZone)}`;
  const item = block.kind === "calendar-anchor" ? `${block.label} ${ANCHOR_MARKER}` : block.label;
  return wrapWithHangingIndent(`${range}  `, item, width);
}

/**
 * Wraps `text` in `colorCode`...`RESET` when `enabled`, else returns it
 * unchanged. Exported because `morning-ritual.ts`'s `renderUncheckedNightNotice`
 * needs the identical paint-or-not behavior for its own `ATTENTION` text.
 */
export function paint(text: string, colorCode: string, enabled: boolean): string {
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

/**
 * `"2026-08-22"` -> `"Saturday, August 22"`. Formatted in UTC against the
 * date's own midnight so no zone offset can shift the printed day off
 * `plan.date`. Exported because `morning-ritual.ts`'s
 * `renderUncheckedNightNotice` needs the identical date formatting for its
 * own notice text.
 */
export function formatPlanDate(date: IsoDate): string {
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
// PlanNotification — the push-notification message shape
// ============================================================================

/**
 * What a ritual's `sendNotification`/`sendFailureAlert` seam receives — the
 * `adapters/notification-adapter.ts` message shape, minus its credentials.
 * Shared across every ritual that sends a Pushover push
 * (`morning-ritual.ts`, `night-ritual.ts`, `self-check.ts`) and
 * `shell/ritual-cli.ts`'s own failure-alert channel.
 */
export interface PlanNotification {
  readonly title: string;
  readonly message: string;
}
