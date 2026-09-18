/**
 * Tests for `src/adapters/token-store.ts`.
 *
 * Per the Task 2 brief's Ruling, `token-store.ts` must be fully implemented
 * and unit-testable WITHOUT real credentials: every test here constructs the
 * `OAuth2Client` from env-var-shaped / injected placeholder config and never
 * makes a real network call. A "refresh" is simulated by emitting the same
 * `'tokens'` event `google-auth-library`'s `OAuth2Client` emits internally
 * after a real refresh (confirmed by reading
 * `node_modules/google-auth-library/build/src/auth/oauth2client.js`, which
 * calls `this.emit('tokens', tokens)` from both `setCredentials` and
 * `refreshAccessToken`/`getTokenAsync` — synchronous, no network I/O).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { OAuth2Client } from "google-auth-library";
import {
  loadGoogleOAuthConfigFromEnv,
  createTokenStore,
  GOOGLE_CALENDAR_BROAD_SCOPE,
  GOOGLE_OAUTH_SCOPES,
} from "../src/adapters/token-store.ts";

function tempTokenFilePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "yoh-token-store-test-"));
  return join(dir, "google-token.json");
}

test("loadGoogleOAuthConfigFromEnv throws when required env vars are missing", () => {
  assert.throws(() => {
    loadGoogleOAuthConfigFromEnv({});
  }, /GOOGLE_CLIENT_ID/);

  assert.throws(() => {
    loadGoogleOAuthConfigFromEnv({ GOOGLE_CLIENT_ID: "id-only" });
  }, /GOOGLE_CLIENT_SECRET/);
});

test("loadGoogleOAuthConfigFromEnv reads static config from environment variables at process start", () => {
  const config = loadGoogleOAuthConfigFromEnv({
    GOOGLE_CLIENT_ID: "fake-client-id",
    GOOGLE_CLIENT_SECRET: "fake-client-secret",
    GOOGLE_REDIRECT_URI: "http://localhost:3000/oauth2callback",
    GOOGLE_TOKEN_FILE_PATH: "/tmp/does-not-matter.json",
    GOOGLE_REFRESH_TOKEN: "seed-refresh-token",
  });

  assert.equal(config.clientId, "fake-client-id");
  assert.equal(config.clientSecret, "fake-client-secret");
  assert.equal(config.redirectUri, "http://localhost:3000/oauth2callback");
  assert.equal(config.tokenFilePath, "/tmp/does-not-matter.json");
  assert.equal(config.initialRefreshToken, "seed-refresh-token");
});

test("loadGoogleOAuthConfigFromEnv defaults GOOGLE_TOKEN_FILE_PATH when not set", () => {
  const config = loadGoogleOAuthConfigFromEnv({
    GOOGLE_CLIENT_ID: "fake-client-id",
    GOOGLE_CLIENT_SECRET: "fake-client-secret",
    GOOGLE_REDIRECT_URI: "http://localhost:3000/oauth2callback",
  });
  assert.equal(typeof config.tokenFilePath, "string");
  assert.ok(config.tokenFilePath.length > 0);
  assert.equal(config.initialRefreshToken, undefined);
});

test("createTokenStore is the sole constructor of a real OAuth2Client, configured from placeholder config, no network call", () => {
  const tokenFilePath = tempTokenFilePath();
  const store = createTokenStore({
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    redirectUri: "http://localhost:3000/oauth2callback",
    tokenFilePath,
    initialRefreshToken: "seed-refresh-token",
  });

  const client = store.getOAuth2Client();
  assert.ok(client instanceof OAuth2Client);
  assert.equal(client._clientId, "fake-client-id");
  assert.equal(client._clientSecret, "fake-client-secret");
  assert.equal(client.credentials.refresh_token, "seed-refresh-token");
});

test("createTokenStore persists the initial (seed) refresh token to disk immediately", () => {
  const tokenFilePath = tempTokenFilePath();
  createTokenStore({
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    redirectUri: "http://localhost:3000/oauth2callback",
    tokenFilePath,
    initialRefreshToken: "seed-refresh-token",
  });

  const onDisk = JSON.parse(readFileSync(tokenFilePath, "utf8"));
  assert.equal(onDisk.refreshToken, "seed-refresh-token");
});

test("token-store.ts rewrites the refresh token to disk immediately after every refresh (AD-10)", () => {
  const tokenFilePath = tempTokenFilePath();
  const store = createTokenStore({
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    redirectUri: "http://localhost:3000/oauth2callback",
    tokenFilePath,
    initialRefreshToken: "old-refresh-token",
  });

  const beforeRefresh = JSON.parse(readFileSync(tokenFilePath, "utf8"));
  assert.equal(beforeRefresh.refreshToken, "old-refresh-token");

  // Simulate what google-auth-library's OAuth2Client does internally after a
  // real token refresh — emits its own 'tokens' event synchronously, no
  // network call involved in this test.
  store.getOAuth2Client().emit("tokens", {
    refresh_token: "new-refresh-token",
    access_token: "new-access-token",
  });

  const afterRefresh = JSON.parse(readFileSync(tokenFilePath, "utf8"));
  assert.equal(afterRefresh.refreshToken, "new-refresh-token");
});

test("a refreshed access token with no new refresh_token does not overwrite the stored refresh token", () => {
  const tokenFilePath = tempTokenFilePath();
  const store = createTokenStore({
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    redirectUri: "http://localhost:3000/oauth2callback",
    tokenFilePath,
    initialRefreshToken: "stable-refresh-token",
  });

  // Google only returns a new refresh_token occasionally; most access-token
  // refreshes carry only a new access_token.
  store.getOAuth2Client().emit("tokens", { access_token: "new-access-token" });

  const onDisk = JSON.parse(readFileSync(tokenFilePath, "utf8"));
  assert.equal(onDisk.refreshToken, "stable-refresh-token");
});

test("createTokenStore loads an existing refresh token from disk on restart, not the (stale) initialRefreshToken", () => {
  const tokenFilePath = tempTokenFilePath();
  const first = createTokenStore({
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    redirectUri: "http://localhost:3000/oauth2callback",
    tokenFilePath,
    initialRefreshToken: "original-token",
  });
  first.getOAuth2Client().emit("tokens", { refresh_token: "rotated-token" });

  // Simulates a process restart: a fresh TokenStore against the same file,
  // with a stale/irrelevant env-sourced initialRefreshToken.
  const second = createTokenStore({
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    redirectUri: "http://localhost:3000/oauth2callback",
    tokenFilePath,
    initialRefreshToken: "original-token",
  });

  assert.equal(second.getOAuth2Client().credentials.refresh_token, "rotated-token");
});

test("getCalendarId/setCalendarId persist the app-created 'Yoh Plan' secondary calendar id (AD-10) to the same token file", () => {
  const tokenFilePath = tempTokenFilePath();
  const store = createTokenStore({
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    redirectUri: "http://localhost:3000/oauth2callback",
    tokenFilePath,
    initialRefreshToken: "seed-refresh-token",
  });

  assert.equal(store.getCalendarId(), undefined);
  store.setCalendarId("yoh-plan-calendar-id-123");
  assert.equal(store.getCalendarId(), "yoh-plan-calendar-id-123");

  const onDisk = JSON.parse(readFileSync(tokenFilePath, "utf8"));
  assert.equal(onDisk.calendarId, "yoh-plan-calendar-id-123");
});

test("GOOGLE_OAUTH_SCOPES exposes the exact confirmed 2026 scope strings for primary-read and Yoh-Plan-write", () => {
  assert.deepEqual(GOOGLE_OAUTH_SCOPES, [
    "https://www.googleapis.com/auth/calendar.events.readonly",
    "https://www.googleapis.com/auth/calendar.app.created",
  ]);
});

// ============================================================================
// Second, broader-scoped OAuth2Client (Story 6.6 / FR-27, AD-13)
// ============================================================================

test("createTokenStore constructs a SECOND, separately-scoped OAuth2Client for AD-13, distinct from the narrow one", () => {
  const tokenFilePath = tempTokenFilePath();
  const store = createTokenStore({
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    redirectUri: "http://localhost:3000/oauth2callback",
    tokenFilePath,
    initialRefreshToken: "narrow-seed",
    broadInitialRefreshToken: "broad-seed",
  });

  const narrow = store.getOAuth2Client();
  const broad = store.getBroadOAuth2Client();
  assert.notEqual(narrow, broad, "the broad client must be a genuinely separate instance, not the same client reused");
  assert.ok(broad instanceof OAuth2Client);
});

test("the broad OAuth2Client is seeded from broadInitialRefreshToken on first run, and persists its own refresh separately from the narrow client's", () => {
  const tokenFilePath = tempTokenFilePath();
  const store = createTokenStore({
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    redirectUri: "http://localhost:3000/oauth2callback",
    tokenFilePath,
    initialRefreshToken: "narrow-seed",
    broadInitialRefreshToken: "broad-seed",
  });

  assert.equal(store.getOAuth2Client().credentials.refresh_token, "narrow-seed");
  assert.equal(store.getBroadOAuth2Client().credentials.refresh_token, "broad-seed");

  const onDisk = JSON.parse(readFileSync(tokenFilePath, "utf8"));
  assert.equal(onDisk.refreshToken, "narrow-seed");
  assert.equal(onDisk.broadRefreshToken, "broad-seed");
});

test("a refreshed broad-client token is rewritten to disk immediately, independent of the narrow client's own token", () => {
  const tokenFilePath = tempTokenFilePath();
  const store = createTokenStore({
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    redirectUri: "http://localhost:3000/oauth2callback",
    tokenFilePath,
    initialRefreshToken: "narrow-seed",
    broadInitialRefreshToken: "broad-seed",
  });

  store.getBroadOAuth2Client().emit("tokens", { refresh_token: "broad-refreshed" });

  const onDisk = JSON.parse(readFileSync(tokenFilePath, "utf8"));
  assert.equal(onDisk.broadRefreshToken, "broad-refreshed");
  assert.equal(onDisk.refreshToken, "narrow-seed", "the narrow client's own stored token must be untouched");
});

test("a refreshed narrow-client token does not overwrite the broad client's own stored token", () => {
  const tokenFilePath = tempTokenFilePath();
  const store = createTokenStore({
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    redirectUri: "http://localhost:3000/oauth2callback",
    tokenFilePath,
    initialRefreshToken: "narrow-seed",
    broadInitialRefreshToken: "broad-seed",
  });

  store.getOAuth2Client().emit("tokens", { refresh_token: "narrow-refreshed" });

  const onDisk = JSON.parse(readFileSync(tokenFilePath, "utf8"));
  assert.equal(onDisk.refreshToken, "narrow-refreshed");
  assert.equal(onDisk.broadRefreshToken, "broad-seed");
});

test("createTokenStore works with no broadInitialRefreshToken at all — a session that never touches FR-27 needs no second grant yet", () => {
  const tokenFilePath = tempTokenFilePath();
  const store = createTokenStore({
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    redirectUri: "http://localhost:3000/oauth2callback",
    tokenFilePath,
    initialRefreshToken: "narrow-seed",
  });

  assert.equal(store.getBroadOAuth2Client().credentials.refresh_token, undefined);
  const onDisk = JSON.parse(readFileSync(tokenFilePath, "utf8"));
  assert.equal(onDisk.broadRefreshToken, undefined);
});

test("GOOGLE_CALENDAR_BROAD_SCOPE is the confirmed 2026 calendar.events scope string", () => {
  assert.equal(GOOGLE_CALENDAR_BROAD_SCOPE, "https://www.googleapis.com/auth/calendar.events");
});

test("AD-10: no file other than token-store.ts imports google-auth-library", () => {
  const offenders: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      if (full.endsWith("src/adapters/token-store.ts")) continue;
      const contents = readFileSync(full, "utf8");
      if (contents.includes("google-auth-library")) {
        offenders.push(full);
      }
    }
  }

  walk(join(import.meta.dirname, "..", "src"));
  assert.deepEqual(offenders, []);
});
