/** Tests for `src/app/queue-research.ts` (Story 11.3). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { queueResearch, type QueueResearchDeps } from "../src/app/queue-research.ts";
import { initJobStoreSchema } from "../src/adapters/job-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";

function deps(over: Partial<QueueResearchDeps> = {}) {
  const connection = openSqliteConnection({ databasePath: ":memory:" });
  initJobStoreSchema(connection.db);
  const d: QueueResearchDeps = {
    connection,
    webSearchAvailable: true,
    now: () => new Date("2026-10-04T10:00:00.000Z"),
    getNotionCreatePageBinding: () => ({ ok: true, value: { client: {} as never, config: { researchVaultDataSourceId: "ds-1" } as never } }),
    ...over,
  };
  return { d, connection };
}
const count = (c: ReturnType<typeof deps>["connection"]) => (c.db.prepare("SELECT COUNT(*) AS n FROM research_jobs").get() as { n: number }).n;

test("queues one job and acknowledges", async () => {
  const { d, connection } = deps();
  const r = await queueResearch(d, { question: "best budget laptops" });
  assert.deepEqual(r, { ok: true, value: { reply: "Queued. You'll get a notification when it's on Research Hub.", receipts: [] } });
  const row = connection.db.prepare("SELECT question, status, created_at FROM research_jobs").get();
  assert.deepEqual({ ...(row as object) }, { question: "best budget laptops", status: "queued", created_at: "2026-10-04T10:00:00.000Z" });
});

test("honest replies and no job for empty, no search, no vault, no connection", async () => {
  const noVault = "The Research Vault isn't set up yet, so there's nowhere to file research.";
  const cases: Array<[Partial<QueueResearchDeps>, string, string]> = [
    [{}, "   ", "Say what to research, like /research best budget laptops for college."],
    [{ webSearchAvailable: false }, "q", "Web search isn't set up yet (it needs a Perplexity key)."],
    [{ getNotionCreatePageBinding: () => ({ ok: false, error: { kind: "missing-field", message: "x" } }) }, "q", noVault],
    [{ getNotionCreatePageBinding: () => ({ ok: true, value: { client: {} as never, config: { researchVaultDataSourceId: "" } as never } }) }, "q", noVault],
  ];
  for (const [over, question, reply] of cases) {
    const { d, connection } = deps(over);
    assert.deepEqual(await queueResearch(d, { question }), { ok: true, value: { reply, receipts: [] } });
    assert.equal(count(connection), 0);
  }
  const { d } = deps();
  const { connection: _omit, ...noConn } = d;
  assert.deepEqual(await queueResearch(noConn, { question: "q" }), { ok: true, value: { reply: "Background research isn't available right now.", receipts: [] } });
});
