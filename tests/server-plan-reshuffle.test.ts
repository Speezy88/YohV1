/**
 * Epic 10 (T4b): `POST /api/plan/reshuffle` (+ `/approve`, `/discard`), Home
 * carrying the open preview, and a chat "approve" answer applying it.
 * In-process via `app.request(...)`; fake Notion/calendar throughout.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection, type SqliteConnection } from "../src/adapters/sqlite.ts";
import { createMemoryStore, getPlan, listOpenInteractionRequests, putPlan, putTimeBudget } from "../src/adapters/memory-store.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { initCompletionLogSchema } from "../src/adapters/completion-log.ts";
import { createApp, type ServerDeps } from "../src/shell/server.ts";
import { getHomeView } from "../src/app/home-view.ts";
import { answerOpenItem } from "../src/app/answer-open-item.ts";
import { RESHUFFLE_PROPOSAL_TTL_MINUTES } from "../src/core/reshuffle-preview.ts";
import type { Plan, Task } from "../src/types/domain.ts";

const TZ = "America/New_York";
const T0 = new Date("2026-08-22T18:00:00.000Z");
const iso = (base: Date, mins: number): string => new Date(base.getTime() + mins * 60_000).toISOString();

function setup() {
  let now = T0;
  const connection: SqliteConnection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  initCompletionLogSchema(connection.db);
  const store = createMemoryStore(connection);
  putTimeBudget(store, { date: "2026-08-22", totalMinutes: 480, workMinutes: 70, breakMinutes: 15 });
  const plan: Plan = {
    id: "plan-2026-08-22", date: "2026-08-22", version: 1, reasoning: "x", createdAt: iso(T0, -60), updatedAt: iso(T0, -60),
    blocks: [{ id: "v1-work-1", kind: "work", start: iso(T0, 30), end: iso(T0, 60), label: "Future", taskId: "t2" }],
  };
  putPlan(store, plan);
  const tasks = ["t2", "t3"].map((id) => ({
    id, title: id, createdAt: iso(T0, -60), updatedAt: iso(T0, -60), estimatedDurationMinutes: 30, area: "Work",
    dueDate: "2026-08-22", status: "not-started", energy: "medium",
  })) as Task[];
  const calendarWrites: string[][] = [];
  const planDeps: NonNullable<ServerDeps["plan"]> = {
    store, connection, timeZone: TZ, now: () => now,
    readTasks: async () => tasks,
    readCalendarEvents: async () => [],
    writeCalendarPlan: async (blocks) => {
      calendarWrites.push(blocks.map((b) => b.id));
      return { written: blocks.map((b) => b.id), failed: [] };
    },
  };
  const app = createApp({ connection, log: () => {}, plan: planDeps });
  return { app, store, connection, planDeps, calendarWrites, setNow: (d: Date) => { now = d; } };
}

type Env = { ok: boolean; value?: any; error?: { kind: string; message: string } };
async function post(app: ReturnType<typeof createApp>, path: string, body: unknown): Promise<{ status: number; body: Env }> {
  const res = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Env };
}

test("reshuffle routes reject malformed bodies with 400", async () => {
  const { app } = setup();
  for (const [path, body] of [
    ["/api/plan/reshuffle", {}],
    ["/api/plan/reshuffle", { kind: "pin-task", taskId: "t1" }],
    ["/api/plan/reshuffle", { kind: "nope" }],
    ["/api/plan/reshuffle/approve", {}],
    ["/api/plan/reshuffle/discard", { proposalId: 3 }],
  ] as const) {
    const r = await post(app, path, body);
    assert.equal(r.status, 400, `${path} ${JSON.stringify(body)}`);
    assert.equal(r.body.error?.kind, "validation");
  }
});

test("reshuffle routes report unreachable when plan deps are absent", async () => {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(connection.db);
  const app = createApp({ connection, log: () => {} });
  const r = await post(app, "/api/plan/reshuffle", { kind: "reflow-now" });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.error?.kind, "unreachable");
});

test("request then approve applies the preview, writes the Plan once and syncs the calendar", async () => {
  const s = setup();
  const req = await post(s.app, "/api/plan/reshuffle", { kind: "reflow-now" });
  assert.equal(req.status, 200);
  assert.ok(req.body.ok);
  const { preview, question } = req.body.value;
  assert.deepEqual(question.options.map((o: { label: string }) => o.label), ["Approve", "Discard"]);
  assert.ok(preview.blocks.every((b: { moved: unknown }) => typeof b.moved === "boolean"));
  assert.equal(getPlan(s.store, "2026-08-22")!.data.version, 1, "a request writes no Plan");

  const approve = await post(s.app, "/api/plan/reshuffle/approve", { proposalId: preview.proposalId });
  assert.equal(approve.status, 200);
  assert.deepEqual(approve.body.value, { status: "applied", calendarFailedBlockIds: [] });
  assert.equal(getPlan(s.store, "2026-08-22")!.data.version, 2);
  assert.equal(s.calendarWrites.length, 1);
  assert.equal(listOpenInteractionRequests(s.store).length, 0);
});

test("discard writes nothing and clears the request; approving it afterwards is a stale-proposal error", async () => {
  const s = setup();
  const req = await post(s.app, "/api/plan/reshuffle", { kind: "reflow-now" });
  const id = req.body.value.preview.proposalId as string;
  const discard = await post(s.app, "/api/plan/reshuffle/discard", { proposalId: id });
  assert.deepEqual(discard.body.value, { discarded: true });
  assert.equal(getPlan(s.store, "2026-08-22")!.data.version, 1);
  assert.equal(listOpenInteractionRequests(s.store).length, 0);
  const approve = await post(s.app, "/api/plan/reshuffle/approve", { proposalId: id });
  assert.equal(approve.body.ok, false);
  assert.equal(approve.body.error?.kind, "stale-proposal");
});

test("approving an expired preview recomputes and returns a fresh preview", async () => {
  const s = setup();
  const req = await post(s.app, "/api/plan/reshuffle", { kind: "reflow-now" });
  const id = req.body.value.preview.proposalId as string;
  s.setNow(new Date(T0.getTime() + (RESHUFFLE_PROPOSAL_TTL_MINUTES + 1) * 60_000));
  const approve = await post(s.app, "/api/plan/reshuffle/approve", { proposalId: id });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.value.status, "recomputed");
  assert.notEqual(approve.body.value.preview.proposalId, id);
  assert.equal(approve.body.value.question.options[0].label, "Approve");
  assert.equal(getPlan(s.store, "2026-08-22")!.data.version, 1);
});

test("Home carries the open preview and omits an expired one", async () => {
  const s = setup();
  const homeDeps = { connection: s.connection, store: s.store, timeZone: TZ, now: () => T0, readCalendarEvents: async () => [], readTasks: async () => ({ tasks: [] as Task[] }) };
  const before = await getHomeView(homeDeps, {});
  assert.ok(before.ok && before.value.reshuffle === undefined);

  const req = await post(s.app, "/api/plan/reshuffle", { kind: "reflow-now" });
  const id = req.body.value.preview.proposalId as string;
  const open = await getHomeView(homeDeps, {});
  assert.ok(open.ok);
  if (!open.ok) return;
  assert.equal(open.value.reshuffle?.proposalId, id);
  assert.equal(open.value.reshuffle?.expiresAt, iso(T0, RESHUFFLE_PROPOSAL_TTL_MINUTES));

  const later = await getHomeView({ ...homeDeps, now: () => new Date(T0.getTime() + RESHUFFLE_PROPOSAL_TTL_MINUTES * 60_000) }, {});
  assert.ok(later.ok && later.value.reshuffle === undefined);
});

test("answering approve to the open reshuffle question through answerOpenItem applies it; an expired one returns the fresh question as next", async () => {
  const s = setup();
  const req = await post(s.app, "/api/plan/reshuffle", { kind: "reflow-now" });
  const q = req.body.value.question as { requestId: string; questionId: string };
  const deps = {
    store: s.store, session: { recentMessages: [], lastSearchAnswer: undefined },
    updateTaskField: async () => ({ ok: true as const, value: undefined }),
    setTaskStatus: async () => ({ ok: true as const, value: undefined }),
    recordCompletion: () => {}, lookupTask: async () => undefined, today: "2026-08-22", random: () => 0,
    reshuffle: { connection: s.connection, timeZone: TZ, now: s.planDeps.now, readTasks: s.planDeps.readTasks, readCalendarEvents: s.planDeps.readCalendarEvents, ...(s.planDeps.writeCalendarPlan ? { writeCalendarPlan: s.planDeps.writeCalendarPlan } : {}) },
  };
  s.setNow(new Date(T0.getTime() + (RESHUFFLE_PROPOSAL_TTL_MINUTES + 1) * 60_000));
  const recomputed = await answerOpenItem(deps, { requestId: q.requestId, questionId: q.questionId, answer: "approve" });
  assert.ok(recomputed.ok);
  if (!recomputed.ok) return;
  assert.notEqual(recomputed.value.next, "done");
  assert.equal(getPlan(s.store, "2026-08-22")!.data.version, 1);

  const next = recomputed.value.next;
  if (next === "done") return;
  const applied = await answerOpenItem(deps, { requestId: next.requestId, questionId: next.questionId, answer: "approve" });
  assert.ok(applied.ok);
  if (!applied.ok) return;
  assert.equal(applied.value.next, "done");
  assert.equal(getPlan(s.store, "2026-08-22")!.data.version, 2);
});
