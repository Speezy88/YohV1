/**
 * src/shell/ritual-cli/morning-deps.ts
 *
 * `morning`'s per-subcommand deps builder (Task 12, a pure-move split of
 * `shell/ritual-cli.ts`, then ~1500 lines: entry, dispatch, and the AD-7
 * top-level handler stayed in `ritual-cli.ts`; each subcommand's real
 * adapter wiring moved out to its own file under `shell/ritual-cli/`). Moved
 * verbatim from `ritual-cli.ts`'s own "Real adapter wiring" section — no
 * behavior change. `ritual-cli.ts`'s `main()` is this file's sole caller;
 * per AD-1 this file, like `ritual-cli.ts` itself, never imports `app/`.
 */
import type { MemoryStore } from "../../adapters/memory-store.ts";
import {
  createCalendarReadClient,
  createCalendarWriteClient,
  parseExtraCalendarIds,
  readCalendarEvents,
  writeTodaysPlanToCalendar,
} from "../../adapters/calendar-adapter.ts";
import { createPlanCalendarSnapshotStore } from "../../adapters/plan-calendar-snapshot-store.ts";
import { writeStructuredLog } from "../../adapters/logger.ts";
import { loadTaskPropertyNamesFromEnv, readNotionTasks } from "../../adapters/notion-adapter.ts";
import { createTokenStore, loadGoogleOAuthConfigFromEnv } from "../../adapters/token-store.ts";
import type { SqliteConnection } from "../../adapters/sqlite.ts";
import { computeBumpLevels } from "../../rituals/ritual-shared.ts";
import type { MorningRitualDeps } from "../../rituals/morning-ritual.ts";
import { Client } from "@notionhq/client";

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
  connection?: SqliteConnection,
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
  const taskPropertyNames = loadTaskPropertyNamesFromEnv(env);

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
  // Final whole-branch review, Finding 1: the "Yoh Plan" Calendar-write
  // surface (Task 12 / Story 1.12, AD-4) was built, tested, and reviewed but
  // never wired to a caller. Same `authClient` source and the same
  // documented cast as the read client just above (see that call's own
  // comment for the two-copies-of-the-auth-library reasoning). `tokenStore`
  // already structurally satisfies `CalendarIdStore`
  // (`getCalendarId`/`setCalendarId`, `token-store.ts` lines ~190-195), so it
  // is passed directly — no adapter import of `token-store.ts` (AD-1).
  const calendarWriteClient = createCalendarWriteClient(
    tokenStore.getOAuth2Client() as unknown as Parameters<typeof createCalendarWriteClient>[0],
  );

  // The bumpLevels bridge (see the doc comment above): every currently-
  // stored SlipHistory row, turned into a `taskId -> consecutiveSlipCount`
  // map, then the REAL `core/slip-bump.ts` computation over it — never a
  // parallel/hand-rolled escalation here. `app/plan-day.ts`'s own `/plan`
  // deps builder needs the identical bridge but AD-1 forbids it importing
  // this `shell/` file, so it keeps its own small copy of this same loop
  // (see that file's own doc comment).
  const bumpLevels = computeBumpLevels(store);

  return {
    store,
    readTasks: async () =>
      (await readNotionTasks(notionClient, { tasksDataSourceId, projectsDataSourceId, taskPropertyNames })).tasks,
    readCalendarEvents: () =>
      readCalendarEvents(calendarClient, {
        timeZone,
        extraCalendarIds: parseExtraCalendarIds(env["YOH_EXTRA_CALENDAR_IDS"]),
        yohPlanCalendarId: tokenStore.getCalendarId(),
        log: writeStructuredLog,
      }),
    // Final whole-branch review, Finding 1: mirrors `readCalendarEvents`
    // above — bound to the same `tokenStore`, which structurally satisfies
    // `CalendarIdStore`. `blocks` is already `"calendar-anchor"`-filtered by
    // the caller (`runMorningRitual`'s step 12a.5) before this is invoked.
    writeCalendarPlan: (blocks) => writeTodaysPlanToCalendar(calendarWriteClient, tokenStore, blocks, {
        timeZone,
        ...(connection ? { snapshot: createPlanCalendarSnapshotStore(connection) } : {}),
      }),
    // Spencer, 2026-09-27: the morning Plan reaches him in the app only
    // (Home + `/morning`), never as a phone push. The stored Plan IS the
    // delivery, so this seam just records that the Plan is ready. Pushover
    // stays wired for AD-7 failure/operational alerts, which go through
    // ritual-cli.ts's separate `sendFailureAlert` path, not this one.
    sendNotification: async () => {
      writeStructuredLog({ level: "info", event: "morning-ritual.plan-in-app-only" });
    },
    now: () => new Date(),
    timeZone,
    bumpLevels,
    // Task 27 / Story 5.3 (AD-9): delegates to the ONE shared writer in
    // `adapters/logger.ts` instead of repeating this closure per subcommand
    // (all four `create*RitualDeps` functions used to have their own
    // byte-identical copy of it).
    log: (entry) => writeStructuredLog(entry),
    // Story 9.4: threaded straight through, never re-opened — this process
    // already owns the one shared connection (AD-10); this function just
    // hands it to the ritual so it can raise its own needs-data notification.
    ...(connection ? { connection } : {}),
  };
}
