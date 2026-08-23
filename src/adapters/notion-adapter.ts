/**
 * src/adapters/notion-adapter.ts
 *
 * Owns Yoh's read (and, from Task 19 onward, single write) surface onto
 * Notion (Story 1.3 / FR-1). Per AD-9 of the Architecture Spine this file
 * has one primary export today, `readNotionTasks` — Task 19/Epic 3 adds
 * `setTaskStatus` alongside it, the *only* write function this file will
 * ever have (AD-12: Status is the only Task field Yoh writes back to
 * Notion). Both functions share the same injectable-client/config shape
 * defined here so that later addition doesn't require restructuring this
 * file.
 *
 * Per AD-8, `adapters/*.ts` files may throw on I/O failure rather than
 * returning `Result` themselves — `rituals/*.ts` (a later task) is the only
 * layer allowed to catch and convert a throw into a `Result` failure. Every
 * function here lets `@notionhq/client`'s own SDK/network errors propagate
 * unchanged; nothing in this file catches them.
 *
 * The Notion `Client` is never constructed here — per the Task 3 brief's
 * AD-8 implementer note, it's received as an injectable parameter (typed as
 * `NotionDataSourceClient`, the minimal slice of the real `Client` this file
 * needs), the same pattern `calendar-adapter.ts` (a later task) uses for its
 * already-authenticated `OAuth2Client` from `token-store.ts`. A real
 * `Client` instance from `@notionhq/client` satisfies `NotionDataSourceClient`
 * structurally; tests supply a fake/mock instead, since no live Notion
 * account is available in this environment.
 *
 * No caching layer exists anywhere in this file: every call to
 * `readNotionTasks` re-queries Notion via the injected client's
 * `dataSources.query`, so a field changed in Notion since the last call is
 * reflected on the very next call, with no manual re-sync step (Story 1.3's
 * acceptance criteria).
 *
 * Documented assumptions about Notion's Task/Project database shape (no
 * live Notion account is available in this environment to confirm against
 * a real workspace — see the Task 3 brief's "Before You Begin"; these are
 * reasonable-default readings of the real `@notionhq/client` v5 TypeScript
 * types in `node_modules/@notionhq/client`, checked live, not guessed
 * blindly):
 *  - This SDK version (5.x, `Client.defaultNotionVersion = "2025-09-03"`,
 *    matching `.env.example`'s pinned `NOTION_API_VERSION`) queries via
 *    `client.dataSources.query({ data_source_id, ... })`, Notion's current
 *    "database contains one or more data sources" model — not the older
 *    `client.databases.query({ database_id })` shape.
 *  - Task property names default to "Name" (title), "Estimated Duration"
 *    (number), "Area" (select), "Due Date" (date), "Status" (status),
 *    "Energy" (select), "Project" (relation) — the exact names the Task 3
 *    brief's acceptance criteria uses. Overridable via
 *    `NotionAdapterConfig.taskPropertyNames` in case Spencer's real
 *    workspace differs, without a code change.
 *  - `Area` is read from either a `select` or `rich_text` property (select
 *    checked first) since `domain.ts` documents `Area` as Spencer's own
 *    free-form taxonomy, not a fixed enum — either Notion property type is
 *    a reasonable way for Spencer to have modeled it.
 *  - `Status`/`Energy` option names are normalized (trimmed, lower-cased,
 *    spaces to hyphens) before being checked against Yoh's fixed
 *    `TaskStatus`/`Energy` enums (e.g. Notion option "In Progress" ->
 *    `"in-progress"`). An option that still doesn't match a known enum
 *    value is left unset (`undefined`) rather than guessed at — the Task 1
 *    brief's `Task` type already models every planning field as optional
 *    for exactly this "Notion row incompletely/inconsistently filled in"
 *    case; `core/data-completeness-gate.ts` (a later task) is what decides
 *    whether an incomplete Task is plan-eligible, not this file.
 *  - A Task's "Project grouping" is read from a `relation` property named
 *    "Project"; only the first related page id is used (a Task's project
 *    relation is modeled as single-valued for this story). Projects
 *    themselves are read from a separate data source
 *    (`projectsDataSourceId`) as minimal `{ id, name }` metadata — per the
 *    Task 3 brief's acceptance criteria, nothing about a Project feeds
 *    priority or scheduling in this story, so nothing more than an id/name
 *    pair is read.
 */

import { isFullPage, type Client } from "@notionhq/client";
import type {
  PageObjectResponse,
  QueryDataSourceParameters,
  QueryDataSourceResponse,
} from "@notionhq/client";
import type { Energy, ExternalId, IsoDate, Project, Result, Task, TaskStatus, YohError } from "../types/domain.ts";

// ============================================================================
// Injectable client
// ============================================================================

/**
 * The minimal slice of `@notionhq/client`'s `Client` this file needs — just
 * `dataSources.query`, typed off the real `Client`'s own method signature
 * rather than `Pick<Client, "dataSources">` (which would also require the
 * unused `retrieve`/`create`/`update`/`listTemplates` sibling methods). A
 * real `Client` instance is structurally assignable here; tests supply a
 * fake/mock instead (AD-8's implementer note — no live Notion account is
 * available in this environment).
 */
export interface NotionDataSourceClient {
  readonly dataSources: {
    readonly query: Client["dataSources"]["query"];
  };
}

/**
 * The minimal slice of `@notionhq/client`'s `Client` `setTaskStatus` needs —
 * just `pages.update`, typed off the real `Client`'s own method signature,
 * the same minimal-injectable-slice convention `NotionDataSourceClient`
 * above uses for the read side. Kept as its OWN interface rather than
 * widening `NotionDataSourceClient` to carry both: widening would force
 * every existing `readNotionTasks` caller/test (which only ever needs
 * `dataSources.query`) to also supply a `pages.update` stub, for a
 * capability it never uses. A real `Client` instance satisfies both
 * interfaces structurally at once, so `shell/ritual-cli.ts` and
 * `shell/chat-cli.ts` bind the one real `Client` to both `readNotionTasks`
 * and `setTaskStatus` without needing two separate client objects.
 */
export interface NotionWriteClient {
  readonly pages: {
    readonly update: Client["pages"]["update"];
  };
}

// ============================================================================
// Config
// ============================================================================

/** The Notion property name each of Task's five planning fields plus Project grouping is read from. */
export interface NotionTaskPropertyNames {
  readonly title: string;
  readonly estimatedDuration: string;
  readonly area: string;
  readonly dueDate: string;
  readonly status: string;
  readonly energy: string;
  readonly project: string;
}

/** The default Task property names, matching the exact field names the Task 3 brief's acceptance criteria uses. */
export const DEFAULT_TASK_PROPERTY_NAMES: NotionTaskPropertyNames = {
  title: "Name",
  estimatedDuration: "Estimated Duration",
  area: "Area",
  dueDate: "Due Date",
  status: "Status",
  energy: "Energy",
  project: "Project",
};

/** The Notion property name a Project's display name is read from. */
export interface NotionProjectPropertyNames {
  readonly title: string;
}

export const DEFAULT_PROJECT_PROPERTY_NAMES: NotionProjectPropertyNames = {
  title: "Name",
};

/**
 * The Notion Status-property OPTION NAME each `TaskStatus` value writes back
 * as — the inverse of `normalizeStatus`'s read-side mapping (`"In Progress"`
 * -> `"in-progress"`, trim/lowercase/hyphenate). Title-cased with a literal
 * space, matching the exact option names the Task 3 brief's read-side
 * assumption documents Spencer's workspace as using. Overridable via
 * `NotionAdapterConfig.statusOptionNames` in case Spencer's real workspace
 * names its Status options differently, without a code change — the same
 * override convention `taskPropertyNames`/`projectPropertyNames` already
 * establish.
 */
export const DEFAULT_TASK_STATUS_OPTION_NAMES: Record<TaskStatus, string> = {
  "not-started": "Not Started",
  "in-progress": "In Progress",
  completed: "Completed",
  slipped: "Slipped",
};

/**
 * `readNotionTasks`'s config. `setTaskStatus` does NOT take this type
 * directly (Task 19 review fix) — it takes only the narrower
 * `NotionStatusWriteConfig` slice below; see that type's own doc comment
 * for why. The two data source ids are workspace-specific — sourced from
 * wherever the caller (a `rituals/*.ts` or `shell/*.ts` bootstrap, a later
 * task) constructs them from, e.g. env vars, mirroring `token-store.ts`'s
 * `loadGoogleOAuthConfigFromEnv` pattern for Google.
 */
export interface NotionAdapterConfig {
  /** The data source id of Spencer's Notion Tasks database. */
  readonly tasksDataSourceId: string;
  /** The data source id of Spencer's Notion Projects database. */
  readonly projectsDataSourceId: string;
  readonly taskPropertyNames?: NotionTaskPropertyNames;
  readonly projectPropertyNames?: NotionProjectPropertyNames;
  /** Overrides `DEFAULT_TASK_STATUS_OPTION_NAMES` — used only by `setTaskStatus`. */
  readonly statusOptionNames?: Record<TaskStatus, string>;
}

/**
 * The config slice `setTaskStatus` actually reads — `taskPropertyNames`
 * (for its `.status` property-name field only) and `statusOptionNames`.
 * Deliberately narrower than `NotionAdapterConfig` (Task 19 review fix):
 * writing a Task's Status touches neither Tasks-database nor
 * Projects-database DATA SOURCE ids (`tasksDataSourceId`/
 * `projectsDataSourceId` — those address `dataSources.query` calls
 * `setTaskStatus` never makes; it addresses a page directly by `taskId`)
 * nor `projectPropertyNames` (nothing about a Project). Requiring the full
 * `NotionAdapterConfig` here would let an unrelated missing/misconfigured
 * field (e.g. `NOTION_PROJECTS_DATA_SOURCE_ID` unset) block a Status write
 * that has nothing to do with it — which is exactly what
 * `shell/chat-cli.ts`'s close-out binding used to do before this fix, and
 * combined with the close-out answer loop having no escape hatch at the
 * time, made that failure unrecoverable from chat. A real
 * `NotionAdapterConfig` still satisfies this type structurally (it's a
 * `Pick`), so nothing else in the codebase needs to change.
 */
export type NotionStatusWriteConfig = Pick<NotionAdapterConfig, "taskPropertyNames" | "statusOptionNames">;

// ============================================================================
// Result shape
// ============================================================================

/** What `readNotionTasks` returns: every current Task, plus Projects as organizational metadata only. */
export interface NotionTasksAndProjects {
  readonly tasks: readonly Task[];
  readonly projects: readonly Project[];
}

// ============================================================================
// readNotionTasks (AD-9's primary export)
// ============================================================================

/**
 * Reads every current Task and Project from Spencer's Notion workspace via
 * the injected client. Always queries live (no caching layer in this file —
 * see the module docstring), and paginates through every result page rather
 * than truncating at Notion's per-request page size, so "every current
 * Task" holds even once Spencer's Tasks database exceeds one page.
 *
 * Per AD-8, this function does not catch or wrap SDK/network errors: a
 * failure while querying Notion (auth, rate limit, network) propagates as a
 * thrown error to the caller (`rituals/*.ts`, a later task).
 */
export async function readNotionTasks(
  client: NotionDataSourceClient,
  config: NotionAdapterConfig,
): Promise<NotionTasksAndProjects> {
  const taskPropertyNames = config.taskPropertyNames ?? DEFAULT_TASK_PROPERTY_NAMES;
  const projectPropertyNames = config.projectPropertyNames ?? DEFAULT_PROJECT_PROPERTY_NAMES;

  const [taskPages, projectPages] = await Promise.all([
    queryAllPages(client, config.tasksDataSourceId),
    queryAllPages(client, config.projectsDataSourceId),
  ]);

  return {
    tasks: taskPages.map((page) => toTask(page, taskPropertyNames)),
    projects: projectPages.map((page) => toProject(page, projectPropertyNames)),
  };
}

// ============================================================================
// setTaskStatus (AD-12) — the adapter's ONE write function
// ============================================================================

/**
 * Writes `status` to a Task's Notion Status property, and ONLY that
 * property — no other Task field is read, sent, or otherwise touched by
 * this call (AD-12: Status is the only Task field Yoh ever writes back to
 * Notion). This is Task 19/Epic 3's one addition to this file; per its own
 * brief no generic "update Task property" function may exist here alongside
 * it — this is the entire write surface.
 *
 * **Implementer note on the exact parameter list (a documented choice —
 * the Task 19 brief's "Before You Begin" guidance applies here).** The
 * brief's Implementer note quotes `setTaskStatus(taskId: string, status:
 * TaskStatus): Promise<Result<void, YohError>>` as "the exact signature."
 * Read literally that would mean no injectable client/config at all, which
 * conflicts with this file's own module docstring ("Both functions share
 * the same injectable-client/config shape") and with AD-8's implementer
 * note that the Notion `Client` is never constructed inside this file. The
 * reading adopted here treats that quoted signature as describing the
 * shape of the BOUND dependency a `rituals/*.ts`/`shell/*.ts` caller
 * threads through (exactly the same relationship
 * `MorningRitualDeps.readTasks: () => Promise<readonly Task[]>` already has
 * to `readNotionTasks(client, config)` — a zero-Notion-detail thunk closing
 * over the real client/config) — see `rituals/night-ritual.ts`'s
 * `NightCloseOutApplyDeps.setTaskStatus` and `shell/ritual-cli.ts`'s
 * `createMorningRitualDeps`/`shell/chat-cli.ts`'s `main` for the binding
 * sites. The actual exported function below keeps the SAME
 * `(client, config, ...)` leading shape `readNotionTasks` already
 * establishes, so both functions really do "share the same
 * injectable-client/config shape," and so this file's testing convention
 * (an injected fake client, never a real network call) applies uniformly to
 * both. AD-12's binding requirement — no other write/update function
 * anywhere in this file, and this call touches Status alone — holds exactly
 * either way this parameter-list question is read; only the calling
 * convention was ambiguous, not the behavior.
 *
 * **The AD-8 exception (per the brief's Implementer note).** Every other
 * function in this file lets `@notionhq/client`'s SDK/network errors
 * propagate unchanged (AD-8's general rule: `adapters/*.ts` may throw,
 * `rituals/*.ts` catches). `setTaskStatus` is the one deliberate,
 * brief-mandated exception: its own signature returns `Result<void,
 * YohError>` directly, so the catch-and-translate step that would otherwise
 * happen in `rituals/night-ritual.ts` happens HERE instead — nothing thrown
 * by `client.pages.update` escapes this function.
 *
 * **`config`'s narrower type (Task 19 review fix).** Takes
 * `NotionStatusWriteConfig` — only `taskPropertyNames`/`statusOptionNames`
 * — rather than the full `NotionAdapterConfig` `readNotionTasks` needs. See
 * that type's own doc comment: a Status write addresses a page directly by
 * `taskId` and never queries a data source, so it has no legitimate
 * dependency on `tasksDataSourceId`/`projectsDataSourceId` at all, and
 * requiring them here let an unrelated missing/misconfigured field block a
 * write that had nothing to do with it.
 */
export async function setTaskStatus(
  client: NotionWriteClient,
  config: NotionStatusWriteConfig,
  taskId: string,
  status: TaskStatus,
): Promise<Result<void, YohError>> {
  const statusPropertyName = (config.taskPropertyNames ?? DEFAULT_TASK_PROPERTY_NAMES).status;
  const optionName = (config.statusOptionNames ?? DEFAULT_TASK_STATUS_OPTION_NAMES)[status];

  try {
    await client.pages.update({
      page_id: taskId,
      properties: {
        [statusPropertyName]: { status: { name: optionName }, type: "status" },
      },
    });
    return { ok: true, value: undefined };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "unreachable",
        message: `notion-adapter: could not write Status for Task ${taskId} — ${
          err instanceof Error ? err.message : String(err)
        }`,
        detail: err,
      },
    };
  }
}

// ============================================================================
// Pagination
// ============================================================================

/** Queries every full page of a data source, following `has_more`/`next_cursor` until exhausted. */
async function queryAllPages(
  client: NotionDataSourceClient,
  dataSourceId: string,
): Promise<PageObjectResponse[]> {
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;

  do {
    const params: QueryDataSourceParameters = {
      data_source_id: dataSourceId,
      ...(cursor ? { start_cursor: cursor } : {}),
    };
    const response: QueryDataSourceResponse = await client.dataSources.query(params);

    for (const result of response.results) {
      // Skips partial results (e.g. `PartialDataSourceObjectResponse`) —
      // a data source targeted directly by id only ever yields full Task/
      // Project pages, not sub-data-sources, but `isFullPage` (the SDK's
      // own type guard) is the correct narrowing regardless.
      if (isFullPage(result)) {
        pages.push(result);
      }
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return pages;
}

// ============================================================================
// Page -> domain-type mapping
// ============================================================================

function toTask(page: PageObjectResponse, names: NotionTaskPropertyNames): Task {
  const estimatedDurationMinutes = getNumber(page, names.estimatedDuration);
  const area = getAreaValue(page, names.area);
  const dueDateStart = getDateStart(page, names.dueDate);
  const dueDate = dueDateStart === undefined ? undefined : toIsoDateOnly(dueDateStart);
  const status = normalizeStatus(getStatusName(page, names.status));
  const energy = normalizeEnergy(getSelectName(page, names.energy));
  const projectId = getFirstRelationId(page, names.project);

  return {
    id: page.id,
    title: getTitle(page, names.title),
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
    ...(estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes } : {}),
    ...(area !== undefined ? { area } : {}),
    ...(dueDate !== undefined ? { dueDate } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(energy !== undefined ? { energy } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
  };
}

function toProject(page: PageObjectResponse, names: NotionProjectPropertyNames): Project {
  return {
    id: page.id,
    name: getTitle(page, names.title),
  };
}

// ============================================================================
// Property extraction helpers
// ============================================================================

function getTitle(page: PageObjectResponse, propertyName: string): string {
  const prop = page.properties[propertyName];
  if (prop?.type === "title") {
    return prop.title.map((rt) => rt.plain_text).join("");
  }
  return "";
}

function getNumber(page: PageObjectResponse, propertyName: string): number | undefined {
  const prop = page.properties[propertyName];
  if (prop?.type === "number" && prop.number !== null) {
    return prop.number;
  }
  return undefined;
}

function getSelectName(page: PageObjectResponse, propertyName: string): string | undefined {
  const prop = page.properties[propertyName];
  if (prop?.type === "select" && prop.select) {
    return prop.select.name;
  }
  return undefined;
}

function getStatusName(page: PageObjectResponse, propertyName: string): string | undefined {
  const prop = page.properties[propertyName];
  if (prop?.type === "status" && prop.status) {
    return prop.status.name;
  }
  return undefined;
}

/** Area is read from either a `select` (checked first) or a `rich_text` property — see module docstring assumption. */
function getAreaValue(page: PageObjectResponse, propertyName: string): string | undefined {
  const prop = page.properties[propertyName];
  if (prop?.type === "select" && prop.select) {
    return prop.select.name;
  }
  if (prop?.type === "rich_text") {
    const text = prop.rich_text.map((rt) => rt.plain_text).join("");
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

function getDateStart(page: PageObjectResponse, propertyName: string): string | undefined {
  const prop = page.properties[propertyName];
  if (prop?.type === "date" && prop.date) {
    return prop.date.start;
  }
  return undefined;
}

function getFirstRelationId(page: PageObjectResponse, propertyName: string): ExternalId | undefined {
  const prop = page.properties[propertyName];
  if (prop?.type === "relation" && prop.relation.length > 0) {
    return prop.relation[0]?.id;
  }
  return undefined;
}

// ============================================================================
// Normalization
// ============================================================================

const VALID_TASK_STATUSES: ReadonlySet<string> = new Set<TaskStatus>([
  "not-started",
  "in-progress",
  "completed",
  "slipped",
]);

const VALID_ENERGY_LEVELS: ReadonlySet<string> = new Set<Energy>(["low", "medium", "high"]);

/** `"In Progress"` -> `"in-progress"`, etc. Left `undefined` (not guessed at) if it doesn't match a known value. */
function normalizeOptionName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, "-");
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStatus(raw: string | undefined): TaskStatus | undefined {
  const normalized = normalizeOptionName(raw);
  return normalized !== undefined && VALID_TASK_STATUSES.has(normalized)
    ? (normalized as TaskStatus)
    : undefined;
}

function normalizeEnergy(raw: string | undefined): Energy | undefined {
  const normalized = normalizeOptionName(raw);
  return normalized !== undefined && VALID_ENERGY_LEVELS.has(normalized)
    ? (normalized as Energy)
    : undefined;
}

/** Notion's `date.start` may carry a time component; `IsoDate` is date-only, so this trims it off. */
function toIsoDateOnly(raw: string): IsoDate {
  const tIndex = raw.indexOf("T");
  return tIndex === -1 ? raw : raw.slice(0, tIndex);
}
