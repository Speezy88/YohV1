/**
 * tests/fakes/fake-notion-status-client.ts
 *
 * Story 7.10: an in-memory stand-in for the slice of `@notionhq/client`
 * that `notion-adapter.ts`'s Status-only `setTaskStatus` touches
 * (`dataSources.retrieve` for the live Status options, `pages.update` for
 * the write). Shared by `tests/check-off-app.test.ts` and the Playwright
 * fixture server (`tests/e2e/fixture-server.ts`, Ruling R8) so neither
 * ever reaches a real Notion workspace.
 */
import type { DataSourceObjectResponse, UpdatePageParameters, UpdatePageResponse } from "@notionhq/client";
import type { NotionSchemaClient, NotionWriteClient } from "../../src/adapters/notion-adapter.ts";

export interface FakeStatusWrite {
  readonly taskId: string;
  /** The live Status option name written (e.g. `"Completed"`). */
  readonly status: string;
}

export interface FakeNotionStatusClient {
  readonly client: NotionWriteClient & NotionSchemaClient;
  /** Every successful Status write, in order. */
  readonly writes: FakeStatusWrite[];
  /** How many `pages.update` calls were attempted (successful or not). */
  attempts(): number;
  /** While `true`, `pages.update` throws, as a Notion outage would. */
  setFailing(failing: boolean): void;
  /** Runs just before each `pages.update` attempt — lets a test observe what was already durable at that instant. */
  onBeforeUpdate(listener: (taskId: string) => void): void;
}

const STATUS_OPTIONS = ["Nothing", "In Progress", "Completed"] as const;

export function createFakeNotionStatusClient(options: { readonly statusPropertyName?: string } = {}): FakeNotionStatusClient {
  const statusPropertyName = options.statusPropertyName ?? "Status";
  const writes: FakeStatusWrite[] = [];
  let attempts = 0;
  let failing = false;
  let beforeUpdate: (taskId: string) => void = () => {};

  const schema = {
    object: "data_source",
    id: "tasks-ds",
    title: [],
    properties: {
      [statusPropertyName]: {
        id: "status",
        name: statusPropertyName,
        type: "status",
        status: { options: STATUS_OPTIONS.map((name, i) => ({ id: `opt-${i}`, name, color: "default" })), groups: [] },
      },
    },
  } as unknown as DataSourceObjectResponse;

  const client = {
    pages: {
      update: async (args: UpdatePageParameters): Promise<UpdatePageResponse> => {
        attempts++;
        beforeUpdate(args.page_id);
        if (failing) throw new Error("fake Notion: service unavailable");
        const property = args.properties?.[statusPropertyName] as { status?: { name?: string } } | undefined;
        writes.push({ taskId: args.page_id, status: property?.status?.name ?? "" });
        return { object: "page", id: args.page_id } as UpdatePageResponse;
      },
    },
    dataSources: {
      retrieve: async (): Promise<DataSourceObjectResponse> => schema,
    },
  } as unknown as NotionWriteClient & NotionSchemaClient;

  return {
    client,
    writes,
    attempts: () => attempts,
    setFailing: (value) => {
      failing = value;
    },
    onBeforeUpdate: (listener) => {
      beforeUpdate = listener;
    },
  };
}
