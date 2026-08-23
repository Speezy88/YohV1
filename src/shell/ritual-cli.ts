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
 * `self-check` (Task 24). `night-prompt` and `night-escalate` are now built
 * too; `self-check` is recognized here by name and reported as not yet
 * built, rather than falling through to "unknown subcommand": a cron entry
 * someone adds early should say what's actually going on.
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
 * Per AD-1 this shell file contains no ritual logic of its own. It does two
 * things: bind the real adapters/stores to `rituals/morning-ritual.ts`'s
 * injected seams (`createMorningRitualDeps`, below), and translate the
 * `Result` that comes back into terminal output and a process exit code. The
 * AD-8 catching of adapter throws happens inside the ritual, not here.
 *
 * Exit codes: `0` the subcommand ran (including the "already ran today" and
 * "nothing to plan" no-ops, which are outcomes, not errors), `1` the ritual
 * returned a `Result` failure, `2` a usage problem (no subcommand, unknown
 * subcommand, an unbuilt subcommand, or missing configuration).
 */
import { createMemoryStore, listSlipHistories, type MemoryStore } from "../adapters/memory-store.ts";
import { createCalendarReadClient, readCalendarEvents } from "../adapters/calendar-adapter.ts";
import { loadEmailConfigFromEnv, sendEmail } from "../adapters/email-adapter.ts";
import { loadPushoverConfigFromEnv, sendPushoverNotification } from "../adapters/notification-adapter.ts";
import { readNotionTasks } from "../adapters/notion-adapter.ts";
import { createTokenStore, loadGoogleOAuthConfigFromEnv } from "../adapters/token-store.ts";
import { computeSlipBumpLevels } from "../core/slip-bump.ts";
import { runMorningRitual, type MorningRitualDeps, type MorningRitualOutcome } from "../rituals/morning-ritual.ts";
import {
  renderNightEscalateNotice,
  runNightEscalateRitual,
  runNightPromptRitual,
  type NightEscalateRitualDeps,
  type NightEscalateOutcome,
  type NightPromptRitualDeps,
  type NightPromptOutcome,
} from "../rituals/night-ritual.ts";
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
}

/** AD-5's full subcommand set. `morning` (Task 10), `night-prompt` (Task 19), and `night-escalate` (Task 20) are built; the rest are claimed here so they report honestly instead of reading as typos. */
const SUBCOMMANDS = {
  morning: "built",
  "night-prompt": "built",
  "night-escalate": "built",
  "self-check": "Task 24 (Story 5.1)",
} as const;

const USAGE = "usage: yoh ritual <morning|night-prompt|night-escalate>";

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
    return handleMorningResult(await deps.runMorning(), deps.io);
  }

  if (subcommand === "night-prompt") {
    return handleNightPromptResult(await deps.runNightPrompt(), deps.io);
  }

  if (subcommand === "night-escalate") {
    return handleNightEscalateResult(await deps.runNightEscalate(), deps.io);
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

function handleMorningResult(result: Result<MorningRitualOutcome, YohError>, io: RitualCliIo): number {
  if (!result.ok) {
    // AD-7's real failure alerting is Epic 5; this is the structured log
    // line it will read. One JSON object per line so a cron mail/log
    // aggregator can parse it without guessing at prose.
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
 * Notion, Calendar, or Pushover config is required, so running it must not
 * fail at startup for lack of them.
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

/** A `RitualCliDeps` runner that throws if called — used for the OTHER subcommand's slot below, mirroring `shell/chat-cli.ts`'s "throws only if actually invoked" convention for a seam a given run never exercises. */
function unreachableRunner(label: string): () => Promise<never> {
  return () => {
    throw new Error(`ritual-cli: ${label} should not be invoked for this subcommand`);
  };
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
      try {
        deps = createNightPromptRitualDeps(store, env);
      } catch (err) {
        io.writeError(`ritual-cli: ${err instanceof Error ? err.message : String(err)}`);
        return 2;
      }
      return await runRitualCli(argv, {
        io,
        runMorning: unreachableRunner("runMorning"),
        runNightPrompt: () => runNightPromptRitual(deps),
        runNightEscalate: unreachableRunner("runNightEscalate"),
      });
    }

    if (argv[0] === "night-escalate") {
      let deps: NightEscalateRitualDeps;
      try {
        deps = createNightEscalateRitualDeps(store, env);
      } catch (err) {
        io.writeError(`ritual-cli: ${err instanceof Error ? err.message : String(err)}`);
        return 2;
      }
      return await runRitualCli(argv, {
        io,
        runMorning: unreachableRunner("runMorning"),
        runNightPrompt: unreachableRunner("runNightPrompt"),
        runNightEscalate: () => runNightEscalateRitual(deps),
      });
    }

    let deps: MorningRitualDeps;
    try {
      deps = createMorningRitualDeps(store, env);
    } catch (err) {
      io.writeError(`ritual-cli: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
    return await runRitualCli(argv, {
      io,
      runMorning: () => runMorningRitual(deps),
      runNightPrompt: unreachableRunner("runNightPrompt"),
      runNightEscalate: unreachableRunner("runNightEscalate"),
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
