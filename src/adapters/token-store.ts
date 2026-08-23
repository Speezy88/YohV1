/**
 * src/adapters/token-store.ts
 *
 * Owns the Google OAuth refresh token and is the SOLE constructor and holder
 * of `google-auth-library`'s `OAuth2Client` (AD-10 of the Architecture
 * Spine). No other file in `src/` may import `google-auth-library` —
 * `calendar-adapter.ts` (a later task) receives an already-authenticated
 * `OAuth2Client` as a parameter instead. This rule is enforced by a repo
 * scan in `tests/token-store.test.ts`, not just by convention.
 *
 * Per AD-8, `adapters/*.ts` files may throw on I/O failure rather than
 * returning `Result` themselves — `rituals/*.ts` is the only layer allowed
 * to catch and convert a throw into a `Result` failure. Every function here
 * that touches the filesystem follows that rule and throws plain `Error`s
 * (or lets `node:fs`'s own throws propagate) on I/O failure.
 */

import { OAuth2Client, type Credentials } from "google-auth-library";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ============================================================================
// Google Calendar OAuth scopes — confirmed live against current public docs
// ============================================================================

/**
 * Read-only access to Spencer's primary Google Calendar (events on all
 * calendars, read-only) — used to see what's already on the calendar when
 * building a Plan (FR-1).
 *
 * Confirmed live 2026-08-22 against
 * https://developers.google.com/workspace/calendar/api/auth : scope
 * description "View events on all your calendars." See SETUP.md for the
 * full research trail (this is the exact 2026 scope string, not carried
 * over from stale pre-build research).
 */
export const GOOGLE_CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly";

/**
 * Write scope for the dedicated "Yoh Plan" secondary calendar (AD-10):
 * "Make secondary Google calendars, and see, create, change, and delete
 * events on them" — scoped to calendars the app itself creates via
 * `Calendars.insert`, never the primary calendar. This is the scope
 * `calendar-adapter.ts` (a later task) uses to create the "Yoh Plan"
 * calendar on first run and write only within it, matching AD-10's rule
 * that primary-read and Yoh-Plan-write use separate OAuth scopes so a
 * coding mistake that tried to write the primary calendar fails at the API
 * layer, not just at review.
 *
 * Confirmed live 2026-08-22 against
 * https://developers.google.com/workspace/calendar/api/auth (scope
 * `calendar.app.created`). Also confirmed live against
 * https://developers.google.com/identity/protocols/oauth2 and
 * https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
 * that Calendar scopes are classified "sensitive" (not "restricted"), and
 * that Google Calendar access for a personal @gmail.com account requires
 * OAuth 2.0 user consent — a service account (with or without domain-wide
 * delegation, which only exists for Workspace-managed domains) cannot be
 * used. See SETUP.md for the full research trail and source links.
 */
export const GOOGLE_CALENDAR_WRITE_SCOPE =
  "https://www.googleapis.com/auth/calendar.app.created";

/** The full scope set `token-store.ts` requests when generating a consent URL (see SETUP.md). */
export const GOOGLE_OAUTH_SCOPES = [
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_CALENDAR_WRITE_SCOPE,
] as const;

// ============================================================================
// Config
// ============================================================================

/**
 * Config `token-store.ts` needs to construct its `OAuth2Client`. Everything
 * here is either a static secret (loaded once from env vars at process
 * start, per AD-10) or a file path — never a live network dependency, so
 * this can be constructed entirely from placeholder values in a test.
 */
export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  /** Where the mutable refresh-token/calendar-id file lives on disk. */
  readonly tokenFilePath: string;
  /**
   * A refresh token to seed the token file with, if the file doesn't exist
   * yet. Sourced from `GOOGLE_REFRESH_TOKEN` — the one-time value Spencer
   * obtains via the manual OAuth consent flow described in SETUP.md. After
   * the first run, the on-disk token file (not this env var) is the
   * authoritative source: every subsequent refresh is rewritten there
   * immediately (AD-10), never back to the environment.
   */
  readonly initialRefreshToken?: string;
}

const REQUIRED_ENV_VARS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"] as const;

/**
 * Loads `GoogleOAuthConfig` from environment variables once, at process
 * start (AD-10's "static secrets load once from environment variables at
 * process start" rule, applied to token-store's own Google OAuth id,
 * secret, and redirect URI). Accepts an injectable `env` map so tests never
 * need to mutate real `process.env`.
 */
export function loadGoogleOAuthConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GoogleOAuthConfig {
  for (const name of REQUIRED_ENV_VARS) {
    if (!env[name]) {
      throw new Error(`token-store: missing required environment variable ${name}`);
    }
  }

  const config: GoogleOAuthConfig = {
    clientId: env["GOOGLE_CLIENT_ID"] as string,
    clientSecret: env["GOOGLE_CLIENT_SECRET"] as string,
    redirectUri: env["GOOGLE_REDIRECT_URI"] as string,
    tokenFilePath: env["GOOGLE_TOKEN_FILE_PATH"] || "./data/google-token.json",
    ...(env["GOOGLE_REFRESH_TOKEN"] ? { initialRefreshToken: env["GOOGLE_REFRESH_TOKEN"] } : {}),
  };
  return config;
}

// ============================================================================
// On-disk token file shape
// ============================================================================

interface StoredGoogleToken {
  readonly refreshToken: string;
  /** The "Yoh Plan" secondary calendar id, once `calendar-adapter.ts` creates it (AD-10). */
  readonly calendarId?: string;
}

// ============================================================================
// TokenStore
// ============================================================================

/**
 * The sole constructor and holder of the Google `OAuth2Client` (AD-10).
 * Rewrites the refresh token to disk immediately after every refresh by
 * listening for the `OAuth2Client`'s own `'tokens'` event, which
 * `google-auth-library` emits synchronously whenever it obtains a new
 * refresh and/or access token (from `setCredentials` or an internal
 * `refreshAccessToken` call) — this is the actual mechanism, not a
 * best-effort polling or manual re-save step.
 */
export class TokenStore {
  private readonly client: OAuth2Client;
  private readonly tokenFilePath: string;

  constructor(config: GoogleOAuthConfig) {
    this.tokenFilePath = config.tokenFilePath;
    this.client = new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    });

    const stored = this.readStoredToken();
    const refreshToken = stored?.refreshToken ?? config.initialRefreshToken;
    if (refreshToken) {
      this.client.setCredentials({ refresh_token: refreshToken });
      if (!stored) {
        // First run against this file: persist the seed value immediately
        // so the file (not the env var) becomes the source of truth from
        // here on, per AD-10.
        this.writeStoredToken(refreshToken, undefined);
      }
    }

    this.client.on("tokens", (tokens: Credentials) => {
      if (tokens.refresh_token) {
        const current = this.readStoredToken();
        this.writeStoredToken(tokens.refresh_token, current?.calendarId);
      }
    });
  }

  /** The single shared, already-authenticated `OAuth2Client` every Google-facing adapter is handed. */
  getOAuth2Client(): OAuth2Client {
    return this.client;
  }

  /** The "Yoh Plan" secondary calendar id, if `calendar-adapter.ts` has created and recorded it yet (AD-10). */
  getCalendarId(): string | undefined {
    return this.readStoredToken()?.calendarId;
  }

  /** Persists the "Yoh Plan" secondary calendar id once `calendar-adapter.ts` creates it (AD-10). */
  setCalendarId(calendarId: string): void {
    const current = this.readStoredToken();
    const refreshToken = current?.refreshToken ?? this.client.credentials.refresh_token;
    if (!refreshToken) {
      throw new Error("token-store: cannot persist calendarId before a refresh token exists");
    }
    this.writeStoredToken(refreshToken, calendarId);
  }

  private readStoredToken(): StoredGoogleToken | undefined {
    if (!existsSync(this.tokenFilePath)) return undefined;
    const raw = readFileSync(this.tokenFilePath, "utf8");
    return JSON.parse(raw) as StoredGoogleToken;
  }

  private writeStoredToken(refreshToken: string, calendarId: string | undefined): void {
    const dir = dirname(this.tokenFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const onDisk: StoredGoogleToken = calendarId === undefined ? { refreshToken } : { refreshToken, calendarId };
    writeFileSync(this.tokenFilePath, JSON.stringify(onDisk, null, 2), "utf8");
  }
}

/** Constructs the sole `TokenStore`/`OAuth2Client` for the process. */
export function createTokenStore(config: GoogleOAuthConfig): TokenStore {
  return new TokenStore(config);
}
