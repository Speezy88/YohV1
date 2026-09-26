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
import type { ApiResult, EventHint, HealthResponse, NotificationKind, NotificationRecord } from "../src/types/api.ts";
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
