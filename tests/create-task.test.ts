/**
 * Tests for `src/app/create-task.ts` (Task 6B): a Task Spencer types himself
 * on the Tasks page is a DIRECT write (AD-3/AD-12 amended 2026-09-27) —
 * parsed by `core/quick-add.ts`, validated against the live schema at draft
 * time AND at write time, created in one step with no Proposal, and
 * announced to every open client with one outbox hint. Runs the REAL
 * notion-adapter functions against an in-memory Tasks data source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AnthropicMessagesClient, QuickAddLiveOptions, QuickAddNormalizeRawFields } from "../src/adapters/llm-adapter.ts";
import { openSqliteConnection, type SqliteConnection } from "../src/adapters/sqlite.ts";
import { getMaxOutboxSeq, initNotificationStoreSchema, tailOutboxSince } from "../src/adapters/notification-store.ts";
import { createTask, previewQuickAdd, type CreateTaskDeps } from "../src/app/create-task.ts";
import { createFakeNotionTasksDb, type FakeTasksDb, type FakeTasksDbOptions } from "./fakes/fake-notion-tasks-db.ts";

const NOW = new Date("2026-09-27T15:00:00.000Z"); // Sunday

/** A dummy client — satisfies `CreateTaskDeps.llmClient`'s type without ever being called (every Haiku test below overrides `deps.normalize`, the injection seam, so `.messages.create` is never reached). */
const DUMMY_LLM_CLIENT: AnthropicMessagesClient = { messages: { create: (() => { throw new Error("not used — deps.normalize is injected in tests"); }) as never } };

function setup(dbOptions: FakeTasksDbOptions = {}): { db: FakeTasksDb; connection: SqliteConnection; deps: CreateTaskDeps } {
  const db = createFakeNotionTasksDb(dbOptions);
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const deps: CreateTaskDeps = {
    getNotionCreatePageBinding: () => ({
      ok: true,
      value: { client: db.client, config: { tasksDataSourceId: "tasks-ds", projectsDataSourceId: "projects-ds", researchVaultDataSourceId: "vault-ds" } },
    }),
    now: () => NOW,
    timeZone: "UTC",
    connection,
  };
  return { db, connection, deps };
}

test("one typed line creates the Task directly, with every parsed field written to Notion", async () => {
  const { db, deps } = setup();
  const result = await createTask(deps, { text: "Lab report due fri 90m high #bio" });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Lab report", dueDate: "2026-10-02", minutes: 90, energy: "Deep", area: "Bio" }]);
  assert.equal(result.value.task.id, "created-1");
  assert.equal(result.value.task.title, "Lab report");
  assert.equal(result.value.task.dueDate, "2026-10-02");
  assert.equal(result.value.task.estimatedDurationMinutes, 90);
  assert.equal(result.value.task.energy, "high");
  assert.equal(result.value.task.area, "Bio");
  assert.equal(result.value.receipt, 'Added "Lab report" to Tasks.');
});

test("a title alone is enough — no other field is required", async () => {
  const { db, deps } = setup();
  const result = await createTask(deps, { text: "Call the dentist" });
  assert.ok(result.ok);
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Call the dentist" }]);
  assert.deepEqual(result.value.task.missing, ["estimatedDurationMinutes", "area", "dueDate", "energy"]);
});

test("a #tag with no close live Area option stays in the title and writes no Area", async () => {
  const { db, deps } = setup();
  const result = await createTask(deps, { text: "Lab #chem" });
  assert.ok(result.ok);
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Lab #chem" }]);
});

test("a blank line is a plain validation error and writes nothing", async () => {
  const { db, deps } = setup();
  const result = await createTask(deps, { text: "   " });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.kind, "validation");
  assert.equal(result.error.message, "Type a title for the new Task first.");
  assert.equal(db.rows().length, 0);
});

test("a successful create appends one 'tasks' outbox hint so every open client refreshes", async () => {
  const { deps, connection } = setup();
  const before = getMaxOutboxSeq(connection);
  await createTask(deps, { text: "Call the dentist" });
  const hints = tailOutboxSince(connection, before);
  assert.deepEqual(
    hints.map((h) => [h.topic, h.entityId]),
    [["tasks", "created-1"]],
  );
});

test("a Notion outage is an honest error naming Notion, and no hint is sent", async () => {
  const { db, deps, connection } = setup();
  db.setFailingWrites(true);
  const before = getMaxOutboxSeq(connection);
  const result = await createTask(deps, { text: "Call the dentist" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.message, "I couldn't reach Notion right now; nothing was changed.");
  assert.equal(tailOutboxSince(connection, before).length, 0);
});

test("Notion not configured: a plain 'not set up' error, never an env-var name", async () => {
  const { deps } = setup();
  const result = await createTask(
    { ...deps, getNotionCreatePageBinding: () => ({ ok: false, error: { kind: "missing-field", message: "server: missing required environment variable NOTION_TOKEN" } }) },
    { text: "Call the dentist" },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.message, "I'm not set up to do that yet — my Notion connection isn't configured.");
});

test("previewQuickAdd shows what Enter would create, resolving #tags against the given live Area options", async () => {
  const { deps } = setup();
  const result = await previewQuickAdd(deps, { text: "Lab report due fri 90m high #bio #chem", areaOptions: ["AP Bio", "Math"] });
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    title: "Lab report #chem",
    dueDate: "2026-10-02",
    estimatedDurationMinutes: 90,
    energy: "high",
    area: "AP Bio",
    unmatchedAreas: ["chem"],
  });
});

// ---------------------------------------------------------------------------
// Polish 4 Task 1: Spencer's real second input, end to end — "to act"
// resolves against a live Area option only this fixture makes unambiguous.
// ---------------------------------------------------------------------------

test("Spencer's real input: 'add ACT Math section to act. 60 minutes. deep work. status not started' — Area, Energy, Status, and duration all land in the right Notion property", async () => {
  const { db, deps } = setup({ areaOptions: ["School/ACT/College Apps", "Personal Goals", "AP Bio"] });
  const result = await createTask(deps, { text: "add ACT Math section to act. 60 minutes. deep work. status not started" });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(db.rows(), [
    { id: "created-1", title: "ACT Math section", minutes: 60, energy: "Deep", area: "School/ACT/College Apps", status: "Nothing" },
  ]);
  assert.equal(result.value.task.title, "ACT Math section");
  assert.equal(result.value.task.estimatedDurationMinutes, 60);
  assert.equal(result.value.task.energy, "high");
  assert.equal(result.value.task.status, "not-started");
  assert.equal(result.value.task.area, "School/ACT/College Apps");
});

// ---------------------------------------------------------------------------
// Polish 4 Task 1: the Haiku fallback — submit-only, only when the
// deterministic title still looks like it's carrying an unread field. Every
// test here injects `deps.normalize` (the seam `quick-add-normalize.ts`
// exposes) so NONE of them ever reach the network; `deps.llmClient` is a
// dummy that throws if `.messages.create` is ever actually called.
// ---------------------------------------------------------------------------

function fakeNormalize(
  respond: (line: string) => QuickAddNormalizeRawFields | undefined | Promise<QuickAddNormalizeRawFields | undefined>,
): (
  client: AnthropicMessagesClient,
  line: string,
  today: string,
  timeZone: string,
  options: QuickAddLiveOptions,
  connection?: SqliteConnection,
) => Promise<QuickAddNormalizeRawFields | undefined> {
  return async (_client, line) => respond(line);
}

test("Haiku fallback fills a field the deterministic parse missed (valid case)", async () => {
  const { db, deps } = setup();
  const result = await createTask(
    { ...deps, llmClient: DUMMY_LLM_CLIENT, normalize: fakeNormalize(() => ({ title: "Draft budget", energy: "high" })) },
    { text: "Draft budget high priority" },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.task.title, "Draft budget");
  assert.equal(result.value.task.energy, "high");
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Draft budget", energy: "Deep" }]);
});

test("Haiku fallback: an Area that isn't actually a live option is dropped, never written", async () => {
  const { db, deps } = setup(); // default fixture areas: School, Bio, Math, Errands, Personal
  const result = await createTask(
    { ...deps, llmClient: DUMMY_LLM_CLIENT, normalize: fakeNormalize(() => ({ title: "Draft budget", area: "Nonexistent Area" })) },
    { text: "Draft budget high priority" },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.task.area, undefined);
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Draft budget" }]);
});

test("Haiku fallback never sets Completed, even if it answers 'completed'", async () => {
  const { db, deps } = setup();
  const result = await createTask(
    { ...deps, llmClient: DUMMY_LLM_CLIENT, normalize: fakeNormalize(() => ({ title: "Draft budget", status: "completed" })) },
    { text: "Draft budget status done priority" },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.task.status, undefined);
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Draft budget" }]);
});

test("Haiku fallback: a timeout falls back to the deterministic parse alone — the Task is still created", async () => {
  const { db, deps } = setup();
  const result = await createTask(
    {
      ...deps,
      llmClient: DUMMY_LLM_CLIENT,
      quickAddNormalizeTimeoutMs: 15,
      normalize: fakeNormalize(() => new Promise((resolve) => setTimeout(() => resolve({ title: "Draft budget", energy: "high" }), 500))),
    },
    { text: "Draft budget high priority" },
  );
  assert.ok(result.ok, JSON.stringify(result));
  // The deterministic parse alone couldn't read anything out of this line — the whole line is the title, no fields.
  assert.equal(result.value.task.title, "Draft budget high priority");
  assert.equal(result.value.task.energy, undefined);
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Draft budget high priority" }]);
});

test("Haiku fallback: an LLM error falls back to the deterministic parse alone — the Task is still created", async () => {
  const { db, deps } = setup();
  const result = await createTask(
    {
      ...deps,
      llmClient: DUMMY_LLM_CLIENT,
      normalize: fakeNormalize(() => {
        throw new Error("simulated API failure");
      }),
    },
    { text: "Draft budget high priority" },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.task.title, "Draft budget high priority");
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Draft budget high priority" }]);
});

test("no llmClient configured: the Haiku fallback is skipped entirely, deterministic parse alone still creates the Task", async () => {
  const { db, deps } = setup();
  const result = await createTask(deps, { text: "Draft budget high priority" });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.task.title, "Draft budget high priority");
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Draft budget high priority" }]);
});

test("a deterministic field wins over a conflicting Haiku claim", async () => {
  const { db, deps } = setup();
  const result = await createTask(
    {
      ...deps,
      llmClient: DUMMY_LLM_CLIENT,
      normalize: fakeNormalize(() => ({ title: "Draft budget", estimatedDurationMinutes: "999" })),
    },
    // The deterministic parser already reads "30m" off the end; "priority" is what triggers the Haiku call at all.
    { text: "Draft budget 30m priority" },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.task.estimatedDurationMinutes, 30);
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Draft budget", minutes: 30 }]);
});

// ---------------------------------------------------------------------------
// Fix round 1, finding 2: an invalid Haiku title (empty or over-long) never
// overwrites the deterministic title.
// ---------------------------------------------------------------------------

test("an empty Haiku title falls back to the deterministic title, but its valid fields still land", async () => {
  const { db, deps } = setup();
  const result = await createTask(
    { ...deps, llmClient: DUMMY_LLM_CLIENT, normalize: fakeNormalize(() => ({ title: "   ", energy: "high" })) },
    { text: "Draft budget high priority" },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.task.title, "Draft budget high priority");
  assert.equal(result.value.task.energy, "high");
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Draft budget high priority", energy: "Deep" }]);
});

test("an over-long Haiku title falls back to the deterministic title", async () => {
  const { db, deps } = setup();
  const result = await createTask(
    { ...deps, llmClient: DUMMY_LLM_CLIENT, normalize: fakeNormalize(() => ({ title: "x".repeat(201), energy: "high" })) },
    { text: "Draft budget high priority" },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.task.title, "Draft budget high priority");
  assert.deepEqual(db.rows(), [{ id: "created-1", title: "Draft budget high priority", energy: "Deep" }]);
});
