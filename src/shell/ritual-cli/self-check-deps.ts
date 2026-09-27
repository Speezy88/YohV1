/**
 * src/shell/ritual-cli/self-check-deps.ts
 *
 * `self-check`'s per-subcommand deps builder (Task 12, a pure-move split of
 * `shell/ritual-cli.ts`, then ~1500 lines: entry, dispatch, and the AD-7
 * top-level handler stayed in `ritual-cli.ts`; each subcommand's real
 * adapter wiring moved out to its own file under `shell/ritual-cli/`). Moved
 * verbatim from `ritual-cli.ts`'s own "Real adapter wiring" section — no
 * behavior change. `ritual-cli.ts`'s `main()` is this file's sole caller;
 * per AD-1 this file, like `ritual-cli.ts` itself, never imports `app/`.
 */
import type { MemoryStore } from "../../adapters/memory-store.ts";
import { writeStructuredLog } from "../../adapters/logger.ts";
import { loadPushoverConfigFromEnv, sendPushoverNotification } from "../../adapters/notification-adapter.ts";
import type { SelfCheckRitualDeps } from "../../rituals/self-check.ts";

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
    // Task 27 / Story 5.3 (AD-9): delegates to the ONE shared writer in
    // `adapters/logger.ts` instead of repeating this closure per subcommand
    // (all four `create*RitualDeps` functions used to have their own
    // byte-identical copy of it).
    log: (entry) => writeStructuredLog(entry),
  };
}
