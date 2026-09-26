/**
 * Compile-time smoke test for `src/types/api.ts` (Story 7.2, AD-9/AD-18).
 *
 * `api.ts` is type-only, so, like `tests/domain-types.smoke.test.ts` for
 * `domain.ts`, this file's real job is to fail `tsc --noEmit` if a locked
 * wire shape drifts. The `@ts-expect-error` lines pin the CLOSED-ness of
 * each shape: if a later story widens `NotificationKind` (e.g. adds a
 * check-in kind, which FR-49 forbids) or loosens the `ApiResult` envelope,
 * the directive becomes unused and `tsc` fails here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  CheckOffRequest,
  PendingCheckOffResponse,
  UndoCheckOffResponse,
  ApiResult,
  EventHint,
  HealthResponse,
  HomeCalendarBlock,
  HomeViewResponse,
  MarkNotificationReadRequest,
  MarkNotificationReadResponse,
  NotificationKind,
  NotificationList,
  NotificationRecord,
} from "../src/types/api.ts";
import type { Result, YohError } from "../src/types/domain.ts";

test("ApiResult<T> shapes both branches of the serialized Result envelope", () => {
  const ok: ApiResult<{ n: number }> = { ok: true, value: { n: 1 } };
  const err: ApiResult<{ n: number }> = { ok: false, error: { kind: "validation", message: "bad" } };
  // The wire envelope IS domain.ts's Result<T, YohError> — no parallel declaration to drift.
  const asDomain: Result<{ n: number }, YohError> = ok;
  // @ts-expect-error — a success branch must carry `value`.
  const missingValue: ApiResult<{ n: number }> = { ok: true };
  // @ts-expect-error — a failure branch carries a YohError, never a bare string.
  const stringError: ApiResult<{ n: number }> = { ok: false, error: "bad" };
  assert.equal(ok.ok, true);
  assert.equal(err.ok, false);
  assert.equal(asDomain.ok, true);
  assert.ok(missingValue && stringError);
});

test("HealthResponse is exactly {ok: true}", () => {
  const health: HealthResponse = { ok: true };
  // @ts-expect-error — health is a liveness probe; it never reports ok:false.
  const unhealthy: HealthResponse = { ok: false };
  assert.deepEqual(health, { ok: true });
  assert.ok(unhealthy);
});

test("EventHint carries exactly seq/topic/entityId", () => {
  const hint: EventHint = { seq: 1, topic: "plan", entityId: "2026-09-25" };
  assert.deepEqual(Object.keys(hint).sort(), ["entityId", "seq", "topic"]);
});

test("NotificationKind is the closed seven-member union", () => {
  const kinds: readonly NotificationKind[] = [
    "research-ready",
    "research-failed",
    "sandbox-complete",
    "sandbox-failed",
    "needs-data",
    "reshuffle-apply-failed",
    "operational",
  ];
  // @ts-expect-error — FR-49: a proactive check-in is not a constructible kind.
  const checkIn: NotificationKind = "check-in";
  assert.equal(new Set(kinds).size, 7);
  assert.ok(checkIn);
});

test("NotificationRecord matches AD-18's {id, kind, title, body, deepLink, createdAt, readAt?}", () => {
  const linked: NotificationRecord = {
    id: "n1",
    kind: "research-ready",
    title: "Research ready: tide tables",
    body: "Filed to the Research Vault.",
    deepLink: "/tasks",
    createdAt: "2026-09-25T00:00:00.000Z",
    readAt: "2026-09-25T00:05:00.000Z",
  };
  // Epics Story 7.7: an operational notification is message-only. Ruling R11:
  // it still carries the deepLink KEY (AD-18's field set), with value null.
  const operational: NotificationRecord = {
    id: "n2",
    kind: "operational",
    title: "Notion sign-in expired",
    body: "Reconnect Notion to keep writes flowing.",
    deepLink: null,
    createdAt: "2026-09-25T00:00:00.000Z",
  };
  // @ts-expect-error — R11: deepLink is a required key; omitting it must not type-check.
  const missingDeepLink: NotificationRecord = {
    id: "n3",
    kind: "operational",
    title: "Notion sign-in expired",
    body: "Reconnect Notion to keep writes flowing.",
    createdAt: "2026-09-25T00:00:00.000Z",
  };
  // @ts-expect-error — R11: "no deep link" is null, never undefined.
  const undefinedDeepLink: NotificationRecord = { ...operational, deepLink: undefined };
  assert.equal(linked.deepLink, "/tasks");
  assert.equal(operational.deepLink, null);
  assert.ok("deepLink" in operational);
  assert.equal(operational.readAt, undefined);
  assert.ok(missingDeepLink && undefinedDeepLink);
});

test("Story 7.8 HomeViewResponse: plan is undefined when no Plan exists; calendar block kind is the closed work/break/fixed union", () => {
  const noPlanYet: HomeViewResponse = { today: "2026-09-25", plan: undefined, calendar: { blocks: [] } };
  const withPlan: HomeViewResponse = {
    today: "2026-09-25",
    plan: { rows: [{ blockId: "b1", taskId: "t1", label: "Draft the memo", start: "x", end: "y", completed: false, past: false }] },
    calendar: { blocks: [{ id: "b1", kind: "work", label: "Draft the memo", start: "x", end: "y", completed: false, past: false }] },
  };
  const fixed: HomeCalendarBlock = { id: "e1", kind: "fixed", label: "Soccer practice", start: "x", end: "y", completed: false, past: false };
  // @ts-expect-error — HomeCalendarBlock.kind is closed to work/break/fixed; a raw Calendar-anchor label never leaks onto the wire.
  const badKind: HomeCalendarBlock = { ...fixed, kind: "calendar-anchor" };
  assert.equal(noPlanYet.plan, undefined);
  assert.equal(withPlan.plan?.rows.length, 1);
  assert.equal(fixed.kind, "fixed");
  assert.ok(badKind);
});

test("Story 7.3 notification route shapes: NotificationList, MarkNotificationReadRequest/Response", () => {
  const list: ApiResult<NotificationList> = { ok: true, value: { notifications: [] } };
  const request: MarkNotificationReadRequest = { id: "n1" };
  const response: ApiResult<MarkNotificationReadResponse> = { ok: true, value: { id: "n1", readAt: "2026-09-25T00:00:00.000Z" } };
  // @ts-expect-error — readAt is required on a mark-read response.
  const missingReadAt: MarkNotificationReadResponse = { id: "n1" };
  assert.ok(list.ok && response.ok && request.id && missingReadAt);
});

test("Story 7.10 check-off shapes: the request carries only the Task id (Ruling R7); the pending response carries the server's commitAt and asOf", () => {
  const request: CheckOffRequest = { taskId: "t1" };
  // @ts-expect-error — R7: area/dueDate/estimatedMinutes are looked up server-side, never sent by the client.
  const widened: CheckOffRequest = { taskId: "t1", area: "Work" };
  const pending: ApiResult<PendingCheckOffResponse> = {
    ok: true,
    value: { id: "p1", taskId: "t1", commitAt: "2026-09-25T18:00:05.000Z", asOf: "2026-09-25T18:00:00.000Z", held: false },
  };
  // @ts-expect-error — commitAt is required: the client never hard-codes the undo window (AD-20).
  const missingCommitAt: PendingCheckOffResponse = { id: "p1", taskId: "t1", asOf: "2026-09-25T18:00:00.000Z", held: false };
  const undone: UndoCheckOffResponse = { id: "p1" };
  assert.ok(request.taskId && widened && pending.ok && missingCommitAt && undone.id);
});
