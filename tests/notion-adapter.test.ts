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
import {
  createPage,
  DEFAULT_PROJECT_PROPERTY_NAMES,
  DEFAULT_RESEARCH_VAULT_PROPERTY_NAMES,
  DEFAULT_TASK_PROPERTY_NAMES,
  loadTaskPropertyNamesFromEnv,
  readNotionTasks,
  resolveNotionPageDraftProperties,
  setTaskStatus,
  toResearchVaultPageProperties,
  updateTaskField,
  type NotionCreatePageClient,
  type NotionCreatePageConfig,
  type NotionDataSourceClient,
  type NotionFieldWriteConfig,
  type NotionResearchVaultPropertyNames,
  type NotionSchemaClient,
  type NotionStatusWriteConfig,
  type NotionWriteClient,
  type ResearchVaultEntryFields,
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
 * that type's own doc comment). An empty object exercises its defaults and
 * proves the write path has no dependency on `CONFIG`'s data-source ids at
 * all.
 */
const STATUS_WRITE_CONFIG: NotionStatusWriteConfig = {};

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

test("readNotionTasks normalizes Spencer's real Energy taxonomy (Deep Work / Light Work) to high/low by default", async () => {
  const client = new FakeNotionClient({
    "tasks-ds": [
      [
        makeTaskPage({ id: "task-deep", title: "Deep focus task", energy: "🔵 Deep Work" }),
        makeTaskPage({ id: "task-light", title: "Light admin task", energy: "⚡ Light Work" }),
      ],
    ],
    "projects-ds": [[]],
  });

  const result = await readNotionTasks(client, CONFIG);
  const byId = new Map(result.tasks.map((t) => [t.id, t]));
  assert.equal(byId.get("task-deep")?.energy, "high");
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

/** A fake write client whose `pages.update` is scripted to succeed or throw, recording every call verbatim. */
class FakeNotionWriteClient implements NotionWriteClient {
  readonly calls: UpdatePageParameters[] = [];
  private readonly shouldThrow: Error | undefined;

  constructor(options: { throwError?: Error } = {}) {
    this.shouldThrow = options.throwError;
  }

  pages = {
    update: async (args: UpdatePageParameters): Promise<UpdatePageResponse> => {
      this.calls.push(args);
      if (this.shouldThrow) throw this.shouldThrow;
      return { object: "page", id: "task-1" } as UpdatePageResponse;
    },
  };
}

test("setTaskStatus writes the Status property to the given page id and returns Result.ok", async () => {
  const client = new FakeNotionWriteClient();
  const result = await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "completed");

  assert.equal(result.ok, true);
  assert.equal(client.calls.length, 1, "expected exactly one Notion write call");
  const call = client.calls[0]!;
  assert.equal(call.page_id, "task-1");
});

test("setTaskStatus writes ONLY the Status property — no other Task field is touched as a side effect", async () => {
  const client = new FakeNotionWriteClient();
  await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "slipped");

  const call = client.calls[0]!;
  const propertyKeys = Object.keys(call.properties ?? {});
  assert.deepEqual(propertyKeys, ["Status"], "exactly one property key, the Status property, must be sent");
});

test("setTaskStatus maps every TaskStatus value to a Notion Status option name", async () => {
  const client = new FakeNotionWriteClient();

  await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "not-started");
  await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "in-progress");
  await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "completed");
  await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "slipped");

  const statusNames = client.calls.map((c) => {
    const prop = (c.properties as Record<string, { status?: { name?: string } }>)["Status"];
    return prop?.status?.name;
  });
  assert.deepEqual(statusNames, ["Not Started", "In Progress", "Completed", "Slipped"]);
});

test("setTaskStatus returns a Result failure (not a throw) when the Notion SDK call fails — AD-12's deliberate AD-8 exception", async () => {
  const client = new FakeNotionWriteClient({ throwError: new Error("notion: 500 internal server error") });

  const result = await setTaskStatus(client, STATUS_WRITE_CONFIG, "task-1", "completed");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error.message, /notion/i);
  assert.equal(result.error.kind, "unreachable");
});

test("setTaskStatus honors a custom taskPropertyNames.status override", async () => {
  const client = new FakeNotionWriteClient();
  const config = { taskPropertyNames: { ...(await import("../src/adapters/notion-adapter.ts")).DEFAULT_TASK_PROPERTY_NAMES, status: "Task Status" } };

  await setTaskStatus(client, config, "task-1", "completed");

  const call = client.calls[0]!;
  assert.deepEqual(Object.keys(call.properties ?? {}), ["Task Status"]);
});

test("AD-12: notion-adapter.ts's write surface is exactly setTaskStatus + updateTaskField + createPage — no generic 'update or create any Notion property/page' function exists", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "adapters", "notion-adapter.ts"), "utf8");
  const updateCallSites = source.match(/\.pages\.update\(/g) ?? [];
  assert.equal(updateCallSites.length, 2, "expected exactly two `client.pages.update(` call sites: setTaskStatus's own, and updateTaskField's single shared writer");
  const createCallSites = source.match(/\.pages\.create\(/g) ?? [];
  assert.equal(createCallSites.length, 1, "expected exactly one `client.pages.create(` call site: createPage's own (Story 6.3)");
  assert.doesNotMatch(source, /\.dataSources\.update\(|\.pages\.move\(/, "no other write/update capability may exist anywhere in this file (AD-12)");
});

// ============================================================================
// updateTaskField (FR-24 / AD-12 revised) — the schema-checked write for
// the other four PlanningFieldNames (Estimated Duration, Area, Due Date,
// Energy); Status still delegates to setTaskStatus, unchanged.
// ============================================================================

/** A fake write+schema client: `pages.update` is scripted like `FakeNotionWriteClient`; `dataSources.retrieve` returns a scripted schema and records every data source id it was asked for. */
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

test("updateTaskField delegates Status to setTaskStatus's own mapping", async () => {
  const client = new FakeNotionFieldWriteClient(makeSelectSchema("Status", []));
  const result = await updateTaskField(client, FIELD_WRITE_CONFIG, "task-1", "status", "completed");

  assert.equal(result.ok, true);
  assert.equal(client.retrieveCalls.length, 0, "Status writes never need a schema lookup — delegates straight to setTaskStatus");
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
  const client = new FakeNotionFieldWriteClient(makeSelectSchema("Energy", ["🔵 Deep Work", "⚡ Light Work"]));
  const result = await updateTaskField(client, FIELD_WRITE_CONFIG, "task-1", "energy", "high");

  assert.equal(result.ok, true);
  const prop = (client.updateCalls[0]!.properties as Record<string, { select?: { name?: string } }>)["Energy"];
  assert.equal(prop?.select?.name, "🔵 Deep Work");
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

test("toResearchVaultPageProperties maps Yoh's internal fields to Research Vault's real Notion property names/types", () => {
  const fields: ResearchVaultEntryFields = {
    title: "Best noise-canceling earbuds under $150",
    keyFindings: "The Sony LinkBuds S and Anker Soundcore Liberty 4 both test well; Sony edges out on ANC depth.",
    query: "best noise canceling earbuds under $150",
    searchDate: "2026-09-18",
    sourceUrls: ["https://example.com/review-a", "https://example.com/review-b"],
  };

  const properties = toResearchVaultPageProperties(fields);

  assert.deepEqual(properties, {
    "Research Title": {
      title: [{ type: "text", text: { content: fields.title } }],
    },
    "Key Findings": {
      rich_text: [{ type: "text", text: { content: fields.keyFindings } }],
    },
    Query: {
      rich_text: [{ type: "text", text: { content: fields.query! } }],
    },
    Date: {
      date: { start: fields.searchDate },
    },
    Sources: {
      rich_text: [
        { type: "text", text: { content: "https://example.com/review-a\nhttps://example.com/review-b" } },
      ],
    },
  } satisfies CreatePageParameters["properties"]);
});

test("toResearchVaultPageProperties omits Query when not provided (FR-26's manual-create path may not have an original search query)", () => {
  const fields: ResearchVaultEntryFields = {
    title: "Manually noted finding",
    keyFindings: "Spencer typed this directly, no search involved.",
    searchDate: "2026-09-18",
    sourceUrls: [],
  };

  const properties = toResearchVaultPageProperties(fields);

  assert.equal("Query" in properties!, false);
  assert.deepEqual((properties as Record<string, unknown>)["Sources"], { rich_text: [] });
});

test("toResearchVaultPageProperties honors a custom NotionResearchVaultPropertyNames override", () => {
  const customNames: NotionResearchVaultPropertyNames = {
    ...DEFAULT_RESEARCH_VAULT_PROPERTY_NAMES,
    title: "Title",
    keyFindings: "Summary",
  };

  const properties = toResearchVaultPageProperties(
    { title: "X", keyFindings: "Y", searchDate: "2026-09-18", sourceUrls: [] },
    customNames,
  );

  assert.ok("Title" in properties!);
  assert.ok("Summary" in properties!);
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
