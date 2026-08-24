/**
 * src/shell/ritual-cli.ts
 *
 * The one-shot, OS-cron-triggered ritual entry point (AD-5). Where
 * `chat-cli.ts` is a REPL that blocks indefinitely for Spencer's answers,
 * this file is its opposite in every respect: it runs one subcommand, prints
 * what happened, and exits. It NEVER waits for input — not even when the
 * Data-Completeness Gate finds a missing field. In that case the Morning
 * Ritual persists an open interaction request in `memory-store.ts` and the
 * process exits; Spencer answers it the next time he opens `chat-cli.ts`,
 * which is the only place an open interaction request is ever resolved
 * (AD-5). A test in `tests/ritual-cli.test.ts` enforces that by scanning this
 * file's own source for any stdin/readline use.
 *
 * Task 10 introduces this file with ONE subcommand, `morning`. AD-5 names
 * three more — `night-prompt` (Task 19), `night-escalate` (Task 20), and
 * `self-check` (Task 24). All four are now built (see the per-task update
 * paragraphs below) — `SUBCOMMANDS` reflects that, rather than any
 * subcommand falling through to "unknown subcommand" or a "not implemented
 * yet" placeholder.
 *
 * Task 19 update (Story 3.1): adds the `night-prompt` subcommand
 * (`handleNightPromptResult`, `createNightPromptRitualDeps`) with the exact
 * same one-shot/never-blocks contract `morning` already has, and closes
 * `createMorningRitualDeps`'s `bumpLevels` bridge — see that function's own
 * doc comment.
 *
 * Task 20 update (Story 3.2): adds the `night-escalate` subcommand
 * (`handleNightEscalateResult`, `createNightEscalateRitualDeps`), scheduled
 * (by OS cron, outside this codebase) some hours after `night-prompt`. Same
 * one-shot/never-blocks contract; binds only `adapters/email-adapter.ts`'s
 * `sendEmail` (via `loadEmailConfigFromEnv`) plus the `MemoryStore` — no
 * Notion/Calendar/Pushover credentials are needed for THIS subcommand.
 *
 * Task 20 review-fix update: `createNightPromptRitualDeps` now ALSO wires
 * `adapters/notification-adapter.ts`'s `sendPushoverNotification` (see
 * `rituals/night-ritual.ts`'s own "The first attempt's own push
 * notification" docstring section for why) — `night-prompt` now requires
 * `PUSHOVER_APP_TOKEN`/`PUSHOVER_USER_KEY` to be configured, same as
 * `morning`.
 *
 * Task 21 (Story 3.3, unchecked-day handling) touches no wiring in this
 * file at all: `night-escalate` (above) now writes the durable
 * `UncheckedDay` record itself, at cap-spend time, entirely inside
 * `rituals/night-ritual.ts`; `morning` (`rituals/morning-ritual.ts`) reads
 * it back via plain `memory-store.ts` calls it already has access to
 * through its own `store`. No new subcommand, no new dep to bind here —
 * see both ritual files' own docstrings for the design.
 *
 * Task 24 update (Story 4.3, FR-17, AD-6): adds the FOURTH and final AD-5
 * subcommand, `self-check` (`handleSelfCheckResult`,
 * `createSelfCheckRitualDeps`) — the last of AD-5's four named subcommands
 * is now built; `SUBCOMMANDS` no longer names anything as "planned but not
 * yet built." No Notion, Calendar, or SMTP credentials are needed for THIS
 * subcommand, but — per the Task 24 review fix below — Pushover IS: it
 * needs `YOH_TIMEZONE` (defining "today" and the local time-of-day its
 * randomized due time compares against) plus `PUSHOVER_APP_TOKEN`/
 * `PUSHOVER_USER_KEY`, the same credentials `morning`/`night-prompt`
 * already require.
 *
 * Task 24 review-fix update: `createSelfCheckRitualDeps` now ALSO wires
 * `adapters/notification-adapter.ts`'s `sendPushoverNotification` — mirroring
 * `createNightPromptRitualDeps`'s own Task 20 review-fix precedent exactly
 * (see that function's own doc comment, and `rituals/self-check.ts`'s own
 * "The push notification" docstring section for why this matters even MORE
 * for Self-Check than it did for night-prompt: a randomized ~4-day cadence
 * gives Spencer no habitual daily moment to stumble onto an open prompt, and
 * unlike night-close-out there is no second, escalating retry channel if a
 * silently-persisted request goes unnoticed).
 *
 * Task 25 update (Story 5.1, AD-7/AD-9, Epic 5's first task — the epic hardens
 * all four subcommands at once rather than piecemeal per-epic, per the epic
 * note): every failure branch below used to end with just the structured
 * stderr line ("AD-7's real failure alerting is Epic 5" — that comment is now
 * gone from each `handle*Result` function, replaced by this). Now a single
 * shared wrapper, `withFailureAlert` (factored once per AD-9, applied
 * identically to all four dispatch branches in `runRitualCli`), sends ONE
 * Pushover alert — worded distinctly from a normal Plan/close-out/Self-Check
 * notification, naming the failing subcommand and the error — before any
 * subcommand's invocation (a `Result` failure OR a thrown error escaping it
 * entirely) returns a non-zero exit code. The channel it sends on
 * (`RitualCliDeps.sendFailureAlert`, wired to the real Pushover adapter by
 * `createFailureAlertSender` in `main`, below) is deliberately its OWN seam,
 * separate from any ritual's own `sendNotification` — this is why
 * `night-escalate` now also requires `PUSHOVER_APP_TOKEN`/`PUSHOVER_USER_KEY`
 * to run, even though its own ritual (`runNightEscalateRitual`) still only
 * ever sends email and has no Pushover seam of its own; see
 * `createFailureAlertSender`'s own doc comment.
 *
 * Per AD-1 this shell file contains no ritual logic of its own. It does two
 * things: bind the real adapters/stores to `rituals/morning-ritual.ts`'s
 * injected seams (`createMorningRitualDeps`, below), and translate the
 * `Result` that comes back into terminal output and a process exit code. The
 * AD-8 catching of adapter throws happens inside the ritual, not here — this
 * file's own `withFailureAlert` (Task 25, above) is a defensive layer
 * further out still, for whatever might nonetheless escape that boundary.
 *
 * Exit codes: `0` the subcommand ran (including the "already ran today" and
 * "nothing to plan" no-ops, which are outcomes, not errors), `1` the ritual
 * returned a `Result` failure (or threw — Task 25's `withFailureAlert`
 * treats both the same for exit-code purposes), `2` a usage problem (no
 * subcommand, unknown subcommand, an unbuilt subcommand, or missing
 * configuration).
 */
import { createMemoryStore, listSlipHistories, type MemoryStore } from "../adapters/memory-store.ts";
import { createCalendarReadClient, readCalendarEvents } from "../adapters/calendar-adapter.ts";
import { loadEmailConfigFromEnv, sendEmail } from "../adapters/email-adapter.ts";
import { loadPushoverConfigFromEnv, sendPushoverNotification } from "../adapters/notification-adapter.ts";
import { readNotionTasks } from "../adapters/notion-adapter.ts";
import { createTokenStore, loadGoogleOAuthConfigFromEnv } from "../adapters/token-store.ts";
import { computeSlipBumpLevels } from "../core/slip-bump.ts";
import { runMorningRitual, type MorningRitualDeps, type MorningRitualOutcome, type PlanNotification } from "../rituals/morning-ritual.ts";
import {
  renderNightEscalateNotice,
  runNightEscalateRitual,
  runNightPromptRitual,
  type NightEscalateRitualDeps,
  type NightEscalateOutcome,
  type NightPromptRitualDeps,
  type NightPromptOutcome,
} from "../rituals/night-ritual.ts";
import { runSelfCheckRitual, type SelfCheckOutcome, type SelfCheckRitualDeps } from "../rituals/self-check.ts";
import { Client } from "@notionhq/client";
import type { ExternalId, Result, YohError } from "../types/domain.ts";

// ============================================================================
// Injectable IO / ritual seams
// ============================================================================

export interface RitualCliIo {
  readonly writeLine: (line: string) => void;
  readonly writeError: (line: string) => void;
}

/**
 * What `runRitualCli` needs, injected so the dispatch/exit-code logic is
 * testable without adapters, credentials, or a network. `main` below builds
 * the real one.
 */
export interface RitualCliDeps {
  readonly io: RitualCliIo;
  readonly runMorning: () => Promise<Result<MorningRitualOutcome, YohError>>;
  /** `rituals/night-ritual.ts`'s `runNightPromptRitual`, pre-bound to its deps (Task 19 / Story 3.1). */
  readonly runNightPrompt: () => Promise<Result<NightPromptOutcome, YohError>>;
  /** `rituals/night-ritual.ts`'s `runNightEscalateRitual`, pre-bound to its deps (Task 20 / Story 3.2). */
  readonly runNightEscalate: () => Promise<Result<NightEscalateOutcome, YohError>>;
  /** `rituals/self-check.ts`'s `runSelfCheckRitual`, pre-bound to its deps (Task 24 / Story 4.3). */
  readonly runSelfCheck: () => Promise<Result<SelfCheckOutcome, YohError>>;
  /**
   * AD-7's failure-alert channel (Task 25 / Story 5.1): sends ONE Pushover
   * alert, worded distinctly from a normal Plan/close-out/Self-Check
   * notification. Deliberately separate from any of the four `run*`
   * functions above and from each ritual's OWN `sendNotification` seam (see
   * `createMorningRitualDeps` etc.) — this must work regardless of which
   * subcommand failed, or whether that subcommand's own ritual has a
   * notification seam at all (`night-escalate`'s does not; it uses email).
   * `withFailureAlert`, below, is the sole caller.
   */
  readonly sendFailureAlert: (notification: PlanNotification) => Promise<void>;
}

/** AD-5's full subcommand set — all four are now built. */
const SUBCOMMANDS = {
  morning: "built",
  "night-prompt": "built",
  "night-escalate": "built",
  "self-check": "built",
} as const;

const USAGE = "usage: yoh ritual <morning|night-prompt|night-escalate|self-check>";

// ============================================================================
// runRitualCli
// ============================================================================

/**
 * Dispatches one subcommand and returns the process exit code. Never reads
 * input, never loops, never waits (AD-5).
 */
export async function runRitualCli(argv: readonly string[], deps: RitualCliDeps): Promise<number> {
  const subcommand = argv[0];

  if (subcommand === undefined) {
    deps.io.writeError(`ritual-cli: no subcommand given. ${USAGE}`);
    return 2;
  }

  if (subcommand === "morning") {
    return withFailureAlert("morning", deps.runMorning, handleMorningResult, deps.io, deps.sendFailureAlert);
  }

  if (subcommand === "night-prompt") {
    return withFailureAlert("night-prompt", deps.runNightPrompt, handleNightPromptResult, deps.io, deps.sendFailureAlert);
  }

  if (subcommand === "night-escalate") {
    return withFailureAlert("night-escalate", deps.runNightEscalate, handleNightEscalateResult, deps.io, deps.sendFailureAlert);
  }

  if (subcommand === "self-check") {
    return withFailureAlert("self-check", deps.runSelfCheck, handleSelfCheckResult, deps.io, deps.sendFailureAlert);
  }

  const planned = Object.hasOwn(SUBCOMMANDS, subcommand)
    ? SUBCOMMANDS[subcommand as keyof typeof SUBCOMMANDS]
    : undefined;
  deps.io.writeError(
    planned === undefined
      ? `ritual-cli: unknown subcommand "${subcommand}". ${USAGE}`
      : `ritual-cli: "${subcommand}" is not implemented yet — it arrives with ${planned}. ${USAGE}`,
  );
  return 2;
}

/**
 * AD-7's top-level failure-alert wrapper (Task 25 / Story 5.1), factored
 * ONCE (AD-9's spirit) and applied identically to all four subcommands from
 * `runRitualCli` above — not the same try/catch-plus-alert hand-rolled four
 * times.
 *
 * Wraps a subcommand's ENTIRE invocation, covering BOTH failure modes AD-7
 * names:
 *  (a) a `Result` failure returned by `runSubcommand` — the ordinary,
 *      expected-shape failure `rituals/*.ts` produces per AD-8; and
 *  (b) a thrown error escaping `runSubcommand` entirely. `rituals/*.ts`
 *      shouldn't normally throw (AD-8: it's the layer that catches adapter
 *      throws and converts them to `Result` failures) — this `try/catch` is
 *      the defensive outer layer AD-7's "wraps its entire invocation" calls
 *      for, one boundary further out than that AD-8 guarantee.
 *
 * On either, exactly one Pushover alert is sent (via `sendAlertSafely`,
 * below) BEFORE this returns a non-zero exit code, worded distinctly from a
 * normal Plan/close-out/Self-Check notification. `handleResult` still owns
 * the existing structured-stderr-line/exit-code logic for the
 * `Result`-failure case unchanged (this task keeps those lines as-is per its
 * own scope note) — this wrapper only adds the alert send in front of it,
 * and adds an equivalent structured line of its own for the thrown case,
 * which previously had no handler at all.
 */
async function withFailureAlert<T>(
  subcommand: string,
  runSubcommand: () => Promise<Result<T, YohError>>,
  handleResult: (result: Result<T, YohError>, io: RitualCliIo) => number,
  io: RitualCliIo,
  sendFailureAlert: (notification: PlanNotification) => Promise<void>,
): Promise<number> {
  let result: Result<T, YohError>;
  try {
    result = await runSubcommand();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendAlertSafely(subcommand, `thrown error — ${message}`, io, sendFailureAlert);
    io.writeError(
      JSON.stringify({
        level: "error",
        event: `ritual-cli.${subcommand}-failed`,
        kind: "thrown",
        message,
      }),
    );
    return 1;
  }

  if (!result.ok) {
    await sendAlertSafely(subcommand, `${result.error.kind} — ${result.error.message}`, io, sendFailureAlert);
  }

  return handleResult(result, io);
}

/**
 * Builds the alert's title/body (worded distinctly from a normal Plan/
 * close-out/Self-Check notification — see `handleMorningResult`'s
 * `NOTIFICATION_TITLE`, `NIGHT_PROMPT_NOTIFICATION_TITLE`, and
 * `SELF_CHECK_NOTIFICATION_TITLE`, none of which mention the word "failed"
 * or the subcommand's own name) and sends it, swallowing (but logging) a
 * failure of the SEND itself — the send failing must not prevent the
 * existing `handleResult` structured-log-line/exit-code path from still
 * running, which is the one guarantee that MUST survive even if Pushover
 * itself is unreachable.
 */
async function sendAlertSafely(
  subcommand: string,
  detail: string,
  io: RitualCliIo,
  sendFailureAlert: (notification: PlanNotification) => Promise<void>,
): Promise<void> {
  try {
    await sendFailureAlert({
      title: `Yoh: ${subcommand} failed`,
      message: `The "${subcommand}" ritual failed and needs attention: ${detail}`,
    });
  } catch (err) {
    io.writeError(
      JSON.stringify({
        level: "error",
        event: "ritual-cli.failure-alert-send-failed",
        subcommand,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

function handleMorningResult(result: Result<MorningRitualOutcome, YohError>, io: RitualCliIo): number {
  if (!result.ok) {
    // The structured log line AD-7's real failure alerting (Task 25 /
    // Story 5.1, `withFailureAlert` above) reads before this function ever
    // runs — the alert is already sent by the time control reaches here.
    // One JSON object per line so a cron mail/log aggregator can parse it
    // without guessing at prose.
    io.writeError(
      JSON.stringify({
        level: "error",
        event: "ritual-cli.morning-failed",
        kind: result.error.kind,
        message: result.error.message,
      }),
    );
    return 1;
  }

  switch (result.value.status) {
    case "already-ran":
      io.writeLine(`The Morning Ritual already ran today (${result.value.date}) — nothing more to send.`);
      return 0;
    case "nothing-to-plan":
      io.writeLine(
        `Nothing could be planned for ${result.value.date} yet — ${result.value.incompleteTaskIds.length} Task(s) are still missing planning fields. I've left a note for you in chat.`,
      );
      return 0;
    case "nothing-fits":
      io.writeLine(
        `Nothing fits ${result.value.date}'s Time Budget — all ${result.value.deferredTaskIds.length} Task(s) were deferred. Declare more time in chat and run this again.`,
      );
      return 0;
    case "delivered":
      io.writeLine(result.value.rendered);
      return 0;
  }
}

/** Mirrors `handleMorningResult`'s shape/exit-code conventions for the `night-prompt` subcommand's outcomes (Task 19 / Story 3.1). */
function handleNightPromptResult(result: Result<NightPromptOutcome, YohError>, io: RitualCliIo): number {
  if (!result.ok) {
    io.writeError(
      JSON.stringify({
        level: "error",
        event: "ritual-cli.night-prompt-failed",
        kind: result.error.kind,
        message: result.error.message,
      }),
    );
    return 1;
  }

  switch (result.value.status) {
    case "already-ran":
      io.writeLine(`The Night Ritual close-out already ran today (${result.value.date}) — nothing more to send.`);
      return 0;
    case "no-plan-today":
      io.writeLine(`No Plan has been generated for ${result.value.date} yet — nothing to close out.`);
      return 0;
    case "nothing-to-confirm":
      io.writeLine(`Nothing to confirm for ${result.value.date} — today's Plan has no work blocks.`);
      return 0;
    case "prompted":
      io.writeLine(
        `Asked Spencer to confirm ${result.value.tasks.length} Task${result.value.tasks.length === 1 ? "" : "s"} from today — check chat to answer.`,
      );
      return 0;
  }
}

/** Mirrors `handleNightPromptResult`'s shape/exit-code conventions for the `night-escalate` subcommand's outcomes (Task 20 / Story 3.2). */
function handleNightEscalateResult(result: Result<NightEscalateOutcome, YohError>, io: RitualCliIo): number {
  if (!result.ok) {
    io.writeError(
      JSON.stringify({
        level: "error",
        event: "ritual-cli.night-escalate-failed",
        kind: result.error.kind,
        message: result.error.message,
      }),
    );
    return 1;
  }

  switch (result.value.status) {
    case "already-ran":
      io.writeLine(`The Night Ritual escalation already ran today (${result.value.date}) — nothing more to send.`);
      return 0;
    case "not-prompted-yet":
      io.writeLine(
        `Nothing to escalate for ${result.value.date} yet — night-prompt hasn't run tonight. Try again after it does.`,
      );
      return 0;
    case "no-open-request":
      io.writeLine(`Nothing to escalate for ${result.value.date} — the close-out was already answered. No-op.`);
      return 0;
    case "escalated":
      io.writeLine(renderNightEscalateNotice(result.value.tasks.length, result.value.date));
      return 0;
  }
}

/** Mirrors `handleNightPromptResult`'s shape/exit-code conventions for the `self-check` subcommand's outcomes (Task 24 / Story 4.3). */
function handleSelfCheckResult(result: Result<SelfCheckOutcome, YohError>, io: RitualCliIo): number {
  if (!result.ok) {
    io.writeError(
      JSON.stringify({
        level: "error",
        event: "ritual-cli.self-check-failed",
        kind: result.error.kind,
        message: result.error.message,
      }),
    );
    return 1;
  }

  switch (result.value.status) {
    case "initialized":
      io.writeLine(`Self-Check schedule initialized for the first time — next check-in around ${result.value.nextDueDate}.`);
      return 0;
    case "not-due":
      io.writeLine(`Not due for a Self-Check yet — next one around ${result.value.nextDueDate}.`);
      return 0;
    case "already-open":
      io.writeLine(`Already waiting on Spencer's answer to the last Self-Check prompt — check chat.`);
      return 0;
    case "prompted":
      io.writeLine(`Asked Spencer for a Self-Check — check chat to answer.`);
      return 0;
  }
}

// ============================================================================
// Real adapter wiring
// ============================================================================

/**
 * Binds the real Notion, Google Calendar, and Pushover adapters (plus the
 * `MemoryStore`) to `runMorningRitual`'s injected seams. Every credential
 * and workspace id is read from the environment once, here, at process start
 * (AD-10) — nothing below this line reads `process.env` again.
 *
 * Note the two adapters are wrapped as zero-argument thunks: the ritual
 * deliberately knows nothing about a Notion `Client` or a Calendar
 * `OAuth2Client`, only "give me today's Tasks" and "give me today's events."
 * Both still throw on I/O failure exactly as AD-8 requires; the ritual is
 * what catches them.
 *
 * **The `bumpLevels` bridge (Task 19 — Task 17's deferred item, closed
 * here).** Task 17 built `slip-bump.ts`'s computation and
 * `memory-store.ts`'s `SlipHistory` storage, but nothing populated a
 * `SlipHistory` row until Task 19's Night Ritual close-out
 * (`applyNightCloseOutConfirmation`, `rituals/night-ritual.ts`) exists, and
 * nothing here ever read `listSlipHistories` to build the `bumpLevels` map
 * `MorningRitualDeps` has always accepted. Both halves now exist: every
 * currently-stored `SlipHistory` row is read (`listSlipHistories`) and
 * turned into the `taskId -> bump level` map `orderByDerivedPriority`/
 * `generatePlanReasoning` expect via the SAME `core/slip-bump.ts`
 * computation (`computeSlipBumpLevels`) the rest of the system uses — not a
 * re-derivation of that arithmetic here. So tomorrow's Morning Ritual now
 * genuinely reflects tonight's close-out: a Task confirmed slipped tonight
 * shows up bumped in tomorrow's Plan ordering, exactly as a mid-day-reported
 * slip already did before this task existed.
 */
export function createMorningRitualDeps(
  store: MemoryStore,
  env: Readonly<Record<string, string | undefined>> = process.env,
): MorningRitualDeps {
  const timeZone = env["YOH_TIMEZONE"];
  if (!timeZone) {
    // calendar-adapter.ts deliberately refuses to default this to UTC (a
    // silent default silently drops late-evening events); so does this.
    throw new Error("ritual-cli: missing required environment variable YOH_TIMEZONE (e.g. America/New_York)");
  }
  const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
  const projectsDataSourceId = env["NOTION_PROJECTS_DATA_SOURCE_ID"];
  const notionToken = env["NOTION_TOKEN"];
  if (!tasksDataSourceId || !projectsDataSourceId || !notionToken) {
    throw new Error(
      "ritual-cli: missing required environment variable(s) NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID / NOTION_PROJECTS_DATA_SOURCE_ID",
    );
  }

  const notionClient = new Client({
    auth: notionToken,
    ...(env["NOTION_API_VERSION"] ? { notionVersion: env["NOTION_API_VERSION"] } : {}),
  });
  const tokenStore = createTokenStore(loadGoogleOAuthConfigFromEnv(env));
  // `@googleapis/calendar` reaches its Google auth-client types through a
  // transitively-pinned COPY of that library (10.5.0, nested under
  // `googleapis-common`) while `token-store.ts` — AD-10's sole holder of the
  // real client — constructs one from the top-level copy (11.0.2). The two
  // classes are structurally identical at runtime but declare separate
  // private fields, so TypeScript treats them as unrelated nominal types.
  // This one documented cast, at the single seam where the two meet, is the
  // narrowest possible place to reconcile that; the alternative (importing
  // the auth library's own types here to line them up) is forbidden outright
  // by AD-10 and enforced by the repo scan in `tests/token-store.test.ts`.
  // The cast is expressed via `createCalendarReadClient`'s own parameter type
  // rather than by naming the package, for that same reason.
  const calendarClient = createCalendarReadClient(
    tokenStore.getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0],
  );
  const pushoverConfig = loadPushoverConfigFromEnv(env);

  // The bumpLevels bridge (see the doc comment above): every currently-
  // stored SlipHistory row, turned into a `taskId -> consecutiveSlipCount`
  // map, then the REAL `core/slip-bump.ts` computation over it — never a
  // parallel/hand-rolled escalation here.
  const slipCounts: Record<ExternalId, number> = {};
  for (const record of listSlipHistories(store)) {
    slipCounts[record.id] = record.data.consecutiveSlipCount;
  }
  const bumpLevels = computeSlipBumpLevels(slipCounts);

  return {
    store,
    readTasks: async () => (await readNotionTasks(notionClient, { tasksDataSourceId, projectsDataSourceId })).tasks,
    readCalendarEvents: () => readCalendarEvents(calendarClient, { timeZone }),
    sendNotification: (notification) => sendPushoverNotification(pushoverConfig, notification),
    now: () => new Date(),
    timeZone,
    bumpLevels,
    log: (entry) => {
      process.stderr.write(`${JSON.stringify(entry)}\n`);
    },
  };
}

/**
 * Binds the real `MemoryStore` and Pushover adapter to
 * `runNightPromptRitual`'s injected seams (Task 19 / Story 3.1; Pushover
 * added by Task 20's review fix — see `rituals/night-ritual.ts`'s "The first
 * attempt's own push notification" docstring section). Still lighter than
 * `createMorningRitualDeps`: `night-prompt` reads the already-stored Plan,
 * persists an interaction request, and sends one Pushover push — no Notion
 * or Calendar credentials are needed, so running it must not require THOSE
 * to be configured (mirrors `shell/chat-cli.ts`'s own "don't force unrelated
 * config" convention for its lazily-constructed `readTasks`). Pushover
 * credentials ARE required now, same as `morning`.
 */
export function createNightPromptRitualDeps(
  store: MemoryStore,
  env: Readonly<Record<string, string | undefined>> = process.env,
): NightPromptRitualDeps {
  const timeZone = env["YOH_TIMEZONE"];
  if (!timeZone) {
    throw new Error("ritual-cli: missing required environment variable YOH_TIMEZONE (e.g. America/New_York)");
  }
  const pushoverConfig = loadPushoverConfigFromEnv(env);

  return {
    store,
    sendNotification: (notification) => sendPushoverNotification(pushoverConfig, notification),
    now: () => new Date(),
    timeZone,
    log: (entry) => {
      process.stderr.write(`${JSON.stringify(entry)}\n`);
    },
  };
}

/**
 * Binds the real `MemoryStore` and `adapters/email-adapter.ts`'s `sendEmail`
 * to `runNightEscalateRitual`'s injected seams (Task 20 / Story 3.2). Like
 * `createNightPromptRitualDeps`, deliberately far lighter than
 * `createMorningRitualDeps`: `night-escalate` needs only the SMTP
 * credentials `email-adapter.ts` reads (`loadEmailConfigFromEnv`) — no
 * Notion, Calendar, or Pushover config is required BY THIS FUNCTION, so
 * building THESE deps must not fail at startup for lack of them.
 *
 * Task 25 update (Story 5.1): running `night-escalate` as a whole now DOES
 * require Pushover credentials anyway — not through this function, but
 * through `main`'s separate `createFailureAlertSender` call for AD-7's
 * failure-alert channel (see that function's own doc comment). This
 * function's own scope is deliberately unchanged by that: it still knows
 * nothing about Pushover, keeping the "one seam, one concern" shape AD-9
 * wants even though the two are now both required to actually run.
 */
export function createNightEscalateRitualDeps(
  store: MemoryStore,
  env: Readonly<Record<string, string | undefined>> = process.env,
): NightEscalateRitualDeps {
  const timeZone = env["YOH_TIMEZONE"];
  if (!timeZone) {
    throw new Error("ritual-cli: missing required environment variable YOH_TIMEZONE (e.g. America/New_York)");
  }
  const emailConfig = loadEmailConfigFromEnv(env);

  return {
    store,
    sendEscalationEmail: (message) => sendEmail(emailConfig, message),
    now: () => new Date(),
    timeZone,
    log: (entry) => {
      process.stderr.write(`${JSON.stringify(entry)}\n`);
    },
  };
}

/**
 * Binds the real `MemoryStore` and Pushover adapter to
 * `runSelfCheckRitual`'s injected seams (Task 24 / Story 4.3; Pushover added
 * by this task's own review fix — see `rituals/self-check.ts`'s "The push
 * notification" docstring section for why this is required from the start,
 * unlike `night-prompt`'s Task 20 review-fix retrofit). Still lighter than
 * `createMorningRitualDeps`: no Notion, Calendar, or SMTP credentials are
 * needed — only `YOH_TIMEZONE` plus Pushover's own
 * `PUSHOVER_APP_TOKEN`/`PUSHOVER_USER_KEY`. `random` binds to the real
 * `Math.random`, injected the same way every other non-deterministic seam in
 * this codebase is.
 */
export function createSelfCheckRitualDeps(
  store: MemoryStore,
  env: Readonly<Record<string, string | undefined>> = process.env,
): SelfCheckRitualDeps {
  const timeZone = env["YOH_TIMEZONE"];
  if (!timeZone) {
    throw new Error("ritual-cli: missing required environment variable YOH_TIMEZONE (e.g. America/New_York)");
  }
  const pushoverConfig = loadPushoverConfigFromEnv(env);

  return {
    store,
    now: () => new Date(),
    timeZone,
    random: Math.random,
    sendNotification: (notification) => sendPushoverNotification(pushoverConfig, notification),
    log: (entry) => {
      process.stderr.write(`${JSON.stringify(entry)}\n`);
    },
  };
}

/** A `RitualCliDeps` runner that throws if called — used for the OTHER subcommand's slot below, mirroring `shell/chat-cli.ts`'s "throws only if actually invoked" convention for a seam a given run never exercises. */
function unreachableRunner(label: string): () => Promise<never> {
  return () => {
    throw new Error(`ritual-cli: ${label} should not be invoked for this subcommand`);
  };
}

/**
 * Builds `RitualCliDeps.sendFailureAlert` (Task 25 / Story 5.1): binds the
 * real `adapters/notification-adapter.ts` Pushover adapter to AD-7's
 * failure-alert channel. Loaded SEPARATELY from any subcommand's own
 * `sendNotification` wiring above — see `RitualCliDeps.sendFailureAlert`'s
 * own doc comment for why. Consequence: every subcommand now needs
 * `PUSHOVER_APP_TOKEN`/`PUSHOVER_USER_KEY` configured for THIS reason alone
 * — even `night-escalate`, whose own ritual has no Pushover seam of its own
 * (it uses email; see `createNightEscalateRitualDeps`'s doc comment) and,
 * before this task, needed no Pushover credentials to run at all. That is
 * this task's intended scope: AD-7's alert channel must work "regardless of
 * whether that subcommand's own ritual has a notification seam at all."
 */
function createFailureAlertSender(
  env: Readonly<Record<string, string | undefined>>,
): (notification: PlanNotification) => Promise<void> {
  const pushoverConfig = loadPushoverConfigFromEnv(env);
  return (notification) => sendPushoverNotification(pushoverConfig, notification);
}

/**
 * Real entrypoint: opens the `MemoryStore` (per `MEMORY_DB_PATH`, defaulting
 * to `./data/yoh-memory.db` — the same default `.env.example` documents and
 * `chat-cli.ts` uses), wires ONLY the real adapters the requested subcommand
 * actually needs, dispatches, and always closes the store. Returns the exit
 * code rather than setting it, so it stays callable from a test.
 *
 * Deliberately branches on `argv[0]` BEFORE constructing any ritual's deps
 * (Task 19 review note, extended by Task 20): `createMorningRitualDeps`
 * requires Notion/Calendar/Pushover credentials that neither `night-prompt`
 * nor `night-escalate` has any use for (see `createNightPromptRitualDeps`'s
 * and `createNightEscalateRitualDeps`'s own doc comments), and
 * `createNightEscalateRitualDeps` requires SMTP credentials the other two
 * have no use for — running any one subcommand must not fail at startup
 * just because a DIFFERENT subcommand's credentials happen to be
 * unconfigured.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  const io: RitualCliIo = {
    writeLine: (line) => {
      process.stdout.write(`${line}\n`);
    },
    writeError: (line) => {
      process.stderr.write(`${line}\n`);
    },
  };

  const store = createMemoryStore({ databasePath: env["MEMORY_DB_PATH"] || "./data/yoh-memory.db" });
  try {
    if (argv[0] === "night-prompt") {
      let deps: NightPromptRitualDeps;
      let sendFailureAlert: (notification: PlanNotification) => Promise<void>;
      try {
        deps = createNightPromptRitualDeps(store, env);
        sendFailureAlert = createFailureAlertSender(env);
      } catch (err) {
        io.writeError(`ritual-cli: ${err instanceof Error ? err.message : String(err)}`);
        return 2;
      }
      return await runRitualCli(argv, {
        io,
        runMorning: unreachableRunner("runMorning"),
        runNightPrompt: () => runNightPromptRitual(deps),
        runNightEscalate: unreachableRunner("runNightEscalate"),
        runSelfCheck: unreachableRunner("runSelfCheck"),
        sendFailureAlert,
      });
    }

    if (argv[0] === "night-escalate") {
      let deps: NightEscalateRitualDeps;
      let sendFailureAlert: (notification: PlanNotification) => Promise<void>;
      try {
        deps = createNightEscalateRitualDeps(store, env);
        sendFailureAlert = createFailureAlertSender(env);
      } catch (err) {
        io.writeError(`ritual-cli: ${err instanceof Error ? err.message : String(err)}`);
        return 2;
      }
      return await runRitualCli(argv, {
        io,
        runMorning: unreachableRunner("runMorning"),
        runNightPrompt: unreachableRunner("runNightPrompt"),
        runNightEscalate: () => runNightEscalateRitual(deps),
        runSelfCheck: unreachableRunner("runSelfCheck"),
        sendFailureAlert,
      });
    }

    if (argv[0] === "self-check") {
      let deps: SelfCheckRitualDeps;
      let sendFailureAlert: (notification: PlanNotification) => Promise<void>;
      try {
        deps = createSelfCheckRitualDeps(store, env);
        sendFailureAlert = createFailureAlertSender(env);
      } catch (err) {
        io.writeError(`ritual-cli: ${err instanceof Error ? err.message : String(err)}`);
        return 2;
      }
      return await runRitualCli(argv, {
        io,
        runMorning: unreachableRunner("runMorning"),
        runNightPrompt: unreachableRunner("runNightPrompt"),
        runNightEscalate: unreachableRunner("runNightEscalate"),
        runSelfCheck: () => runSelfCheckRitual(deps),
        sendFailureAlert,
      });
    }

    let deps: MorningRitualDeps;
    let sendFailureAlert: (notification: PlanNotification) => Promise<void>;
    try {
      deps = createMorningRitualDeps(store, env);
      sendFailureAlert = createFailureAlertSender(env);
    } catch (err) {
      io.writeError(`ritual-cli: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
    return await runRitualCli(argv, {
      io,
      runMorning: () => runMorningRitual(deps),
      runNightPrompt: unreachableRunner("runNightPrompt"),
      runNightEscalate: unreachableRunner("runNightEscalate"),
      runSelfCheck: unreachableRunner("runSelfCheck"),
      sendFailureAlert,
    });
  } finally {
    store.close();
  }
}

if (import.meta.main) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`ritual-cli: fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
