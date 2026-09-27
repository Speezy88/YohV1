/**
 * Tests for `src/core/error-copy.ts` (real-use fixes plan, Task 4).
 *
 * Per AD-2/AD-8, this is a pure `core/*.ts` module: no I/O, no module-level
 * state, never throws. These tests exercise `errorCopy`/`errorCopyForThrown`
 * purely in-process.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorCopy, errorCopyForThrown, errorCopyForWire, GENERIC_SERVER_ERROR_MESSAGE } from "../src/core/error-copy.ts";
import type { YohError } from "../src/types/domain.ts";

// ============================================================================
// One test per kind (the brief's own required coverage).
// ============================================================================

test("errorCopy: stale-proposal reads as a plain, honest sentence — never claims to be about anything Notion/Google said", () => {
  const error: YohError = {
    kind: "stale-proposal",
    message: 'confirm-proposal: proposal "abc" is stale — the live entity\'s version (2) no longer matches the version this proposal was generated against (1)',
  };
  assert.equal(errorCopy(error), "That changed since I suggested it, so I didn't apply it.");
});

test("errorCopy: conflict reads as a plain sentence with no internal wording", () => {
  const error: YohError = { kind: "conflict", message: "answer-open-item: that question is no longer pending" };
  assert.equal(errorCopy(error), "That was already answered elsewhere.");
});

test("errorCopy: unreachable names the service and says nothing was changed", () => {
  const error: YohError = { kind: "unreachable", message: "notion-adapter: could not read the live schema for \"Tasks\" — fetch failed" };
  assert.equal(errorCopy(error, { service: "Notion" }), "I couldn't reach Notion right now; nothing was changed.");
});

test("errorCopy: unreachable with no known service falls back to the generic, honest sentence — never an unnamed 'that'", () => {
  const error: YohError = { kind: "unreachable", message: "calendar-adapter: could not create the event — ECONNRESET" };
  assert.equal(errorCopy(error), GENERIC_SERVER_ERROR_MESSAGE);
});

test("errorCopy: rate-limited maps the same as unreachable", () => {
  const error: YohError = { kind: "rate-limited", message: "search-adapter: Perplexity rate-limited this request" };
  assert.equal(errorCopy(error, { service: "web search" }), "I couldn't reach web search right now; nothing was changed.");
});

test("errorCopy: auth-expired says the Google sign-in expired AND points Spencer at something real (review fix, minor #3, round 2)", () => {
  const error: YohError = { kind: "auth-expired", message: "calendar-adapter: token refresh failed" };
  const copy = errorCopy(error, { service: "Google Calendar" });
  // Pinned exact string (review, round 2): the first version named a
  // "Google sign-in helper" that doesn't exist in the repo — this one
  // points at SETUP.md's actual step 6 instead.
  assert.equal(copy, "Your Google sign-in has expired, so nothing was changed. Redo the one-time Google sign-in (SETUP.md, step 6) and I'll pick it back up.");
});

test("errorCopy: auth-expired reads identically with no service given — it's always about Google in this codebase", () => {
  const error: YohError = { kind: "auth-expired", message: "calendar-adapter: token refresh failed" };
  assert.equal(errorCopy(error), errorCopy(error, { service: "Google Calendar" }));
});

test("errorCopy: missing-field never leaks the raw environment-variable text", () => {
  const error: YohError = {
    kind: "missing-field",
    message: "server: missing required Notion environment variable(s) — needed to create or file a Notion item",
  };
  const copy = errorCopy(error, { service: "Notion" });
  assert.match(copy, /Notion/);
  assert.doesNotMatch(copy, /environment variable/i);
  assert.doesNotMatch(copy, /server:/);
});

test("errorCopy: missing-field keeps an already-plain, actionable sentence verbatim (e.g. rituals/morning-ritual.ts's own Time Budget message)", () => {
  const error: YohError = {
    kind: "missing-field",
    message:
      "morning-ritual: no Time Budget has been declared yet — tell Yoh how much time you have (e.g. `time budget 6 hours` in chat) and re-run the Morning Ritual",
  };
  const copy = errorCopy(error);
  assert.match(copy, /Time Budget/i);
  assert.doesNotMatch(copy, /morning-ritual:/);
});

// ============================================================================
// validation — the general reason-computation cases.
// ============================================================================

test("errorCopy: validation with raw leaked API text (no extractable field name) names the service and drops the raw text", () => {
  const error: YohError = {
    kind: "validation",
    message: 'notion-adapter: could not create the "Tasks" page — body failed validation: body.title should be defined, instead was `undefined`.',
  };
  const copy = errorCopy(error, { service: "Notion" });
  assert.match(copy, /^Notion didn't accept that:/);
  assert.doesNotMatch(copy, /\bbody\./);
  assert.doesNotMatch(copy, /notion-adapter/);
});

test("errorCopy: validation keeps an already-plain, Spencer-written sentence verbatim (no preamble glued on)", () => {
  const error: YohError = {
    kind: "validation",
    message: 'confirm-proposal: I didn\'t understand "5000" as a whole number of minutes — try e.g. "30".',
  };
  assert.equal(errorCopy(error, { service: "Notion" }), 'I didn\'t understand "5000" as a whole number of minutes — try e.g. "30".');
});

test("errorCopy: validation with no service and no known reason falls back to a plain, service-free sentence", () => {
  const error: YohError = { kind: "validation", message: "confirm-proposal: unrecognized proposal kind \"mystery\"" };
  const copy = errorCopy(error);
  assert.doesNotMatch(copy, /confirm-proposal/);
});

// ============================================================================
// The incident, verbatim — the exact message from the real-use bug report.
// ============================================================================

test("errorCopy: the incident's exact Notion-validation message maps to a plain sentence naming Due Date, with no body./properties. text", () => {
  const error: YohError = {
    kind: "validation",
    message:
      'notion-adapter: could not create the "Tasks" page — body failed validation: body.properties.Due Date.date.start should be a valid ISO 8601 date string, instead was `"tomorrow at 10:45 AM"`.',
  };
  const copy = errorCopy(error, { service: "Notion" });

  assert.match(copy, /Due Date/);
  assert.doesNotMatch(copy, /\bbody\./);
  assert.doesNotMatch(copy, /\bproperties\./);
  assert.doesNotMatch(copy, /notion-adapter/);
  assert.doesNotMatch(copy, /ISO 8601/);
  // And it must NOT claim staleness — the incident's actual wording bug.
  assert.doesNotMatch(copy, /any more/i);
  assert.doesNotMatch(copy, /stale/i);
});

// ============================================================================
// errorCopyForThrown — the raw-throw stepping stone (app/calendar-edit.ts's
// catch blocks around a thrown Error, never a Result-shaped YohError).
// ============================================================================

test("errorCopyForThrown wraps a thrown Error as unreachable and never leaks its raw .message", () => {
  const err = new Error('llm-adapter: CREATE response has an invalid or out-of-range datetime: start="bogus" end="bogus"');
  const copy = errorCopyForThrown(err, { service: "Claude" });
  assert.equal(copy, "I couldn't reach Claude right now; nothing was changed.");
});

test("errorCopyForThrown handles a non-Error thrown value without throwing itself", () => {
  const copy = errorCopyForThrown("a bare string throw", { service: "Google Calendar" });
  assert.equal(copy, "I couldn't reach Google Calendar right now; nothing was changed.");
});

// ============================================================================
// Review fix #2: errorCopy always ends in terminal punctuation, so a caller
// that appends its own follow-up sentence (answer-data-completeness.ts,
// answer-night-close-out.ts, answer-self-check.ts) never produces a run-on.
// ============================================================================

test("errorCopy: every kind ends in terminal punctuation, even when the underlying message doesn't", () => {
  const noTrailingPunctuation: readonly YohError[] = [
    { kind: "stale-proposal", message: "proposal is stale" },
    { kind: "conflict", message: "already answered" },
    { kind: "validation", message: "notion-adapter: some validation problem with no trailing period" },
    { kind: "auth-expired", message: "token refresh failed" },
    { kind: "unreachable", message: "could not reach it" },
    { kind: "rate-limited", message: "rate limited" },
    { kind: "missing-field", message: "not configured" },
  ];
  for (const error of noTrailingPunctuation) {
    const copy = errorCopy(error, { service: "Notion" });
    assert.match(copy, /[.!?]$/, `${error.kind} copy should end in terminal punctuation: "${copy}"`);
  }
});

test("errorCopy: the exact select-guard rejection (notion-adapter.ts) names the field and value, and ends in a period so a caller's appended follow-up reads as two proper sentences", () => {
  const error: YohError = {
    kind: "validation",
    // notion-adapter.ts's writeSelectLikeField rejection, verbatim (no
    // trailing period in the source) — propertyName="Area", candidateInput="bio".
    message: 'notion-adapter: no existing "Area" option is a close enough match to "bio" — refusing to write raw text or create a new option',
  };
  const copy = errorCopy(error, { service: "Notion" });

  assert.match(copy, /Area/);
  assert.match(copy, /bio/);
  assert.match(copy, /[.!?]$/);
  assert.doesNotMatch(copy, /notion-adapter/);

  // The exact shape answer-data-completeness.ts/answer-night-close-out.ts/
  // answer-self-check.ts build: `${errorCopy(...)} <follow-up sentence>` —
  // must read as two proper sentences, never a run-on.
  const withFollowUp = `${copy} Try again with a value closer to what's already in Notion.`;
  assert.match(withFollowUp, /\. Try again/);
  assert.doesNotMatch(withFollowUp, /option Try again/);
});

// ============================================================================
// errorCopyForWire — the transport-boundary safety net (shell/server.ts's
// wire()/sseMessage()), review fix #1.
// ============================================================================

test("errorCopyForWire maps a raw, never-mapped message (e.g. a bare ConflictError or a 'not configured' constant) to a safe, generic sentence", () => {
  const error: YohError = { kind: "conflict", message: "memory-store: cannot update detail — no interaction request open at abc123" };
  assert.equal(errorCopyForWire(error), "That was already answered elsewhere.");
});

test("errorCopyForWire never leaks raw body./properties. text even when a route somehow returns it unmapped", () => {
  const error: YohError = {
    kind: "validation",
    message: 'notion-adapter: could not create the "Tasks" page — body.properties.Due Date.date.start should be a valid ISO 8601 date string',
  };
  const copy = errorCopyForWire(error);
  assert.doesNotMatch(copy, /\bbody\./);
  assert.doesNotMatch(copy, /\bproperties\./);
});

test("errorCopyForWire passes through an already-mapped, service-specific message unchanged (never downgrades it to the generic no-service version)", () => {
  const alreadyMapped = errorCopy({ kind: "unreachable", message: "notion-adapter: fetch failed" }, { service: "Notion" });
  const error: YohError = { kind: "unreachable", message: alreadyMapped };
  assert.equal(errorCopyForWire(error), alreadyMapped);
  assert.match(errorCopyForWire(error), /Notion/);
});

test("errorCopyForWire is idempotent — calling it twice never changes the result", () => {
  const error: YohError = { kind: "missing-field", message: "server: missing required environment variable(s)" };
  const once = errorCopyForWire(error);
  const twice = errorCopyForWire({ kind: "missing-field", message: once });
  assert.equal(once, twice);
});
