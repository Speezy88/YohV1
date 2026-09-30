/**
 * src/core/error-copy.ts
 *
 * Real-use fixes plan, Task 4. The ONE place a `YohError` becomes a
 * Spencer-facing sentence. Every `app/*.ts` file that turns a failed
 * `Result` into chat reply/message text calls `errorCopy` here instead of
 * embedding `error.message` (or a raw thrown `Error`'s `.message`) directly.
 *
 * The incident this fixes: Spencer confirmed a draft and saw "I can't apply
 * that any more — notion-adapter: could not create the "Tasks" page — body
 * failed validation: body.properties.Due Date.date.start should be a valid
 * ISO 8601 date string, instead was `"tomorrow at 10:45 AM"`." Two things
 * were wrong with that: the wording claimed the proposal was STALE (it
 * wasn't — nothing here says "stale" unless `error.kind` genuinely is
 * `"stale-proposal"`), and it leaked raw Notion API/JSON-path text a human
 * was never meant to read.
 *
 * `error.kind` is a closed union (`types/domain.ts`) — this is the one
 * place every kind is switched on, so a new kind added there is a
 * compile error here until it's given real copy (no silent generic
 * fallback for a kind this file has never seen).
 *
 * Review fix (Task 4 follow-up): `errorCopy` always returns a sentence
 * ending in terminal punctuation — a caller that appends its own follow-up
 * sentence (e.g. `app/answer-data-completeness.ts`'s "Try again with a
 * value closer to what's already in Notion.") never produces a run-on.
 * `errorCopyForWire` is the separate transport-boundary safety net
 * `shell/server.ts`'s `wire()`/`sseMessage()` call on EVERY route's error
 * envelope, so a route that forgets to call `errorCopy` itself (or a raw
 * `ConflictError`/"not configured" constant) still can't leak raw
 * adapter/module text over the wire.
 */
import type { YohError, YohErrorKind } from "../types/domain.ts";

/** The four externally-reachable systems a failure can plausibly be about — named here, never guessed, so a caller that doesn't know which service failed gets honest, service-free wording rather than a fabricated guess. */
export type ErrorCopyService = "Notion" | "Google Calendar" | "Claude" | "web search";

export interface ErrorCopyContext {
  readonly service?: ErrorCopyService;
}

// ============================================================================
// Raw-text detection — what NEVER reaches Spencer verbatim.
// ============================================================================

/**
 * Matches the shape of a leaked API/JSON-path or stack-trace fragment —
 * `body.properties....`, a Node stack frame (`at foo (file.ts:12:34)`), or
 * a `node_modules` path. Anything matching this is dev-facing, never
 * Spencer-facing, regardless of which kind carried it.
 */
const RAW_LEAK_PATTERN = /\bbody\.|\bproperties\.|node_modules|\bat\s+\S+\s+\(.*:\d+:\d+\)/;

/** A leading `modulename: ` (or `module-name: `) prefix — every adapter/app-internal message in this codebase is written this way (`notion-adapter: ...`, `confirm-proposal: ...`, `search-adapter: ...`, `server: ...`). Stripped before deciding whether what's left is a plain, already Spencer-facing sentence. */
const INTERNAL_PREFIX_PATTERN = /^[a-z][a-z0-9-]*:\s*/i;

function stripInternalPrefix(message: string): string {
  return message.replace(INTERNAL_PREFIX_PATTERN, "");
}

/**
 * A Notion property-path validation message names the real property between
 * `properties.` and the next `.` — e.g. `...properties.Due Date.date.start
 * should be a valid ISO 8601 date string...` -> `"Due Date"`. Undefined if
 * the message doesn't have that shape at all.
 */
function extractNotionPropertyField(message: string): string | undefined {
  const match = message.match(/\bproperties\.([^.]+)\./);
  return match?.[1];
}

/**
 * Strips a leading `modulename: ` prefix and hands back what's left, but
 * ONLY if that remainder reads as an already-plain, Spencer-facing sentence
 * written by our own code — e.g. `core/planning-field-value.ts`'s parse
 * errors (`I didn't understand "5000" as a whole number of minutes — try
 * e.g. "30".`) or `rituals/morning-ritual.ts`'s own actionable messages
 * (`no Time Budget has been declared yet — tell Yoh how much time you
 * have...`). `undefined` if `rawMessage` (before OR after stripping) trips
 * `extraJargonPattern` or the shared raw-API/stack-trace pattern, or is
 * empty once stripped — the caller falls back to its own generic, honest
 * wording in that case, never inventing a reason or lecturing.
 */
function stripIfSafe(rawMessage: string, extraJargonPattern?: RegExp): string | undefined {
  if (RAW_LEAK_PATTERN.test(rawMessage)) return undefined;
  if (extraJargonPattern?.test(rawMessage)) return undefined;
  const stripped = stripInternalPrefix(rawMessage).trim();
  return stripped.length > 0 ? stripped : undefined;
}

/**
 * A message with no leading `modulename: ` prefix and no raw-leak text —
 * i.e. one `errorCopy` (or a caller that wrote its own plain sentence) could
 * plausibly have produced already. Used at the wire/transport boundary
 * (`shell/server.ts`'s `wire()`/`sseMessage()`) to decide whether a message
 * is safe to pass through unchanged versus one that needs the generic,
 * context-free fallback — never to decide anything Spencer-facing itself.
 */
function looksAlreadyMapped(message: string): boolean {
  return !RAW_LEAK_PATTERN.test(message) && !INTERNAL_PREFIX_PATTERN.test(message);
}

/** Review fix (Task 4 follow-up): every sentence `errorCopy` returns ends in terminal punctuation — a caller that appends a follow-up sentence (`answer-data-completeness.ts`, `answer-night-close-out.ts`) must never produce a run-on with no punctuation between the two. */
function ensureTerminalPunctuation(text: string): string {
  const trimmed = text.trimEnd();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// ============================================================================
// validation — the one kind whose plain reason has to be computed, not just
// looked up.
// ============================================================================

function validationCopy(error: YohError, service: ErrorCopyService | undefined): string {
  const field = extractNotionPropertyField(error.message);
  if (field !== undefined) {
    const reason = /valid ISO 8601 date/i.test(error.message)
      ? `${field} needs a real date — I couldn't read what was given as one.`
      : `${field} isn't valid.`;
    return service ? `${service} didn't accept that: ${reason}` : `That didn't get accepted: ${reason}`;
  }

  // Not a Notion field-path leak — an already-plain sentence (the "our own
  // code wrote this" case) reads worse with a "Notion/Google didn't accept
  // that:" preamble glued on front — e.g. "confirm-proposal: I didn't
  // understand ..." isn't about Notion/Google rejecting anything, it's
  // Spencer's own input that didn't parse. Only a reason this file itself
  // computes below (the raw-leak fallback) gets the preamble.
  const safe = stripIfSafe(error.message);
  if (safe !== undefined) return safe;

  const reason = "that value wasn't in a format it accepts.";
  return service ? `${service} didn't accept that: ${reason}` : `That didn't get accepted: ${reason}`;
}

// ============================================================================
// missing-field — a service that isn't configured (jargon-strip fallback,
// like validation) OR a genuinely actionable, already-plain message (e.g.
// "no Time Budget has been declared yet — tell Yoh how much time you
// have...") that's safe to keep verbatim.
// ============================================================================

/** `missing-field` jargon a Spencer-facing sentence must never carry, beyond the shared raw-API/stack-trace pattern — a dev-facing "environment variable" name is exactly as opaque to him as a JSON path. */
const MISSING_FIELD_JARGON_PATTERN = /environment variable/i;

function missingFieldCopy(error: YohError, service: ErrorCopyService | undefined): string {
  const safe = stripIfSafe(error.message, MISSING_FIELD_JARGON_PATTERN);
  if (safe !== undefined) return safe;
  return service ? `I'm not set up to do that yet — my ${service} connection isn't configured.` : "I'm not set up to do that yet.";
}

// ============================================================================
// errorCopy — the one exported mapper.
// ============================================================================

/** The generic, context-free "something's wrong, nothing was changed" sentence — used both as `unreachable`/`rate-limited`'s no-service fallback and directly by `shell/server.ts`'s transport-level catch-alls (a genuine thrown exception at that layer carries no known `service`, and often no real `YohErrorKind` either — AD-8 boundary, not a Result failure). */
export const GENERIC_SERVER_ERROR_MESSAGE = "Something went wrong on my side answering that. Nothing was changed.";

/**
 * Review fix (Task 4 follow-up, round 2): a fixed, actionable sentence —
 * auth-expired is, in this codebase, always about Google (Notion's own
 * token never expires mid-session), so this never varies by
 * `context.service`. Points at something that actually exists in the repo
 * (`SETUP.md`'s step 6, "Obtain the initial refresh token (one-time)") —
 * the first version of this message ("re-run the Google sign-in helper")
 * named a helper that doesn't exist.
 */
const AUTH_EXPIRED_MESSAGE =
  "Your Google sign-in has expired, so nothing was changed. Redo the one-time Google sign-in (SETUP.md, step 6) and I'll pick it back up.";

function rawErrorCopy(error: YohError, context: ErrorCopyContext): string {
  const { service } = context;
  const kind: YohErrorKind = error.kind;
  switch (kind) {
    case "stale-proposal":
      return "That changed since I suggested it, so I didn't apply it.";

    case "conflict":
      return "That was already answered elsewhere.";

    case "validation":
      return validationCopy(error, service);

    case "auth-expired":
      return AUTH_EXPIRED_MESSAGE;

    case "unreachable":
    case "rate-limited":
      return service ? `I couldn't reach ${service} right now; nothing was changed.` : GENERIC_SERVER_ERROR_MESSAGE;

    case "missing-field":
      return missingFieldCopy(error, service);
  }
}

/** Maps a `YohError` to the ONE sentence Spencer sees for it. Pure — no I/O, never throws. Always ends in terminal punctuation (review fix), so a caller appending its own follow-up sentence never produces a run-on. */
export function errorCopy(error: YohError, context: ErrorCopyContext = {}): string {
  return ensureTerminalPunctuation(rawErrorCopy(error, context));
}

/**
 * Review fix (Task 4 follow-up): the transport-boundary safety net
 * `shell/server.ts`'s `wire()`/`sseMessage()` calls on EVERY route's error
 * envelope, so no route — including one this file's own callers forgot to
 * map, or a raw `ConflictError`/"not configured" constant that never went
 * through `errorCopy` at the `app/` layer — can leak raw adapter/module
 * text over the wire. A message that already looks like something
 * `errorCopy` (or a caller's own hand-written plain sentence) could have
 * produced is passed through unchanged (still punctuation-enforced) rather
 * than re-derived — re-deriving generically here, with no `service` in
 * hand, would DOWNGRADE an already-good, service-specific message (e.g.
 * "I couldn't reach Notion right now; nothing was changed.") to the
 * generic, unnamed-service version.
 */
export function errorCopyForWire(error: YohError): string {
  if (looksAlreadyMapped(error.message)) return ensureTerminalPunctuation(error.message);
  return errorCopy(error);
}

/**
 * Wraps a raw thrown value (never a `YohError` — those already go straight
 * to `errorCopy`) into one, for the few call sites that still catch a bare
 * `try/catch` around an adapter call that throws rather than returning a
 * `Result` (e.g. `app/calendar-edit.ts`'s Calendar read / LLM draft calls).
 * Always `kind: "unreachable"` — a thrown value from an I/O call is, from
 * Spencer's side, indistinguishable from "couldn't reach it," and this is
 * only ever a stepping stone straight into `errorCopy`, never surfaced on
 * its own.
 */
export function errorCopyForThrown(err: unknown, context: ErrorCopyContext = {}): string {
  const message = err instanceof Error ? err.message : String(err);
  return errorCopy({ kind: "unreachable", message }, context);
}

/**
 * Which external service a `Proposal.kind`'s write actually reaches —
 * `Proposal.kind` is deliberately free-form (`types/domain.ts`'s own doc
 * comment), so this is a lookup, not an exhaustive switch: an unrecognized
 * kind (a future Proposal kind this file hasn't been taught about yet)
 * gets `undefined` — honest, service-free wording rather than a guess.
 */
export function serviceForProposalKind(kind: string): ErrorCopyService | undefined {
  switch (kind) {
    case "notion-page-draft":
    case "field-value":
      return "Notion";
    case "calendar-edit":
      return "Google Calendar";
    default:
      return undefined;
  }
}
