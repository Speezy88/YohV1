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
import { createMemoryStore, putOpenInteractionRequest, putPlan, putTimeBudget } from "../../src/adapters/memory-store.ts";
import { createPage as notionCreatePage, type NotionCreatePageConfig } from "../../src/adapters/notion-adapter.ts";
import { draftItem, type CreateItemDeps } from "../../src/app/create-item.ts";
import { localIsoDate } from "../../src/rituals/ritual-shared.ts";
import { startCheckOffCommitSweep, startServer, type ChatTurnFn, type ServerDeps } from "../../src/shell/server.ts";
import type { AnthropicMessagesClient } from "../../src/adapters/llm-adapter.ts";
import type { Plan, Proposal, Task, TimeBudget } from "../../src/types/domain.ts";
import { createFakeNotionStatusClient } from "../fakes/fake-notion-status-client.ts";
import { createFakeNotionCreateClient } from "../fakes/fake-notion-create-client.ts";

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

// Story 8.8 (NFR-CaptureSpeed): the fake Notion CREATE client (schema
// retrieve + page create — distinct from `notion` above, which is a
// STATUS-only fake) the capture-flow smoke's Task actually gets created
// against, plus a small fake LLM client for the ONE adapter call `draftItem`
// makes directly (`draftNotionPageFields`, via its "structured draft for a
// new" system prompt) — everything else in the real FR-26 pipeline
// (`draftItem` -> `openProposal` -> `answerOpenItem` -> `confirmProposal`
// -> `createPage`) runs for real, against the SAME `store` every other
// fixture deps object already shares, so a capture drafted through
// `runChatTurn` below is genuinely confirmable via `POST
// /api/open-items/answer` afterward (Review Focus #3: no shortcut write).
const notionCreate = createFakeNotionCreateClient();
const NOTION_CREATE_CONFIG: NotionCreatePageConfig = { tasksDataSourceId: "tasks-ds", projectsDataSourceId: "projects-ds", researchVaultDataSourceId: "vault-ds" };
const draftFieldsLlmClient: AnthropicMessagesClient = {
  messages: {
    create: (async (params: { readonly messages: ReadonlyArray<{ readonly content: unknown }> }) => {
      const userText = typeof params.messages[0]?.content === "string" ? params.messages[0].content : "";
      const title = userText.split(",")[0]!.trim();
      return {
        id: "msg_fixture",
        container: null,
        content: [{ type: "text", text: `title=${title}`, citations: null }],
        model: "fixture-model",
        role: "assistant",
        stop_details: null,
        stop_reason: "end_turn",
        stop_sequence: null,
        type: "message",
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: null, service_tier: null },
      };
    }) as unknown as AnthropicMessagesClient["messages"]["create"],
  },
};
const captureDeps: CreateItemDeps = {
  store,
  now: () => new Date(),
  llmClient: draftFieldsLlmClient,
  getNotionCreatePageBinding: () => ({ ok: true, value: { client: notionCreate.client, config: NOTION_CREATE_CONFIG } }),
};
/** A free-text Task description the capture smoke sends — matches none of `chatTurn`'s deterministic recognizers, mirroring what a real `detectTaskCapture` call would confidently call CAPTURE for. */
const CAPTURE_TRIGGER = /report|assignment|errand|due (thursday|friday|monday)/i;

// Story 8.5 (controller ruling (c)): a scripted chat turn through the
// `runChatTurn` seam — never a fake Anthropic client for the GENERAL chat
// case, so that smoke doesn't drift with llm-adapter.ts's streaming shape.
// The pause before the first delta keeps the Thinking Indicator on screen
// long enough to observe. Story 8.8 extends this with ONE additional
// branch: a message that reads like a Task description routes through the
// REAL `draftItem` (never a canned reply), so the capture-flow smoke
// exercises FR-26's genuine draft -> confirm -> write pipeline; this
// fixture stands in only for the classifier's OWN decision (`detectTaskCapture`,
// already unit-tested in `tests/llm-adapter.test.ts`), not for anything
// downstream of it.
const runChatTurn: ChatTurnFn = async (deps, input) => {
  deps.emit?.({ type: "status", text: "Thinking…" });
  if (CAPTURE_TRIGGER.test(input.message)) {
    return draftItem(captureDeps, { database: "Tasks", request: input.message });
  }
  await sleep(600);
  for (const chunk of FIXTURE_CHAT_CHUNKS) {
    deps.emit?.({ type: "delta", text: chunk });
    await sleep(100);
  }
  return { ok: true, value: { reply: FIXTURE_CHAT_REPLY, receipts: [] } };
};
// Story 8.6 (Task 7): one fixture open item the smoke can see and answer —
// seeded exactly as a ritual would (never through chatTurn), matching
// Review Focus #1 ("including ones created while the CLI was in use"). A
// `"proposal"` kind (`buildProposalQuestion`, `core/open-item-questions.ts`)
// is the one request kind whose CURRENT question always carries real option
// chips (Yes/No) — a data-completeness blind ask is free-text only, so it
// wouldn't exercise "a chip pick answers it" at all. `confirmProposal`'s
// `"time-budget-change"` branch needs only `store` (the generic apply()/
// accessor pattern re-reads the live Time Budget itself), so this needs no
// Notion/Calendar fixture wiring at all.
export const FIXTURE_PROPOSAL_TEXT = "Move your Time Budget to 7 hours today?";
const storedTimeBudget = putTimeBudget(store, { date: today, totalMinutes: 360, workMinutes: 252, breakMinutes: 54 });
const timeBudgetProposal: Proposal<Partial<TimeBudget>> = {
  id: "tb-e2e",
  kind: "time-budget-change",
  entityId: "time-budget",
  entityVersion: String(storedTimeBudget.version),
  suggested: { totalMinutes: 420 },
  reason: FIXTURE_PROPOSAL_TEXT,
  createdAt: startedAt.toISOString(),
};
putOpenInteractionRequest(store, "proposal:tb-e2e", {
  requestKind: "proposal",
  promptText: FIXTURE_PROPOSAL_TEXT,
  createdAt: startedAt.toISOString(),
  detail: { proposal: timeBudgetProposal },
});

// The seam replaces chatTurn wholesale for /api/chat, so most of its real
// deps aren't read there — but `store` is real, and shared by
// `/api/open-items`/`/api/open-items/answer` (Preflight ruling P2), so the
// proposal seeded above (and any Story 8.8 capture drafted via
// `runChatTurn`'s own `draftItem` call above) is genuinely answerable end to
// end. `createPage` IS read there — `confirmProposal`'s `"notion-page-draft"`
// branch (Story 8.8's confirm step) needs it bound to the SAME fake Notion
// create client `runChatTurn`'s capture branch drafted against.
const chat = {
  store,
  runChatTurn,
  createPage: (database: string, properties: Record<string, string>) =>
    notionCreatePage(notionCreate.client, NOTION_CREATE_CONFIG, database as never, properties),
} as unknown as NonNullable<ServerDeps["chat"]>;

function fixtureState(url: URL): Response {
  const taskId = url.searchParams.get("taskId") ?? "";
  const body = {
    statusWrites: notion.writes.filter((w) => w.taskId === taskId),
    completedToday: listCompletedTaskIdsOnDate(connection, today, TIME_ZONE).has(taskId),
    // Story 8.8 (Review Focus #3): empty until Spencer's "Create" chip
    // actually confirms the draft — proves no shortcut write.
    createdPages: notionCreate.createdPages.map((p) => ({ title: p.title })),
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
