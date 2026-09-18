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
 * Documented assumptions about Notion's Task/Project database shape,
 * updated once a real Notion workspace (Spencer's own) became available to
 * confirm against — see the Task 3 brief's "Before You Begin" for how these
 * started as reasonable-default readings of the real `@notionhq/client` v5
 * TypeScript types, not guessed blindly; three of the four gaps a live
 * comparison surfaced needed no code change (a "Estimated Duration" Number
 * property and a native-Status "Status" property were simply added/converted
 * on the Notion side to match what this file already expected), and the
 * fourth (`Status`'s Notion option names) already matched
 * `DEFAULT_TASK_STATUS_OPTION_NAMES` exactly. The two below did need code
 * changes:
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
 *    workspace differs, without a code change — confirmed genuinely needed
 *    for `title`: Spencer's real Tasks database names it "Task Name", not
 *    "Name". `loadTaskPropertyNamesFromEnv` (below) wires this one override
 *    to `NOTION_TASK_TITLE_PROPERTY`; every caller that constructs
 *    `NotionAdapterConfig` uses it rather than the bare default.
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
 *    whether an incomplete Task is plan-eligible, not this file. `Energy`
 *    additionally checks `DEFAULT_ENERGY_OPTION_NAMES` first (see that
 *    constant's own doc comment) — confirmed genuinely needed: Spencer's
 *    real Energy select uses his own "🔵 Deep Work"/"⚡ Light Work"
 *    taxonomy, which this generic normalization alone would leave unset for
 *    every Task.
 *  - A Task's "Project grouping" is read from a `relation` property named
 *    "Project"; only the first related page id is used (a Task's project
 *    relation is modeled as single-valued for this story). Projects
 *    themselves are read from a separate data source
 *    (`projectsDataSourceId`) as minimal `{ id, name }` metadata — per the
 *    Task 3 brief's acceptance criteria, nothing about a Project feeds
 *    priority or scheduling in this story, so nothing more than an id/name
 *    pair is read.
 */

import { isFullDataSource, isFullPage, type Client } from "@notionhq/client";
import type {
  CreatePageParameters,
  CreatePageResponse,
  GetDataSourceResponse,
  PageObjectResponse,
  QueryDataSourceParameters,
  QueryDataSourceResponse,
  UpdatePageParameters,
} from "@notionhq/client";
import type {
  Energy,
  ExternalId,
  IsoDate,
  NotionDatabaseTarget,
  PlanningFieldNames,
  Project,
  Result,
  Task,
  TaskStatus,
  YohError,
} from "../types/domain.ts";
import { closestOption } from "./notion-select-match.ts";

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

/**
 * The minimal slice of `@notionhq/client`'s `Client` `updateTaskField`
 * needs to check a `select`-backed property's live options before writing
 * it (AD-12's revised rule) — just `dataSources.retrieve`, the same
 * minimal-injectable-slice convention every other client interface in this
 * file uses. Kept separate from `NotionDataSourceClient` (which only ever
 * needs `.query`) for the same reason `NotionWriteClient` is kept separate
 * from it — a real `Client` satisfies every one of these interfaces at
 * once, so `shell/chat-cli.ts` still only ever constructs one real client.
 */
export interface NotionSchemaClient {
  readonly dataSources: {
    readonly retrieve: Client["dataSources"]["retrieve"];
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

/**
 * Loads `NotionTaskPropertyNames` from environment variables, overriding
 * `DEFAULT_TASK_PROPERTY_NAMES.title` with `NOTION_TASK_TITLE_PROPERTY` when
 * set (the other six property names stay at their defaults — no other
 * per-workspace title-style mismatch has been found in Spencer's real
 * workspace, so this deliberately does not grow into a generic
 * one-env-var-per-property scheme until a second one actually turns up).
 *
 * This exists because Spencer's real Tasks database titles its title
 * property "Task Name", not "Name" — `DEFAULT_TASK_PROPERTY_NAMES.title`'s
 * "reasonable-default reading" (see the module docstring) guessed wrong for
 * this workspace. `taskPropertyNames` on `NotionAdapterConfig` already
 * existed as an override seam for exactly this case; this function is what
 * actually wires it to an environment variable, following the same
 * adapter-owns-its-env-parsing convention `token-store.ts`'s
 * `loadGoogleOAuthConfigFromEnv` and `notification-adapter.ts`'s
 * `loadPushoverConfigFromEnv` already establish — so the NEXT workspace
 * property-name mismatch a future call site hits (title or otherwise) has a
 * documented precedent to extend, rather than requiring another one-off code
 * change the way this one did.
 *
 * Never throws: unlike `loadPushoverConfigFromEnv`'s required secrets, every
 * field here has a sane default, so an unset `NOTION_TASK_TITLE_PROPERTY`
 * just means "use the default" rather than a startup failure.
 */
export function loadTaskPropertyNamesFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): NotionTaskPropertyNames {
  const titleOverride = env["NOTION_TASK_TITLE_PROPERTY"];
  return {
    ...DEFAULT_TASK_PROPERTY_NAMES,
    ...(titleOverride ? { title: titleOverride } : {}),
  };
}

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
 * Maps Spencer's real Notion Energy-select option names onto `domain.ts`'s
 * `Energy` enum ("the energy level a Task requires"). Spencer's workspace
 * doesn't use a low/medium/high scale for this property — it uses his own
 * pre-existing personal taxonomy, "🔵 Deep Work" / "⚡ Light Work", which
 * already IS an energy-required distinction and maps directly onto the
 * enum's two ends: Deep Work needs real focus/energy (`"high"`), Light Work
 * doesn't (`"low"`). `"medium"` deliberately has no entry — nothing in
 * Spencer's workspace corresponds to it, and `derived-priority.ts`'s
 * `ENERGY_RANK`/secondary-axis tie-break doesn't require every enum value to
 * be reachable, only that the ones that occur rank consistently (a decision
 * made explicitly in favor of this direct mapping over adding a second,
 * Yoh-only Low/Medium/High property: see the Energy field-mapping
 * conversation this was resolved in — a duplicate property would mean
 * double-tagging every Task with information Spencer's existing taxonomy
 * already carries, for a finer-grained scale that reflects nothing true
 * about the Tasks themselves).
 *
 * Overridable via `NotionAdapterConfig.energyOptionNames`, the same
 * override convention `taskPropertyNames`/`statusOptionNames` already
 * establish, in case this ever needs to point at different real option
 * names later.
 */
export const DEFAULT_ENERGY_OPTION_NAMES: Partial<Record<Energy, string>> = {
  high: "🔵 Deep Work",
  low: "⚡ Light Work",
};

/**
 * The Notion property name each of Yoh's internal Research Vault field
 * concepts is read from/written to — confirmed live against Spencer's real
 * "Research Vault" database (data source id `33ee0769-3060-8103-
 * 86f6-000be2d03654`) on 2026-09-18, per Story 6.1's spike. Unlike
 * `NotionTaskPropertyNames`, every field here maps to a property Spencer's
 * database already has today — none needed adding. `status`, `area`, and
 * `confidence` are `select`-backed in Notion (see
 * `DEFAULT_RESEARCH_VAULT_PROPERTY_NAMES`'s own doc comment for their real
 * option names) and go through the same live-schema fuzzy-match resolution
 * `writeSelectLikeField` already establishes for Task's `select` properties,
 * once Story 6.3 wires them into a draft — this story only confirms and
 * names them, it does not write them.
 */
export interface NotionResearchVaultPropertyNames {
  readonly title: string;
  readonly keyFindings: string;
  readonly query: string;
  readonly date: string;
  readonly sources: string;
  readonly status: string;
  readonly area: string;
  readonly confidence: string;
  readonly openQuestions: string;
  readonly linkedProject: string;
}

/**
 * The confirmed real property names on Spencer's live Research Vault
 * database (Story 6.1's spike, 2026-09-18) — see this file's own inline
 * comment above `NotionResearchVaultPropertyNames` for the id and
 * confirmation date. `select`-backed properties and their real, live option
 * names (also confirmed live, not assumed): `status` -> "Draft" | "Reviewed"
 * | "Applied"; `area` -> "Manatee" | "School/ACT/College Apps" | "Wellbeing
 * Think Tank" | "Personal Goals" | "Side Projects/Business" |
 * "Reading/Learning"; `confidence` -> "High" | "Medium" | "Low". A write to
 * any of those three must resolve to one of its own listed options via
 * `closestOption` (AD-12) — never raw/invented text.
 */
export const DEFAULT_RESEARCH_VAULT_PROPERTY_NAMES: NotionResearchVaultPropertyNames = {
  title: "Research Title",
  keyFindings: "Key Findings",
  query: "Query",
  date: "Date",
  sources: "Sources",
  status: "Status",
  area: "Area",
  confidence: "Confidence",
  openQuestions: "Open Questions",
  linkedProject: "Linked Project",
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
  /** Overrides `DEFAULT_ENERGY_OPTION_NAMES` — used only by `readNotionTasks`'s read-side Energy normalization. */
  readonly energyOptionNames?: Partial<Record<Energy, string>>;
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

/**
 * `updateTaskField`'s config — `NotionStatusWriteConfig`'s two fields (it
 * delegates its own `"status"` case straight to `setTaskStatus`) plus
 * `tasksDataSourceId` (needed for `dataSources.retrieve`'s live-schema
 * lookup ahead of a `select`-backed write) and `energyOptionNames` (Energy's
 * preferred real-option-name mapping — see `updateTaskField`'s own doc
 * comment). Deliberately excludes `projectsDataSourceId`/
 * `projectPropertyNames`: nothing about a Project is ever touched by this
 * write, the same "don't require an unrelated field" reasoning
 * `NotionStatusWriteConfig`'s own doc comment gives.
 */
export type NotionFieldWriteConfig = Pick<
  NotionAdapterConfig,
  "tasksDataSourceId" | "taskPropertyNames" | "statusOptionNames" | "energyOptionNames"
>;

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
  const energyOptionNames = config.energyOptionNames ?? DEFAULT_ENERGY_OPTION_NAMES;

  const [taskPages, projectPages] = await Promise.all([
    queryAllPages(client, config.tasksDataSourceId),
    queryAllPages(client, config.projectsDataSourceId),
  ]);

  return {
    tasks: taskPages.map((page) => toTask(page, taskPropertyNames, energyOptionNames)),
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
// updateTaskField (FR-24, AD-12 revised) — the write for the other four
// PlanningFieldNames (Estimated Duration, Area, Due Date, Energy); Status
// keeps going through setTaskStatus above, unchanged.
// ============================================================================

/**
 * Writes `value` to Task `taskId`'s Notion property for `field` — one of
 * `types/domain.ts`'s five `PlanningFieldNames`, never an arbitrary Notion
 * property name (AD-12: the write surface stays this closed, enumerated
 * set). `"status"` delegates straight to `setTaskStatus` (unchanged — see
 * that function's own doc comment); this is genuinely just a second entry
 * point onto the SAME one write, not a duplicate.
 *
 * For the remaining four fields:
 *  - Estimated Duration (`number`) and Due Date (`date`) are written
 *    directly — Notion can't silently corrupt a number or a date the way it
 *    can a `select`, so no live-schema check applies.
 *  - Area and Energy each go through `writeSelectLikeField`, which checks
 *    the property's LIVE type first: a `rich_text` Area is written as raw
 *    text (Spencer's own free-form taxonomy, per the module docstring's
 *    read-side assumption); a `select` Area or Energy is resolved to one of
 *    that property's real, currently-existing options via
 *    `notion-select-match.ts`'s `closestOption` — Energy's candidate input
 *    is `energyOptionNames`'s (or `DEFAULT_ENERGY_OPTION_NAMES`'s)
 *    already-known real option string for `value`, so a config that's
 *    drifted from Spencer's actual live workspace still resolves correctly
 *    rather than failing outright. A write that can't be confidently
 *    resolved fails (`YohError.kind: "validation"`) rather than writing raw
 *    text or letting Notion create a new option.
 */
export async function updateTaskField(
  client: NotionWriteClient & NotionSchemaClient,
  config: NotionFieldWriteConfig,
  taskId: string,
  field: PlanningFieldNames,
  value: NonNullable<Task[PlanningFieldNames]>,
): Promise<Result<void, YohError>> {
  const propertyNames = config.taskPropertyNames ?? DEFAULT_TASK_PROPERTY_NAMES;

  if (field === "status") {
    return setTaskStatus(client, config, taskId, value as TaskStatus);
  }

  if (field === "estimatedDurationMinutes") {
    return writePageProperty(client, taskId, propertyNames.estimatedDuration, { number: value as number });
  }

  if (field === "dueDate") {
    return writePageProperty(client, taskId, propertyNames.dueDate, { date: { start: value as string } });
  }

  if (field === "area") {
    return writeSelectLikeField(client, config.tasksDataSourceId, taskId, propertyNames.area, value as string);
  }

  // field === "energy" — the only PlanningFieldNames value not yet handled.
  const energyOptionNames = config.energyOptionNames ?? DEFAULT_ENERGY_OPTION_NAMES;
  const preferredOptionName = energyOptionNames[value as Energy] ?? capitalizeFirst(value as Energy);
  return writeSelectLikeField(client, config.tasksDataSourceId, taskId, propertyNames.energy, preferredOptionName);
}

/** The single shared `client.pages.update` call site for every `updateTaskField` write except Status (which keeps its own, inside `setTaskStatus`, unchanged) — AD-12's write surface stays exactly these two call sites. */
async function writePageProperty(
  client: NotionWriteClient,
  taskId: string,
  propertyName: string,
  propertyValue: NonNullable<UpdatePageParameters["properties"]>[string],
): Promise<Result<void, YohError>> {
  try {
    await client.pages.update({
      page_id: taskId,
      properties: { [propertyName]: propertyValue },
    });
    return { ok: true, value: undefined };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "unreachable",
        message: `notion-adapter: could not write "${propertyName}" for Task ${taskId} — ${
          err instanceof Error ? err.message : String(err)
        }`,
        detail: err,
      },
    };
  }
}

/**
 * Writes Area or Energy — the two planning fields that may be modeled as a
 * Notion `select` property, where AD-12's data-integrity guard applies.
 * Retrieves the property's LIVE definition first (never trusts a cached
 * assumption about its type): a `rich_text` property is written directly
 * with `candidateInput`; a `select`/`status` property is resolved to one of
 * its real, live option names via `closestOption` before writing — never
 * the raw `candidateInput` itself. Any other live property type, or a
 * schema-retrieval failure, fails the write rather than guessing.
 */
async function writeSelectLikeField(
  client: NotionWriteClient & NotionSchemaClient,
  dataSourceId: string,
  taskId: string,
  propertyName: string,
  candidateInput: string,
): Promise<Result<void, YohError>> {
  let schema: GetDataSourceResponse;
  try {
    schema = await client.dataSources.retrieve({ data_source_id: dataSourceId });
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "unreachable",
        message: `notion-adapter: could not read the live schema for "${propertyName}" — ${
          err instanceof Error ? err.message : String(err)
        }`,
        detail: err,
      },
    };
  }

  if (!isFullDataSource(schema)) {
    return {
      ok: false,
      error: {
        kind: "unreachable",
        message: `notion-adapter: Notion returned a partial data source object — cannot read "${propertyName}"'s live schema`,
      },
    };
  }

  const propertyConfig = schema.properties[propertyName];

  if (propertyConfig?.type === "rich_text") {
    return writePageProperty(client, taskId, propertyName, {
      rich_text: [{ type: "text", text: { content: candidateInput } }],
    });
  }

  if (propertyConfig?.type !== "select" && propertyConfig?.type !== "status") {
    return {
      ok: false,
      error: {
        kind: "validation",
        message: `notion-adapter: "${propertyName}" is not a select/status/rich_text property in Notion — refusing to guess how to write it`,
      },
    };
  }

  const liveOptionNames = (propertyConfig.type === "select" ? propertyConfig.select.options : propertyConfig.status.options).map(
    (option) => option.name,
  );

  const resolved = closestOption(candidateInput, liveOptionNames);
  if (resolved === undefined) {
    return {
      ok: false,
      error: {
        kind: "validation",
        message: `notion-adapter: no existing "${propertyName}" option is a close enough match to "${candidateInput}" — refusing to write raw text or create a new option`,
      },
    };
  }

  return writePageProperty(
    client,
    taskId,
    propertyName,
    propertyConfig.type === "select" ? { select: { name: resolved } } : { status: { name: resolved } },
  );
}

/** `"low"` -> `"Low"` — the last-resort Energy candidate string when `value` has no `energyOptionNames` entry (e.g. `"medium"`, which `DEFAULT_ENERGY_OPTION_NAMES` deliberately leaves unmapped — see that constant's own doc comment). Still goes through `closestOption` against the LIVE options, so this only needs to be a reasonable guess, not exact. */
function capitalizeFirst(raw: string): string {
  return raw.length === 0 ? raw : raw[0]!.toUpperCase() + raw.slice(1);
}

// ============================================================================
// toResearchVaultPageProperties (Story 6.1) — maps Yoh's internal Research
// Vault field names to Spencer's real, confirmed Notion property names/
// types (DEFAULT_RESEARCH_VAULT_PROPERTY_NAMES). Pure and does no I/O: it
// only builds the `properties` payload Story 6.3's createPage will pass to
// `client.pages.create`. It does NOT write to Notion, and does not resolve
// select-backed properties (status/area/confidence) — those aren't among
// the fields FR-29's automated "save that" path ever sets, and Story 6.3's
// general create-from-chat path is responsible for routing any
// select-backed value it accepts through the same closestOption/
// live-schema-retrieve mechanism writeSelectLikeField already establishes.
// ============================================================================

/**
 * Yoh's internal shape for a Research Vault entry, independent of Notion's
 * property names — `toResearchVaultPageProperties` is the only place that
 * translates between the two. `query` is optional: Story 6.5's automated
 * file-a-search-result path always has one (the question Spencer asked),
 * but Story 6.3's manual "create a Research Vault item" path may not.
 */
export interface ResearchVaultEntryFields {
  readonly title: string;
  readonly keyFindings: string;
  readonly query?: string;
  readonly searchDate: IsoDate;
  readonly sourceUrls: readonly string[];
}

/**
 * Maps `fields` onto Spencer's confirmed real Research Vault Notion
 * property names (`names`, defaulting to `DEFAULT_RESEARCH_VAULT_PROPERTY_
 * NAMES`) and Notion's own property-value wire shapes — one-to-one, no
 * silent renaming or guessing (Story 6.1 AC2). `sourceUrls` (citations) are
 * joined with `\n` into `Sources`, since that property is `rich_text` in
 * Spencer's live workspace, not a dedicated URL-type property. `query` is
 * omitted from the returned properties object entirely when absent, rather
 * than written as an empty string — an absent property is simply not part
 * of the create-page request, so Notion leaves that property unset on the
 * new page (its own default), which is the correct "nothing to say here"
 * representation for an optional field.
 */
export function toResearchVaultPageProperties(
  fields: ResearchVaultEntryFields,
  names: NotionResearchVaultPropertyNames = DEFAULT_RESEARCH_VAULT_PROPERTY_NAMES,
): NonNullable<CreatePageParameters["properties"]> {
  const properties: NonNullable<CreatePageParameters["properties"]> = {
    [names.title]: { title: [{ type: "text", text: { content: fields.title } }] },
    [names.keyFindings]: { rich_text: [{ type: "text", text: { content: fields.keyFindings } }] },
    [names.date]: { date: { start: fields.searchDate } },
    [names.sources]: {
      rich_text: fields.sourceUrls.length > 0
        ? [{ type: "text", text: { content: fields.sourceUrls.join("\n") } }]
        : [],
    },
  };

  if (fields.query !== undefined) {
    properties[names.query] = { rich_text: [{ type: "text", text: { content: fields.query } }] };
  }

  return properties;
}

// ============================================================================
// createPage (Story 6.3 / FR-26, FR-29, AD-12) — the adapter's THIRD and
// final write function. resolveNotionPageDraftProperties is the shared,
// no-write schema-resolution core both createPage (write time) and
// shell/chat-cli.ts (draft time, before showing Spencer a Proposal) call —
// the exact same resolution genuinely runs twice, per AD-12.
// ============================================================================

export interface NotionCreatePageClient {
  readonly pages: {
    readonly create: Client["pages"]["create"];
  };
  readonly dataSources: {
    readonly retrieve: Client["dataSources"]["retrieve"];
  };
}

/** `createPage`/`resolveNotionPageDraftProperties`'s config — one data source id + property-name map per target database. */
export interface NotionCreatePageConfig {
  readonly tasksDataSourceId: string;
  readonly projectsDataSourceId: string;
  readonly researchVaultDataSourceId: string;
  readonly taskPropertyNames?: NotionTaskPropertyNames;
  readonly projectPropertyNames?: NotionProjectPropertyNames;
  readonly researchVaultPropertyNames?: NotionResearchVaultPropertyNames;
}

/** Yoh-internal field name -> real Notion property name, per target database. Deliberately excludes relation-typed properties (e.g. Research Vault's "Linked Project") — a chat-driven raw-string draft can't supply a valid relation target. */
function createPagePropertyNameMap(database: NotionDatabaseTarget, config: NotionCreatePageConfig): Record<string, string> {
  if (database === "Tasks") {
    const names = config.taskPropertyNames ?? DEFAULT_TASK_PROPERTY_NAMES;
    return {
      title: names.title,
      estimatedDurationMinutes: names.estimatedDuration,
      area: names.area,
      dueDate: names.dueDate,
      status: names.status,
      energy: names.energy,
    };
  }
  if (database === "Projects") {
    const names = config.projectPropertyNames ?? DEFAULT_PROJECT_PROPERTY_NAMES;
    return { title: names.title };
  }
  const names = config.researchVaultPropertyNames ?? DEFAULT_RESEARCH_VAULT_PROPERTY_NAMES;
  return {
    title: names.title,
    keyFindings: names.keyFindings,
    query: names.query,
    searchDate: names.date,
    sources: names.sources,
    status: names.status,
    area: names.area,
    confidence: names.confidence,
    openQuestions: names.openQuestions,
  };
}

function createPageDataSourceId(database: NotionDatabaseTarget, config: NotionCreatePageConfig): string {
  if (database === "Tasks") return config.tasksDataSourceId;
  if (database === "Projects") return config.projectsDataSourceId;
  return config.researchVaultDataSourceId;
}

/**
 * Resolves ONE already-retrieved live property definition + a raw string
 * value into a `CreatePageParameters["properties"]` entry, or a failure
 * reason. `title`/`rich_text` are written directly; `number`/`date` are
 * coerced; `select`/`status` are resolved via `closestOption` against the
 * property's REAL live options (never raw/invented text — AD-12). Any other
 * live property type fails.
 */
function resolveCreatePageProperty(
  propertyName: string,
  propertyConfig: GetDataSourceResponse["properties"][string] | undefined,
  rawValue: string,
): { readonly ok: true; readonly value: NonNullable<CreatePageParameters["properties"]>[string] } | { readonly ok: false; readonly message: string } {
  if (!propertyConfig) {
    return { ok: false, message: `"${propertyName}" does not exist on this database's live schema` };
  }
  switch (propertyConfig.type) {
    case "title":
      return { ok: true, value: { title: [{ type: "text", text: { content: rawValue } }] } };
    case "rich_text":
      return { ok: true, value: { rich_text: [{ type: "text", text: { content: rawValue } }] } };
    case "number": {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) return { ok: false, message: `"${propertyName}" expects a number, got "${rawValue}"` };
      return { ok: true, value: { number: n } };
    }
    case "date":
      return { ok: true, value: { date: { start: rawValue } } };
    case "select":
    case "status": {
      const liveOptionNames = (propertyConfig.type === "select" ? propertyConfig.select.options : propertyConfig.status.options).map(
        (option) => option.name,
      );
      const resolved = closestOption(rawValue, liveOptionNames);
      if (resolved === undefined) {
        return { ok: false, message: `no existing "${propertyName}" option is a close enough match to "${rawValue}"` };
      }
      return { ok: true, value: propertyConfig.type === "select" ? { select: { name: resolved } } : { status: { name: resolved } } };
    }
    default:
      return { ok: false, message: `"${propertyName}" is a ${propertyConfig.type} property — not supported for chat-driven creation` };
  }
}

/**
 * Retrieves `database`'s live schema and resolves every entry in
 * `properties` (Yoh-internal field name -> Spencer's raw string value)
 * against it — never writes anything. Fails closed (AD-12) on: an unknown
 * internal field name for `database`, a missing/unresolvable `title`, or
 * any single property that can't be confidently resolved (e.g. a
 * `select`-backed value with no close live match). Called by
 * `shell/chat-cli.ts` at DRAFT time (so the `Proposal<NotionPageDraft>`
 * shown to Spencer is actually accurate) and internally by `createPage`
 * again at WRITE time (the binding guarantee) — the exact same resolution,
 * genuinely run twice.
 */
export async function resolveNotionPageDraftProperties(
  client: NotionCreatePageClient,
  config: NotionCreatePageConfig,
  database: NotionDatabaseTarget,
  properties: Readonly<Record<string, string>>,
): Promise<Result<NonNullable<CreatePageParameters["properties"]>, YohError>> {
  const nameMap = createPagePropertyNameMap(database, config);
  const dataSourceId = createPageDataSourceId(database, config);

  if (!properties["title"] || properties["title"].trim().length === 0) {
    return {
      ok: false,
      error: { kind: "validation", message: `notion-adapter: a "${database}" page draft needs a non-blank title` },
    };
  }

  let schema: GetDataSourceResponse;
  try {
    schema = await client.dataSources.retrieve({ data_source_id: dataSourceId });
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "unreachable",
        message: `notion-adapter: could not read the live schema for "${database}" — ${err instanceof Error ? err.message : String(err)}`,
        detail: err,
      },
    };
  }
  if (!isFullDataSource(schema)) {
    return {
      ok: false,
      error: { kind: "unreachable", message: `notion-adapter: Notion returned a partial data source object for "${database}"` },
    };
  }

  const resolved: NonNullable<CreatePageParameters["properties"]> = {};
  for (const [internalField, rawValue] of Object.entries(properties)) {
    const realName = nameMap[internalField];
    if (!realName) {
      return {
        ok: false,
        error: { kind: "validation", message: `notion-adapter: "${internalField}" is not a settable field for "${database}"` },
      };
    }
    const result = resolveCreatePageProperty(realName, schema.properties[realName], rawValue);
    if (!result.ok) {
      return { ok: false, error: { kind: "validation", message: `notion-adapter: ${result.message}` } };
    }
    resolved[realName] = result.value;
  }

  return { ok: true, value: resolved };
}

/**
 * Creates a new page in `database`'s live data source. Re-runs
 * `resolveNotionPageDraftProperties` itself (the write-time half of AD-12's
 * "runs twice") rather than trusting an already-resolved payload from a
 * caller — so a draft that was valid moments ago but has since drifted
 * still fails closed here, not just at draft time. Only called from
 * `shell/chat-cli.ts`, never `shell/ritual-cli.ts` (AD-12).
 */
export async function createPage(
  client: NotionCreatePageClient,
  config: NotionCreatePageConfig,
  database: NotionDatabaseTarget,
  properties: Readonly<Record<string, string>>,
): Promise<Result<{ pageId: string; url?: string }, YohError>> {
  const resolved = await resolveNotionPageDraftProperties(client, config, database, properties);
  if (!resolved.ok) return resolved;

  const dataSourceId = createPageDataSourceId(database, config);

  let response: CreatePageResponse;
  try {
    response = await client.pages.create({
      parent: { data_source_id: dataSourceId },
      properties: resolved.value,
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "unreachable",
        message: `notion-adapter: could not create the "${database}" page — ${err instanceof Error ? err.message : String(err)}`,
        detail: err,
      },
    };
  }

  return {
    ok: true,
    value: isFullPage(response) ? { pageId: response.id, url: response.url } : { pageId: response.id },
  };
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

function toTask(
  page: PageObjectResponse,
  names: NotionTaskPropertyNames,
  energyOptionNames: Partial<Record<Energy, string>>,
): Task {
  const estimatedDurationMinutes = getNumber(page, names.estimatedDuration);
  const area = getAreaValue(page, names.area);
  const dueDateStart = getDateStart(page, names.dueDate);
  const dueDate = dueDateStart === undefined ? undefined : toIsoDateOnly(dueDateStart);
  const status = normalizeStatus(getStatusName(page, names.status));
  const energy = normalizeEnergy(getSelectName(page, names.energy), energyOptionNames);
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

/**
 * Checks `raw` against `optionNames` (Spencer's real Energy-select option
 * strings, e.g. "🔵 Deep Work") FIRST, by exact trimmed match — those option
 * names don't survive `normalizeOptionName`'s lowercase/hyphenate pass into
 * anything resembling `"low"`/`"medium"`/`"high"`, so they'd never match via
 * the generic path below. Falls back to the generic low/medium/high string
 * normalization `normalizeStatus` also uses, so a workspace that DOES use
 * literal "Low"/"Medium"/"High" option names (the Task 3 brief's original
 * reasonable-default assumption) still works unchanged.
 */
function normalizeEnergy(raw: string | undefined, optionNames: Partial<Record<Energy, string>>): Energy | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  for (const level of ["low", "medium", "high"] as const) {
    if (optionNames[level] === trimmed) return level;
  }

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
