/**
 * src/shell/ritual-cli/night-deps.ts
 *
 * `night-prompt` and `night-escalate`'s per-subcommand deps builders (Task
 * 12, a pure-move split of `shell/ritual-cli.ts`, then ~1500 lines: entry,
 * dispatch, and the AD-7 top-level handler stayed in `ritual-cli.ts`; each
 * subcommand's real adapter wiring moved out to its own file under
 * `shell/ritual-cli/`). Moved verbatim from `ritual-cli.ts`'s own "Real
 * adapter wiring" section — no behavior change. `ritual-cli.ts`'s `main()`
 * is this file's sole caller; per AD-1 this file, like `ritual-cli.ts`
 * itself, never imports `app/`.
 */
import type { MemoryStore } from "../../adapters/memory-store.ts";
import type { SqliteConnection } from "../../adapters/sqlite.ts";
import { listCompletedTaskIdsOnDate } from "../../adapters/completion-log.ts";
import { loadEmailConfigFromEnv, sendEmail } from "../../adapters/email-adapter.ts";
import { writeStructuredLog } from "../../adapters/logger.ts";
import { loadPushoverConfigFromEnv, sendPushoverNotification } from "../../adapters/notification-adapter.ts";
import { localIsoDate } from "../../rituals/ritual-shared.ts";
import type { NightEscalateRitualDeps, NightPromptRitualDeps } from "../../rituals/night-ritual.ts";

/**
 * Binds the real `MemoryStore` and Pushover adapter to
 * `runNightPromptRitual`'s injected seams (Task 19 / Story 3.1; Pushover
 * added by Task 20's review fix — see `rituals/night-ritual.ts`'s "The first
 * attempt's own push notification" docstring section). Still lighter than
 * `createMorningRitualDeps`: `night-prompt` reads the already-stored Plan,
 * persists an interaction request, and sends one Pushover push — no Notion
 * or Calendar credentials are needed, so running it must not require THOSE
 * to be configured (mirrors `shell/server.ts`'s own "don't force unrelated
 * config" convention for its own lazily-constructed dependencies). Pushover
 * credentials ARE required now, same as `morning`.
 */
export function createNightPromptRitualDeps(
  connection: SqliteConnection,
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
    // Task 27 / Story 5.3 (AD-9): delegates to the ONE shared writer in
    // `adapters/logger.ts` instead of repeating this closure per subcommand
    // (all four `create*RitualDeps` functions used to have their own
    // byte-identical copy of it).
    log: (entry) => writeStructuredLog(entry),
    // Story 7.9 (FR-41): completion-log.ts's own read, scoped to TODAY's
    // local date in the same `timeZone` this ritual already uses.
    getCompletedTaskIdsToday: () => listCompletedTaskIdsOnDate(connection, localIsoDate(new Date(), timeZone), timeZone),
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
    // Task 27 / Story 5.3 (AD-9): delegates to the ONE shared writer in
    // `adapters/logger.ts` instead of repeating this closure per subcommand
    // (all four `create*RitualDeps` functions used to have their own
    // byte-identical copy of it).
    log: (entry) => writeStructuredLog(entry),
  };
}
