/**
 * tests/fakes/fake-notion-create-client.ts
 *
 * Story 8.8: a minimal in-memory `NotionCreatePageClient` (schema retrieve +
 * page create) for the Tasks database only — everything the Playwright
 * capture-flow smoke (`tests/e2e/fixture-server.ts`) needs to exercise the
 * REAL `app/create-item.ts` `draftItem` -> `openProposal` ->
 * `confirmProposal` -> `createPage` pipeline end to end, without touching a
 * real Notion workspace. Mirrors `tests/create-item.test.ts`'s own
 * `fakeTasksClient` fixture (a full-shaped data source object —
 * `resolveNotionPageDraftProperties`'s own `isFullDataSource` guard rejects
 * anything less).
 */
import type { GetDataSourceResponse, CreatePageResponse } from "@notionhq/client/build/src/api-endpoints.js";
import type { NotionCreatePageClient } from "../../src/adapters/notion-adapter.ts";

export interface FakeCreatedPage {
  readonly database: string;
  readonly title: string;
}

export interface FakeNotionCreateClient {
  readonly client: NotionCreatePageClient;
  /** Every page created, in order — read by the fixture's `/__fixture/state` endpoint (Review Focus #3: empty until Spencer actually confirms). */
  readonly createdPages: FakeCreatedPage[];
}

const TASKS_SCHEMA = {
  object: "data_source",
  id: "tasks-ds",
  title: [],
  description: [],
  parent: { type: "database_id", database_id: "tasks-ds-db" },
  database_parent: { type: "database_id", database_id: "tasks-ds-db" },
  is_inline: false,
  in_trash: false,
  archived: false,
  created_time: "2026-08-01T09:00:00.000Z",
  last_edited_time: "2026-08-01T09:00:00.000Z",
  created_by: { object: "user", id: "user-1" },
  last_edited_by: { object: "user", id: "user-1" },
  icon: null,
  cover: null,
  url: "https://notion.so/tasks-ds",
  public_url: null,
  properties: {
    Name: { id: "title", name: "Name", description: null, type: "title", title: {} },
  },
} as unknown as GetDataSourceResponse;

export function createFakeNotionCreateClient(): FakeNotionCreateClient {
  const createdPages: FakeCreatedPage[] = [];
  const client: NotionCreatePageClient = {
    dataSources: { retrieve: (async () => TASKS_SCHEMA) as NotionCreatePageClient["dataSources"]["retrieve"] },
    pages: {
      create: (async (params: { properties: Record<string, unknown> }) => {
        const titleProp = params.properties["Name"] as { title?: Array<{ text: { content: string } }> } | undefined;
        const title = titleProp?.title?.[0]?.text.content ?? "";
        createdPages.push({ database: "Tasks", title });
        return { id: `page-${createdPages.length}`, object: "page" } as CreatePageResponse;
      }) as NotionCreatePageClient["pages"]["create"],
    },
  };
  return { client, createdPages };
}
