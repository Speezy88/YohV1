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

import { APIResponseError, isFullDataSource, isFullPage, type Client } from "@notionhq/client";
import { isValidIsoDate, isValidIsoDateTime } from "./iso-datetime.ts";
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
  EditableTaskField,
  Energy,
  ExternalId,
  IsoDate,
  NotionDatabaseTarget,
  PlanningFieldNames,
  Project,
  ResearchVaultRecord,
  Result,
  Task,
  TaskFieldOption,
  TaskFieldOptions,
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
 * `shell/server.ts` (Story 8.9: originally also `shell/chat-cli.ts`) bind
 * the one real `Client` to both `readNotionTasks` and `setTaskStatus`
 * without needing two separate client objects.
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
 * once, so `shell/server.ts` (Story 8.9: originally also `shell/chat-cli.ts`)
 * still only ever constructs one real client.
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
  /** Task 7 (Priority field). */
  readonly priority: string;
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
  priority: "Priority",
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
 * -> `"in-progress"`, trim/lowercase/hyphenate). Overridable via
 * `NotionAdapterConfig.statusOptionNames` in case Spencer's real workspace
 * names its Status options differently, without a code change — the same
 * override convention `taskPropertyNames`/`projectPropertyNames` already
 * establish.
 *
 * `"not-started"` -> `"Nothing"` reflects Spencer's own 2026-09-22 rename of
 * his live Status property to a leaner three-option set (nothing / in
 * progress / completed — no live `"Slipped"` option any more). Getting this
 * exact string wrong is no longer a silent failure mode the way it would
 * have been before this same revision: `setTaskStatus` (see its own doc
 * comment) now resolves this candidate against the LIVE option list via
 * `notion-select-match.ts`'s `closestOption`, the same fuzzy/case-insensitive
 * resolution `Area`/`Energy` already used — so a future rename, or a minor
 * casing difference here, self-corrects rather than requiring another code
 * change. `"slipped"` stays mapped to `"Slipped"` even though no live option
 * currently matches it: `closestOption` will correctly fail to resolve it,
 * surfacing a clear error Spencer can "skip" past (Task 19's close-out escape
 * hatch) rather than writing something wrong.
 */
export const DEFAULT_TASK_STATUS_OPTION_NAMES: Record<TaskStatus, string> = {
  "not-started": "Nothing",
  "in-progress": "In Progress",
  completed: "Completed",
  slipped: "Slipped",
};

/**
 * Maps Spencer's real Notion Energy-select option names onto `domain.ts`'s
 * `Energy` enum ("the energy level a Task requires"). Originally Spencer's
 * workspace used his own two-tier "🔵 Deep Work" / "⚡ Light Work" taxonomy
 * with no middle option, which is why `"medium"` used to have no entry here
 * at all. As of 2026-09-22 Spencer renamed his live Energy select options to
 * a genuine three-tier "Deep" / "medium" / "low" set specifically so Yoh's
 * own low/medium/high scale has somewhere real to write a `"medium"` value —
 * every `Energy` value is mapped now.
 *
 * Overridable via `NotionAdapterConfig.energyOptionNames`, the same
 * override convention `taskPropertyNames`/`statusOptionNames` already
 * establish, in case this ever needs to point at different real option
 * names later. Exact casing here isn't load-bearing either way:
 * `writeSelectLikeField`'s `closestOption` resolution is case-insensitive
 * before it ever falls back to edit-distance matching.
 */
export const DEFAULT_ENERGY_OPTION_NAMES: Partial<Record<Energy, string>> = {
  high: "Deep",
  medium: "medium",
  low: "low",
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
 * (for its `.status` property-name field only), `statusOptionNames`, and
 * `tasksDataSourceId`. Still deliberately narrower than the full
 * `NotionAdapterConfig` (Task 19 review fix), but no longer excludes
 * `tasksDataSourceId` the way it originally did: this revision makes
 * `setTaskStatus` schema-checked (see its own doc comment), which needs
 * `dataSources.retrieve` on the Tasks data source to resolve a Status option
 * name against Notion's LIVE option list, the same way Area/Energy writes
 * already do. `projectsDataSourceId`/`projectPropertyNames` stay excluded —
 * the original review fix's reasoning still holds for those: nothing about
 * writing a Task's Status ever legitimately depends on Projects-side config,
 * so an unrelated missing/misconfigured field there must not block this
 * write. `tasksDataSourceId` is different: `readNotionTasks`/
 * `updateTaskField` already require it for the app to be useful at all, so
 * requiring it here too no longer meaningfully narrows what "a session that
 * only touches Status" can get away without configuring. A real
 * `NotionAdapterConfig` still satisfies this type structurally (it's a
 * `Pick`), so nothing else in the codebase needs to change.
 */
export type NotionStatusWriteConfig = Pick<NotionAdapterConfig, "tasksDataSourceId" | "taskPropertyNames" | "statusOptionNames">;

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
  const statusOptionNames = config.statusOptionNames ?? DEFAULT_TASK_STATUS_OPTION_NAMES;

  const [taskPages, projectPages] = await Promise.all([
    queryAllPages(client, config.tasksDataSourceId),
    queryAllPages(client, config.projectsDataSourceId),
  ]);

  return {
    tasks: taskPages.map((page) => toTask(page, taskPropertyNames, energyOptionNames, statusOptionNames)),
    projects: projectPages.map((page) => toProject(page, projectPropertyNames)),
  };
}

// ============================================================================
// readTaskFieldOptions (Task 6B) — the Tasks page's live select options.
// A read, like `readNotionTasks`: it lets SDK/network errors propagate
// (AD-8), and writes nothing.
// ============================================================================

/**
 * Reads the Tasks data source's LIVE schema and returns the options the
 * Tasks page's inline selects offer (`TaskFieldOptions`): every Area
 * select option name (or `undefined` when Area is free text), and each
 * live Energy/Status option that maps onto one of Yoh's enum values —
 * mapped by the SAME read-side normalization `readNotionTasks` uses, so an
 * option the list can show is exactly an option a row can hold. A live
 * option that maps onto no enum value is left out rather than guessed at.
 */
export async function readTaskFieldOptions(
  client: NotionSchemaClient,
  config: Pick<NotionAdapterConfig, "tasksDataSourceId" | "taskPropertyNames" | "energyOptionNames" | "statusOptionNames">,
): Promise<TaskFieldOptions> {
  const names = config.taskPropertyNames ?? DEFAULT_TASK_PROPERTY_NAMES;
  const energyOptionNames = config.energyOptionNames ?? DEFAULT_ENERGY_OPTION_NAMES;
  const statusOptionNames = config.statusOptionNames ?? DEFAULT_TASK_STATUS_OPTION_NAMES;
  const schema = await client.dataSources.retrieve({ data_source_id: config.tasksDataSourceId });
  if (!isFullDataSource(schema)) {
    throw new Error("notion-adapter: Notion returned a partial data source object — cannot read the Tasks options");
  }

  const liveOptionNames = (propertyName: string): readonly string[] | undefined => {
    const property = schema.properties[propertyName];
    if (property?.type === "select") return property.select.options.map((o) => o.name);
    if (property?.type === "status") return property.status.options.map((o) => o.name);
    return undefined;
  };

  const mapOptions = <V extends string>(liveNames: readonly string[], toValue: (name: string) => V | undefined): TaskFieldOption<V>[] => {
    const seen = new Set<V>();
    const out: TaskFieldOption<V>[] = [];
    for (const label of liveNames) {
      const value = toValue(label);
      if (value === undefined || seen.has(value)) continue;
      seen.add(value);
      out.push({ value, label });
    }
    return out;
  };

  return {
    area: liveOptionNames(names.area),
    energy: mapOptions(liveOptionNames(names.energy) ?? [], (label) => normalizeEnergy(label, energyOptionNames)),
    status: mapOptions(liveOptionNames(names.status) ?? [], (label) => normalizeStatus(label, statusOptionNames)),
    // Task 7: Priority is a string field, like Area — the live option
    // names verbatim, never mapped onto a fixed enum.
    priority: liveOptionNames(names.priority) ?? [],
  };
}

// ============================================================================
// readResearchVault (Task 6C, FR-43) — the Research Hub page's one read. A
// read, like readNotionTasks/readTaskFieldOptions: it lets SDK/network
// errors propagate (AD-8), and writes nothing.
// ============================================================================

/** `readResearchVault`'s config — just the two fields it needs, the same narrow-config convention `NotionStatusWriteConfig` etc. already establish. */
export type NotionResearchVaultReadConfig = Pick<NotionCreatePageConfig, "researchVaultDataSourceId" | "researchVaultPropertyNames">;

/**
 * Reads every current Research Vault page and maps it to a
 * `ResearchVaultRecord`: title, date (absent if unset), the "Key Findings"
 * body, the "Sources" lines (and their count), and the page's own Notion
 * url (so a row can link straight to it). Read-only: nothing is written.
 * Always queries live (no caching layer in this file), and paginates
 * through every result page via the same `queryAllPages` helper
 * `readNotionTasks` uses.
 */
export async function readResearchVault(
  client: NotionDataSourceClient,
  config: NotionResearchVaultReadConfig,
): Promise<readonly ResearchVaultRecord[]> {
  const names = config.researchVaultPropertyNames ?? DEFAULT_RESEARCH_VAULT_PROPERTY_NAMES;
  const pages = await queryAllPages(client, config.researchVaultDataSourceId);
  return pages.map((page) => toResearchVaultRecord(page, names));
}

// ============================================================================
// setTaskStatus (AD-12) — the adapter's ONE write function
// ============================================================================

/**
 * Writes `status` to a Task's Notion Status property — the only Task FIELD
 * this call ever reads, sends, or touches (AD-12: Status is the only Task
 * field Yoh ever writes back to Notion). This is Task 19/Epic 3's one
 * addition to this file; per its own brief no generic "update Task property"
 * function may exist here alongside it — this is the entire field-write
 * surface. (A completed Task's page is never trashed or otherwise
 * deleted — see the "Reverted 2026-09-25" note below, Story 7.9/AD-12.)
 *
 * **Schema-checked, not a blind write (this revision).** Originally this
 * function wrote `(config.statusOptionNames ?? DEFAULT_TASK_STATUS_OPTION_NAMES)[status]`
 * straight to Notion, trusting it to already be a real live option name.
 * That trust broke in practice: Spencer renamed his live Status options
 * (dropping `"Not Started"`/`"Slipped"` for a leaner nothing/in-progress/
 * completed set) and the hardcoded default silently went stale, the same
 * failure mode `writeSelectLikeField` already exists to prevent for Area and
 * Energy. `setTaskStatus` now delegates to that same function: the mapped
 * name is a CANDIDATE, resolved against the Tasks data source's live option
 * list via `notion-select-match.ts`'s `closestOption` before anything is
 * written — a rename or minor casing drift self-corrects; an option that
 * genuinely no longer exists (e.g. `"Slipped"`, now that Spencer's workspace
 * has none) fails clearly instead of writing garbage, surfacing through the
 * same `YohError` path `app/answer-night-close-out.ts`'s "skip" escape
 * hatch (Task 19; Story 8.9: originally `shell/chat-cli.ts`'s) already
 * handles for a permanently-failing Status write.
 *
 * **Reverted 2026-09-25 (Spencer, AD-12).** `setTaskStatus` writes the
 * Status property only and never trashes, from any trigger (Night
 * close-out or a Web App check-off, FR-41/FR-43). Completion history is
 * Yoh's own Completion Log (`completion-log.ts`, FR-47/AD-23), not
 * Notion's — Tasks stays fully populated and browsable in Tasks page (§9.4:
 * check-off never deletes).
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
 * `createMorningRitualDeps`/`shell/server.ts`'s `main` (Story 8.9:
 * originally also `shell/chat-cli.ts`'s `main`) for the binding
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
 * **`config`'s narrower type (Task 19 review fix, revised).** Takes
 * `NotionStatusWriteConfig` — `taskPropertyNames`/`statusOptionNames`/
 * `tasksDataSourceId` — rather than the full `NotionAdapterConfig`
 * `readNotionTasks` needs. See that type's own doc comment for exactly what
 * stays excluded (`projectsDataSourceId`/`projectPropertyNames`) and why
 * `tasksDataSourceId` was added back in this revision.
 */
export async function setTaskStatus(
  client: NotionWriteClient & NotionSchemaClient,
  config: NotionStatusWriteConfig,
  taskId: string,
  status: TaskStatus,
): Promise<Result<void, YohError>> {
  const statusPropertyName = (config.taskPropertyNames ?? DEFAULT_TASK_PROPERTY_NAMES).status;
  const optionName = (config.statusOptionNames ?? DEFAULT_TASK_STATUS_OPTION_NAMES)[status];

  return writeSelectLikeField(client, config.tasksDataSourceId, taskId, statusPropertyName, optionName);
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
  field: EditableTaskField,
  value: NonNullable<Task[EditableTaskField]>,
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

  // Task 7: Priority — like Area, the value is already the live option
  // NAME (`core/planning-field-value.ts`'s `parsePriorityValue`/the update
  // route validate this before it ever reaches here), resolved against the
  // live select options the same guarded way every other select field is.
  if (field === "priority") {
    return writeSelectLikeField(client, config.tasksDataSourceId, taskId, propertyNames.priority, value as string);
  }

  // field === "energy" — the only EditableTaskField value not yet handled.
  const energyOptionNames = config.energyOptionNames ?? DEFAULT_ENERGY_OPTION_NAMES;
  const preferredOptionName = energyOptionNames[value as Energy] ?? capitalizeFirst(value as Energy);
  return writeSelectLikeField(client, config.tasksDataSourceId, taskId, propertyNames.energy, preferredOptionName);
}

// ============================================================================
// updateTaskTitle (Task 6B fix round; AD-12 amended 2026-09-27, Spencer) —
// the closed write surface's one addition: the title of an EXISTING Task,
// from Spencer's own edit on the Tasks page only.
// ============================================================================

/**
 * Writes `title` (trimmed) to Task `taskId`'s title property — the
 * configured one (`taskPropertyNames.title`, i.e. `NOTION_TASK_TITLE_PROPERTY`,
 * Spencer's real "Task Name") — and touches nothing else. A blank title is
 * refused (`validation`) before any call is made. Like `setTaskStatus`/
 * `updateTaskField`, it returns a `Result` and never throws.
 */
export async function updateTaskTitle(
  client: NotionWriteClient,
  config: NotionFieldWriteConfig,
  taskId: string,
  title: string,
): Promise<Result<void, YohError>> {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: { kind: "validation", message: "A Task's title can't be blank." } };
  }
  const titleProperty = (config.taskPropertyNames ?? DEFAULT_TASK_PROPERTY_NAMES).title;
  return writePageProperty(client, taskId, titleProperty, { title: [{ type: "text", text: { content: trimmed } }] });
}

// ============================================================================
// archiveTask (2026-10-04, Spencer) — the write surface's one removal: an
// EXISTING Task moved to Notion's Trash, from an approved chat change set only.
// ============================================================================

/**
 * Moves Task `taskId` to Notion's Trash (`in_trash`), where Notion keeps it
 * restorable, and writes no property. A blank id is refused (`validation`)
 * before any call is made. Like `updateTaskTitle`, it returns a `Result`
 * and never throws.
 */
export async function archiveTask(client: NotionWriteClient, taskId: string): Promise<Result<void, YohError>> {
  if (taskId.trim().length === 0) {
    return { ok: false, error: { kind: "validation", message: "That Task couldn't be found." } };
  }
  try {
    await client.pages.update({ page_id: taskId, in_trash: true });
    return { ok: true, value: undefined };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "unreachable",
        message: `notion-adapter: could not move Task ${taskId} to the trash — ${err instanceof Error ? err.message : String(err)}`,
        detail: err,
      },
    };
  }
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

/**
 * `setTaskStatus`/`updateTaskField`, pre-bound through a LAZY
 * client/config provider (Story 8.4, Ruling R1) — `getBinding` is called
 * fresh on every actual write, never at bind time, so a session that never
 * triggers either write still never has to construct a Notion client or
 * check its env vars (the same laziness `shell/chat-cli.ts`'s own
 * pre-Story-8.4 closures always had). Only THIS file's own source may name
 * `setTaskStatus`/`updateTaskField` directly (AD-16) — a shell that needs a
 * bound closure for either (e.g. `shell/server.ts`'s `AnswerOpenItemDeps`
 * construction — Story 8.9: originally `shell/chat-cli.ts`'s — which feeds
 * `app/answer-data-completeness.ts` and
 * `app/answer-night-close-out.ts`) spreads this binder's return value
 * instead of importing/calling the two write functions itself, so their
 * names never appear as literal text in `shell/*.ts` (not even as an object-
 * literal property key).
 */
export type NotionTaskWriteBindingFn = () => Result<
  { readonly client: NotionWriteClient & NotionSchemaClient; readonly config: NotionFieldWriteConfig },
  YohError
>;

export interface NotionTaskWriteBindings {
  readonly setTaskStatus: (taskId: string, status: TaskStatus) => Promise<Result<void, YohError>>;
  readonly updateTaskField: (
    taskId: string,
    field: EditableTaskField,
    value: NonNullable<Task[EditableTaskField]>,
  ) => Promise<Result<void, YohError>>;
  /** Task 6B fix round: the Tasks page's inline rename (AD-12 amended 2026-09-27). */
  readonly updateTaskTitle: (taskId: string, title: string) => Promise<Result<void, YohError>>;
  /** A chat change set's approved Task deletion (2026-10-04): the page goes to Notion's Trash. */
  readonly archiveTask: (taskId: string) => Promise<Result<void, YohError>>;
}

export function bindNotionTaskWrites(getBinding: NotionTaskWriteBindingFn): NotionTaskWriteBindings {
  return {
    updateTaskTitle: async (taskId, title) => {
      const binding = getBinding();
      if (!binding.ok) return binding;
      return updateTaskTitle(binding.value.client, binding.value.config, taskId, title);
    },
    archiveTask: async (taskId) => {
      const binding = getBinding();
      if (!binding.ok) return binding;
      return archiveTask(binding.value.client, taskId);
    },
    setTaskStatus: async (taskId, status) => {
      const binding = getBinding();
      if (!binding.ok) return binding;
      return setTaskStatus(binding.value.client, binding.value.config, taskId, status);
    },
    updateTaskField: async (taskId, field, value) => {
      const binding = getBinding();
      if (!binding.ok) return binding;
      return updateTaskField(binding.value.client, binding.value.config, taskId, field, value);
    },
  };
}

// ============================================================================
// createPage (Story 6.3 / FR-26, FR-29, AD-12) — the adapter's THIRD and
// final write function. resolveNotionPageDraftProperties is the shared,
// no-write schema-resolution core both createPage (write time) and
// app/create-item.ts (draft time, before showing Spencer a Proposal; Story
// 8.9: originally shell/chat-cli.ts) call —
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
      priority: names.priority,
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
 * Notion rejects a single `rich_text` `text.content` longer than 2,000
 * characters, but accepts up to 100 segments per property (F4, Epic 6
 * retro: `epic-6-retro-2026-09-24.md`). Filing a search answer over 2,000
 * characters — Sonar answers with citations routinely run past that —
 * used to fail closed with a raw Notion 400.
 */
const NOTION_RICH_TEXT_SEGMENT_MAX_LENGTH = 2000;

/**
 * Splits `value` into `NOTION_RICH_TEXT_SEGMENT_MAX_LENGTH`-char-or-fewer
 * `text` segments for a `rich_text` property (F4). An empty string still
 * yields one (empty) segment, matching a plain `[{ type: "text", text: {
 * content: rawValue } }]` for any value under the limit — so this is a
 * drop-in replacement, not a special case only for long values.
 */
function chunkRichText(value: string): NonNullable<CreatePageParameters["properties"]>[string] {
  const segments: Array<{ type: "text"; text: { content: string } }> = [];
  for (let i = 0; i < value.length; i += NOTION_RICH_TEXT_SEGMENT_MAX_LENGTH) {
    segments.push({ type: "text", text: { content: value.slice(i, i + NOTION_RICH_TEXT_SEGMENT_MAX_LENGTH) } });
  }
  if (segments.length === 0) segments.push({ type: "text", text: { content: "" } });
  return { rich_text: segments };
}

/**
 * Resolves ONE already-retrieved live property definition + a raw string
 * value into a `CreatePageParameters["properties"]` entry, or a failure
 * reason. `title` is written directly; `rich_text` is chunked into
 * `NOTION_RICH_TEXT_SEGMENT_MAX_LENGTH`-char segments (F4); `number`/`date`
 * are coerced; `select`/`status` are resolved via `closestOption` against
 * the property's REAL live options (never raw/invented text — AD-12). Any
 * other live property type fails.
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
      return { ok: true, value: chunkRichText(rawValue) };
    case "number": {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) return { ok: false, message: `"${propertyName}" expects a number, got "${rawValue}"` };
      return { ok: true, value: { number: n } };
    }
    case "date":
      // Real-use fixes plan, Task 3 (backstop, AD-12): `app/create-item.ts` is
      // supposed to have already resolved any relative phrase into a real
      // ISO date/datetime BEFORE calling this — this check is what makes
      // that not merely a convention. Without it, a raw, never-validated
      // string like "tomorrow at 10:45 AM" would sail through here (Notion's
      // own API only rejects it later, at WRITE time), which is exactly the
      // incident this task fixes: a draft Spencer confirmed, that Notion
      // then rejected.
      if (!isValidIsoDate(rawValue) && !isValidIsoDateTime(rawValue)) {
        return { ok: false, message: `"${propertyName}" expects an ISO date (got "${rawValue}")` };
      }
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
 * `app/create-item.ts` (Story 8.9: originally `shell/chat-cli.ts`) at DRAFT
 * time (so the `Proposal<NotionPageDraft>` shown to Spencer is actually
 * accurate) and internally by `createPage` again at WRITE time (the binding
 * guarantee) — the exact same resolution, genuinely run twice.
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
 * `app/save-search-result.ts` and `app/confirm-proposal.ts` (Story 8.9:
 * originally `shell/chat-cli.ts`), never `shell/ritual-cli.ts` (AD-12).
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
    // F4 (Epic 6 retro): a Notion HTTP 400 means the request itself was
    // malformed (e.g. a still-too-long value, an unexpected property shape)
    // — that's a validation failure, not an unreachable/network one, even
    // though it's only detected here at write time.
    const isValidationFailure = err instanceof APIResponseError && err.status === 400;
    return {
      ok: false,
      error: {
        kind: isValidationFailure ? "validation" : "unreachable",
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

/**
 * `createPage`, pre-bound through a LAZY client/config provider (Story 8.4,
 * Ruling R1) — `getBinding` (the same shape `app/create-item.ts`'s own
 * `NotionCreatePageBindingFn` already uses, structurally) is called fresh on
 * every actual write, never at bind time. `app/save-search-result.ts` calls
 * `createPage` itself against the RAW client/config that function's own
 * binding returns (AD-16's own convention for `app/*.ts`); this binder is
 * for `shell/server.ts`'s OTHER call site (Story 8.9: originally
 * `shell/chat-cli.ts`'s), `AnswerOpenItemDeps`'s
 * `createPage` field (consumed by `app/confirm-proposal.ts`'s
 * `"notion-page-draft"` branch) — a shell may never name `createPage`
 * directly (not even as an object-literal property key), so it spreads this
 * binder's return value instead.
 */
export type NotionCreatePageBindingFn = () => Result<
  { readonly client: NotionCreatePageClient; readonly config: NotionCreatePageConfig },
  YohError
>;

export interface NotionCreatePageBinding {
  readonly createPage: (
    database: NotionDatabaseTarget,
    properties: Readonly<Record<string, string>>,
  ) => Promise<Result<{ readonly pageId: string; readonly url?: string }, YohError>>;
}

export function bindNotionCreatePage(getBinding: NotionCreatePageBindingFn): NotionCreatePageBinding {
  return {
    createPage: async (database, properties) => {
      const binding = getBinding();
      if (!binding.ok) return binding;
      return createPage(binding.value.client, binding.value.config, database, properties);
    },
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
  statusOptionNames: Record<TaskStatus, string>,
): Task {
  const estimatedDurationMinutes = getNumber(page, names.estimatedDuration);
  const area = getAreaValue(page, names.area);
  const dueDateStart = getDateStart(page, names.dueDate);
  const dueDate = dueDateStart === undefined ? undefined : toIsoDateOnly(dueDateStart);
  const status = normalizeStatus(getStatusName(page, names.status), statusOptionNames);
  const energy = normalizeEnergy(getSelectName(page, names.energy), energyOptionNames);
  const projectId = getFirstRelationId(page, names.project);
  // Task 7: Priority is read like Area — the live select option name
  // verbatim, never mapped onto a fixed enum.
  const priority = getAreaValue(page, names.priority);

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
    ...(priority !== undefined ? { priority } : {}),
  };
}

function toProject(page: PageObjectResponse, names: NotionProjectPropertyNames): Project {
  return {
    id: page.id,
    name: getTitle(page, names.title),
  };
}

/** The non-empty, trimmed lines of `raw` (the "Sources" rich_text value) — `save-search-result.ts` writes one citation URL per line (`citations.join("\n")`). */
function splitSourceLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function toResearchVaultRecord(page: PageObjectResponse, names: NotionResearchVaultPropertyNames): ResearchVaultRecord {
  const dateStart = getDateStart(page, names.date);
  const sources = splitSourceLines(getRichText(page, names.sources));
  return {
    id: page.id,
    title: getTitle(page, names.title),
    ...(dateStart !== undefined ? { date: toIsoDateOnly(dateStart) } : {}),
    keyFindings: getRichText(page, names.keyFindings),
    sources,
    sourceCount: sources.length,
    url: page.url,
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

/** Plain concatenated text of a `rich_text` property — `""` if unset or the property is some other type. */
function getRichText(page: PageObjectResponse, propertyName: string): string {
  const prop = page.properties[propertyName];
  if (prop?.type === "rich_text") {
    return prop.rich_text.map((rt) => rt.plain_text).join("");
  }
  return "";
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

/**
 * Checks `raw` against `optionNames` (the write-side Status option names,
 * e.g. Spencer's live "Nothing" for `"not-started"`) FIRST, case-
 * insensitively — Task 6B fix: without this, a Task whose live Status is
 * "Nothing" (the option `setTaskStatus` itself writes for `"not-started"`
 * since the 2026-09-22 rename) read back as having NO Status at all, so
 * every untouched Task looked like it was missing a field. Falls back to
 * the generic "In Progress" -> "in-progress" normalization.
 */
function normalizeStatus(raw: string | undefined, optionNames: Record<TaskStatus, string>): TaskStatus | undefined {
  if (raw === undefined) return undefined;
  const lowered = raw.trim().toLowerCase();
  for (const status of Object.keys(optionNames) as TaskStatus[]) {
    if (optionNames[status].toLowerCase() === lowered) return status;
  }
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
