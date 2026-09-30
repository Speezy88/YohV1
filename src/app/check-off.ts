/**
 * src/app/check-off.ts
 *
 * Story 7.10, AD-16/AD-20/AD-23: checking a Task off on Home, with undo.
 *
 * - `checkOff` records a PENDING completion in `plan-state-store.ts`:
 *   `completedAt` = the click instant, `commitAt = completedAt +
 *   UNDO_WINDOW_MS`. It returns `commitAt` (and the server's own `asOf`) so
 *   the client never hard-codes the window. The click path touches only
 *   local SQLite — no Notion round trip — so the response is immediate
 *   (NFR-Latency). The pending record is named from today's stored Plan row.
 * - `undoCheckOff` deletes the pending record while it is still
 *   uncommitted; nothing ever reaches the Completion Log or Notion.
 * - `holdCheckOff`/`releaseCheckOff` pause the window while the Undo Toast
 *   is hovered or focused (WCAG 2.2.1); release resumes it with exactly the
 *   time it had left.
 * - `commitDueCheckOffs` is the ONE sweep — `shell/server.ts` runs it at
 *   startup (overdue records from a previous process) and on its commit
 *   timer. Commit order is fixed (AD-20): `recordCompletionInTx` first, in
 *   the same transaction that claims the record (so it can never run twice),
 *   then — outside any transaction — `setTaskStatus(completed)`, the
 *   Status-only write (AD-12). A Notion failure keeps the log entry, leaves
 *   the sync owed for a later sweep, and raises one `operational`
 *   notification; a retry only ever re-attempts the Notion write.
 *
 * **Ruling R7 — the snapshot.** The client sends only `{taskId}`. The
 * Completion Log's `area`/`dueDate`/`estimatedMinutes` come from a live
 * `lookupTask` read made when the record commits (the completion is being
 * written then; the window is ~5 s, so the values are the click-time ones),
 * which keeps Notion's read latency off the click path. A lookup failure
 * never blocks the commit: the three fields are `null` and the name falls
 * back to the Plan row's label.
 *
 * **Only `app/` calls a Notion write (AD-16).** This file receives the
 * Notion client and Status config as dependencies and calls
 * `notion-adapter.ts`'s `setTaskStatus` itself; `shell/server.ts` only
 * constructs the client.
 */
import type { LogEntry } from "../adapters/logger.ts";
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { getPlan, PLAN_TOPIC, type MemoryStore } from "../adapters/memory-store.ts";
import {
  claimDueCheckOffInTx,
  createPendingCheckOffInTx,
  deleteUncommittedCheckOffInTx,
  findUncommittedCheckOffForTask,
  holdPendingCheckOff,
  leaseNotionRetryInTx,
  listDueCheckOffs,
  listNotionSyncDueCheckOffs,
  markNotionSyncFailedInTx,
  releasePendingCheckOff,
  removePendingCheckOff,
  type PendingCheckOff,
} from "../adapters/plan-state-store.ts";
import { recordCompletionInTx } from "../adapters/completion-log.ts";
import { appendOutboxInTx, createNotificationInTx } from "../adapters/notification-store.ts";
import {
  setTaskStatus,
  type NotionSchemaClient,
  type NotionStatusWriteConfig,
  type NotionWriteClient,
} from "../adapters/notion-adapter.ts";
import { localIsoDate } from "../rituals/ritual-shared.ts";
import type { CheckOffIdRequest, CheckOffRequest, PendingCheckOffResponse, UndoCheckOffResponse } from "../types/api.ts";
import type { CheckOffSweepSummary, ExternalId, Result, Task, YohError } from "../types/domain.ts";

/** How often `shell/server.ts`'s commit timer runs `commitDueCheckOffs` — the one defining export. */
export const CHECK_OFF_COMMIT_TICK_MS = 1000;

/**
 * How long after a failed Notion Status write the sweep tries again — the
 * one defining export. A retry every commit tick would hammer Notion's rate
 * limit for as long as it's down.
 */
export const CHECK_OFF_NOTION_RETRY_MS = 60_000;

export interface CheckOffDeps {
  readonly connection: SqliteConnection;
  /** Today's stored Plan names the pending record (no Notion round trip on the click path). */
  readonly store: MemoryStore;
  /** The one configured host timezone — "today" for the Plan lookup. */
  readonly timeZone: string;
  /** A real `@notionhq/client` `Client` in production; a fake in tests. Only this file calls the write with it. */
  readonly notionClient: NotionWriteClient & NotionSchemaClient;
  readonly notionStatusConfig: NotionStatusWriteConfig;
  /** A live per-id Task read (Ruling R7), used at commit to snapshot the Completion Log fields. May throw. */
  readonly lookupTask: (taskId: ExternalId) => Promise<Task | undefined>;
  readonly now: () => Date;
  readonly log?: (entry: LogEntry) => void;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function failure(kind: YohError["kind"], message: string, detail?: unknown): { ok: false; error: YohError } {
  return { ok: false, error: { kind, message: `check-off: ${message}`, ...(detail !== undefined ? { detail } : {}) } };
}

function toResponse(row: PendingCheckOff, asOf: Date): PendingCheckOffResponse {
  return { id: row.id, taskId: row.taskId, commitAt: row.commitAt, asOf: asOf.toISOString(), held: row.heldSince !== undefined };
}

/** The label of `taskId`'s row on today's stored Plan, if it has one. */
function planLabel(deps: CheckOffDeps, taskId: ExternalId, now: Date): string | undefined {
  const plan = getPlan(deps.store, localIsoDate(now, deps.timeZone));
  return plan?.data.blocks.find((b) => b.kind === "work" && b.taskId === taskId)?.label;
}

/** Story 13.2: the first `work` block for `taskId` on the Plan of the day the check-off was clicked, if any. */
function plannedWindow(deps: CheckOffDeps, taskId: ExternalId, completedAt: string): { plannedStart: string | null; plannedEnd: string | null } {
  const plan = getPlan(deps.store, localIsoDate(new Date(completedAt), deps.timeZone));
  const block = plan?.data.blocks.find((b) => b.kind === "work" && b.taskId === taskId);
  return { plannedStart: block?.start ?? null, plannedEnd: block?.end ?? null };
}

// ============================================================================
// Interaction use-cases (routes)
// ============================================================================

/**
 * Records a pending completion for `taskId`. A Task that already has an
 * undoable pending record gets that record back — a repeated click can
 * never produce two completions.
 */
export async function checkOff(deps: CheckOffDeps, input: CheckOffRequest): Promise<Result<PendingCheckOffResponse, YohError>> {
  if (typeof input.taskId !== "string" || input.taskId.trim() === "") return failure("validation", "missing taskId");
  const now = deps.now();
  try {
    const existing = findUncommittedCheckOffForTask(deps.connection, input.taskId);
    if (existing) return { ok: true, value: toResponse(existing, now) };
    const taskName = planLabel(deps, input.taskId, now) ?? input.taskId;
    const row = deps.connection.writeTx((db) => createPendingCheckOffInTx(db, { taskId: input.taskId, taskName, completedAt: now.toISOString() }));
    return { ok: true, value: toResponse(row, now) };
  } catch (err) {
    return failure("unreachable", `could not record the check-off: ${describeError(err)}`, err);
  }
}

/**
 * Undo: deletes the still-pending record. Anything else is a `conflict` —
 * a record that already committed (its log entry stands) and one already
 * fully synced and forgotten are indistinguishable by then, and both mean
 * "too late to undo" to the client.
 */
export async function undoCheckOff(deps: CheckOffDeps, input: CheckOffIdRequest): Promise<Result<UndoCheckOffResponse, YohError>> {
  try {
    const outcome = deps.connection.writeTx((db) => deleteUncommittedCheckOffInTx(db, input.id));
    if (outcome === "deleted") return { ok: true, value: { id: input.id } };
    return notPending(input.id, "undo");
  } catch (err) {
    return failure("unreachable", `could not undo ${input.id}: ${describeError(err)}`, err);
  }
}

function notPending(id: string, what: string): { ok: false; error: YohError } {
  return failure("conflict", `${what}: ${id} is no longer pending`);
}

/** Pauses the window while the Undo Toast is hovered or focused (WCAG 2.2.1). */
export async function holdCheckOff(deps: CheckOffDeps, input: CheckOffIdRequest): Promise<Result<PendingCheckOffResponse, YohError>> {
  const now = deps.now();
  try {
    const row = holdPendingCheckOff(deps.connection, input.id, now.toISOString());
    return row ? { ok: true, value: toResponse(row, now) } : notPending(input.id, "hold");
  } catch (err) {
    return failure("unreachable", `could not hold ${input.id}: ${describeError(err)}`, err);
  }
}

/** Ends a hold; the returned `commitAt` gives the window back exactly the time it had left. */
export async function releaseCheckOff(deps: CheckOffDeps, input: CheckOffIdRequest): Promise<Result<PendingCheckOffResponse, YohError>> {
  const now = deps.now();
  try {
    const row = releasePendingCheckOff(deps.connection, input.id, now.toISOString());
    return row ? { ok: true, value: toResponse(row, now) } : notPending(input.id, "release");
  } catch (err) {
    return failure("unreachable", `could not release ${input.id}: ${describeError(err)}`, err);
  }
}

// ============================================================================
// Commit sweep (server timer + startup)
// ============================================================================

async function lookupSnapshot(deps: CheckOffDeps, row: PendingCheckOff): Promise<Task | undefined> {
  try {
    return await deps.lookupTask(row.taskId);
  } catch (err) {
    // Ruling R7: never blocks the commit — the snapshot is simply null.
    deps.log?.({ level: "error", event: "check-off.lookup-failed", detail: { taskId: row.taskId, message: describeError(err) } });
    return undefined;
  }
}

function retryAt(deps: CheckOffDeps): string {
  return new Date(deps.now().getTime() + CHECK_OFF_NOTION_RETRY_MS).toISOString();
}

/** One Notion Status write for an already-logged record. `true` on success (the record is then forgotten). */
async function syncNotion(deps: CheckOffDeps, row: PendingCheckOff, taskName: string): Promise<boolean> {
  let written: Result<void, YohError>;
  try {
    written = await setTaskStatus(deps.notionClient, deps.notionStatusConfig, row.taskId, "completed");
  } catch (err) {
    written = failure("unreachable", describeError(err));
  }

  if (written.ok) {
    removePendingCheckOff(deps.connection, row.id);
    return true;
  }

  deps.log?.({ level: "error", event: "check-off.notion-sync-failed", detail: { taskId: row.taskId, message: written.error.message } });
  const createdAt = deps.now().toISOString();
  deps.connection.writeTx((db) => {
    if (markNotionSyncFailedInTx(db, row.id, retryAt(deps))) {
      const message = `Couldn't update Notion for ${taskName} — retrying`;
      createNotificationInTx(db, { kind: "operational", title: "Couldn't update Notion", body: message, deepLink: null, createdAt });
    }
  });
  return false;
}

/**
 * Commits every due pending check-off, then retries every Notion sync that
 * is owed and due. Safe to run concurrently with itself: each record is
 * claimed (and its retry leased) inside a transaction, so no completion is
 * recorded twice and no Notion write is made twice by overlapping sweeps.
 */
export async function commitDueCheckOffs(deps: CheckOffDeps, _input: Record<string, never>): Promise<Result<CheckOffSweepSummary, YohError>> {
  let committed = 0;
  let notionSynced = 0;
  let notionFailed = 0;
  try {
    for (const row of listDueCheckOffs(deps.connection, deps.now())) {
      const task = await lookupSnapshot(deps, row);
      const taskName = task?.title ?? row.taskName;
      const planned = plannedWindow(deps, row.taskId, row.completedAt);
      const claimed = deps.connection.writeTx((db) => {
        if (!claimDueCheckOffInTx(db, row.id, deps.now(), retryAt(deps))) return false;
        recordCompletionInTx(db, {
          taskId: row.taskId,
          taskName,
          area: task?.area ?? null,
          dueDate: task?.dueDate ?? null,
          estimatedMinutes: task?.estimatedDurationMinutes ?? null,
          completedAt: row.completedAt,
          source: "check-off",
          plannedStart: planned.plannedStart,
          plannedEnd: planned.plannedEnd,
        });
        appendOutboxInTx(db, { topic: PLAN_TOPIC, entityId: row.taskId });
        return true;
      });
      if (!claimed) continue; // undone, held, or claimed by an overlapping sweep since it was listed
      committed++;
      if (await syncNotion(deps, row, taskName)) notionSynced++;
      else notionFailed++;
    }

    for (const row of listNotionSyncDueCheckOffs(deps.connection, deps.now())) {
      const leased = deps.connection.writeTx((db) => leaseNotionRetryInTx(db, row.id, deps.now(), retryAt(deps)));
      if (!leased) continue;
      if (await syncNotion(deps, row, row.taskName)) notionSynced++;
      else notionFailed++;
    }
  } catch (err) {
    return failure("unreachable", `commit sweep stopped early: ${describeError(err)}`, err);
  }
  return { ok: true, value: { committed, notionSynced, notionFailed } };
}
