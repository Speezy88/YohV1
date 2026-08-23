/**
 * src/adapters/notification-adapter.ts
 *
 * Owns Yoh's outbound push-notification surface (Story 1.10 / FR-1, FR-3).
 * Today that is Pushover only — the one channel the Morning Plan is
 * delivered on. Per the Architecture Spine's Stack table, Pushover is called
 * over plain HTTP with Node's built-in `fetch`; there is deliberately no SDK
 * dependency for it. Epic 3's night-escalate story (FR-13/FR-14, Task 20)
 * needs a genuinely DIFFERENT channel for its capped second attempt (this
 * story's own AC: "a channel distinct from the first attempt's push
 * notification, not a repeat of the identical notification"), so that email
 * fallback lives in its own file, `adapters/email-adapter.ts`, rather than
 * here — a second, unrelated transport (SMTP via nodemailer) alongside this
 * one would blur the "one adapter, one external system" shape every other
 * `adapters/*.ts` file in this codebase keeps.
 *
 * Per AD-8, `adapters/*.ts` files may throw on I/O failure rather than
 * returning `Result` themselves — `rituals/*.ts` is the only layer allowed
 * to catch and convert a throw into a `Result` failure. A non-2xx response
 * from Pushover and a transport-level `fetch` rejection alike propagate as
 * thrown errors here; nothing in this file catches them, and nothing here
 * retries.
 *
 * The HTTP call itself is injectable (`PushoverConfig.fetch`, defaulting to
 * the global `fetch`), mirroring the injectable-client pattern
 * `notion-adapter.ts` and `calendar-adapter.ts` already use: no live
 * Pushover account exists in this environment, so tests supply a fake rather
 * than hitting the real network.
 *
 * Documented assumptions about Pushover's API (no live account is available
 * here to confirm against, per the Task 10 brief — these are the
 * long-stable, documented shapes of the Messages API):
 *  - `POST https://api.pushover.net/1/messages.json` with an
 *    `application/x-www-form-urlencoded` body carrying at minimum `token`
 *    (the application token) and `user` (the user/group key), plus optional
 *    `title` and `message`.
 *  - Success is a 2xx response; a 4xx carries a JSON `errors` array
 *    explaining what was rejected. This file surfaces the response body text
 *    verbatim in the thrown error's message so a real failure is diagnosable
 *    from a log line alone.
 *  - `html=1` opts the MESSAGE body into Pushover's small formatting subset
 *    (`<b>`, `<i>`, `<u>`, `<font color="#rrggbb">`, `<a href>`). Notification
 *    TITLES carry no formatting on Pushover at all, which is why
 *    `morning-ritual.ts` sends DESIGN.md's `{components.notification}`
 *    `title-emphasis: {colors.accent}` as plain-text wording ("Today's
 *    Plan") rather than markup — the documented graceful degradation
 *    UX-DR20 requires ("pair every color cue with plain-text wording that
 *    carries the same meaning on its own"), applied here to a platform that
 *    supports no styling on the element in question.
 */

// ============================================================================
// Injectable HTTP call
// ============================================================================

/**
 * The minimal slice of a `fetch` response this file reads. The global
 * `Response` satisfies this structurally, so `globalThis.fetch` is directly
 * assignable to `FetchLike` below; a test's fake only has to provide these
 * three members.
 */
export interface HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/**
 * The one HTTP call shape this file makes. Deliberately narrower than the
 * global `fetch` type (a single string URL, a required init with the exact
 * fields used) so a fake in a test is trivial to write, while the real
 * `globalThis.fetch` still satisfies it.
 */
export type FetchLike = (
  url: string,
  init: { readonly method: string; readonly headers: Record<string, string>; readonly body: string },
) => Promise<HttpResponseLike>;

// ============================================================================
// Config
// ============================================================================

/** Pushover's Messages API endpoint (see the module docstring's documented assumptions). */
export const PUSHOVER_MESSAGES_ENDPOINT = "https://api.pushover.net/1/messages.json";

/**
 * Pushover's documented maximum `message` length, in characters. Exported
 * because the LENGTH constraint belongs to Pushover but the TRUNCATION
 * decision belongs to whoever composes the message (only they know what is
 * safe to drop) — `rituals/morning-ritual.ts`'s `buildNotificationBody`
 * reads this to keep the Plan body inside it.
 */
export const PUSHOVER_MESSAGE_LIMIT = 1024;

/** Pushover's documented maximum `title` length, in characters. */
export const PUSHOVER_TITLE_LIMIT = 250;

export interface PushoverConfig {
  /** The Pushover *application* token (`PUSHOVER_APP_TOKEN`). */
  readonly appToken: string;
  /** The Pushover *user or group* key (`PUSHOVER_USER_KEY`). */
  readonly userKey: string;
  /** Injectable HTTP call, defaulting to the global `fetch`. Tests supply a fake — no live Pushover account exists in this environment. */
  readonly fetch?: FetchLike;
  /** Overrides `PUSHOVER_MESSAGES_ENDPOINT`; exists only so a test can point at a local stub without monkey-patching a global. */
  readonly endpoint?: string;
}

/**
 * The message itself. `title`/`message` are what DESIGN.md's
 * `{components.notification}` describes: an accent-emphasized title (plain
 * text on Pushover — see the module docstring) and a body carrying the
 * Plan's content and its reasoning line.
 */
export interface PushoverNotification {
  readonly title: string;
  readonly message: string;
  /** Opts `message` into Pushover's HTML subset. Omitted (plain text) unless the caller explicitly builds markup. */
  readonly html?: boolean;
}

const REQUIRED_ENV_VARS = ["PUSHOVER_APP_TOKEN", "PUSHOVER_USER_KEY"] as const;

/**
 * Loads `PushoverConfig` from environment variables once, at process start
 * (AD-10's "static secrets load once from environment variables at process
 * start" rule), from the exact names `.env.example` documents. Accepts an
 * injectable `env` map so tests never need to mutate real `process.env` —
 * the same shape `token-store.ts`'s `loadGoogleOAuthConfigFromEnv` uses.
 *
 * Throws (rather than returning a half-populated config) when a variable is
 * missing: a notification sent with an empty token silently goes nowhere,
 * which is strictly worse than a loud startup failure.
 */
export function loadPushoverConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PushoverConfig {
  for (const name of REQUIRED_ENV_VARS) {
    if (!env[name]) {
      throw new Error(`notification-adapter: missing required environment variable ${name}`);
    }
  }
  return {
    appToken: env["PUSHOVER_APP_TOKEN"] as string,
    userKey: env["PUSHOVER_USER_KEY"] as string,
  };
}

// ============================================================================
// sendPushoverNotification (AD-9's primary export)
// ============================================================================

/**
 * Sends exactly one Pushover notification. Makes exactly one HTTP request
 * and never retries — "exactly one notification is sent" (Story 1.10's
 * acceptance criterion) is a property of this function making one call, and
 * of `rituals/morning-ritual.ts` calling it once per day.
 *
 * Per AD-8 this throws rather than returning `Result`: a non-2xx Pushover
 * response becomes an `Error` naming the status and Pushover's own response
 * body, and a transport-level `fetch` rejection propagates unchanged. The
 * `rituals/*.ts` caller is the layer that catches either and converts it
 * into a `Result` failure / structured log line.
 */
export async function sendPushoverNotification(
  config: PushoverConfig,
  notification: PushoverNotification,
): Promise<void> {
  // Refuse an over-limit payload locally rather than spending a round trip
  // to have Pushover reject it: a local throw names exactly which field is
  // too long and by how much, and is caught by the same AD-8 boundary in
  // `rituals/` that a remote rejection would be. Callers are expected to
  // compose within these limits (see `PUSHOVER_MESSAGE_LIMIT`); this is the
  // backstop that makes a regression there loud instead of silent.
  if (notification.message.length > PUSHOVER_MESSAGE_LIMIT) {
    throw new Error(
      `notification-adapter: message is ${notification.message.length} characters, over Pushover's ${PUSHOVER_MESSAGE_LIMIT}-character limit`,
    );
  }
  if (notification.title.length > PUSHOVER_TITLE_LIMIT) {
    throw new Error(
      `notification-adapter: title is ${notification.title.length} characters, over Pushover's ${PUSHOVER_TITLE_LIMIT}-character limit`,
    );
  }

  const httpFetch = config.fetch ?? (globalThis.fetch as FetchLike);
  const endpoint = config.endpoint ?? PUSHOVER_MESSAGES_ENDPOINT;

  const form = new URLSearchParams({
    token: config.appToken,
    user: config.userKey,
    title: notification.title,
    message: notification.message,
  });
  if (notification.html) {
    form.set("html", "1");
  }

  const response = await httpFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!response.ok) {
    const body = await safeReadBody(response);
    throw new Error(`notification-adapter: Pushover rejected the notification (HTTP ${response.status}): ${body}`);
  }
}

/**
 * Reads a failing response's body for the thrown error's message, tolerating
 * a body that itself fails to read — the HTTP status is the important part,
 * and losing it to a secondary failure while building an error message would
 * be strictly worse diagnostics.
 */
async function safeReadBody(response: HttpResponseLike): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<response body unavailable>";
  }
}
