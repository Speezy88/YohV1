/**
 * Tests for `src/adapters/notion-adapter.ts` (Story 1.3 / Task 3).
 *
 * Per the Task 3 brief's implementer note (AD-8), `readNotionTasks` takes an
 * injectable Notion client so these tests never make a real network call —
 * `FakeNotionClient` below stands in for `@notionhq/client`'s `Client`,
 * typed against the real `dataSources.query` signature so a genuine
 * `Client` instance would satisfy `readNotionTasks`'s parameter type too.
 *
 * Fixture pages are built against the real `PageObjectResponse` shape
 * (checked live against `node_modules/@notionhq/client`, per the Task 3
 * brief's "Before You Begin" guidance) rather than a hand-rolled shape, so a
 * mismatch between this test's assumptions and the SDK's actual types would
 * fail to compile, not just fail silently at runtime.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CreatePageParameters,
  PageObjectResponse,
  QueryDataSourceParameters,
  QueryDataSourceResponse,
} from "@notionhq/client";
import { APIErrorCode, APIResponseError } from "@notionhq/client";
import {
  createPage,
  DEFAULT_PROJECT_PROPERTY_NAMES,
  DEFAULT_RESEARCH_VAULT_PROPERTY_NAMES,
  DEFAULT_TASK_PROPERTY_NAMES,
  loadTaskPropertyNamesFromEnv,
  readNotionTasks,
  resolveNotionPageDraftProperties,
  setTaskStatus,
  updateTaskField,
  type NotionCreatePageClient,
  type NotionCreatePageConfig,
  type NotionDataSourceClient,
  type NotionFieldWriteConfig,
  type NotionSchemaClient,
  type NotionStatusWriteConfig,
  type NotionWriteClient,
} from "../src/adapters/notion-adapter.ts";
import type { DataSourceObjectResponse, UpdatePageParameters, UpdatePageResponse } from "@notionhq/client";

// ============================================================================
// Fixture helpers
// ============================================================================

const FAKE_USER = { object: "user" as const, id: "user-1" };

/** Builds a minimal-but-real-shaped `PageObjectResponse` for a Notion Task row. */
function makeTaskPage(overrides: {
  id: string;
  title: string;
  createdTime?: string;
  lastEditedTime?: string;
  estimatedDuration?: number | null;
  area?: string | null;
  dueDateStart?: string | null;
  status?: string | null;
  energy?: string | null;
  projectId?: string | null;
}): PageObjectResponse {
  const createdTime = overrides.createdTime ?? "2026-08-01T09:00:00.000Z";
  const lastEditedTime = overrides.lastEditedTime ?? createdTime;

  return {
    object: "page",
    id: overrides.id,
    created_time: createdTime,
    last_edited_time: lastEditedTime,
    in_trash: false,
    archived: false,
    is_archived: false,
    is_locked: false,
    url: `https://notion.so/${overrides.id}`,
    public_url: null,
    parent: { type: "data_source_id", data_source_id: "tasks-ds", database_id: "tasks-db" },
    icon: null,
    cover: null,
    created_by: FAKE_USER,
    last_edited_by: FAKE_USER,
    properties: {
      Name: {
        id: "title",
        type: "title",
        title: [
          {
            type: "text",
            text: { content: overrides.title, link: null },
            plain_text: overrides.title,
            href: null,
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: "default",
            },
          },
        ],
      },
      "Estimated Duration": {
        id: "duration",
        type: "number",
        number: overrides.estimatedDuration === undefined ? null : overrides.estimatedDuration,
      },
      Area: {
        id: "area",
        type: "select",
        select:
          overrides.area == null
            ? null
            : { id: "area-opt", name: overrides.area, color: "blue", description: null },
      },
      "Due Date": {
        id: "due",
        type: "date",
        date:
          overrides.dueDateStart == null
            ? null
            : { start: overrides.dueDateStart, end: null, time_zone: null },
      },
      Status: {
        id: "status",
        type: "status",
        status:
          overrides.status == null
            ? null
            : { id: "status-opt", name: overrides.status, color: "gray", description: null },
      },
      Energy: {
        id: "energy",
        type: "select",
        select:
          overrides.energy == null
            ? null
            : { id: "energy-opt", name: overrides.energy, color: "green", description: null },
      },
      Project: {
        id: "project",
        type: "relation",
        relation: overrides.projectId == null ? [] : [{ id: overrides.projectId }],
        has_more: false,
      },
    },
  } as unknown as PageObjectResponse;
}

function makeProjectPage(id: string, name: string): PageObjectResponse {
  return {
    object: "page",
    id,
    created_time: "2026-07-01T09:00:00.000Z",
    last_edited_time: "2026-07-01T09:00:00.000Z",
    in_trash: false,
    archived: false,
    is_archived: false,
    is_locked: false,
    url: `https://notion.so/${id}`,
    public_url: null,
    parent: { type: "data_source_id", data_source_id: "projects-ds", database_id: "projects-db" },
    icon: null,
    cover: null,
    created_by: FAKE_USER,
    last_edited_by: FAKE_USER,
    properties: {
      Name: {
        id: "title",
        type: "title",
        title: [
          {
            type: "text",
            text: { content: name, link: null },
            plain_text: name,
            href: null,
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: "default",
            },
          },
        ],
      },
    },
  } as unknown as PageObjectResponse;
}

/** A fake client whose `dataSources.query` is scripted per-data-source-id, one response array per call. */
class FakeNotionClient implements NotionDataSourceClient {
  private readonly queue: Map<string, PageObjectResponse[][]>;
  readonly calls: QueryDataSourceParameters[] = [];

  constructor(responses: Record<string, PageObjectResponse[][]>) {
    this.queue = new Map(Object.entries(responses).map(([k, v]) => [k, [...v]]));
  }

  dataSources = {
    query: async (args: QueryDataSourceParameters): Promise<QueryDataSourceResponse> => {
      this.calls.push(args);
      const pages = this.queue.get(args.data_source_id)?.shift() ?? [];
      return {
        type: "page_or_data_source",
        page_or_data_source: {},
        object: "list",
        next_cursor: null,
        has_more: false,
        results: pages,
      };
    },
  };
}

const CONFIG = { tasksDataSourceId: "tasks-ds", projectsDataSourceId: "projects-ds" };

/**
 * `setTaskStatus` takes `NotionStatusWriteConfig`, not the full
 * `NotionAdapterConfig` — deliberately narrower (Task 19 review fix; see
 * that type's own doc comment). Now includes `tasksDataSourceId`: as of the
 * schema-checked-Status revision, `setTaskStatus` resolves its Status option
 * name against the Tasks data source's LIVE schema the same way Area/Energy
 * writes already do.
 */
const STATUS_WRITE_CONFIG: NotionStatusWriteConfig = { tasksDataSourceId: "tasks-ds" };

// ============================================================================
// Tests
// ============================================================================

test("readNotionTasks returns every current Task with its 5 planning fields plus Project grouping", async () => {
  const client = new FakeNotionClient({
    "tasks-ds": [
      [
        makeTaskPage({
          id: "task-1",
          title: "Write the report",
          estimatedDuration: 90,
          area: "Work",
          dueDateStart: "2026-08-25",
          status: "In Progress",
          energy: "High",
          projectId: "project-1",
        }),
      ],
    ],
    "projects-ds": [[makeProjectPage("project-1", "Q3 Planning")]],
  });

  const result = await readNotionTasks(client, CONFIG);

  assert.equal(result.tasks.length, 1);
  const task = result.tasks[0];
  assert.ok(task);
  assert.equal(task.id, "task-1");
  assert.equal(task.title, "Write the report");
  assert.equal(task.estimatedDurationMinutes, 90);
  assert.equal(task.area, "Work");
  assert.equal(task.dueDate, "2026-08-25");
  assert.equal(task.status, "in-progress");
  assert.equal(task.energy, "high");
  assert.equal(task.projectId, "project-1");
  assert.equal(task.createdAt, "2026-08-01T09:00:00.000Z");

  assert.equal(result.projects.length, 1);
  assert.deepEqual(result.projects[0], { id: "project-1", name: "Q3 Planning" });
});

test("readNotionTasks leaves a planning field undefined when Notion has it unset, rather than inventing a value", () => {
  return (async () => {
    const client = new FakeNotionClient({
      "tasks-ds": [[makeTaskPage({ id: "task-2", title: "Bare task" })]],
      "projects-ds": [[]],
    });

    const result = await readNotionTasks(client, CONFIG);
    const task = result.tasks[0];
    assert.ok(task);
    assert.equal(task.estimatedDurationMinutes, undefined);
    assert.equal(task.area, undefined);
    assert.equal(task.dueDate, undefined);
    assert.equal(task.status, undefined);
    assert.equal(task.energy, undefined);
    assert.equal(task.projectId, undefined);
    assert.ok(!("estimatedDurationMinutes" in task) || task.estimatedDurationMinutes === undefined);
  })();
});

test("readNotionTasks reflects a Task field changed in Notion since the last read, with no manual re-sync", async () => {
  const client = new FakeNotionClient({
    "tasks-ds": [
      [makeTaskPage({ id: "task-3", title: "Ship the feature", status: "Not Started" })],
      [makeTaskPage({ id: "task-3", title: "Ship the feature", status: "Completed" })],
    ],
    "projects-ds": [[], []],
  });

  const first = await readNotionTasks(client, CONFIG);
  assert.equal(first.tasks[0]?.status, "not-started");

  // Simulates Spencer changing the Status in Notion between two runs. No
  // caching layer exists in notion-adapter.ts, so a second call must re-query
  // and reflect the new value with no manual re-sync step.
  const second = await readNotionTasks(client, CONFIG);
  assert.equal(second.tasks[0]?.status, "completed");
});

test("readNotionTasks pages through every result via start_cursor/has_more rather than truncating at one page", async () => {
  const page1 = makeTaskPage({ id: "task-page-1", title: "First page task" });
  const page2 = makeTaskPage({ id: "task-page-2", title: "Second page task" });

  class PaginatingFakeClient implements NotionDataSourceClient {
    dataSources = {
      query: async (args: QueryDataSourceParameters): Promise<QueryDataSourceResponse> => {
        if (args.data_source_id === "projects-ds") {
          return {
            type: "page_or_data_source",
            page_or_data_source: {},
            object: "list",
            next_cursor: null,
            has_more: false,
            results: [],
          };
        }
        if (!args.start_cursor) {
          return {
            type: "page_or_data_source",
            page_or_data_source: {},
            object: "list",
            next_cursor: "cursor-2",
            has_more: true,
            results: [page1],
          };
        }
        return {
          type: "page_or_data_source",
          page_or_data_source: {},
          object: "list",
          next_cursor: null,
          has_more: false,
          results: [page2],
        };
      },
    };
  }

  const result = await readNotionTasks(new PaginatingFakeClient(), CONFIG);
  assert.deepEqual(
    result.tasks.map((t) => t.id).sort(),
    ["task-page-1", "task-page-2"],
  );
});

test("readNotionTasks normalizes Spencer's real Energy taxonomy (Deep / medium / low) to high/medium/low by default", async () => {
  const client = new FakeNotionClient({
    "tasks-ds": [
      [
        makeTaskPage({ id: "task-deep", title: "Deep focus task", energy: "Deep" }),
        makeTaskPage({ id: "task-medium", title: "Middling task", energy: "medium" }),
        makeTaskPage({ id: "task-light", title: "Light admin task", energy: "low" }),
      ],
    ],
    "projects-ds": [[]],
  });

  const result = await readNotionTasks(client, CONFIG);
  const byId = new Map(result.tasks.map((t) => [t.id, t]));
  assert.equal(byId.get("task-deep")?.energy, "high");
  assert.equal(byId.get("task-medium")?.energy, "medium");
  assert.equal(byId.get("task-light")?.energy, "low");
});

test("readNotionTasks honors a custom energyOptionNames override", async () => {
  const client = new FakeNotionClient({
    "tasks-ds": [[makeTaskPage({ id: "task-custom", title: "Custom energy", energy: "Grindy" })]],
    "projects-ds": [[]],
  });

  const result = await readNotionTasks(client, { ...CONFIG, energyOptionNames: { high: "Grindy" } });
  assert.equal(result.tasks[0]?.energy, "high");
});

test("readNotionTasks leaves Energy unset for a value matching neither the option-name map nor the generic low/medium/high normalization", async () => {
  const client = new FakeNotionClient({
    "tasks-ds": [[makeTaskPage({ id: "task-unknown", title: "Mystery energy", energy: "🎲 Whatever" })]],
    "projects-ds": [[]],
  });

  const result = await readNotionTasks(client, CONFIG);
  assert.equal(result.tasks[0]?.energy, undefined);
});

test("readNotionTasks normalizes Status/Energy option casing to the fixed Yoh enums", async () => {
  const client = new FakeNotionClient({
    "tasks-ds": [
      [
        makeTaskPage({ id: "task-4", title: "Slipped one", status: "Slipped", energy: "Low" }),
      ],
    ],
    "projects-ds": [[]],
  });

  const result = await readNotionTasks(client, CONFIG);
  assert.equal(result.tasks[0]?.status, "slipped");
  assert.equal(result.tasks[0]?.energy, "low");
});

test("readNotionTasks honors a custom taskPropertyNames.title override — Spencer's real workspace names it 'Task Name', not 'Name'", async () => {
  const page = makeTaskPage({ id: "task-titled", title: "placeholder" });
  // makeTaskPage hardcodes the title property under the key "Name"; rename
  // it to "Task Name" to simulate Spencer's real workspace shape.
  const renamed = {
    ...page,
    properties: { ...page.properties, "Task Name": page.properties["Name"] },
  } as unknown as PageObjectResponse;
  delete (renamed as { properties: Record<string, unknown> }).properties["Name"];

  const client = new FakeNotionClient({
    "tasks-ds": [[renamed]],
    "projects-ds": [[]],
  });

  const config = { ...CONFIG, taskPropertyNames: { ...DEFAULT_TASK_PROPERTY_NAMES, title: "Task Name" } };
  const result = await readNotionTasks(client, config);
  assert.equal(result.tasks[0]?.title, "placeholder");
});

// ============================================================================
// loadTaskPropertyNamesFromEnv (title property mismatch fix)
// ============================================================================

test("loadTaskPropertyNamesFromEnv falls back to DEFAULT_TASK_PROPERTY_NAMES when NOTION_TASK_TITLE_PROPERTY is unset", () => {
  assert.deepEqual(loadTaskPropertyNamesFromEnv({}), DEFAULT_TASK_PROPERTY_NAMES);
});

test("loadTaskPropertyNamesFromEnv overrides only .title from NOTION_TASK_TITLE_PROPERTY, leaving every other property name at its default", () => {
  const result = loadTaskPropertyNamesFromEnv({ NOTION_TASK_TITLE_PROPERTY: "Task Name" });
  assert.deepEqual(result, { ...DEFAULT_TASK_PROPERTY_NAMES, title: "Task Name" });
});

// ============================================================================
// setTaskStatus (Task 19 / AD-12 — the adapter's ONE write function)
// ============================================================================

/** A fake write+schema client: `pages.update` is scripted to succeed or throw, recording every call verbatim; `dataSources.retrieve` returns a scripted schema and records every data source id it was asked for. Moved above the `setTaskStatus` tests (originally only needed by `updateTaskField`'s) since `setTaskStatus` became schema-checked in the same revision that renamed Spencer's live Status/Energy options. */
class FakeNotionFieldWriteClient implements NotionWriteClient, NotionSchemaClient {
  readonly updateCalls: UpdatePageParameters[] = [];
  readonly retrieveCalls: string[] = [];
  private readonly schema: DataSourceObjectResponse;
  private readonly throwOnUpdate: Error | undefined;

  constructor(schema: DataSourceObjectResponse, options: { throwOnUpdate?: Error } = {}) {
    this.schema = schema;
    this.throwOnUpdate = options.throwOnUpdate;
  }

  pages = {
    update: async (args: UpdatePageParameters): Promise<UpdatePageResponse> => {
      this.updateCalls.push(args);
      if (this.throwOnUpdate) throw this.throwOnUpdate;
      return { object: "page", id: "task-1" } as UpdatePageResponse;
    },
  };

  dataSources = {
    retrieve: async (args: { data_source_id: string }): Promise<DataSourceObjectResponse> => {
      this.retrieveCalls.push(args.data_source_id);
      return this.schema;
    },
  };
}

function makeSelectSchema(propertyName: string, optionNames: readonly string[]): DataSourceObjectResponse {
  return {
    object: "data_source",
    id: "tasks-ds",
    title: [],
    description: [],
    parent: { type: "database_id", database_id: "tasks-db" },
    database_parent: { type: "database_id", database_id: "tasks-db" },
    is_inline: false,
    in_trash: false,
    archived: false,
    created_time: "2026-08-01T09:00:00.000Z",
    last_edited_time: "2026-08-01T09:00:00.000Z",
    created_by: FAKE_USER,
    last_edited_by: FAKE_USER,
    icon: null,
    cover: null,
    url: "https://notion.so/tasks-ds",
    public_url: null,
    properties: {
      [propertyName]: {
        id: "prop-1",
        name: propertyName,
        description: null,
        type: "select",
        select: { options: optionNames.map((name, i) => ({ id: `opt-${i}`, name, color: "default", description: null })) },
      },
    },
  } as unknown as DataSourceObjectResponse;
}

function makeRichTextSchema(propertyName: string): DataSourceObjectResponse {
  const schema = makeSelectSchema(propertyName, []) as unknown as { properties: Record<string, unknown> };
  schema.properties[propertyName] = { id: "prop-1", name: propertyName, description: null, type: "rich_text", rich_text: {} };
  return schema as unknown as DataSourceObjectResponse;
}

/**
 * Same shape as `makeSelectSchema`, but typed as Notion's real `status`
 * property (distinct from `select` — Spencer's real "Status" property is a
 * `status`-type property, per the module docstring's read-side notes), so
 * `writeSelectLikeField` takes its `{status: {name}}` write-shape branch
 * rather than `select`'s. `setTaskStatus`'s tests use this one, not
 * `makeSelectSchema` — a generic `select` schema would still resolve the
 * option name correctly but write it under the WRONG property shape,
 * silently making those tests read `undefined` off the wrong key.
 */
function makeStatusSchema(propertyName: string, optionNames: readonly string[]): DataSourceObjectResponse {
  const schema = makeSelectSchema(propertyName, []) as unknown as { properties: Record<string, unknown> };
  schema.properties[propertyName] = {
    id: "prop-1",
    name: propertyName,
    description: null,
    type: "status",
    status: { options: optionNames.map((name, i) => ({ id: `opt-${i}`, name, color: "default", description: null })), groups: [] },
  };
  return schema as unknown as DataSourceObjectResponse;
}

test("setTaskStatus writes the Status property to the given page id and returns Result.ok", async () => {
  const client = new FakeNotionFieldWriteClient(makeStatusSchema("Status", ["Nothing", "In Progress", "Completed", "Slipped"]));
  const result = await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "in-progress");

  assert.equal(result.ok, true);
  assert.equal(client.updateCalls.length, 1, "expected exactly one Notion write call for a non-completing status");
  const call = client.updateCalls[0]!;
  assert.equal(call.page_id, "task-1");
});

test("setTaskStatus writes ONLY the Status property — no other Task field is touched as a side effect (non-completing status)", async () => {
  const client = new FakeNotionFieldWriteClient(makeStatusSchema("Status", ["Nothing", "In Progress", "Completed", "Slipped"]));
  await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "slipped");

  const call = client.updateCalls[0]!;
  const propertyKeys = Object.keys(call.properties ?? {});
  assert.deepEqual(propertyKeys, ["Status"], "exactly one property key, the Status property, must be sent");
});

test("setTaskStatus maps every TaskStatus value to a Notion Status option name, resolved against the live schema", async () => {
  const client = new FakeNotionFieldWriteClient(makeStatusSchema("Status", ["Nothing", "In Progress", "Completed", "Slipped"]));

  await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "not-started");
  await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "in-progress");
  await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "completed");
  await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "slipped");

  // "completed" also emits a second (Trash) call with no `properties` at all
  // — filter to only the calls that actually wrote the Status property.
  const statusNames = client.updateCalls
    .filter((c) => c.properties !== undefined)
    .map((c) => (c.properties as Record<string, { status?: { name?: string } }>)["Status"]?.status?.name);
  assert.deepEqual(statusNames, ["Nothing", "In Progress", "Completed", "Slipped"]);
});

test("setTaskStatus resolves a live Status option that's been renamed from the hardcoded default — e.g. Spencer's real 'Not Started' -> 'Nothing' rename", async () => {
  // Spencer's real 2026-09-22 workspace: exactly these three live options, no "Slipped".
  const client = new FakeNotionFieldWriteClient(makeStatusSchema("Status", ["Nothing", "In Progress", "Completed"]));
  const result = await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "not-started");

  assert.equal(result.ok, true);
  const prop = (client.updateCalls[0]!.properties as Record<string, { status?: { name?: string } }>)["Status"];
  assert.equal(prop?.status?.name, "Nothing");
});

test("setTaskStatus fails clearly, and writes nothing, when the mapped Status option no longer exists live", async () => {
  // Same real three-option workspace — "Slipped" has no live match any more.
  const client = new FakeNotionFieldWriteClient(makeStatusSchema("Status", ["Nothing", "In Progress", "Completed"]));
  const result = await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "slipped");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /no existing "Status" option is a close enough match/);
  assert.equal(client.updateCalls.length, 0, "a write that can't be confidently resolved must never reach Notion");
});

test("setTaskStatus writes the Status property only and never sets in_trash, for a 'completed' confirmation (AD-12, reverted 2026-09-25)", async () => {
  const client = new FakeNotionFieldWriteClient(makeStatusSchema("Status", ["Nothing", "In Progress", "Completed"]));
  const result = await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "completed");

  assert.equal(result.ok, true);
  assert.equal(client.updateCalls.length, 1, "exactly one write: the Status property — no second Trash write, from any trigger");
  const call = client.updateCalls[0]!;
  assert.equal((call as unknown as { in_trash?: boolean }).in_trash, undefined);
  assert.equal((call.properties as Record<string, { status?: { name?: string } }>)["Status"]?.status?.name, "Completed");
});

test("setTaskStatus never sets in_trash for any status, from any trigger", async () => {
  const client = new FakeNotionFieldWriteClient(makeStatusSchema("Status", ["Nothing", "In Progress", "Completed", "Slipped"]));
  for (const status of ["not-started", "in-progress", "completed", "slipped"] as const) {
    await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", status);
  }
  assert.equal(client.updateCalls.length, 4, "exactly one write per status call, never a second Trash call for any of them");
  for (const call of client.updateCalls) {
    assert.equal((call as unknown as { in_trash?: boolean }).in_trash, undefined);
  }
});

test("setTaskStatus returns a Result failure (not a throw) when the Notion SDK call fails — AD-12's deliberate AD-8 exception", async () => {
  const client = new FakeNotionFieldWriteClient(makeStatusSchema("Status", ["Completed"]), {
    throwOnUpdate: new Error("notion: 500 internal server error"),
  });

  const result = await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "completed");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /notion/i);
  assert.equal(result.error.kind, "unreachable");
});

test("setTaskStatus honors a custom taskPropertyNames.status override", async () => {
  const client = new FakeNotionFieldWriteClient(makeStatusSchema("Task Status", ["Completed"]));
  const config = {
    tasksDataSourceId: "tasks-ds",
    taskPropertyNames: { ...(await import("../src/adapters/notion-adapter.ts")).DEFAULT_TASK_PROPERTY_NAMES, status: "Task Status" },
  };

  await setTaskStatus(client, config, "task-1", "completed");

  const call = client.updateCalls[0]!;
  assert.deepEqual(Object.keys(call.properties ?? {}), ["Task Status"]);
});

test("AD-12: notion-adapter.ts's write surface is exactly setTaskStatus + updateTaskField + createPage — no generic 'update or create any Notion property/page' function exists", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "adapters", "notion-adapter.ts"), "utf8");
  const updateCallSites = source.match(/\.pages\.update\(/g) ?? [];
  assert.equal(updateCallSites.length, 1, "expected exactly one `client.pages.update(` call site: writePageProperty's single shared field-writer — setTaskStatus no longer trashes on completion (AD-12, reverted 2026-09-25)");
  const createCallSites = source.match(/\.pages\.create\(/g) ?? [];
  assert.equal(createCallSites.length, 1, "expected exactly one `client.pages.create(` call site: createPage's own (Story 6.3)");
  assert.doesNotMatch(source, /\.dataSources\.update\(|\.pages\.move\(/, "no other write/update capability may exist anywhere in this file (AD-12)");
  assert.doesNotMatch(source, /in_trash/, "AD-12 (reverted 2026-09-25): no Phase 2 capability deletes anything from Notion — in_trash is never sent from any trigger");
});

// ============================================================================
// updateTaskField (FR-24 / AD-12 revised) — the schema-checked write for
// the other four PlanningFieldNames (Estimated Duration, Area, Due Date,
// Energy); Status still delegates to setTaskStatus, unchanged.
// ============================================================================

// `FakeNotionFieldWriteClient`/`makeSelectSchema`/`makeRichTextSchema` now
// live above, right before the `setTaskStatus` tests — moved there once
// `setTaskStatus` also became schema-checked in the same revision.

const FIELD_WRITE_CONFIG: NotionFieldWriteConfig = { tasksDataSourceId: "tasks-ds" };

test("updateTaskField writes Estimated Duration as a number property", async () => {
  const client = new FakeNotionFieldWriteClient(makeSelectSchema("Estimated Duration", []));
  const result = await updateTaskField(client, FIELD_WRITE_CONFIG, "task-1", "estimatedDurationMinutes", 45);

  assert.equal(result.ok, true);
  const call = client.updateCalls[0]!;
  assert.equal(call.page_id, "task-1");
  assert.deepEqual(call.properties, { "Estimated Duration": { number: 45 } });
});

test("updateTaskField writes Due Date as a date property", async () => {
  const client = new FakeNotionFieldWriteClient(makeSelectSchema("Due Date", []));
  const result = await updateTaskField(client, FIELD_WRITE_CONFIG, "task-1", "dueDate", "2026-09-20");

  assert.equal(result.ok, true);
  assert.deepEqual(client.updateCalls[0]!.properties, { "Due Date": { date: { start: "2026-09-20" } } });
});

test("updateTaskField delegates Status to setTaskStatus's own mapping, which is itself schema-checked", async () => {
  const client = new FakeNotionFieldWriteClient(makeStatusSchema("Status", ["Completed"]));
  const result = await updateTaskField(client, FIELD_WRITE_CONFIG, "task-1", "status", "completed");

  assert.equal(result.ok, true);
  assert.equal(client.retrieveCalls.length, 1, "setTaskStatus resolves its option against the live schema, same as Area/Energy");
  const prop = (client.updateCalls[0]!.properties as Record<string, { status?: { name?: string } }>)["Status"];
  assert.equal(prop?.status?.name, "Completed");
});

test("updateTaskField writes Area directly when the live property is rich_text — no option matching needed", async () => {
  const client = new FakeNotionFieldWriteClient(makeRichTextSchema("Area"));
  const result = await updateTaskField(client, FIELD_WRITE_CONFIG, "task-1", "area", "Finance");

  assert.equal(result.ok, true);
  const prop = (client.updateCalls[0]!.properties as Record<string, { rich_text?: Array<{ text?: { content?: string } }> }>)["Area"];
  assert.equal(prop?.rich_text?.[0]?.text?.content, "Finance");
});

test("updateTaskField writes Area's exact-matching live select option", async () => {
  const client = new FakeNotionFieldWriteClient(makeSelectSchema("Area", ["Finance", "Health", "Work"]));
  const result = await updateTaskField(client, FIELD_WRITE_CONFIG, "task-1", "area", "Finance");

  assert.equal(result.ok, true);
  const prop = (client.updateCalls[0]!.properties as Record<string, { select?: { name?: string } }>)["Area"];
  assert.equal(prop?.select?.name, "Finance");
});

test("updateTaskField autocorrects a typo'd Area answer to the nearest real live select option, never writing the raw typo", async () => {
  const client = new FakeNotionFieldWriteClient(makeSelectSchema("Area", ["Finance", "Health", "Work"]));
  const result = await updateTaskField(client, FIELD_WRITE_CONFIG, "task-1", "area", "Financ");

  assert.equal(result.ok, true);
  const prop = (client.updateCalls[0]!.properties as Record<string, { select?: { name?: string } }>)["Area"];
  assert.equal(prop?.select?.name, "Finance");
});

test("updateTaskField fails (not a throw) rather than writing or inventing a new Area select option when nothing live is a close match", async () => {
  const client = new FakeNotionFieldWriteClient(makeSelectSchema("Area", ["Finance", "Health", "Work"]));
  const result = await updateTaskField(client, FIELD_WRITE_CONFIG, "task-1", "area", "Astronomy");

  assert.equal(result.ok, false);
  assert.equal(client.updateCalls.length, 0, "no write may happen when the answer can't be confidently matched to a real option");
  if (!result.ok) assert.equal(result.error.kind, "validation");
});

test("updateTaskField resolves Energy through the configured real-option-name mapping against the live select options", async () => {
  const client = new FakeNotionFieldWriteClient(makeSelectSchema("Energy", ["Deep", "medium", "low"]));
  const result = await updateTaskField(client, FIELD_WRITE_CONFIG, "task-1", "energy", "high");

  assert.equal(result.ok, true);
  const prop = (client.updateCalls[0]!.properties as Record<string, { select?: { name?: string } }>)["Energy"];
  assert.equal(prop?.select?.name, "Deep");
});

test("updateTaskField returns a Result failure (not a throw) when the Notion SDK write call fails", async () => {
  const client = new FakeNotionFieldWriteClient(makeSelectSchema("Estimated Duration", []), {
    throwOnUpdate: new Error("notion: 500 internal server error"),
  });
  const result = await updateTaskField(client, FIELD_WRITE_CONFIG, "task-1", "estimatedDurationMinutes", 30);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "unreachable");
});

// ============================================================================
// Research Vault schema (Story 6.1)
// ============================================================================

test("DEFAULT_RESEARCH_VAULT_PROPERTY_NAMES matches Spencer's confirmed live Research Vault schema", () => {
  assert.deepEqual(DEFAULT_RESEARCH_VAULT_PROPERTY_NAMES, {
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
  });
});

// ============================================================================
// resolveNotionPageDraftProperties / createPage (Story 6.3 / FR-26, AD-12)
// ============================================================================

const CREATE_PAGE_CONFIG: NotionCreatePageConfig = {
  tasksDataSourceId: "tasks-ds",
  projectsDataSourceId: "projects-ds",
  researchVaultDataSourceId: "research-vault-ds",
};

function fakeSchemaFor(id: string, properties: DataSourceObjectResponse["properties"]): DataSourceObjectResponse {
  return {
    object: "data_source",
    id,
    title: [],
    description: [],
    parent: { type: "database_id", database_id: `${id}-db` },
    database_parent: { type: "database_id", database_id: `${id}-db` },
    is_inline: false,
    in_trash: false,
    archived: false,
    created_time: "2026-08-01T09:00:00.000Z",
    last_edited_time: "2026-08-01T09:00:00.000Z",
    created_by: FAKE_USER,
    last_edited_by: FAKE_USER,
    icon: null,
    cover: null,
    url: `https://notion.so/${id}`,
    public_url: null,
    properties,
  } as unknown as DataSourceObjectResponse;
}

function fakeCreatePageClient(
  schemasByDataSourceId: Readonly<Record<string, DataSourceObjectResponse>>,
  options: { readonly throwOnCreate?: Error } = {},
): NotionCreatePageClient & {
  readonly createCalls: Array<{ readonly parent: unknown; readonly properties: unknown }>;
} {
  const createCalls: Array<{ parent: unknown; properties: unknown }> = [];
  return {
    createCalls,
    dataSources: {
      retrieve: (async ({ data_source_id }: { data_source_id: string }) => {
        const schema = schemasByDataSourceId[data_source_id];
        if (!schema) throw new Error(`no fake schema configured for data source "${data_source_id}"`);
        return schema;
      }) as NotionCreatePageClient["dataSources"]["retrieve"],
    },
    pages: {
      create: (async (args: { parent: unknown; properties: unknown }) => {
        createCalls.push(args);
        if (options.throwOnCreate) throw options.throwOnCreate;
        return { object: "page", id: "new-page-id", url: "https://notion.so/new-page-id" };
      }) as NotionCreatePageClient["pages"]["create"],
    },
  };
}

const TASKS_SCHEMA = fakeSchemaFor("tasks-ds", {
  Name: { id: "title", name: "Name", description: null, type: "title", title: {} },
  "Estimated Duration": { id: "dur", name: "Estimated Duration", description: null, type: "number", number: { format: "number" } },
  Area: {
    id: "area",
    name: "Area",
    description: null,
    type: "select",
    select: { options: [{ id: "1", name: "Work", color: "blue", description: null }, { id: "2", name: "Health", color: "green", description: null }] },
  },
  "Due Date": { id: "due", name: "Due Date", description: null, type: "date", date: {} },
  Status: {
    id: "status",
    name: "Status",
    description: null,
    type: "status",
    status: { options: [{ id: "1", name: "Not Started", color: "gray", description: null }], groups: [] },
  },
  Energy: {
    id: "energy",
    name: "Energy",
    description: null,
    type: "select",
    select: { options: [{ id: "1", name: "Low", color: "gray", description: null }, { id: "2", name: "High", color: "red", description: null }] },
  },
} as unknown as DataSourceObjectResponse["properties"]);

const PROJECTS_SCHEMA = fakeSchemaFor("projects-ds", {
  Name: { id: "title", name: "Name", description: null, type: "title", title: {} },
} as unknown as DataSourceObjectResponse["properties"]);

const RESEARCH_VAULT_SCHEMA = fakeSchemaFor("research-vault-ds", {
  "Research Title": { id: "title", name: "Research Title", description: null, type: "title", title: {} },
  "Key Findings": { id: "kf", name: "Key Findings", description: null, type: "rich_text", rich_text: {} },
  Query: { id: "q", name: "Query", description: null, type: "rich_text", rich_text: {} },
  Date: { id: "date", name: "Date", description: null, type: "date", date: {} },
  Sources: { id: "src", name: "Sources", description: null, type: "rich_text", rich_text: {} },
  Status: { id: "status", name: "Status", description: null, type: "select", select: { options: [{ id: "1", name: "Draft", color: "gray", description: null }] } },
  Area: {
    id: "area",
    name: "Area",
    description: null,
    type: "select",
    select: { options: [{ id: "1", name: "Reading/Learning", color: "blue", description: null }] },
  },
  Confidence: { id: "conf", name: "Confidence", description: null, type: "select", select: { options: [{ id: "1", name: "High", color: "green", description: null }] } },
  "Open Questions": { id: "oq", name: "Open Questions", description: null, type: "rich_text", rich_text: {} },
} as unknown as DataSourceObjectResponse["properties"]);

const ALL_CREATE_PAGE_SCHEMAS: Record<string, DataSourceObjectResponse> = {
  "tasks-ds": TASKS_SCHEMA,
  "projects-ds": PROJECTS_SCHEMA,
  "research-vault-ds": RESEARCH_VAULT_SCHEMA,
};

test("resolveNotionPageDraftProperties succeeds for a valid Tasks draft, resolving Area's select fuzzy-match", async () => {
  const client = fakeCreatePageClient(ALL_CREATE_PAGE_SCHEMAS);
  const result = await resolveNotionPageDraftProperties(client, CREATE_PAGE_CONFIG, "Tasks", {
    title: "Buy hiking boots",
    area: "wrk",
    estimatedDurationMinutes: "30",
  });
  assert.equal(result.ok, true);
});

test("resolveNotionPageDraftProperties fails closed when a select-backed value has no close live match, never guessing", async () => {
  const client = fakeCreatePageClient(ALL_CREATE_PAGE_SCHEMAS);
  const result = await resolveNotionPageDraftProperties(client, CREATE_PAGE_CONFIG, "Tasks", {
    title: "Buy hiking boots",
    area: "Astronomy",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "validation");
});

test("resolveNotionPageDraftProperties fails closed when title is missing", async () => {
  const client = fakeCreatePageClient(ALL_CREATE_PAGE_SCHEMAS);
  const result = await resolveNotionPageDraftProperties(client, CREATE_PAGE_CONFIG, "Projects", {});
  assert.equal(result.ok, false);
});

test("resolveNotionPageDraftProperties fails closed for an internal field name not recognized for that database", async () => {
  const client = fakeCreatePageClient(ALL_CREATE_PAGE_SCHEMAS);
  const result = await resolveNotionPageDraftProperties(client, CREATE_PAGE_CONFIG, "Projects", {
    title: "New initiative",
    estimatedDurationMinutes: "30",
  });
  assert.equal(result.ok, false);
});

test("resolveNotionPageDraftProperties never calls pages.create — validation only, no write", async () => {
  const client = fakeCreatePageClient(ALL_CREATE_PAGE_SCHEMAS);
  await resolveNotionPageDraftProperties(client, CREATE_PAGE_CONFIG, "Tasks", { title: "X" });
  assert.equal(client.createCalls.length, 0);
});

// Real-use fixes plan, Task 3 (AD-12 backstop): a `date`-typed property
// rejects any value that isn't a real ISO date/datetime — the incident this
// guards against is a draft that carried the literal, never-resolved text
// "tomorrow at 10:45 AM" as Due Date, shown to Spencer and confirmed before
// Notion's own write-time check ever caught it.
test("resolveNotionPageDraftProperties rejects a non-ISO date value for a date-typed property (the incident: an unresolved relative phrase)", async () => {
  const client = fakeCreatePageClient(ALL_CREATE_PAGE_SCHEMAS);
  const result = await resolveNotionPageDraftProperties(client, CREATE_PAGE_CONFIG, "Tasks", {
    title: "Lab report draft",
    dueDate: "tomorrow at 10:45 AM",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.kind, "validation");
    assert.match(result.error.message, /ISO date/);
  }
});

test("resolveNotionPageDraftProperties accepts a bare ISO date for a date-typed property", async () => {
  const client = fakeCreatePageClient(ALL_CREATE_PAGE_SCHEMAS);
  const result = await resolveNotionPageDraftProperties(client, CREATE_PAGE_CONFIG, "Tasks", {
    title: "Lab report draft",
    dueDate: "2026-09-28",
  });
  assert.equal(result.ok, true);
});

test("resolveNotionPageDraftProperties accepts a full ISO datetime for a date-typed property", async () => {
  const client = fakeCreatePageClient(ALL_CREATE_PAGE_SCHEMAS);
  const result = await resolveNotionPageDraftProperties(client, CREATE_PAGE_CONFIG, "Tasks", {
    title: "Lab report draft",
    dueDate: "2026-09-28T17:45:00.000Z",
  });
  assert.equal(result.ok, true);
});

test("createPage creates a page in the target database's data source and returns its id/url", async () => {
  const client = fakeCreatePageClient(ALL_CREATE_PAGE_SCHEMAS);
  const result = await createPage(client, CREATE_PAGE_CONFIG, "ResearchVault", {
    title: "Best hiking boots",
    keyFindings: "Salomon and Merrell both test well.",
    searchDate: "2026-09-18",
    sources: "https://example.com",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.pageId, "new-page-id");
  assert.deepEqual(client.createCalls[0]!.parent, { data_source_id: "research-vault-ds" });
  const props = client.createCalls[0]!.properties as Record<string, unknown>;
  assert.ok("Research Title" in props);
  assert.ok("Key Findings" in props);
});

test("createPage re-validates at write time and fails closed exactly like the draft-time check, never writing an unresolved select", async () => {
  const client = fakeCreatePageClient(ALL_CREATE_PAGE_SCHEMAS);
  const result = await createPage(client, CREATE_PAGE_CONFIG, "Tasks", { title: "X", area: "Astronomy" });
  assert.equal(result.ok, false);
  assert.equal(client.createCalls.length, 0, "no write may happen when a property can't be confidently resolved");
});

test("createPage propagates a pages.create failure as a Result failure, not a throw", async () => {
  const client = fakeCreatePageClient(ALL_CREATE_PAGE_SCHEMAS, { throwOnCreate: new Error("notion: 500") });
  const result = await createPage(client, CREATE_PAGE_CONFIG, "Projects", { title: "New initiative" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "unreachable");
});

test("F4 regression: a 5,000-character search answer is chunked into <=2,000-char rich_text segments instead of failing (Notion rejects a single text.content over 2,000 chars)", async () => {
  const client = fakeCreatePageClient(ALL_CREATE_PAGE_SCHEMAS);
  const longAnswer = "a".repeat(5000);

  const result = await createPage(client, CREATE_PAGE_CONFIG, "ResearchVault", {
    title: "Best hiking boots",
    keyFindings: longAnswer,
    searchDate: "2026-09-18",
    sources: "",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const props = client.createCalls[0]!.properties as Record<string, { rich_text: Array<{ text: { content: string } }> }>;
  const segments = props["Key Findings"]!.rich_text;
  assert.ok(segments.length >= 3, `expected at least 3 <=2,000-char segments for 5,000 chars, got ${segments.length}`);
  for (const segment of segments) {
    assert.ok(segment.text.content.length <= 2000, `segment of ${segment.text.content.length} chars exceeds Notion's 2,000-char limit`);
  }
  assert.equal(segments.map((s) => s.text.content).join(""), longAnswer, "chunking must not lose, reorder, or duplicate any content");
});

test("F4 regression: createPage classifies a Notion 400 (validation_error) API response as YohError.kind 'validation', not 'unreachable'", async () => {
  const notion400 = new APIResponseError({
    code: APIErrorCode.ValidationError,
    status: 400,
    message: "body.properties.Key Findings.rich_text[0].text.content.length should be ≤ 2000, instead was 5000.",
    headers: {},
    rawBodyText: "",
    additional_data: undefined,
    request_id: undefined,
  });
  const client = fakeCreatePageClient(ALL_CREATE_PAGE_SCHEMAS, { throwOnCreate: notion400 });

  const result = await createPage(client, CREATE_PAGE_CONFIG, "Projects", { title: "New initiative" });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "validation");
});
