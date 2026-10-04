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
    { id: "rv-1", title: "AP Bio registration deadline", date: "2026-09-20", keyFindings: "Deadline is Oct 1.\n\nRegister online.", sources: ["https://a.example", "https://b.example"], sourceCount: 2, url: "https://notion.so/rv-1" },
    { id: "rv-2", title: "Best hiking boots under $150", date: "2026-09-10", keyFindings: "Get Salomon.", sources: ["https://c.example"], sourceCount: 1, url: "https://notion.so/rv-2" },
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

test("GET /api/research reports hasMore and honours ?pages=", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const records: ResearchVaultRecord[] = Array.from({ length: 45 }, (_, i) => ({
    id: `r-${i}`,
    title: `r-${i}`,
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    keyFindings: "",
    sources: [],
    sourceCount: 0,
    url: `https://notion.so/r-${i}`,
  }));
  const app = createApp({ connection, log: () => {}, research: { readResearchVault: async () => records } });
  const one = await get(app, "/api/research");
  assert.equal((one.body.value as { items: unknown[] }).items.length, 20);
  assert.equal(one.body.value?.hasMore, true);
  const two = await get(app, "/api/research?pages=2");
  assert.equal((two.body.value as { items: unknown[] }).items.length, 40);
  const three = await get(app, "/api/research?pages=3");
  assert.equal((three.body.value as { items: unknown[] }).items.length, 45);
  assert.equal(three.body.value?.hasMore, false);
  const bad = await get(app, "/api/research?pages=abc");
  assert.equal((bad.body.value as { items: unknown[] }).items.length, 20);
});

test("GET /api/research/document returns the document by id", async () => {
  const { app } = setup();
  const { status, body } = await get(app, "/api/research/document?id=rv-2");
  assert.equal(status, 200);
  assert.ok(body.ok);
  assert.deepEqual(body.value, {
    document: { id: "rv-2", title: "Best hiking boots under $150", date: "2026-09-10", body: "Get Salomon.", sources: ["https://c.example"], url: "https://notion.so/rv-2" },
  });
});

test("GET /api/research/document with no or unknown id returns the most recent document", async () => {
  const { app } = setup();
  for (const path of ["/api/research/document", "/api/research/document?id=nope"]) {
    const { body } = await get(app, path);
    assert.equal((body.value as { document: { id: string } }).document.id, "rv-1");
  }
});

test("GET /api/research/document on an empty vault is a success with no document", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const app = createApp({ connection, log: () => {}, research: { readResearchVault: async () => [] } });
  const { status, body } = await get(app, "/api/research/document");
  assert.equal(status, 200);
  assert.ok(body.ok);
  assert.deepEqual(body.value, {});
});

test("GET /api/research/document without Notion configured is a clear unreachable error", async () => {
  const { app } = setup(false);
  const { status, body } = await get(app, "/api/research/document");
  assert.equal(status, 503);
  assert.match(body.error!.message, /Notion connection isn't configured/);
});

test("GET /api/research/document maps a Notion failure to an honest unreachable error", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const research: NonNullable<ServerDeps["research"]> = {
    readResearchVault: async () => {
      throw new Error("notion-adapter: socket hang up");
    },
  };
  const app = createApp({ connection, log: () => {}, research });
  const { status, body } = await get(app, "/api/research/document?id=x");
  assert.equal(status, 503);
  assert.equal(body.error?.message, "I couldn't reach Notion right now; nothing was changed.");
});
