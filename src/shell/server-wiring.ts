/**
 * src/shell/server-wiring.ts
 *
 * The real dependencies behind `ServerDeps`, split out of `server.ts` (a
 * pure move): the `build*Deps` functions that construct the Notion, Calendar,
 * Claude and search clients from the environment. Called only by
 * `server.ts`'s entry point; tests and the fixture server build fakes instead.
 */
import { Client } from "@notionhq/client";
import { writeStructuredLog } from "../adapters/logger.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import type { FeedFetch } from "../adapters/feed-cache.ts";
import { createCryptoFeed } from "../adapters/crypto-feed.ts";
import { createWeatherFeed } from "../adapters/weather-feed.ts";
import { createNewsFeed } from "../adapters/news-feed.ts";
import { createMemoryStore, listNightCloseOutDone, listPlanDates, type MemoryStore } from "../adapters/memory-store.ts";
import { listLlmUsageSince } from "../adapters/llm-usage-store.ts";
import { localIsoDate } from "../core/local-time.ts";
import { listCompletedTaskIdsOnDate, listActivityDays, listCompletions, recordActivityDay, recordCompletion as completionLogRecordCompletion, type RecordCompletionInput } from "../adapters/completion-log.ts";
import { createTokenStore, loadGoogleOAuthConfigFromEnv, type TokenStore } from "../adapters/token-store.ts";
import {
  bindCalendarApply,
  createCalendarBroadClient,
  createCalendarReadClient,
  createCalendarWriteClient,
  parseExtraCalendarIds,
  proposeCalendarEdit as calendarProposeEdit,
  proposeNewCalendarEvent,
  readCalendarEvents,
  readDeletedYohPlanEventIds,
  readYohPlanEvents,
  resolveCalendarEditRoute as calendarResolveRoute,
  writeTodaysPlanToCalendar,
  type CalendarApplyBindingFn,
  type CalendarBroadClient,
  type CalendarWriteClient,
} from "../adapters/calendar-adapter.ts";
import { createPlanCalendarSnapshotStore } from "../adapters/plan-calendar-snapshot-store.ts";
import {
  bindNotionCreatePage,
  bindNotionTaskWrites,
  loadTaskPropertyNamesFromEnv,
  readNotionTasks,
  readResearchVault,
  readTaskFieldOptions,
  type NotionCreatePageBindingFn,
  type NotionTaskPropertyNames,
  type NotionTaskWriteBindingFn,
} from "../adapters/notion-adapter.ts";
import { createAnthropicMessagesClient, loadLlmAdapterConfigFromEnv, type AnthropicMessagesClient } from "../adapters/llm-adapter.ts";
import { search as runSearch } from "../adapters/search-adapter.ts";
import type { SearchFn } from "../app/web-search.ts";
import type { CalendarEvent, ExternalId, IsoDate, Task, TaskFieldOptions } from "../types/domain.ts";
import { currentIsoDate, type ServerDeps } from "./server-routes.ts";

/**
 * The Notion + host-timezone configuration Home (Story 7.8) and check-off
 * (Story 7.10) both need — loaded once so the two share ONE Notion client
 * and ONE memory store. Mirrors `shell/ritual-cli.ts`'s
 * `createMorningRitualDeps` construction (same env vars, same client
 * constructor) — the Notion/Calendar clients are otherwise built only
 * inside `rituals/`'s one-shot deps builders, never shared as an importable
 * helper (AD-1 keeps `rituals/` and `shell/server.ts` from depending on each
 * other), so this is its own small copy, not a refactor of that one.
 *
 * Returns `undefined` — logging why, once, at startup — rather than
 * throwing: unlike `ritual-cli.ts` (a one-shot CLI where a thrown config
 * error is the whole run failing anyway), this runs inside the long-lived
 * server's own startup — a misconfigured feature must degrade its routes to
 * a clear `unreachable` error, never take down `/api/health`, the
 * notification routes, or the built web app with it.
 */
interface NotionFeatureConfig {
  readonly timeZone: string;
  readonly store: MemoryStore;
  readonly notionClient: Client;
  readonly tasksDataSourceId: string;
  readonly projectsDataSourceId: string;
  readonly taskPropertyNames: NotionTaskPropertyNames;
}

export function loadNotionFeatureConfig(connection: SqliteConnection, env: Readonly<Record<string, string | undefined>>): NotionFeatureConfig | undefined {
  const timeZone = env["YOH_TIMEZONE"];
  const notionToken = env["NOTION_TOKEN"];
  const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
  const projectsDataSourceId = env["NOTION_PROJECTS_DATA_SOURCE_ID"];
  if (!timeZone || !notionToken || !tasksDataSourceId || !projectsDataSourceId) {
    writeStructuredLog({
      level: "warn",
      event: "server.home-view-not-configured",
      detail: {
        message:
          "missing required environment variable(s) YOH_TIMEZONE / NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID / NOTION_PROJECTS_DATA_SOURCE_ID — GET /api/home and the check-off routes will report an error until set",
      },
    });
    return undefined;
  }
  return {
    timeZone,
    store: createMemoryStore(connection),
    notionClient: new Client({ auth: notionToken, ...(env["NOTION_API_VERSION"] ? { notionVersion: env["NOTION_API_VERSION"] } : {}) }),
    tasksDataSourceId,
    projectsDataSourceId,
    taskPropertyNames: loadTaskPropertyNamesFromEnv(env),
  };
}

function readTasksWith(notion: NotionFeatureConfig) {
  return async () =>
    await readNotionTasks(notion.notionClient, {
      tasksDataSourceId: notion.tasksDataSourceId,
      projectsDataSourceId: notion.projectsDataSourceId,
      taskPropertyNames: notion.taskPropertyNames,
    });
}

/**
 * Story 7.8: `GET /api/home`'s real dependencies. The whole Google client
 * construction is wrapped: `loadGoogleOAuthConfigFromEnv` throws on a
 * missing `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI`, which must degrade
 * Home only, never the rest of the server.
 */
export function buildHomeViewDeps(notion: NotionFeatureConfig, env: Readonly<Record<string, string | undefined>>): ServerDeps["homeView"] {
  try {
    const tokenStore = createTokenStore(loadGoogleOAuthConfigFromEnv(env));
    const calendarClient = createCalendarReadClient(tokenStore.getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0]);
    return {
      store: notion.store,
      readCalendarEvents: () =>
        readCalendarEvents(calendarClient, {
          timeZone: notion.timeZone,
          extraCalendarIds: parseExtraCalendarIds(env["YOH_EXTRA_CALENDAR_IDS"]),
          yohPlanCalendarId: tokenStore.getCalendarId(),
          log: writeStructuredLog,
        }),
      readTasks: readTasksWith(notion),
      timeZone: notion.timeZone,
    };
  } catch (err) {
    writeStructuredLog({
      level: "warn",
      event: "server.home-view-not-configured",
      detail: { message: err instanceof Error ? err.message : String(err) },
    });
    return undefined;
  }
}

/**
 * Real-use fixes plan, Task 4: `GET /api/calendar/day`'s real
 * dependencies — same lazy Google client construction/degrade-only-this-
 * feature convention as `buildHomeViewDeps` just above, bound to a per-date
 * read (`readCalendarEvents`'s own `date` field) instead of "today only." A
 * separate `TokenStore`/read client instance from `buildHomeViewDeps`'s own
 * (and from `buildChatDeps`'s `readCalendarEventsForDate`, below) — the
 * same duplication precedent those two already establish, since each
 * optional feature bucket is independently guarded against Google OAuth not
 * being configured.
 */
export function buildCalendarDayDeps(notion: NotionFeatureConfig, env: Readonly<Record<string, string | undefined>>): ServerDeps["calendarDay"] {
  try {
    const tokenStore = createTokenStore(loadGoogleOAuthConfigFromEnv(env));
    const calendarClient = createCalendarReadClient(tokenStore.getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0]);
    return {
      store: notion.store,
      timeZone: notion.timeZone,
      readCalendarEventsForDate: (date) =>
        readCalendarEvents(calendarClient, {
          timeZone: notion.timeZone,
          date,
          extraCalendarIds: parseExtraCalendarIds(env["YOH_EXTRA_CALENDAR_IDS"]),
          yohPlanCalendarId: tokenStore.getCalendarId(),
          log: writeStructuredLog,
        }),
    };
  } catch (err) {
    writeStructuredLog({
      level: "warn",
      event: "server.calendar-day-not-configured",
      detail: { message: err instanceof Error ? err.message : String(err) },
    });
    return undefined;
  }
}

/**
 * Story 7.10: the check-off routes' and commit sweep's real dependencies.
 * Needs no Google configuration. The Notion client goes to `app/check-off.ts`
 * as a dependency; the Status write itself is made there (AD-16).
 */
/**
 * Task 6B: the Tasks page routes' real dependencies, on the SAME Notion
 * client Home and check-off already share. The create-page binding and the
 * field-write binding are both built here from that one client; the writes
 * themselves happen inside `app/create-task.ts`/`app/update-task.ts`
 * (AD-16), the field write reached only through the adapter's own
 * `bindNotionTaskWrites` spread. The create-page config type also carries a
 * Research Vault id; only the Tasks target is ever used from this page.
 */
export function buildTasksDeps(
  notion: NotionFeatureConfig,
  env: Readonly<Record<string, string | undefined>>,
  /** Polish 4 Task 1: the quick-add Haiku fallback's Claude client — the SAME instance `buildChatDeps` already built for `/api/chat`, never a second `Anthropic` client. Absent (no `CLAUDE_API_KEY`/`YOH_TIMEZONE`): the fallback is simply skipped. */
  llmClient?: AnthropicMessagesClient,
): ServerDeps["tasks"] {
  const config = {
    tasksDataSourceId: notion.tasksDataSourceId,
    projectsDataSourceId: notion.projectsDataSourceId,
    taskPropertyNames: notion.taskPropertyNames,
  };
  const readTasks = readTasksWith(notion);
  return {
    timeZone: notion.timeZone,
    readTasks: async () => (await readTasks()).tasks,
    readFieldOptions: () => readTaskFieldOptions(notion.notionClient, config),
    getNotionCreatePageBinding: () => ({
      ok: true,
      value: { client: notion.notionClient, config: { ...config, researchVaultDataSourceId: env["NOTION_RESEARCH_VAULT_DATA_SOURCE_ID"] ?? "" } },
    }),
    ...(llmClient ? { llmClient } : {}),
    ...bindNotionTaskWrites(() => ({ ok: true, value: { client: notion.notionClient, config } })),
  };
}

/** Story 9.2: /sandbox's real dependencies — the same shared Notion client Home/Tasks/check-off already use. */
export function buildSandboxDeps(notion: NotionFeatureConfig): ServerDeps["sandbox"] {
  const config = { tasksDataSourceId: notion.tasksDataSourceId, projectsDataSourceId: notion.projectsDataSourceId, taskPropertyNames: notion.taskPropertyNames };
  return {
    store: notion.store,
    timeZone: notion.timeZone,
    readTasks: async () => (await readTasksWith(notion)()).tasks,
    // Task 5 (polish-5): the SAME live-schema read `buildTasksDeps` above
    // binds for the Tasks page's own inline selects — the Sandbox Card's
    // Area/Energy fields render as `<select>`s from this.
    readFieldOptions: () => readTaskFieldOptions(notion.notionClient, config),
    ...bindNotionTaskWrites(() => ({ ok: true, value: { client: notion.notionClient, config } })),
  };
}

/**
 * Task 6C: the Research Hub page route's real dependencies — the SAME
 * shared Notion client Home/Tasks/check-off already use, plus its own
 * `NOTION_RESEARCH_VAULT_DATA_SOURCE_ID` (the one extra env var this page
 * needs beyond `NotionFeatureConfig`'s core four). Absent either — no
 * `notion` (core Notion unconfigured) or no Research Vault id — the page
 * reports a clear `unreachable` error rather than a 500 (same convention as
 * `buildHomeViewDeps`/`buildTasksDeps`).
 */
export function buildResearchDeps(notion: NotionFeatureConfig | undefined, env: Readonly<Record<string, string | undefined>>): ServerDeps["research"] {
  const researchVaultDataSourceId = env["NOTION_RESEARCH_VAULT_DATA_SOURCE_ID"];
  if (!notion || !researchVaultDataSourceId) return undefined;
  return { readResearchVault: () => readResearchVault(notion.notionClient, { researchVaultDataSourceId }) };
}

/** A minute: after a failed activity write, no retry (and so no log line) sooner than this. */
const ACTIVITY_RETRY_MS = 60_000;
/** Spend reads from this far before the local month starts, so any timezone's month start is covered; `monthlySpend` filters exactly. */
const SPEND_READ_MARGIN_DAYS = 2;

/** The slice of `fetch` every Desk feed adapter needs (the global `fetch` satisfies it). */
export type DeskFeedFetch = FeedFetch;

/**
 * Ruling E12-R21: the Desk's public-feed widgets (real `fetch`, one cache per
 * feed). Without `YOH_TIMEZONE` Desk is not configured, so neither are its feeds.
 */
export function buildDeskFeedsDeps(env: Readonly<Record<string, string | undefined>>, fetchFn: DeskFeedFetch = (url, init) => fetch(url, init), now: () => Date = () => new Date()): ServerDeps["deskFeeds"] {
  const timeZone = env["YOH_TIMEZONE"];
  if (!timeZone) return undefined;
  const crypto = createCryptoFeed({ fetch: fetchFn, now, log: writeStructuredLog, userAgent: env["YOH_FEED_USER_AGENT"] });
  const weather = createWeatherFeed({ fetch: fetchFn, now, log: writeStructuredLog, userAgent: env["YOH_FEED_USER_AGENT"] });
  const news = createNewsFeed({ fetch: fetchFn, now, log: writeStructuredLog, userAgent: env["YOH_FEED_USER_AGENT"] });
  return { timeZone, readCrypto: () => crypto.read(), readWeather: () => weather.read(), readNews: () => news.read() };
}

/**
 * Ruling E12-R3: the activity-day recorder. Remembers the last date it wrote,
 * so a process makes one SQLite write per day however many pings arrive,
 * and after a failed write waits a minute before trying again. Without
 * `YOH_TIMEZONE` Desk is not configured (never a silent UTC).
 */
export function buildDeskDeps(connection: SqliteConnection, env: Readonly<Record<string, string | undefined>>, now: () => Date = () => new Date()): ServerDeps["desk"] {
  const timeZone = env["YOH_TIMEZONE"];
  if (!timeZone) return undefined;
  let lastWritten: IsoDate | undefined;
  let lastFailedAt: number | undefined;
  const store = createMemoryStore(connection);
  return {
    now,
    timeZone,
    recordActivityDay: (date) => {
      if (date === lastWritten) return;
      // Throws rather than returning, so `POST /api/activity` answers with a failure and the web pings again on a later input.
      if (lastFailedAt !== undefined && now().getTime() - lastFailedAt < ACTIVITY_RETRY_MS) throw new Error("activity day not written: backing off after a failed write");
      try {
        recordActivityDay(connection, date);
      } catch (err) {
        lastFailedAt = now().getTime();
        throw err;
      }
      lastWritten = date;
      lastFailedAt = undefined;
    },
    listCompletions: () => listCompletions(connection),
    listActivityDays: () => listActivityDays(connection),
    listPlanDates: () => listPlanDates(store),
    listCloseOutDates: () => listNightCloseOutDone(store).map((r) => r.data.date),
    listUsage: () => {
      const monthStart = `${localIsoDate(now(), timeZone).slice(0, 7)}-01T00:00:00.000Z`;
      const since = new Date(Date.parse(monthStart) - SPEND_READ_MARGIN_DAYS * 86_400_000).toISOString();
      return listLlmUsageSince(connection, since);
    },
  };
}

export function buildCheckOffDeps(notion: NotionFeatureConfig): ServerDeps["checkOff"] {
  const readTasks = readTasksWith(notion);
  return {
    store: notion.store,
    timeZone: notion.timeZone,
    notionClient: notion.notionClient,
    notionStatusConfig: { tasksDataSourceId: notion.tasksDataSourceId, taskPropertyNames: notion.taskPropertyNames },
    lookupTask: async (taskId) => (await readTasks()).tasks.find((t) => t.id === taskId),
  };
}

/**
 * Story 8.5: `POST /api/chat`'s real dependencies — the same wiring
 * `shell/chat-cli.ts`'s `main()` used to build for its own `chatTurn` call
 * (since retired, Story 8.9), mirrored here for the server process. Only
 * `YOH_TIMEZONE` and
 * `CLAUDE_API_KEY` are required up front (general chat, Time Budget, and
 * Plan-view need nothing else); every Notion, search, and Calendar
 * dependency is constructed lazily on first use and reports its own missing
 * configuration then, so a server without Notion or Google still chats.
 * Missing either required value returns `undefined` (logged once), and the
 * route streams its not-configured `error` event.
 */
/** `POST /api/plan/reshuffle*`'s deps: the reshuffle binding `buildChatDeps` already built, so both entry points share one set. */
export function buildPlanDeps(chat: ServerDeps["chat"]): ServerDeps["plan"] {
  if (!chat?.reshuffle) return undefined;
  return { ...chat.reshuffle, store: chat.store };
}

/** `POST /api/plan/sync` and the sweep's deps: the reshuffle binding plus the two Yoh Plan calendar reads `buildChatDeps` built. */
export function buildPlanSyncDeps(chat: ServerDeps["chat"]): ServerDeps["planSync"] {
  if (!chat?.reshuffle || !chat.planSyncReads) return undefined;
  return { ...chat.reshuffle, store: chat.store, ...chat.planSyncReads };
}

export function buildChatDeps(
  connection: SqliteConnection,
  notion: NotionFeatureConfig | undefined,
  env: Readonly<Record<string, string | undefined>>,
): ServerDeps["chat"] {
  const notConfigured = (message: string): undefined => {
    writeStructuredLog({ level: "warn", event: "server.chat-not-configured", detail: { message: `${message} — POST /api/chat will report an error until set` } });
    return undefined;
  };
  const timeZone = env["YOH_TIMEZONE"];
  if (!timeZone) return notConfigured("missing required environment variable YOH_TIMEZONE");
  let llmClient: AnthropicMessagesClient;
  try {
    llmClient = createAnthropicMessagesClient(loadLlmAdapterConfigFromEnv(env));
  } catch (err) {
    return notConfigured(err instanceof Error ? err.message : String(err));
  }

  const notionClientFromEnv = (notionToken: string): Client =>
    new Client({ auth: notionToken, ...(env["NOTION_API_VERSION"] ? { notionVersion: env["NOTION_API_VERSION"] } : {}) });

  const readTasks = async (): Promise<readonly Task[]> => {
    if (!notion) {
      throw new Error(
        "server: missing required environment variable(s) NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID / NOTION_PROJECTS_DATA_SOURCE_ID — needed to read your Tasks",
      );
    }
    return (await readTasksWith(notion)()).tasks;
  };

  const getNotionCreatePageBinding: NotionCreatePageBindingFn = () => {
    const notionToken = env["NOTION_TOKEN"];
    const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
    const projectsDataSourceId = env["NOTION_PROJECTS_DATA_SOURCE_ID"];
    const researchVaultDataSourceId = env["NOTION_RESEARCH_VAULT_DATA_SOURCE_ID"];
    if (!notionToken || !tasksDataSourceId || !projectsDataSourceId || !researchVaultDataSourceId) {
      return {
        ok: false,
        error: { kind: "missing-field", message: "server: missing required Notion environment variable(s) — needed to create or file a Notion item" },
      };
    }
    return {
      ok: true,
      value: {
        client: notion?.notionClient ?? notionClientFromEnv(notionToken),
        config: { tasksDataSourceId, projectsDataSourceId, researchVaultDataSourceId, taskPropertyNames: loadTaskPropertyNamesFromEnv(env) },
      },
    };
  };

  const perplexityApiKey = env["PERPLEXITY_API_KEY"];
  const searchFn: SearchFn = async (query) => {
    if (!perplexityApiKey) {
      return { ok: false, error: { kind: "missing-field", message: "server: missing required environment variable PERPLEXITY_API_KEY — needed to search" } };
    }
    return runSearch({ apiKey: perplexityApiKey }, query);
  };

  // Story 8.6 (Task 7): same lazy-construction convention as every Notion
  // binding above — a session that never answers an open item's Task-field
  // question must not be unable to chat at all just because Notion isn't
  // configured. `bindNotionTaskWrites` (`notion-adapter.ts`) is the ONLY
  // caller of the two Notion Task-write functions this binds (AD-16) — this
  // file never names either directly, mirroring `chat-cli.ts`'s own
  // `getNotionTaskWriteBinding` before it was retired (Story 8.9).
  const getNotionTaskWriteBinding: NotionTaskWriteBindingFn = () => {
    const notionToken = env["NOTION_TOKEN"];
    const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
    if (!notionToken || !tasksDataSourceId) {
      return {
        ok: false,
        error: {
          kind: "missing-field",
          message: "server: missing required environment variable(s) NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID — needed to record this answer in Notion",
        },
      };
    }
    return { ok: true, value: { client: notion?.notionClient ?? notionClientFromEnv(notionToken), config: { tasksDataSourceId } } };
  };

  // Polish 4 Task 3 (Spencer: an Area answer typed in chat wrote "college
  // apps" free text instead of matching the live "College Apps" option):
  // `AnswerDataCompletenessDeps.readFieldOptions`, the same live-schema read
  // `buildTasksDeps` already binds for the Tasks page's own inline selects —
  // a fresh read every call (never cached), since the live option list can
  // change while the process runs. Throws when Notion isn't fully
  // configured; `answer-data-completeness.ts`'s own `liveAreaOptions` treats
  // any throw as "no live options to check against," so a chat session
  // still lets Spencer answer even when Notion is unreachable.
  const readFieldOptions = (): Promise<TaskFieldOptions> => {
    const notionToken = env["NOTION_TOKEN"];
    const tasksDataSourceId = env["NOTION_TASKS_DATA_SOURCE_ID"];
    if (!notionToken || !tasksDataSourceId) {
      throw new Error("server: missing required Notion environment variable(s) NOTION_TOKEN / NOTION_TASKS_DATA_SOURCE_ID — needed to read the live Area/Energy/Status options");
    }
    return readTaskFieldOptions(notion?.notionClient ?? notionClientFromEnv(notionToken), {
      tasksDataSourceId,
      taskPropertyNames: loadTaskPropertyNamesFromEnv(env),
    });
  };

  // Story 8.6 (Task 7): `completion-log.ts`'s `recordCompletion`, pre-bound
  // to the shared `SqliteConnection` — the server's own equivalent of
  // `chat-cli.ts`'s `recordCompletion` closure, before it was retired
  // (Story 8.9). `initCompletionLogSchema`
  // already runs unconditionally at server startup (in `server.ts`), so this needs
  // no lazy guard of its own.
  const recordCompletion = (input: RecordCompletionInput): void => completionLogRecordCompletion(connection, input);
  // Reuses `readTasks` above (the same live Notion read Mid-Day Re-Flow
  // already uses) — Story 7.9's Ruling R7 close-out completion-snapshot
  // lookup, mirrored from `chat-cli.ts`'s `main()` (since retired, Story
  // 8.9).
  const lookupTask = async (taskId: ExternalId): Promise<Task | undefined> => (await readTasks()).find((t) => t.id === taskId);

  // Google OAuth is constructed once, on the first Calendar request. The
  // narrow read client lists today's events; the broad one routes and
  // proposes an edit (AD-13).
  let cachedTokenStore: TokenStore | undefined;
  const getTokenStore = (): TokenStore => {
    cachedTokenStore ??= createTokenStore(loadGoogleOAuthConfigFromEnv(env));
    return cachedTokenStore;
  };
  const getCalendarBroadClient = (): CalendarBroadClient =>
    createCalendarBroadClient(getTokenStore().getBroadOAuth2Client() as unknown as Parameters<typeof createCalendarBroadClient>[0]);
  const readCalendarEventsFn = async (): Promise<readonly CalendarEvent[]> =>
    readCalendarEvents(createCalendarReadClient(getTokenStore().getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0]), {
      timeZone,
      extraCalendarIds: parseExtraCalendarIds(env["YOH_EXTRA_CALENDAR_IDS"]),
      yohPlanCalendarId: getTokenStore().getCalendarId(),
      log: writeStructuredLog,
    });
  // Real-use fixes plan, Task 5 ("what's happening tomorrow"): the same
  // read-only client/binding as `readCalendarEventsFn` above, just with the
  // target date threaded through to `readCalendarEvents`'s own `date`
  // field — `app/day-view.ts`'s `dayView` is the sole caller.
  const readCalendarEventsForDate = async (date: IsoDate): Promise<readonly CalendarEvent[]> =>
    readCalendarEvents(createCalendarReadClient(getTokenStore().getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0]), {
      timeZone,
      date,
      extraCalendarIds: parseExtraCalendarIds(env["YOH_EXTRA_CALENDAR_IDS"]),
      yohPlanCalendarId: getTokenStore().getCalendarId(),
      log: writeStructuredLog,
    });
  // Real-use fixes plan, Task 1 ("plan my day on demand"): `/plan`'s own
  // Calendar-write seam (`app/plan-day.ts`'s `PlanDayDeps.writeCalendarPlan`)
  // — same lazy-construction convention as `getCalendarBroadClient` above,
  // built from the SAME cached `getTokenStore()` rather than a second,
  // independently-refreshing token store. Deliberately not a re-run of
  // `shell/ritual-cli/morning-deps.ts`'s `createMorningRitualDeps` wholesale
  // — this file already builds its own lazily-guarded Notion client and
  // `TokenStore` for `/api/chat`'s other capabilities (see
  // `loadNotionFeatureConfig`/`buildHomeViewDeps` above for the identical
  // reasoning on the Notion/Calendar READ side), and re-running that
  // builder here would stand up a SECOND, independent Notion client and a
  // SECOND, independently-refreshing Google `TokenStore` in the same
  // process — a worse outcome than the few lines of adapter-binding code
  // this avoids duplicating.
  let cachedCalendarWriteClient: CalendarWriteClient | undefined;
  const getCalendarWriteClient = (): CalendarWriteClient => {
    cachedCalendarWriteClient ??= createCalendarWriteClient(getTokenStore().getOAuth2Client() as unknown as Parameters<typeof createCalendarWriteClient>[0]);
    return cachedCalendarWriteClient;
  };
  // Story 8.6 (Task 7): same lazy-construction convention as every binding
  // above — a session that never confirms a Calendar-edit Proposal must not
  // be unable to chat at all just because Google OAuth isn't configured.
  // `bindCalendarApply` (`calendar-adapter.ts`) is the ONLY caller of the
  // Calendar apply-edit write this binds (AD-16) — mirrors `chat-cli.ts`'s
  // own `getCalendarApplyBinding` before it was retired (Story 8.9).
  const getCalendarApplyBinding: CalendarApplyBindingFn = () => {
    try {
      return { ok: true, value: getCalendarBroadClient() };
    } catch (err) {
      return {
        ok: false,
        error: { kind: "missing-field", message: `server: could not apply that calendar change — ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  };

  const store = notion?.store ?? createMemoryStore(connection);

  return {
    store,
    timeZone,
    now: () => new Date(),
    llmClient,
    // Real-use fixes plan, Task 9: every `llm-adapter.ts` call site this
    // process makes (`app/chat-turn.ts`, `app/chat-agent.ts`,
    // `app/create-item.ts`, `app/calendar-edit.ts`,
    // `app/surface-open-items.ts`) threads its own trailing `connection`
    // argument from this one field, so real usage gets recorded — the
    // schema is created idempotently at startup, in `server.ts`.
    connection,
    readTasks,
    // Story 8.7 (FR-41): the same completion-log.ts binding
    // ritual-cli.ts's createNightPromptRitualDeps already uses — /night's
    // exclusion rule.
    getCompletedTaskIdsToday: () => listCompletedTaskIdsOnDate(connection, currentIsoDate(new Date(), timeZone), timeZone),
    getNotionCreatePageBinding,
    searchFn,
    // Review fix (real-use fixes plan, Task 5 fix, FR-42): the single
    // source of truth for whether web search is actually configured right
    // now — threaded through `ChatTurnDeps` (via `WebSearchDeps`) into both
    // `app/web-search.ts`'s `searchWeb` (never attempts a search when
    // false) and, via `app/chat-turn.ts`'s system prompt,
    // `core/tone.ts`'s capability text (never claims search when false).
    webSearchAvailable: Boolean(perplexityApiKey),
    readCalendarEventsFn,
    readCalendarEventsForDate,
    resolveCalendarEditRouteFn: (calendarId, eventId) => calendarResolveRoute(getCalendarBroadClient(), calendarId, eventId),
    proposeCalendarEditFn: (calendarId, eventId, change) => calendarProposeEdit(getCalendarBroadClient(), calendarId, eventId, change),
    proposeNewCalendarEventFn: proposeNewCalendarEvent,
    // Real-use fixes plan, Task 1: `/plan`'s (`app/plan-day.ts`) own
    // Yoh-Plan Calendar write, the same seam the 6am cron's
    // `createMorningRitualDeps` binds, minus the push (`planDay` hardcodes
    // that to a no-op itself, so it isn't threaded through `ChatTurnDeps` at
    // all — see that file's own doc comment). `bumpLevels` is deliberately
    // NOT built here: it's pure computation over `store` with no credential
    // of its own, so `plan-day.ts` computes it itself, freshly, on every
    // `/plan` — see that file's own doc comment for why (this object is
    // built once at server startup, but a long-running process can see
    // fresh `SlipHistory` rows written hours later, e.g. via `/night`).
    writeCalendarPlan: (blocks) => writeTodaysPlanToCalendar(getCalendarWriteClient(), getTokenStore(), blocks, { timeZone, snapshot: createPlanCalendarSnapshotStore(connection) }),
    log: (entry) => writeStructuredLog(entry),
    planSyncReads: {
      readYohPlanEvents: async () => {
        const calendarId = getTokenStore().getCalendarId();
        if (!calendarId) return undefined;
        return readYohPlanEvents(createCalendarReadClient(getTokenStore().getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0]), calendarId, { timeZone, now: new Date() });
      },
      readDeletedYohPlanEventIds: async () => {
        const calendarId = getTokenStore().getCalendarId();
        if (!calendarId) return [];
        return readDeletedYohPlanEventIds(createCalendarReadClient(getTokenStore().getOAuth2Client() as unknown as Parameters<typeof createCalendarReadClient>[0]), calendarId, { timeZone, now: new Date() });
      },
      readPlanCalendarSnapshot: (date) => createPlanCalendarSnapshotStore(connection).list(date),
      readPlanCalendarWriteState: (date) => createPlanCalendarSnapshotStore(connection).writeState(date),
    },
    // Reshuffle approval (chat "Approve" answers via `answerOpenItem`) — the
    // same narrow Yoh-Plan-calendar writer `/plan` uses, never the broad client.
    reshuffle: {
      connection,
      timeZone,
      now: () => new Date(),
      readTasks,
      readCalendarEvents: readCalendarEventsFn,
      writeCalendarPlan: (blocks) => writeTodaysPlanToCalendar(getCalendarWriteClient(), getTokenStore(), blocks, { timeZone, snapshot: createPlanCalendarSnapshotStore(connection) }),
    },
    // Story 8.6 (Task 7): `AnswerOpenItemDeps`'s own fields — spread in via
    // each write function's adapter-owned binder (never named directly
    // here, AD-16), so `GET /api/open-items`/`POST /api/open-items/answer`
    // (transport over `surfaceOpenItems`/`answerOpenItem`) and a confirmed
    // Proposal's `"field-value"`/`"notion-page-draft"`/`"calendar-edit"`
    // kinds (`confirmProposal`, dispatched from `answerOpenItem`) all work
    // identically to `chat-cli.ts`'s own equivalent wiring, before it was
    // retired (Story 8.9).
    ...bindNotionTaskWrites(getNotionTaskWriteBinding),
    ...bindNotionCreatePage(getNotionCreatePageBinding),
    ...bindCalendarApply(getCalendarApplyBinding),
    changeSetWrites: { ...bindNotionCreatePage(getNotionCreatePageBinding), ...bindCalendarApply(getCalendarApplyBinding) },
    // Story 11.4: a Yes on the research offer queues exactly as `/research` does.
    research: { connection, webSearchAvailable: Boolean(perplexityApiKey), getNotionCreatePageBinding, now: () => new Date() },
    readFieldOptions,
    recordCompletion,
    lookupTask,
  };
}
