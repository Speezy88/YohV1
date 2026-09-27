/**
 * Tests for Task 6C's slice of `src/shell/server.ts`: `GET /api/research` —
 * pure transport over `app/research-list.ts`'s `listResearch`. In-process
 * via `app.request(...)`, no real Notion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { createApp, type ServerDeps } from "../src/shell/server.ts";
import type { ResearchVaultRecord } from "../src/types/domain.ts";

function setup(withResearch = true) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const records: ResearchVaultRecord[] = [
    { id: "rv-1", title: "AP Bio registration deadline", date: "2026-09-20", sourceCount: 2, url: "https://notion.so/rv-1" },
    { id: "rv-2", title: "Best hiking boots under $150", date: "2026-09-10", sourceCount: 1, url: "https://notion.so/rv-2" },
  ];
  const research: NonNullable<ServerDeps["research"]> = { readResearchVault: async () => records };
  const app = createApp({ connection, log: () => {}, ...(withResearch ? { research } : {}) });
  return { app, connection };
}

type Envelope = { ok: boolean; value?: Record<string, unknown>; error?: { kind: string; message: string } };

async function get(app: ReturnType<typeof createApp>, path: string): Promise<{ status: number; body: Envelope }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as Envelope };
}

test("GET /api/research lists the Research Vault, most recent first", async () => {
  const { app } = setup();
  const { status, body } = await get(app, "/api/research");
  assert.equal(status, 200);
  assert.ok(body.ok);
  const value = body.value as { items: Array<{ id: string }> };
  assert.deepEqual(
    value.items.map((i) => i.id),
    ["rv-1", "rv-2"],
  );
});

test("GET /api/research without Notion configured is a clear unreachable error, not a 500", async () => {
  const { app } = setup(false);
  const { status, body } = await get(app, "/api/research");
  assert.equal(status, 503);
  assert.equal(body.error?.kind, "unreachable");
  assert.match(body.error!.message, /Notion connection isn't configured/);
});

test("GET /api/research maps a Notion read failure to an honest unreachable error", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const research: NonNullable<ServerDeps["research"]> = {
    readResearchVault: async () => {
      throw new Error("notion-adapter: socket hang up");
    },
  };
  const app = createApp({ connection, log: () => {}, research });
  const { status, body } = await get(app, "/api/research");
  assert.equal(status, 503);
  assert.equal(body.error?.kind, "unreachable");
  assert.equal(body.error?.message, "I couldn't reach Notion right now; nothing was changed.");
});
