/**
 * Tests for `src/adapters/notification-adapter.ts` (Story 1.10 / Task 10).
 *
 * No live Pushover account is available in this environment, so every test
 * injects a fake `fetch` (the adapter's `PushoverConfig.fetch` seam) rather
 * than hitting the real network — the same injectable-client pattern
 * `notion-adapter.ts` and `calendar-adapter.ts` already use.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PUSHOVER_MESSAGES_ENDPOINT,
  PUSHOVER_MESSAGE_LIMIT,
  PUSHOVER_TITLE_LIMIT,
  loadPushoverConfigFromEnv,
  sendPushoverNotification,
  type FetchLike,
} from "../src/adapters/notification-adapter.ts";

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

function recordingFetch(
  response: { ok: boolean; status: number; body?: string } = { ok: true, status: 200 },
): { readonly calls: RecordedCall[]; readonly fetch: FetchLike } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    return {
      ok: response.ok,
      status: response.status,
      text: async () => response.body ?? "{}",
    };
  };
  return { calls, fetch };
}

test("sendPushoverNotification POSTs exactly one form-encoded message to Pushover", async () => {
  const { calls, fetch } = recordingFetch();

  await sendPushoverNotification(
    { appToken: "app-token", userKey: "user-key", fetch },
    { title: "Today's Plan", message: "line one\nline two" },
  );

  assert.equal(calls.length, 1, "exactly one HTTP call is made per notification");
  const call = calls[0]!;
  assert.equal(call.url, PUSHOVER_MESSAGES_ENDPOINT);
  assert.equal(call.method, "POST");
  assert.equal(call.headers["Content-Type"], "application/x-www-form-urlencoded");

  const form = new URLSearchParams(call.body);
  assert.equal(form.get("token"), "app-token");
  assert.equal(form.get("user"), "user-key");
  assert.equal(form.get("title"), "Today's Plan");
  assert.equal(form.get("message"), "line one\nline two");
  // Plain text unless the caller explicitly asks for Pushover's html mode.
  assert.equal(form.get("html"), null);
});

test("sendPushoverNotification sets html=1 only when asked", async () => {
  const { calls, fetch } = recordingFetch();

  await sendPushoverNotification(
    { appToken: "t", userKey: "u", fetch },
    { title: "Today's Plan", message: "<b>hi</b>", html: true },
  );

  assert.equal(new URLSearchParams(calls[0]!.body).get("html"), "1");
});

test("AD-8: sendPushoverNotification throws on a non-ok Pushover response (adapters throw, they don't return Result)", async () => {
  const { fetch } = recordingFetch({ ok: false, status: 400, body: '{"errors":["application token is invalid"]}' });

  await assert.rejects(
    () => sendPushoverNotification({ appToken: "bad", userKey: "u", fetch }, { title: "t", message: "m" }),
    /notification-adapter/,
  );
});

test("AD-8: a transport-level fetch rejection propagates unchanged", async () => {
  const fetch: FetchLike = async () => {
    throw new Error("getaddrinfo ENOTFOUND api.pushover.net");
  };

  await assert.rejects(
    () => sendPushoverNotification({ appToken: "t", userKey: "u", fetch }, { title: "t", message: "m" }),
    /ENOTFOUND/,
  );
});

test("loadPushoverConfigFromEnv reads the documented .env.example variable names", () => {
  const config = loadPushoverConfigFromEnv({
    PUSHOVER_APP_TOKEN: "app",
    PUSHOVER_USER_KEY: "user",
  });
  assert.equal(config.appToken, "app");
  assert.equal(config.userKey, "user");
});

test("loadPushoverConfigFromEnv throws (rather than sending nowhere) when a variable is missing", () => {
  assert.throws(() => loadPushoverConfigFromEnv({ PUSHOVER_APP_TOKEN: "app" }), /PUSHOVER_USER_KEY/);
  assert.throws(() => loadPushoverConfigFromEnv({ PUSHOVER_USER_KEY: "user" }), /PUSHOVER_APP_TOKEN/);
});

// ============================================================================
// Pushover's documented size limits
//
// The adapter refuses an over-limit payload locally rather than letting
// Pushover reject it remotely: a local throw names exactly which field is
// too long and by how much, and is caught by the same AD-8 boundary in
// `rituals/` that a remote 4xx would be. `morning-ritual.ts`'s
// `buildNotificationBody` is what guarantees a real Plan never reaches this
// guard; these tests cover the guard itself, so a regression in that
// composer fails loudly here instead of silently at Pushover.
// ============================================================================

test("sendPushoverNotification refuses an over-limit message before making any HTTP call", async () => {
  const { calls, fetch } = recordingFetch();

  await assert.rejects(
    () =>
      sendPushoverNotification(
        { appToken: "t", userKey: "u", fetch },
        { title: "Today's Plan", message: "x".repeat(PUSHOVER_MESSAGE_LIMIT + 1) },
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /notification-adapter/);
      assert.match(err.message, /message/);
      // The message names the actual size and the limit, so a log line alone
      // is enough to diagnose it.
      assert.match(err.message, new RegExp(String(PUSHOVER_MESSAGE_LIMIT)));
      return true;
    },
  );

  assert.equal(calls.length, 0, "no wasted round trip to have Pushover reject it");
});

test("sendPushoverNotification refuses an over-limit title before making any HTTP call", async () => {
  const { calls, fetch } = recordingFetch();

  await assert.rejects(
    () =>
      sendPushoverNotification(
        { appToken: "t", userKey: "u", fetch },
        { title: "T".repeat(PUSHOVER_TITLE_LIMIT + 1), message: "a short body" },
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /notification-adapter/);
      assert.match(err.message, /title/);
      assert.match(err.message, new RegExp(String(PUSHOVER_TITLE_LIMIT)));
      return true;
    },
  );

  assert.equal(calls.length, 0);
});

test("a message and title exactly at their limits are sent (the guard is > , not >=)", async () => {
  const { calls, fetch } = recordingFetch();

  await sendPushoverNotification(
    { appToken: "t", userKey: "u", fetch },
    { title: "T".repeat(PUSHOVER_TITLE_LIMIT), message: "x".repeat(PUSHOVER_MESSAGE_LIMIT) },
  );

  assert.equal(calls.length, 1, "a payload exactly at the limit is legal and must not be refused");
  const form = new URLSearchParams(calls[0]!.body);
  assert.equal(form.get("message")?.length, PUSHOVER_MESSAGE_LIMIT);
  assert.equal(form.get("title")?.length, PUSHOVER_TITLE_LIMIT);
});
