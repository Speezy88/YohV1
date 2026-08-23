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
