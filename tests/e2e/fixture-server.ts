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
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { openSqliteConnection } from "../../src/adapters/sqlite.ts";
import { createChatStore, initChatStoreSchema } from "../../src/adapters/chat-store.ts";
import { FIXTURE_RATING_NOTE } from "./fixture-memory-seed.ts";
import { createRatingStore, initRatingStoreSchema } from "../../src/adapters/rating-store.ts";
import { initSettingsStoreSchema } from "../../src/adapters/settings-store.ts";
import { createMemoryItemStore, initMemoryItemStoreSchema } from "../../src/adapters/memory-item-store.ts";
import { initRoutineStoreSchema } from "../../src/adapters/routine-store.ts";
import { appendOutboxInTx, initNotificationStoreSchema } from "../../src/adapters/notification-store.ts";
import { findUncommittedCheckOffForTask, initPlanStateStoreSchema, replaceDayPinsAndDropsInTx } from "../../src/adapters/plan-state-store.ts";
import { listOpenReshuffleProposals } from "../../src/adapters/reshuffle-proposal-store.ts";
import { initJobStoreSchema } from "../../src/adapters/job-store.ts";
import { initCompletionLogSchema,listCompletedTaskIdsOnDate } from "../../src/adapters/completion-log.ts";
import { clearInteractionRequest, createMemoryStore, listOpenInteractionRequests, putPlan, putTimeBudget } from "../../src/adapters/memory-store.ts";
import {
  bindNotionTaskWrites,
  createPage as notionCreatePage,
  readNotionTasks,
  readResearchVault,
  readTaskFieldOptions,
  type NotionCreatePageClient,
  type NotionCreatePageConfig,
} from "../../src/adapters/notion-adapter.ts";
import { CHANGE_SET_PROPOSAL_KIND } from "../../src/app/apply-change-set.ts";
import { undoCheckOff } from "../../src/app/check-off.ts";
import { draftItem, type CreateItemDeps } from "../../src/app/create-item.ts";
import { openProposal } from "../../src/app/open-proposal.ts";
import { changeSetPrompt } from "../../src/core/chat-tools.ts";
import { offerPattern } from "../../src/app/pattern-offer.ts";
import { sandboxQueue, type SandboxQueueDeps } from "../../src/app/sandbox-queue.ts";
import { clearFixturePatterns, FIXTURE_RULE_TEXT, seedFixtureMemory, seedFixturePattern } from "./fixture-memory-seed.ts";
import { recognizeMemoryCommand } from "../../src/core/memory-commands.ts";
import { firstCardView } from "../../src/core/sandbox-card-view.ts";
import { startNightCloseOut } from "../../src/app/night-close-out.ts";
import { localIsoDate } from "../../src/rituals/ritual-shared.ts";
import { startCheckOffCommitSweep, startResearchJobRunner, startServer, type ChatTurnFn, type ServerDeps } from "../../src/shell/server.ts";
import { buildDeskDeps } from "../../src/shell/server-wiring.ts";
import { queueResearch } from "../../src/app/queue-research.ts";
import type { NotionCreatePageBindingFn } from "../../src/app/create-item.ts";
import type { SearchFn } from "../../src/app/web-search.ts";
import type { AnthropicMessagesClient } from "../../src/adapters/llm-adapter.ts";
import type { ChangeSetItem, Plan, PlanBlock, Proposal, PlanCalendarSnapshotEntry, Task, YohPlanEvent } from "../../src/types/domain.ts";
import { createFakeNotionStatusClient } from "../fakes/fake-notion-status-client.ts";
import { createFakeNotionCreateClient } from "../fakes/fake-notion-create-client.ts";
import { createFakeNotionTasksDb } from "../fakes/fake-notion-tasks-db.ts";

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
initRoutineStoreSchema(connection.db);
initChatStoreSchema(connection.db);
initSettingsStoreSchema(connection.db);
initMemoryItemStoreSchema(connection.db);
initRatingStoreSchema(connection.db);
initCompletionLogSchema(connection.db);
initJobStoreSchema(connection.db);

const store = createMemoryStore(connection);
// Story 13.1: the REAL chat store — `chatExchange` stores both turns even though `runChatTurn` is scripted.
const chatHistory = createChatStore(connection);
export const memoryItems = createMemoryItemStore(connection);
// Story 13.11: the REAL rating store; the draw is forced below so the prompt appears whenever the schedule allows it.
const ratings = createRatingStore(connection);
const startedAt = new Date();
const today = localIsoDate(startedAt, TIME_ZONE);

/** The default Plan: both rows span "now" for the next few hours, so neither row is past (read-only). */
function defaultPlan(version: number): Plan {
  return {
    id: `plan-${today}`,
    date: today,
    blocks: FIXTURE_TASKS.map((t, i) => ({
      id: `block-${t.id}`,
      kind: "work" as const,
      start: new Date(startedAt.getTime() - 10 * 60_000 + i * 60_000).toISOString(),
      end: new Date(startedAt.getTime() + 4 * 3_600_000 + i * 60_000).toISOString(),
      taskId: t.id,
      label: t.title,
    })),
    reasoning: "",
    version,
    createdAt: startedAt.toISOString(),
    updatedAt: startedAt.toISOString(),
  };
}
putPlan(store, defaultPlan(1));

/**
 * Yoh Plan calendar sync (web/e2e/plan-calendar-sync.spec.ts): the fake calendar mirrors what Yoh
 * last wrote, as Google would. `fixtureYohPlanEvents` is what the calendar holds now (a spec edits
 * it via `POST /__fixture/yoh-plan-events`); the snapshot is what Yoh last wrote. Both follow the
 * stored Plan on reset and on every fake calendar write. The timed sweep is not started here.
 */
export const fixtureYohPlanEvents: YohPlanEvent[] = [];
let fixturePlanSnapshot: PlanCalendarSnapshotEntry[] = [];
function mirrorPlanToCalendar(blocks: readonly PlanBlock[]): void {
  const written = blocks.filter((b) => b.kind !== "calendar-anchor");
  fixturePlanSnapshot = written.map((b) => ({
    eventId: `evt-${b.id}`,
    blockId: b.id,
    kind: b.kind,
    ...(b.taskId ? { taskId: b.taskId } : {}),
    ...(b.routineId ? { routineId: b.routineId } : {}),
    start: b.start,
    end: b.end,
  }));
  fixtureYohPlanEvents.splice(0, fixtureYohPlanEvents.length, ...written.map((b) => ({ eventId: `evt-${b.id}`, blockId: b.id, title: b.label, start: b.start, end: b.end })));
}
mirrorPlanToCalendar(store.getRecord<Plan>("plan", today)?.data.blocks ?? []);
// Reshuffle (like the morning ritual) needs a declared Time Budget; 6 h of work + 1 h of breaks covers every fixture Plan.
putTimeBudget(store, { date: today, totalMinutes: 420, workMinutes: 360, breakMinutes: 60 });

/**
 * Reshuffle isolation (web/e2e/reshuffle.spec.ts): a fixture-only scenario, switched on and off
 * by `POST /__fixture/reshuffle-scenario` and `POST /__fixture/reset`. While on, the Plan clock is
 * pinned to today 06:00 UTC (so 9:00-10:30 blocks are future and draggable whatever time the suite
 * runs) and the Tasks and Plan are two fresh Tasks. Reset restores the default Plan, real clock and
 * Tasks, clears the day's pins/drops and any open reshuffle proposal.
 */
export const FIXTURE_RESHUFFLE_TASKS = [
  { id: "e2e-reshuffle-alpha", title: "Reshuffle Alpha" },
  { id: "e2e-reshuffle-beta", title: "Reshuffle Beta" },
] as const;
let reshuffleScenario = false;
const fixtureNow = (): Date => (reshuffleScenario ? new Date(`${today}T06:00:00.000Z`) : new Date());
function scenarioPlan(version: number): Plan {
  const at = (h: number, m: number): string => new Date(`${today}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`).toISOString();
  return {
    ...defaultPlan(version),
    blocks: [
      { id: `v${version}-work-0`, kind: "work", start: at(9, 0), end: at(9, 30), taskId: FIXTURE_RESHUFFLE_TASKS[0].id, label: FIXTURE_RESHUFFLE_TASKS[0].title },
      { id: `v${version}-work-1`, kind: "work", start: at(9, 30), end: at(10, 0), taskId: FIXTURE_RESHUFFLE_TASKS[1].id, label: FIXTURE_RESHUFFLE_TASKS[1].title },
    ],
  };
}
function resetFixturePlan(scenario: boolean): void {
  reshuffleScenario = scenario;
  chatHistory.clearAll();
  memoryItems.clearAll();
  clearFixturePatterns(store, memoryItems);
  ratings.clearAll();
  for (const open of listOpenReshuffleProposals(store)) clearInteractionRequest(store, open.requestId, open.requestVersion);
  connection.db.prepare("DELETE FROM planning_settings").run();
  connection.db.transaction(() => replaceDayPinsAndDropsInTx(connection.db, today, [], []))();
  const version = (store.getRecord<Plan>("plan", today)?.version ?? 0) + 1;
  const next = scenario ? scenarioPlan(version) : defaultPlan(version);
  putPlan(store, next, (db) => appendOutboxInTx(db, { topic: "plan", entityId: today }));
  mirrorPlanToCalendar(next.blocks);
}

const notion = createFakeNotionStatusClient();
const tasks = (): Task[] =>
  (reshuffleScenario ? FIXTURE_RESHUFFLE_TASKS : FIXTURE_TASKS).map((t) => ({
    id: t.id,
    title: t.title,
    area: "Personal",
    estimatedDurationMinutes: 30,
    dueDate: today,
    status: notion.writes.some((w) => w.taskId === t.id && w.status === "Completed") ? ("completed" as const) : ("not-started" as const),
    createdAt: startedAt.toISOString(),
    updatedAt: startedAt.toISOString(),
  }));

const homeView: NonNullable<ServerDeps["homeView"]> = {
  store,
  readCalendarEvents: async () => [],
  readTasks: async () => ({ tasks: tasks() }),
  timeZone: TIME_ZONE,
  now: fixtureNow,
};

/**
 * Task 4 ("pick any day in Month to see its calendar"): a fixed event on a
 * NON-today date, so `web/e2e/home-layout.spec.ts` has something real to
 * assert on after clicking a different day in Month. `today + 3 days`
 * (never crosses more than one calendar month forward, since no month is
 * shorter than 28 days) — computed the same way here and in the spec
 * (real UTC "now", `TIME_ZONE` is `"UTC"`), so both land on the identical
 * date without the fixture and the test ever talking to each other.
 */
function addUtcDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}
export const FIXTURE_OTHER_DAY_DATE = addUtcDays(today, 3);
export const FIXTURE_OTHER_DAY_EVENT_TITLE = "Team Sync";
const otherDayEvents = [
  { id: "e2e-other-day", title: FIXTURE_OTHER_DAY_EVENT_TITLE, start: `${FIXTURE_OTHER_DAY_DATE}T15:00:00.000Z`, end: `${FIXTURE_OTHER_DAY_DATE}T16:00:00.000Z` },
];
const calendarDay: NonNullable<ServerDeps["calendarDay"]> = {
  store,
  timeZone: TIME_ZONE,
  readCalendarEventsForDate: async (date) => (date === FIXTURE_OTHER_DAY_DATE ? otherDayEvents : []),
};
const checkOff: NonNullable<ServerDeps["checkOff"]> = {
  store,
  timeZone: TIME_ZONE,
  notionClient: notion.client,
  notionStatusConfig: { tasksDataSourceId: "tasks-ds" },
  lookupTask: async (taskId) => tasks().find((t) => t.id === taskId),
};

/** Reshuffle routes over the fixture Plan/Tasks; the Yoh Plan calendar write is a fake that always succeeds. */
export const fixturePlanCalendarWrites: string[][] = [];
const reshufflePlanDeps: NonNullable<ServerDeps["plan"]> = {
  store,
  connection,
  timeZone: TIME_ZONE,
  now: fixtureNow,
  readTasks: async () => tasks(),
  readCalendarEvents: async () => [],
  writeCalendarPlan: async (blocks) => {
    fixturePlanCalendarWrites.push(blocks.map((b) => b.id));
    mirrorPlanToCalendar(blocks);
    return { written: blocks.map((b) => b.id), failed: [] };
  },
};

/** `POST /api/plan/sync` over the fixture Plan and its fake calendar mirror. */
const planSyncDeps: NonNullable<ServerDeps["planSync"]> = {
  ...reshufflePlanDeps,
  readYohPlanEvents: async () => [...fixtureYohPlanEvents],
  readPlanCalendarSnapshot: () => fixturePlanSnapshot,
  readPlanCalendarWriteState: () => ({}),
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
/**
 * Story 13.4 (Ruling E13): the memory LLM seam, separate from `llmClient` (which would feed FR-25
 * suggestions). Returns one Corrections candidate ONLY for the Chem club fixture text, otherwise `[]`,
 * so unrelated fixture turns never file.
 */
export { FIXTURE_PATTERN, FIXTURE_PATTERN_EVIDENCE, FIXTURE_PATTERN_HEADLINE, FIXTURE_PATTERN_QUESTION } from "./fixture-memory-seed.ts";
export { FIXTURE_CONVERSATIONS, FIXTURE_MEMORY_ITEMS, FIXTURE_RATING_NOTE, FIXTURE_RULE_TEXT } from "./fixture-memory-seed.ts";
export const FIXTURE_MEMORY_TEXT = "Chem club is a club, not a class";
/** Story 13.11: the "What was off?" note the rating spec sends; the memory LLM files it to Feedback. */
const memoryLlmClient: AnthropicMessagesClient = {
  messages: {
    create: (async (params: { readonly messages: unknown }) => {
      // Match only Spencer's typed text (after the marker), never the always-loaded items the prompt also lists.
      const prompt = JSON.stringify(params.messages);
      const typed = prompt.slice(prompt.indexOf("Spencer's message:") + 1);
      const reply = /Chem club/.test(typed)
        ? JSON.stringify([{ folder: "corrections", text: FIXTURE_MEMORY_TEXT, origin: "stated" }])
        : typed.includes(FIXTURE_RATING_NOTE)
          ? JSON.stringify([{ folder: "feedback", text: FIXTURE_RATING_NOTE, origin: "stated" }])
        : /2:30 on school days/.test(typed)
          ? JSON.stringify([{ folder: "planning-preferences", text: FIXTURE_RULE_TEXT, origin: "stated", ruleChange: { key: "schoolDayWorkStart", value: "14:30" } }])
          : "[]";
      return {
        id: "msg_fixture_memory",
        container: null,
        content: [{ type: "text", text: reply, citations: null }],
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
  timeZone: TIME_ZONE,
  llmClient: draftFieldsLlmClient,
  getNotionCreatePageBinding: () => ({ ok: true, value: { client: notionCreate.client, config: NOTION_CREATE_CONFIG } }),
};
/** A free-text Task description the capture smoke sends — matches none of `chatTurn`'s deterministic recognizers, mirroring what a real `detectTaskCapture` call would confidently call CAPTURE for. */
/** Epic 14: the message that stages a two-item change set (a calendar event and a check-off); `web/e2e/change-set.spec.ts` hardcodes it. */
export const FIXTURE_CHANGE_SET_MESSAGE = "add a workout at 1 and mark the first task done";
/** Calendar creates the change set's `applyCalendarEdit` fake recorded. */
export const fixtureCalendarCreates: string[] = [];

/** Local copy of `chat-agent.ts`'s `clearOpenChangeSets` (the fixture is not `app/`): a second open change set with the same entity would be refused. */
function clearOpenChangeSets(): void {
  for (const record of listOpenInteractionRequests(store)) {
    if (record.data.requestKind !== "proposal") continue;
    const proposal = (record.data.detail as { readonly proposal?: Proposal<unknown> } | undefined)?.proposal;
    if (proposal?.kind === CHANGE_SET_PROPOSAL_KIND) clearInteractionRequest(store, record.id, record.version);
  }
}

/** A reset undoes the change set's still-pending check-off, so `check-off.spec.ts` (which follows alphabetically) finds both fixture Tasks open. */
async function undoChangeSetCheckOffs(): Promise<void> {
  const pending = findUncommittedCheckOffForTask(connection, FIXTURE_TASKS[0].id);
  if (pending) await undoCheckOff({ ...checkOff, connection, now: () => new Date() }, { id: pending.id });
}

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
  // Story 9.2: `/sandbox` is a deterministic slash command (`chat-turn.ts`'s
  // own `dispatchSlashCommand` checks it before anything LLM-shaped) —
  // this fake stands in for the WHOLE `chatTurn` seam, so it dispatches
  // `/sandbox` itself, against the real `sandboxQueue`/`firstCardView`
  // functions (never duplicated logic), using the same fake Notion Tasks
  // data source `sandbox` (below) already reads/writes for the three
  // `/api/sandbox/*` routes.
  if (input.message.trim() === "/sandbox") {
    const sandboxChatDeps: SandboxQueueDeps = { ...sandbox, now: () => new Date() };
    const queue = await sandboxQueue(sandboxChatDeps, { withOptions: true });
    if (!queue.ok) return queue;
    const card = firstCardView(queue.value.items, queue.value.options);
    if (!card) return { ok: true, value: { reply: "Nothing's missing a Due Date or Duration.", receipts: [] } };
    return { ok: true, value: { reply: "", receipts: [], sandboxCard: card } };
  }
  // Story 11.3: `/research <question>` queues a job through the REAL `queueResearch`; the runner below does the rest.
  const researchMatch = /^\/research(?:\s+([\s\S]*))?$/.exec(input.message.trim());
  if (researchMatch) {
    return queueResearch(
      { connection, webSearchAvailable: true, getNotionCreatePageBinding: researchVaultBinding, now: () => new Date() },
      { question: researchMatch[1] ?? "" },
    );
  }
  // Story 13.11: `/morning` is a substantive turn, so the rating schedule may prompt after it.
  if (input.message.trim() === "/morning") {
    // Story 13.13: the REAL offerPattern, so the once-per-day rule is the server's own.
    const offer = await offerPattern({ memoryItems, store, now: () => new Date(), timeZone: TIME_ZONE }, {});
    const question = offer.ok ? offer.value.question : undefined;
    return { ok: true, value: { reply: "Fixture morning.", receipts: [], substantive: true, ...(question ? { question } : {}) } };
  }
  // `/night` runs the REAL startNightCloseOut with every fixture Task counted as
  // completed today, so it goes straight to the close-out's "anything else?" step.
  if (input.message.trim() === "/night") {
    return startNightCloseOut(
      { store, session: deps.session, now: () => new Date(), timeZone: TIME_ZONE, getCompletedTaskIdsToday: () => new Set(FIXTURE_TASKS.map((t) => t.id)) },
      {},
    );
  }
  const memoryCommand = recognizeMemoryCommand(input.message);
  if (memoryCommand?.kind === "remember") {
    return { ok: true, value: { reply: "Got it.", receipts: [], memory: { kind: "remember", text: memoryCommand.text } } };
  }
  if (CAPTURE_TRIGGER.test(input.message)) {
    return draftItem(captureDeps, { database: "Tasks", request: input.message });
  }
  if (input.message === FIXTURE_CHANGE_SET_MESSAGE) {
    const items: ChangeSetItem[] = [
      { kind: "create-event", title: "Workout", start: new Date(startedAt.getTime() + 3_600_000).toISOString(), end: new Date(startedAt.getTime() + 7_200_000).toISOString() },
      { kind: "complete-task", taskId: FIXTURE_TASKS[0].id, label: FIXTURE_TASKS[0].title },
    ];
    const reply = changeSetPrompt(items, TIME_ZONE);
    const proposal: Proposal<{ readonly items: readonly ChangeSetItem[] }> = {
      id: randomUUID(),
      kind: CHANGE_SET_PROPOSAL_KIND,
      entityId: "chat",
      entityVersion: "",
      suggested: { items },
      reason: reply,
      createdAt: new Date().toISOString(),
    };
    clearOpenChangeSets();
    const opened = await openProposal({ store }, { proposal });
    if (!opened.ok) return opened;
    return { ok: true, value: { reply, receipts: [], question: opened.value } };
  }
  await sleep(600);
  for (const chunk of FIXTURE_CHAT_CHUNKS) {
    deps.emit?.({ type: "delta", text: chunk });
    await sleep(100);
  }
  return { ok: true, value: { reply: FIXTURE_CHAT_REPLY, receipts: [] } };
};
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
  // `chatExchange` reads these when a chat store is present.
  timeZone: TIME_ZONE,
  now: () => new Date(),
  // `connection` is here only for the rule-change transaction (`fileMemory` and the Yes in `confirmProposal`).
  connection,
  runChatTurn,
  memoryLlmClient,
  ratingDraw: () => 0,
  createPage: (database: string, properties: Record<string, string>) =>
    notionCreatePage(notionCreate.client, NOTION_CREATE_CONFIG, database as never, properties),
  // Epic 14: the change set's own write seams (`server.ts` threads them into `changeSet`). The calendar write is a fake that records;
  // `completeTask` is the real check-off path over the fake Notion (see `withChatToolLoopDeps`).
  changeSetWrites: {
    createPage: (database: string, properties: Record<string, string>) =>
      notionCreatePage(notionCreate.client, NOTION_CREATE_CONFIG, database as never, properties),
    applyCalendarEdit: async (proposal: Proposal<{ readonly kind: string; readonly title?: string }>) => {
      fixtureCalendarCreates.push(proposal.suggested.title ?? proposal.suggested.kind);
      return { ok: true as const, value: { eventId: `fixture-event-${fixtureCalendarCreates.length}`, calendarId: "primary" } };
    },
  },
} as unknown as NonNullable<ServerDeps["chat"]>;

// Task 6B: the Tasks page runs against a whole fake Tasks data source
// (query + live schema + create + update) — the REAL notion-adapter read,
// option, create and field-write functions all run on top of it, so
// `web/e2e/tasks.spec.ts` can list, quick-add and inline-edit end to end.
// Seeded relative to the fixture's own "today" so every Due bucket shows.
const shiftDays = (days: number): string => new Date(Date.parse(`${today}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const tasksDb = createFakeNotionTasksDb({
  seed: [
    { id: "tp-overdue", title: "Email Mr. Alvarez about the lab", dueDate: shiftDays(-2), minutes: 15, area: "School", energy: "low", status: "Nothing", priority: "🔴 High" },
    { id: "tp-today", title: "Calc problem set 4", dueDate: today, minutes: 60, area: "Math", energy: "medium", status: "Nothing" },
    { id: "tp-done", title: "Return library books", dueDate: today, minutes: 20, area: "Errands", energy: "low", status: "Completed" },
    { id: "tp-week", title: "AP Bio ch. 7 reading", dueDate: shiftDays(2), minutes: 90, area: "Bio", status: "Nothing" },
    { id: "tp-soccer", title: "Soccer fundraiser flyers", dueDate: shiftDays(4), minutes: 45, area: "Personal", energy: "medium", status: "In Progress" },
    { id: "tp-nodate", title: "College essay brainstorm", area: "School", energy: "Deep", status: "Nothing" },
    // Story 9.2: dedicated to /sandbox — missing BOTH Required fields
    // (Due Date, Estimated Duration), so it is unambiguously eligible for
    // the card flow regardless of Task 1's exact Refining-tier behavior.
    { id: "e2e-sandbox", title: "E2E Sandbox Task", area: "Personal", status: "Nothing" },
  ],
});
const TASKS_CONFIG = { tasksDataSourceId: "tasks-ds", projectsDataSourceId: "projects-ds" };
const tasksPage: NonNullable<ServerDeps["tasks"]> = {
  timeZone: TIME_ZONE,
  readTasks: async () => (await readNotionTasks(tasksDb.client, TASKS_CONFIG)).tasks,
  readFieldOptions: () => readTaskFieldOptions(tasksDb.client, TASKS_CONFIG),
  getNotionCreatePageBinding: () => ({ ok: true, value: { client: tasksDb.client, config: { ...TASKS_CONFIG, researchVaultDataSourceId: "vault-ds" } } }),
  ...bindNotionTaskWrites(() => ({ ok: true, value: { client: tasksDb.client, config: TASKS_CONFIG } })),
};

// Story 9.2: /sandbox's fake dependencies — the SAME fake Notion Tasks data
// source `tasksPage` already reads/writes, mirrored exactly.
const sandbox: NonNullable<ServerDeps["sandbox"]> = {
  store,
  timeZone: TIME_ZONE,
  readTasks: async () => (await readNotionTasks(tasksDb.client, TASKS_CONFIG)).tasks,
  readFieldOptions: () => readTaskFieldOptions(tasksDb.client, TASKS_CONFIG),
  ...bindNotionTaskWrites(() => ({ ok: true, value: { client: tasksDb.client, config: TASKS_CONFIG } })),
};

// Task 6C: the Research Hub page's fake Research Vault data source — just
// `dataSources.query` (the one call `readResearchVault` makes), seeded with
// a couple of rows so `web/e2e/research-hub.spec.ts` can see the list
// render, each with a real "Sources" rich_text value (one URL per line, the
// same shape `app/save-search-result.ts` writes) so `sourceCount` is
// genuine, not zero.
function researchVaultPage(id: string, title: string, date: string, sources: readonly string[], keyFindings = ""): Record<string, unknown> {
  const richText = (content: string) => (content === "" ? [] : [{ type: "text", plain_text: content, text: { content } }]);
  return {
    object: "page",
    id,
    url: `https://notion.so/${id}`,
    created_time: "2026-09-01T09:00:00.000Z",
    last_edited_time: "2026-09-01T09:00:00.000Z",
    in_trash: false,
    archived: false,
    properties: {
      "Research Title": { id: "title", type: "title", title: richText(title) },
      Date: { id: "date", type: "date", date: { start: date, end: null, time_zone: null } },
      Sources: { id: "sources", type: "rich_text", rich_text: richText(sources.join("\n")) },
      "Key Findings": { id: "kf", type: "rich_text", rich_text: richText(keyFindings) },
    },
  };
}
// Story 11.2: 23 rows so the library pages (20 + 3). The two real rows stay
// the two newest; 20 older filler rows and one empty-body row follow.
export const FIXTURE_RESEARCH_AP_BIO = {
  id: "rv-ap-bio",
  title: "AP Bio registration deadline",
  body: ["Registration closes October 1, 2026.", "Late registration adds a fee of $40."],
} as const;
export const FIXTURE_RESEARCH_HIKING = { id: "rv-hiking", title: "Best hiking boots under $150", body: "Pick a mid-cut boot with a waterproof liner." } as const;
export const FIXTURE_RESEARCH_EMPTY = { id: "rv-empty", title: "Old note with no body" } as const;
export const FIXTURE_RESEARCH_PAGE_2_TITLE = "Filler research 02";
const researchVaultRows = [
  researchVaultPage(FIXTURE_RESEARCH_AP_BIO.id, FIXTURE_RESEARCH_AP_BIO.title, "2026-09-20", ["https://example.com/ap-bio-1", "https://example.com/ap-bio-2"], FIXTURE_RESEARCH_AP_BIO.body.join("\n\n")),
  researchVaultPage(FIXTURE_RESEARCH_HIKING.id, FIXTURE_RESEARCH_HIKING.title, "2026-09-10", ["https://example.com/hiking"], FIXTURE_RESEARCH_HIKING.body),
  // Twenty filler rows, 20 down to 01 (dates 2026-08-20 .. 2026-08-01): 20..03 fill page 1, 02 and 01 land on page 2.
  ...Array.from({ length: 20 }, (_, i) => {
    const nn = String(20 - i).padStart(2, "0");
    return researchVaultPage(`rv-filler-${nn}`, `Filler research ${nn}`, `2026-08-${nn}`, [`https://example.com/filler-${nn}`], `Filler findings ${nn}.`);
  }),
  // The oldest row: an empty body and no sources (page 2).
  researchVaultPage(FIXTURE_RESEARCH_EMPTY.id, FIXTURE_RESEARCH_EMPTY.title, "2026-07-31", []),
];
// Story 11.3: the research runner's fake vault. The REAL `createPage("ResearchVault", ...)` runs against this client, and each
// created page joins `researchVaultRows` so the Research Hub list and document reads see it.
const richTextOf = (prop: unknown): string =>
  ((prop as { rich_text?: Array<{ text?: { content?: string } }> } | undefined)?.rich_text ?? []).map((t) => t.text?.content ?? "").join("");
const researchVaultCreateSchema = {
  object: "data_source",
  id: "research-vault-ds",
  title: [],
  description: [],
  parent: { type: "database_id", database_id: "research-vault-ds-db" },
  database_parent: { type: "database_id", database_id: "research-vault-ds-db" },
  is_inline: false,
  in_trash: false,
  archived: false,
  created_time: "2026-08-01T09:00:00.000Z",
  last_edited_time: "2026-08-01T09:00:00.000Z",
  created_by: { object: "user", id: "user-1" },
  last_edited_by: { object: "user", id: "user-1" },
  icon: null,
  cover: null,
  url: "https://notion.so/research-vault-ds",
  public_url: null,
  properties: {
    "Research Title": { id: "title", name: "Research Title", description: null, type: "title", title: {} },
    "Key Findings": { id: "kf", name: "Key Findings", description: null, type: "rich_text", rich_text: {} },
    Query: { id: "q", name: "Query", description: null, type: "rich_text", rich_text: {} },
    Date: { id: "date", name: "Date", description: null, type: "date", date: {} },
    Sources: { id: "src", name: "Sources", description: null, type: "rich_text", rich_text: {} },
  },
} as unknown as Awaited<ReturnType<NotionCreatePageClient["dataSources"]["retrieve"]>>;
let researchVaultCreated = 0;
const researchVaultCreateClient: NotionCreatePageClient = {
  dataSources: { retrieve: (async () => researchVaultCreateSchema) as NotionCreatePageClient["dataSources"]["retrieve"] },
  pages: {
    create: (async (params: { properties: Record<string, unknown> }) => {
      researchVaultCreated += 1;
      const id = `rv-job-${researchVaultCreated}`;
      const title = ((params.properties["Research Title"] as { title?: Array<{ text?: { content?: string } }> } | undefined)?.title ?? []).map((t) => t.text?.content ?? "").join("");
      const date = (params.properties["Date"] as { date?: { start?: string } } | undefined)?.date?.start ?? today;
      const sources = richTextOf(params.properties["Sources"]).split("\n").filter(Boolean);
      researchVaultRows.unshift(researchVaultPage(id, title, date, sources, richTextOf(params.properties["Key Findings"])));
      return { object: "page", id, url: `https://notion.so/${id}` };
    }) as NotionCreatePageClient["pages"]["create"],
  },
};
const researchVaultBinding: NotionCreatePageBindingFn = () => ({
  ok: true,
  value: { client: researchVaultCreateClient, config: { ...NOTION_CREATE_CONFIG, researchVaultDataSourceId: "research-vault-ds" } },
});
// The fake search answers any question with one canned answer and one source.
const fixtureSearch: SearchFn = async (query) => ({ ok: true, value: { answer: `Fixture findings for: ${query}`, citations: ["https://example.com/fixture-research"] } });

const researchVaultClient = {
  dataSources: {
    query: async (params: { data_source_id: string }) => ({
      object: "list",
      type: "page_or_data_source",
      results: params.data_source_id === "research-vault-ds" ? researchVaultRows : [],
      has_more: false,
      next_cursor: null,
    }),
  },
} as unknown as Parameters<typeof readResearchVault>[0];
const research: NonNullable<ServerDeps["research"]> = {
  readResearchVault: () => readResearchVault(researchVaultClient, { researchVaultDataSourceId: "research-vault-ds" }),
};

function fixtureState(url: URL): Response {
  const taskId = url.searchParams.get("taskId") ?? "";
  const body = {
    statusWrites: notion.writes.filter((w) => w.taskId === taskId),
    completedToday: listCompletedTaskIdsOnDate(connection, today, TIME_ZONE).has(taskId),
    // Story 8.8 (Review Focus #3): empty until Spencer's "Create" chip
    // actually confirms the draft — proves no shortcut write.
    createdPages: notionCreate.createdPages.map((p) => ({ title: p.title })),
    // Task 6B: the fake Tasks data source's rows, as Notion would hold them.
    tasksRows: tasksDb.rows(),
    // Epic 14: how many calendar creates a confirmed change set made.
    calendarCreates: fixtureCalendarCreates.length,
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
        if (request.method === "POST" && (url.pathname === "/__fixture/reshuffle-scenario" || url.pathname === "/__fixture/reset")) {
          resetFixturePlan(url.pathname === "/__fixture/reshuffle-scenario");
          clearOpenChangeSets();
          fixtureCalendarCreates.splice(0);
          return undoChangeSetCheckOffs().then(() => new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } }));
        }
        // Story 13.9: memory items + two Conversations for the Memory page specs; deliberately NOT part of reset.
        if (request.method === "POST" && url.pathname === "/__fixture/seed-memory") {
          connection.db.prepare("DELETE FROM planning_settings").run();
          seedFixtureMemory({ connection, chatHistory, memoryItems }, today);
          return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
        }
        // Story 13.13: one pending Pattern proposal (History essays run about 30 min over).
        if (request.method === "POST" && url.pathname === "/__fixture/seed-pattern") {
          seedFixturePattern({ connection, store, memoryItems });
          return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.pathname === "/__fixture/yoh-plan-events") {
          if (request.method === "POST") {
            return request.json().then((body) => {
              const events = body as YohPlanEvent[];
              fixtureYohPlanEvents.splice(0, fixtureYohPlanEvents.length, ...events);
              return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
            });
          }
          return new Response(JSON.stringify(fixtureYohPlanEvents), { headers: { "Content-Type": "application/json" } });
        }
        return url.pathname === "/__fixture/state" ? fixtureState(url) : options.fetch(request);
      },
    }),
  { homeView, calendarDay, checkOff, plan: reshufflePlanDeps, planSync: planSyncDeps, chat, chatHistory, memoryItems, ratings, tasks: tasksPage, research, sandbox, desk: buildDeskDeps(connection, { YOH_TIMEZONE: TIME_ZONE }) },
);
const sweep = startCheckOffCommitSweep({ connection, ...checkOff, now: () => new Date() }, { log: quiet });
// Story 11.3: the real research runner over the fake search and the fake vault (short interval so specs stay fast).
const researchRunner = startResearchJobRunner(
  { connection, searchFn: fixtureSearch, getNotionCreatePageBinding: researchVaultBinding, timeZone: TIME_ZONE, now: () => new Date() },
  { intervalMs: 250, log: quiet },
);

const shutdown = (): void => {
  sweep.stop();
  researchRunner.stop();
  handle.close();
  connection.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
