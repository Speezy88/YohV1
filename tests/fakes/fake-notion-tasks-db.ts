/**
 * tests/fakes/fake-notion-tasks-db.ts
 *
 * Task 6B: an in-memory stand-in for Spencer's whole Notion Tasks data
 * source — the four `@notionhq/client` calls the Tasks page's read and
 * write paths reach (`dataSources.query`, `dataSources.retrieve`,
 * `pages.create`, `pages.update`). Its schema mirrors the real workspace's
 * shape (a title, a number, an Area select, a date, a native Status, an
 * Energy select with Spencer's own "Deep"/"medium"/"low" names), so the
 * REAL `readNotionTasks`, `readTaskFieldOptions`, `updateTaskField`,
 * `resolveNotionPageDraftProperties` and `createPage` all run against it
 * unchanged. Shared by the node tests and the Playwright fixture server
 * (`tests/e2e/fixture-server.ts`) so neither ever reaches a real workspace.
 */
import type { NotionCreatePageClient, NotionDataSourceClient, NotionSchemaClient, NotionWriteClient } from "../../src/adapters/notion-adapter.ts";

export interface FakeTaskSeed {
  readonly id: string;
  readonly title: string;
  readonly dueDate?: string;
  readonly minutes?: number;
  readonly area?: string;
  /** The live Energy option NAME (e.g. "Deep"), not Yoh's enum value. */
  readonly energy?: string;
  /** The live Status option NAME (e.g. "Nothing"), not Yoh's enum value. */
  readonly status?: string;
  /** Task 7: the live Priority option NAME verbatim (e.g. "🔴 High"). */
  readonly priority?: string;
}

export interface FakeTasksDbOptions {
  readonly areaOptions?: readonly string[];
  readonly energyOptions?: readonly string[];
  readonly statusOptions?: readonly string[];
  readonly priorityOptions?: readonly string[];
  readonly seed?: readonly FakeTaskSeed[];
}

export type FakeTasksDbClient = NotionDataSourceClient & NotionSchemaClient & NotionWriteClient & NotionCreatePageClient;

export interface FakeTasksDb {
  readonly client: FakeTasksDbClient;
  /** Current rows, in creation order. */
  rows(): readonly FakeTaskSeed[];
  /** Every `pages.update` properties payload, in order. */
  readonly updates: Array<{ readonly pageId: string; readonly properties: Record<string, unknown> }>;
  /** While `true`, `pages.update` and `pages.create` throw, as a Notion outage would. */
  setFailingWrites(failing: boolean): void;
}

const EPOCH = "2026-09-01T09:00:00.000Z";

type Prop = Record<string, unknown>;

function toPage(row: FakeTaskSeed): Record<string, unknown> {
  const properties: Record<string, Prop> = {
    Name: { id: "title", type: "title", title: [{ type: "text", plain_text: row.title, text: { content: row.title } }] },
    "Estimated Duration": { id: "dur", type: "number", number: row.minutes ?? null },
    Area: { id: "area", type: "select", select: row.area ? { id: `a-${row.area}`, name: row.area, color: "default" } : null },
    "Due Date": { id: "due", type: "date", date: row.dueDate ? { start: row.dueDate, end: null, time_zone: null } : null },
    Status: { id: "status", type: "status", status: row.status ? { id: `s-${row.status}`, name: row.status, color: "default" } : null },
    Energy: { id: "energy", type: "select", select: row.energy ? { id: `e-${row.energy}`, name: row.energy, color: "default" } : null },
    Priority: { id: "priority", type: "select", select: row.priority ? { id: `p-${row.priority}`, name: row.priority, color: "default" } : null },
    Project: { id: "proj", type: "relation", relation: [] },
  };
  return {
    object: "page",
    id: row.id,
    url: `https://notion.so/${row.id}`,
    created_time: EPOCH,
    last_edited_time: EPOCH,
    in_trash: false,
    archived: false,
    properties,
  };
}

function options(names: readonly string[]): Array<{ id: string; name: string; color: string; description: null }> {
  return names.map((name, i) => ({ id: `opt-${i}`, name, color: "default", description: null }));
}

/** Applies one Notion property write (the shapes `notion-adapter.ts` sends) onto a row. */
function applyProperty(row: FakeTaskSeed, name: string, value: Record<string, unknown>): FakeTaskSeed {
  const next: Record<string, unknown> = { ...row };
  if (name === "Name") next["title"] = (value["title"] as Array<{ text: { content: string } }>)[0]?.text.content ?? "";
  if (name === "Estimated Duration") next["minutes"] = value["number"] as number;
  if (name === "Due Date") next["dueDate"] = (value["date"] as { start: string }).start;
  if (name === "Area") next["area"] = (value["select"] as { name: string }).name;
  if (name === "Energy") next["energy"] = (value["select"] as { name: string }).name;
  if (name === "Priority") next["priority"] = (value["select"] as { name: string }).name;
  if (name === "Status") next["status"] = (value["status"] as { name: string }).name;
  return next as unknown as FakeTaskSeed;
}

export function createFakeNotionTasksDb(opts: FakeTasksDbOptions = {}): FakeTasksDb {
  const areaOptions = opts.areaOptions ?? ["School", "Bio", "Math", "Errands", "Personal"];
  const energyOptions = opts.energyOptions ?? ["Deep", "medium", "low"];
  const statusOptions = opts.statusOptions ?? ["Nothing", "In Progress", "Completed"];
  const priorityOptions = opts.priorityOptions ?? ["🔴 High", "🟡 Medium", "🟢 Low"];
  let rows: FakeTaskSeed[] = [...(opts.seed ?? [])];
  const updates: FakeTasksDb["updates"] = [];
  let failingWrites = false;
  let nextId = 1;

  const schema = {
    object: "data_source",
    id: "tasks-ds",
    title: [],
    description: [],
    parent: { type: "database_id", database_id: "tasks-db" },
    database_parent: { type: "database_id", database_id: "tasks-db" },
    is_inline: false,
    in_trash: false,
    archived: false,
    created_time: EPOCH,
    last_edited_time: EPOCH,
    created_by: { object: "user", id: "user-1" },
    last_edited_by: { object: "user", id: "user-1" },
    icon: null,
    cover: null,
    url: "https://notion.so/tasks-ds",
    public_url: null,
    properties: {
      Name: { id: "title", name: "Name", description: null, type: "title", title: {} },
      "Estimated Duration": { id: "dur", name: "Estimated Duration", description: null, type: "number", number: { format: "number" } },
      Area: { id: "area", name: "Area", description: null, type: "select", select: { options: options(areaOptions) } },
      "Due Date": { id: "due", name: "Due Date", description: null, type: "date", date: {} },
      Status: { id: "status", name: "Status", description: null, type: "status", status: { options: options(statusOptions), groups: [] } },
      Energy: { id: "energy", name: "Energy", description: null, type: "select", select: { options: options(energyOptions) } },
      Priority: { id: "priority", name: "Priority", description: null, type: "select", select: { options: options(priorityOptions) } },
    },
  };

  const client = {
    dataSources: {
      query: async (params: { data_source_id: string }) => ({
        object: "list",
        type: "page_or_data_source",
        // Projects (any other data source id) are an empty list here.
        results: params.data_source_id === "tasks-ds" ? rows.map(toPage) : [],
        has_more: false,
        next_cursor: null,
      }),
      retrieve: async () => schema,
    },
    pages: {
      update: async (args: { page_id: string; properties: Record<string, Record<string, unknown>> }) => {
        if (failingWrites) throw new Error("fake Notion: service unavailable");
        updates.push({ pageId: args.page_id, properties: args.properties });
        rows = rows.map((row) =>
          row.id === args.page_id ? Object.entries(args.properties).reduce((r, [name, value]) => applyProperty(r, name, value), row) : row,
        );
        return { object: "page", id: args.page_id };
      },
      create: async (args: { properties: Record<string, Record<string, unknown>> }) => {
        if (failingWrites) throw new Error("fake Notion: service unavailable");
        const id = `created-${nextId++}`;
        const row = Object.entries(args.properties).reduce<FakeTaskSeed>((r, [name, value]) => applyProperty(r, name, value), { id, title: "" });
        rows.push(row);
        return toPage(row);
      },
    },
  } as unknown as FakeTasksDbClient;

  return {
    client,
    rows: () => rows,
    updates,
    setFailingWrites: (failing) => {
      failingWrites = failing;
    },
  };
}
