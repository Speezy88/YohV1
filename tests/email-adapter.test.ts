/**
 * Tests for `src/adapters/email-adapter.ts` (Story 3.2 / Task 20).
 *
 * No live SMTP account is available in this environment, so every test
 * injects a fake transport (the adapter's `EmailConfig.transport` seam)
 * rather than hitting a real SMTP server — the same injectable-client
 * pattern `notification-adapter.ts`'s `fetch` seam already uses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEmailConfigFromEnv, sendEmail, type EmailTransportLike } from "../src/adapters/email-adapter.ts";

interface RecordedMail {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

function recordingTransport(fail?: Error): { readonly calls: RecordedMail[]; readonly transport: EmailTransportLike } {
  const calls: RecordedMail[] = [];
  const transport: EmailTransportLike = {
    sendMail: async (message) => {
      if (fail) throw fail;
      calls.push(message);
      return { messageId: "fake" };
    },
  };
  return { calls, transport };
}

test("sendEmail sends exactly one message via the injected transport", async () => {
  const { calls, transport } = recordingTransport();

  await sendEmail(
    { host: "smtp.example.com", port: 587, user: "spencer@example.com", password: "pw", from: "yoh@example.com", transport },
    { subject: "Still waiting", text: "line one\nline two" },
  );

  assert.equal(calls.length, 1, "exactly one email is sent per call");
  const call = calls[0]!;
  assert.equal(call.from, "yoh@example.com");
  assert.equal(call.to, "spencer@example.com", "defaults to the configured user's own address");
  assert.equal(call.subject, "Still waiting");
  assert.equal(call.text, "line one\nline two");
});

test("sendEmail sends to an explicit `to` address when configured, not the default", async () => {
  const { calls, transport } = recordingTransport();

  await sendEmail(
    { host: "h", port: 587, user: "spencer@example.com", password: "pw", from: "yoh@example.com", to: "other@example.com", transport },
    { subject: "s", text: "t" },
  );

  assert.equal(calls[0]!.to, "other@example.com");
});

test("AD-8: sendEmail throws (does not catch/retry) when the transport rejects", async () => {
  const { transport } = recordingTransport(new Error("ECONNREFUSED smtp.example.com"));

  await assert.rejects(
    () =>
      sendEmail(
        { host: "h", port: 587, user: "u@example.com", password: "pw", from: "f@example.com", transport },
        { subject: "s", text: "t" },
      ),
    /ECONNREFUSED/,
  );
});

test("loadEmailConfigFromEnv reads the documented .env.example variable names", () => {
  const config = loadEmailConfigFromEnv({
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "spencer@example.com",
    SMTP_PASSWORD: "secret",
    SMTP_FROM: "yoh@example.com",
  });
  assert.equal(config.host, "smtp.example.com");
  assert.equal(config.port, 587);
  assert.equal(config.user, "spencer@example.com");
  assert.equal(config.password, "secret");
  assert.equal(config.from, "yoh@example.com");
  assert.equal(config.to, "spencer@example.com", "defaults `to` to `user` when SMTP_TO is unset");
});

test("loadEmailConfigFromEnv throws (rather than sending nowhere) when a variable is missing", () => {
  assert.throws(
    () =>
      loadEmailConfigFromEnv({
        SMTP_HOST: "h",
        SMTP_PORT: "587",
        SMTP_USER: "u@example.com",
        SMTP_FROM: "f@example.com",
        // SMTP_PASSWORD missing
      }),
    /SMTP_PASSWORD/,
  );
});

test("loadEmailConfigFromEnv throws when SMTP_PORT doesn't parse as a number", () => {
  assert.throws(
    () =>
      loadEmailConfigFromEnv({
        SMTP_HOST: "h",
        SMTP_PORT: "not-a-number",
        SMTP_USER: "u@example.com",
        SMTP_PASSWORD: "pw",
        SMTP_FROM: "f@example.com",
      }),
    /SMTP_PORT/,
  );
});
