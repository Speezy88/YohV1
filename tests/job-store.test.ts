/** Tests for `src/adapters/job-store.ts` (Story 11.3). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimNextResearchJob,
  initJobStoreSchema,
  insertQueuedResearchJobInTx,
  listRunningResearchJobs,
  markResearchJobDoneInTx,
  markResearchJobFailedInTx,
} from "../src/adapters/job-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";

function setup() {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initJobStoreSchema(connection.db);
  return connection;
}
const t0 = "2026-10-04T10:00:00.000Z";
const t1 = "2026-10-04T10:05:00.000Z";

test("claims the oldest queued job first, ties by insertion order, one running at a time", () => {
  const c = setup();
  const [a, b, d] = c.writeTx((tx) => [
    insertQueuedResearchJobInTx(tx, { question: "a", createdAt: t1 }),
    insertQueuedResearchJobInTx(tx, { question: "b", createdAt: t0 }),
    insertQueuedResearchJobInTx(tx, { question: "d", createdAt: t0 }),
  ]) as [string, string, string];
  const first = claimNextResearchJob(c, t1);
  assert.equal(first?.id, b);
  assert.equal(first?.status, "running");
  assert.equal(first?.claimedAt, t1);
  assert.equal(claimNextResearchJob(c, t1), undefined, "another job is running");
  c.writeTx((tx) => markResearchJobDoneInTx(tx, b, { pageId: "p1", finishedAt: t1 }));
  assert.equal(claimNextResearchJob(c, t1)?.id, d);
  c.writeTx((tx) => markResearchJobFailedInTx(tx, d, { error: "boom", finishedAt: t1 }));
  assert.equal(claimNextResearchJob(c, t1)?.id, a);
});

test("done and failed transitions record page id, error and finish time", () => {
  const c = setup();
  const id = c.writeTx((tx) => insertQueuedResearchJobInTx(tx, { question: "q", createdAt: t0 }));
  claimNextResearchJob(c, t0);
  assert.equal(listRunningResearchJobs(c).length, 1);
  c.writeTx((tx) => markResearchJobDoneInTx(tx, id, { pageId: "page-9", finishedAt: t1 }));
  assert.deepEqual(listRunningResearchJobs(c), []);
  const row = c.db.prepare("SELECT status, page_id, finished_at, error FROM research_jobs WHERE id = ?").get(id);
  assert.deepEqual({ ...(row as object) }, { status: "done", page_id: "page-9", finished_at: t1, error: null });
  const id2 = c.writeTx((tx) => insertQueuedResearchJobInTx(tx, { question: "q2", createdAt: t0 }));
  claimNextResearchJob(c, t0);
  c.writeTx((tx) => markResearchJobFailedInTx(tx, id2, { error: "nope", finishedAt: t1 }));
  const row2 = c.db.prepare("SELECT status, page_id, error FROM research_jobs WHERE id = ?").get(id2);
  assert.deepEqual({ ...(row2 as object) }, { status: "failed", page_id: null, error: "nope" });
});

test("claim returns nothing when the queue is empty", () => {
  assert.equal(claimNextResearchJob(setup(), t0), undefined);
});

test("M4: a done row cannot be moved to failed, a queued row cannot be marked done", () => {
  const c = setup();
  const id = c.writeTx((tx) => insertQueuedResearchJobInTx(tx, { question: "a", createdAt: t0 })) as string;
  c.writeTx((tx) => markResearchJobDoneInTx(tx, id, { pageId: "p", finishedAt: t1 }));
  assert.equal((c.db.prepare("SELECT status FROM research_jobs WHERE id = ?").get(id) as { status: string }).status, "queued");
  claimNextResearchJob(c, t0);
  c.writeTx((tx) => markResearchJobDoneInTx(tx, id, { pageId: "p", finishedAt: t1 }));
  c.writeTx((tx) => markResearchJobFailedInTx(tx, id, { error: "late", finishedAt: t1 }));
  assert.deepEqual({ ...(c.db.prepare("SELECT status, page_id, error FROM research_jobs WHERE id = ?").get(id) as object) }, { status: "done", page_id: "p", error: null });
});

test("M2: a failed mark can carry the filed page id", () => {
  const c = setup();
  const id = c.writeTx((tx) => insertQueuedResearchJobInTx(tx, { question: "a", createdAt: t0 })) as string;
  claimNextResearchJob(c, t0);
  c.writeTx((tx) => markResearchJobFailedInTx(tx, id, { error: "e", finishedAt: t1, pageId: "p" }));
  assert.deepEqual({ ...(c.db.prepare("SELECT status, page_id FROM research_jobs WHERE id = ?").get(id) as object) }, { status: "failed", page_id: "p" });
});
