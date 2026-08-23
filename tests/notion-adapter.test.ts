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
import type {
  PageObjectResponse,
  QueryDataSourceParameters,
  QueryDataSourceResponse,
} from "@notionhq/client";
import { readNotionTasks, type NotionDataSourceClient } from "../src/adapters/notion-adapter.ts";

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
