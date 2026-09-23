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

/**
 * Broader read/write access across all of Spencer's accessible Google
 * Calendars (AD-13, FR-27) — Google's scope catalog has no narrower
 * "primary only" grant. "Primary only" for FR-27's confirm-gated path is
 * enforced entirely by `calendar-adapter.ts`'s `assertPrimaryCalendar`
 * (`calendarId === 'primary'`) in code, not by this grant itself (AD-13, confirmed by
 * Spencer 2026-09-18). This client is NEVER handed to AD-4's automatic
 * "Yoh Plan" path — only `calendar-adapter.ts`'s own
 * `proposeCalendarEdit`/`proposeNewCalendarEvent`/`applyCalendarEdit` use
 * it, via `TokenStore.getBroadOAuth2Client()`.
 *
 * Confirmed live 2026-08-22 (and re-checked 2026-09-18 per AD-13's own
 * "final live-docs re-check" Deferred item) against
 * https://developers.google.com/workspace/calendar/api/auth (scope
 * `calendar.events`).
 */
export const GOOGLE_CALENDAR_BROAD_SCOPE = "https://www.googleapis.com/auth/calendar.events";

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
  /**
   * A refresh token to seed the BROAD-scoped client's token file entry
   * with, if the file doesn't exist yet — the AD-13 analogue of
   * `initialRefreshToken` above, sourced from `GOOGLE_BROAD_REFRESH_TOKEN`
   * (Spencer's own separate, broader-scope consent grant). After the first
   * run, the on-disk `broadRefreshToken` field is authoritative.
   */
  readonly broadInitialRefreshToken?: string;
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
    ...(env["GOOGLE_BROAD_REFRESH_TOKEN"] ? { broadInitialRefreshToken: env["GOOGLE_BROAD_REFRESH_TOKEN"] } : {}),
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
  /** The broad-scoped client's own refresh token (AD-13, Story 6.6), stored and rewritten independently of `refreshToken`. */
  readonly broadRefreshToken?: string;
}

// ============================================================================
// TokenStore
// ============================================================================

/**
 * The sole constructor and holder of the Google `OAuth2Client` (AD-10).
 * Rewrites the refresh token to disk immediately after every refresh by
 * listening for the `OAuth2Client`'s own `'tokens'` event, which
 * `google-auth-library` emits synchronously whenever it obtains tokens via
 * an actual code exchange or refresh call (`getTokenAsync`,
 * `refreshTokenNoCache` — confirmed by reading
 * `node_modules/google-auth-library/build/src/auth/oauth2client.js`; note
 * `setCredentials` itself does *not* emit `'tokens'` — it's
 * `AuthClient.setCredentials`, a plain field assignment) — this is the
 * actual mechanism, not a best-effort polling or manual re-save step.
 */
export class TokenStore {
  private readonly client: OAuth2Client;
  private readonly broadClient: OAuth2Client;
  private readonly tokenFilePath: string;

  constructor(config: GoogleOAuthConfig) {
    this.tokenFilePath = config.tokenFilePath;
    this.client = new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    });
    // A second, separately-scoped client (AD-13, Story 6.6) — same client
    // id/secret/redirect (one registered OAuth app), but its own distinct
    // refresh token, obtained via a separate, broader-scope consent grant.
    this.broadClient = new OAuth2Client({
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
        this.writeStoredToken({ refreshToken });
      }
    }

    const broadRefreshToken = stored?.broadRefreshToken ?? config.broadInitialRefreshToken;
    if (broadRefreshToken) {
      this.broadClient.setCredentials({ refresh_token: broadRefreshToken });
      // `writeStoredToken` needs a narrow refresh token to exist first; a
      // broad-only config just keeps the broad token in memory until one does.
      if (!stored?.broadRefreshToken && refreshToken) {
        this.writeStoredToken({ broadRefreshToken });
      }
    }

    this.client.on("tokens", (tokens: Credentials) => {
      if (tokens.refresh_token) {
        this.writeStoredToken({ refreshToken: tokens.refresh_token });
      }
    });
    this.broadClient.on("tokens", (tokens: Credentials) => {
      if (!tokens.refresh_token) return;
      try {
        this.writeStoredToken({ broadRefreshToken: tokens.refresh_token });
      } catch {
        // No narrow refresh token exists yet (see the broad-only branch
        // above) — `writeStoredToken` can't persist without one. Keep the
        // refreshed broad token in the client's own in-memory credentials
        // (already set by `setCredentials`/this event) rather than crashing
        // this listener; it persists once a narrow token exists.
      }
    });
  }

  /** The single shared, already-authenticated `OAuth2Client` every Google-facing adapter is handed. */
  getOAuth2Client(): OAuth2Client {
    return this.client;
  }

  /** The second, broader-scoped `OAuth2Client` (AD-13, Story 6.6) — used ONLY by `calendar-adapter.ts`'s FR-27 functions, never AD-4's automatic path. */
  getBroadOAuth2Client(): OAuth2Client {
    return this.broadClient;
  }

  /** The "Yoh Plan" secondary calendar id, if `calendar-adapter.ts` has created and recorded it yet (AD-10). */
  getCalendarId(): string | undefined {
    return this.readStoredToken()?.calendarId;
  }

  /** Persists the "Yoh Plan" secondary calendar id once `calendar-adapter.ts` creates it (AD-10). */
  setCalendarId(calendarId: string): void {
    this.writeStoredToken({ calendarId });
  }

  private readStoredToken(): StoredGoogleToken | undefined {
    if (!existsSync(this.tokenFilePath)) return undefined;
    const raw = readFileSync(this.tokenFilePath, "utf8");
    return JSON.parse(raw) as StoredGoogleToken;
  }

  /** Merges `patch` onto whatever is currently on disk (never wholesale-replaces) — so the narrow client's refresh, the broad client's refresh, and the "Yoh Plan" calendar id can each be updated independently without clobbering the other two. */
  private writeStoredToken(patch: Partial<StoredGoogleToken>): void {
    const dir = dirname(this.tokenFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const current = this.readStoredToken();
    const refreshToken = patch.refreshToken ?? current?.refreshToken ?? this.client.credentials.refresh_token;
    if (!refreshToken) {
      throw new Error("token-store: cannot persist token state before a narrow refresh token exists");
    }
    const calendarId = patch.calendarId ?? current?.calendarId;
    const broadRefreshToken = patch.broadRefreshToken ?? current?.broadRefreshToken;
    const onDisk: StoredGoogleToken = {
      refreshToken,
      ...(calendarId !== undefined ? { calendarId } : {}),
      ...(broadRefreshToken !== undefined ? { broadRefreshToken } : {}),
    };
    writeFileSync(this.tokenFilePath, JSON.stringify(onDisk, null, 2), "utf8");
  }
}

/** Constructs the sole `TokenStore`/`OAuth2Client` for the process. */
export function createTokenStore(config: GoogleOAuthConfig): TokenStore {
  return new TokenStore(config);
}
