/**
 * tests/e2e/fixture-server.ts
 *
 * Story 7.10, controller Ruling R8: the test-only server the Playwright
 * smoke suite (`web/e2e/`) runs against. It is built on the SAME exported
 * seams production uses — `startServer` (and through it `createApp`) and
 * `startCheckOffCommitSweep` — wired to in-memory fakes: a fake Notion
 * client (`tests/fakes/fake-notion-status-client.ts`, so no real Notion
 * workspace is ever touched), a fixed Task list, no Calendar events, and a
 * throwaway SQLite file seeded with today's Plan, and (Story 8.5) a scripted
 * chat turn through `ServerDeps.chat.runChatTurn`. Production code has no
 * test switch; everything test-shaped lives here.
 *
 * It lives under `tests/`, not `web/e2e/`, because it imports server code
 * at runtime — `web/` may only `import type` from `src/types/` (AD-17,
 * `tests/web-import-rule.test.ts`).
 *
 * One fixture-only endpoint, answered before the app ever sees the request:
 * `GET /__fixture/state?taskId=…` → `{statusWrites, completedToday}`, what
 * the fake Notion recorded and what the Completion Log holds for that Task.
 *
 * Run from the repo root (the app serves `./web/dist`, built beforehand):
 *   YOH_SERVER_PORT=8788 node tests/e2e/fixture-server.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { openSqliteConnection } from "../../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../../src/adapters/notification-store.ts";
import { initPlanStateStoreSchema } from "../../src/adapters/plan-state-store.ts";
import { initCompletionLogSchema, listCompletedTaskIdsOnDate } from "../../src/adapters/completion-log.ts";
import { createMemoryStore, putPlan } from "../../src/adapters/memory-store.ts";
import { localIsoDate } from "../../src/rituals/ritual-shared.ts";
import { startCheckOffCommitSweep, startServer, type ChatTurnFn, type ServerDeps } from "../../src/shell/server.ts";
import type { Plan, Task } from "../../src/types/domain.ts";
import { createFakeNotionStatusClient } from "../fakes/fake-notion-status-client.ts";

/** The Tasks on today's fixture Plan — `web/e2e/check-off.spec.ts` checks these off by name. */
export const FIXTURE_TASKS = [
  { id: "e2e-undo", title: "E2E Undo Task" },
  { id: "e2e-commit", title: "E2E Commit Task" },
] as const;

const TIME_ZONE = "UTC";
const quiet = (): void => {};

const dir = mkdtempSync(join(tmpdir(), "yoh-e2e-"));
const connection = openSqliteConnection({ databasePath: join(dir, "yoh.db") });
initNotificationStoreSchema(connection.db);
initPlanStateStoreSchema(connection.db);
initCompletionLogSchema(connection.db);

const store = createMemoryStore(connection);
const startedAt = new Date();
const today = localIsoDate(startedAt, TIME_ZONE);
const plan: Plan = {
  id: `plan-${today}`,
  date: today,
  // Both blocks span "now" for the next few hours, so neither row is past (read-only).
  blocks: FIXTURE_TASKS.map((t, i) => ({
    id: `block-${t.id}`,
    kind: "work" as const,
    start: new Date(startedAt.getTime() - 10 * 60_000 + i * 60_000).toISOString(),
    end: new Date(startedAt.getTime() + 4 * 3_600_000 + i * 60_000).toISOString(),
    taskId: t.id,
    label: t.title,
  })),
  reasoning: "",
  version: 1,
  createdAt: startedAt.toISOString(),
  updatedAt: startedAt.toISOString(),
};
putPlan(store, plan);

const notion = createFakeNotionStatusClient();
const tasks = (): Task[] =>
  FIXTURE_TASKS.map((t) => ({
    id: t.id,
    title: t.title,
    area: "Personal",
    estimatedDurationMinutes: 30,
    status: notion.writes.some((w) => w.taskId === t.id && w.status === "Completed") ? ("completed" as const) : ("not-started" as const),
    createdAt: startedAt.toISOString(),
    updatedAt: startedAt.toISOString(),
  }));

const homeView: NonNullable<ServerDeps["homeView"]> = {
  store,
  readCalendarEvents: async () => [],
  readTasks: async () => ({ tasks: tasks() }),
  timeZone: TIME_ZONE,
};
const checkOff: NonNullable<ServerDeps["checkOff"]> = {
  store,
  timeZone: TIME_ZONE,
  notionClient: notion.client,
  notionStatusConfig: { tasksDataSourceId: "tasks-ds" },
  lookupTask: async (taskId) => tasks().find((t) => t.id === taskId),
};

/** `web/e2e/chat.spec.ts` asserts on this exact text. */
export const FIXTURE_CHAT_REPLY = "Hello, Spencer. This is a fixture reply, streamed in three chunks.";
const FIXTURE_CHAT_CHUNKS = ["Hello, Spencer. ", "This is a fixture reply, ", "streamed in three chunks."];
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Story 8.5 (controller ruling (c)): a scripted chat turn through the
// `runChatTurn` seam — never a fake Anthropic client, so the smoke doesn't
// drift with llm-adapter.ts's streaming shape. The pause before the first
// delta keeps the Thinking Indicator on screen long enough to observe.
const runChatTurn: ChatTurnFn = async (deps) => {
  deps.emit?.({ type: "status", text: "Thinking…" });
  await sleep(600);
  for (const chunk of FIXTURE_CHAT_CHUNKS) {
    deps.emit?.({ type: "delta", text: chunk });
    await sleep(100);
  }
  return { ok: true, value: { reply: FIXTURE_CHAT_REPLY, receipts: [] } };
};
// The seam replaces chatTurn wholesale, so none of its real deps are read.
const chat = { runChatTurn } as unknown as NonNullable<ServerDeps["chat"]>;

function fixtureState(url: URL): Response {
  const taskId = url.searchParams.get("taskId") ?? "";
  const body = {
    statusWrites: notion.writes.filter((w) => w.taskId === taskId),
    completedToday: listCompletedTaskIdsOnDate(connection, today, TIME_ZONE).has(taskId),
  };
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const handle = startServer(
  connection,
  { YOH_SERVER_PORT: process.env["YOH_SERVER_PORT"] ?? "8788" },
  (options) =>
    serve({
      ...options,
      fetch: (request: Request) => {
        const url = new URL(request.url);
        return url.pathname === "/__fixture/state" ? fixtureState(url) : options.fetch(request);
      },
    }),
  { homeView, checkOff, chat },
);
const sweep = startCheckOffCommitSweep({ connection, ...checkOff, now: () => new Date() }, { log: quiet });

const shutdown = (): void => {
  sweep.stop();
  handle.close();
  connection.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
