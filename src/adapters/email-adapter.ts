/**
 * src/adapters/email-adapter.ts
 *
 * Owns Yoh's outbound email surface (Story 3.2 / FR-13, FR-14) — the SECOND
 * channel of Night Ritual's capped escalating retry. Where
 * `notification-adapter.ts` (Task 10) is the FIRST attempt's push channel
 * (Pushover), this file is what `rituals/night-ritual.ts`'s `night-escalate`
 * half sends over when that first attempt has gone unanswered for hours —
 * deliberately a DIFFERENT channel (email, not a repeat push), per this
 * story's own AC. `notification-adapter.ts`'s own module docstring names
 * this exact addition in advance ("Epic 3's night-escalate story ... later
 * adds an SMTP fallback"), and `.env.example` has carried the `SMTP_*`
 * variable names this file reads since Task 10, for the same reason.
 *
 * Per AD-8, `adapters/*.ts` files may throw on I/O failure rather than
 * returning `Result` themselves — `rituals/*.ts` is the only layer allowed
 * to catch and convert a throw into a `Result` failure. A `sendMail`
 * rejection (bad credentials, an unreachable host, an SMTP-level rejection)
 * propagates unchanged; nothing in this file catches or retries it.
 *
 * The SMTP transport itself is injectable (`EmailConfig.transport`,
 * defaulting to a real `nodemailer.createTransport(...)`), mirroring the
 * injectable-client pattern every other adapter in this codebase already
 * uses (`notification-adapter.ts`'s `fetch` seam, `notion-adapter.ts`'s and
 * `calendar-adapter.ts`'s injectable clients): no live SMTP credentials
 * exist in this environment, so tests supply a fake transport rather than
 * sending real email.
 *
 * Documented choice (no live SMTP account is available here to confirm
 * against, per the brief's "make a reasonable documented choice" guidance):
 * every email this adapter sends is addressed to Spencer's own SMTP account
 * (`config.to`, defaulting to `config.user`) — a personal SMTP account
 * sending a message to itself is the ordinary, unsurprising shape for a
 * single-user tool with no separately-provisioned "notify" mailbox, and
 * `.env.example` documents no distinct recipient variable.
 */
import { createTransport } from "nodemailer";

// ============================================================================
// Injectable SMTP transport
// ============================================================================

/**
 * The minimal slice of a nodemailer `Transporter` this file calls — narrow
 * enough that a test's fake needs only this one method, the same
 * deliberately-narrow-seam shape `notification-adapter.ts`'s `FetchLike`
 * uses for `fetch`. The real `nodemailer.createTransport(...)` return value
 * satisfies this structurally.
 */
export interface EmailTransportLike {
  sendMail(message: {
    readonly from: string;
    readonly to: string;
    readonly subject: string;
    readonly text: string;
  }): Promise<unknown>;
}

// ============================================================================
// Config
// ============================================================================

export interface EmailConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  /** The From address every email is sent as (`SMTP_FROM`). */
  readonly from: string;
  /** The To address every email is sent to. Defaults to `user` — see the module docstring's documented choice. */
  readonly to?: string;
  /**
   * Injectable SMTP transport, defaulting to a real
   * `nodemailer.createTransport({ host, port, auth: { user, pass } })`
   * built from the fields above. Tests supply a fake — no live SMTP
   * credentials exist in this environment.
   */
  readonly transport?: EmailTransportLike;
}

const REQUIRED_ENV_VARS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;

/**
 * Loads `EmailConfig` from environment variables once, at process start
 * (AD-10's "static secrets load once from environment variables at process
 * start" rule), from the exact names `.env.example` already documents.
 * Accepts an injectable `env` map so tests never need to mutate real
 * `process.env` — the same shape `notification-adapter.ts`'s
 * `loadPushoverConfigFromEnv` uses.
 *
 * Throws (rather than returning a half-populated config) when a required
 * variable is missing, or when `SMTP_PORT` doesn't parse as a number: an
 * escalation email sent with an empty host/port silently goes nowhere,
 * which is strictly worse than a loud startup failure.
 */
export function loadEmailConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EmailConfig {
  for (const name of REQUIRED_ENV_VARS) {
    if (!env[name]) {
      throw new Error(`email-adapter: missing required environment variable ${name}`);
    }
  }
  const port = Number(env["SMTP_PORT"]);
  if (!Number.isFinite(port)) {
    throw new Error(`email-adapter: SMTP_PORT must be a number, got ${JSON.stringify(env["SMTP_PORT"])}`);
  }
  return {
    host: env["SMTP_HOST"] as string,
    port,
    user: env["SMTP_USER"] as string,
    password: env["SMTP_PASSWORD"] as string,
    from: env["SMTP_FROM"] as string,
    to: env["SMTP_TO"] ?? (env["SMTP_USER"] as string),
  };
}

// ============================================================================
// sendEmail (AD-9's primary export)
// ============================================================================

/** The message itself — a subject and a plain-text body. Yoh sends no HTML email; see `rituals/night-ritual.ts`'s escalation-message builder for why (UX-DR20's plain-text-pairing rule, applied to a channel that can't render ANSI color at all). */
export interface EmailMessage {
  readonly subject: string;
  readonly text: string;
}

/**
 * Sends exactly one email. Makes exactly one `sendMail` call and never
 * retries — `rituals/night-ritual.ts`'s own idempotence guard (the
 * `night-escalate` ritual-run marker) is what keeps this to "at most one
 * escalation email per night," not a retry loop in here.
 *
 * Per AD-8 this throws rather than returning `Result`: a `sendMail`
 * rejection (bad credentials, an unreachable host, an SMTP-level rejection)
 * propagates unchanged. The `rituals/*.ts` caller is the layer that catches
 * it and converts it into a `Result` failure / structured log line.
 */
export async function sendEmail(config: EmailConfig, message: EmailMessage): Promise<void> {
  const transport =
    config.transport ??
    createTransport({
      host: config.host,
      port: config.port,
      auth: { user: config.user, pass: config.password },
    });

  await transport.sendMail({
    from: config.from,
    to: config.to ?? config.user,
    subject: message.subject,
    text: message.text,
  });
}
