/**
 * src/adapters/logger.ts
 *
 * Task 27 / Story 5.3 (AD-9): the one shared home for Yoh's structured
 * ritual-logging shape and the write it goes through. Before this file
 * existed, every `rituals/*.ts` file independently declared its own
 * byte-identical `{ level, event, detail }` log-entry interface
 * (`morning-ritual.ts`'s `MorningRitualLogEntry`, `night-ritual.ts`'s
 * `NightPromptLogEntry` and its `NightEscalateLogEntry` alias,
 * `mid-day-reflow.ts`'s `MidDayReflowLogEntry`, `self-check.ts`'s
 * `SelfCheckLogEntry` — five declarations of the exact same shape, some of
 * whose own doc comments already said "mirroring NightPromptLogEntry's
 * shape," acknowledging the duplication with nowhere shared to put it), and
 * `shell/ritual-cli.ts`'s four `create*RitualDeps` functions each
 * independently repeated the exact same 3-line
 * `process.stderr.write(\`${JSON.stringify(entry)}\n\`)` closure to bind
 * one. Five duplicated type declarations plus four duplicated write
 * closures for one genuinely shared capability is exactly what AD-9 says
 * gets its own file — this one.
 *
 * Every `rituals/*.ts` file now imports `LogEntry` from here instead of
 * declaring its own, keeping each file's own `log?` seam exactly as
 * optional and injectable as before (tests still supply a fake `log`
 * function per ritual) — only the TYPE moved, not the injection pattern.
 * Every `create*RitualDeps` function in `shell/ritual-cli.ts` now calls
 * `writeStructuredLog` instead of repeating the closure.
 *
 * Per AD-1/AD-8: this is an `adapters/*.ts`-shaped concern (the one bit of
 * real I/O here — writing a line to a stream) so it may throw on I/O
 * failure rather than returning a `Result`, like every other adapter in
 * this directory. Writing to `process.stderr` essentially never throws in
 * practice, so this is a deliberately low-stakes application of that rule —
 * nothing here needs to catch it, and nothing here retries.
 *
 * Deliberately NOT used for `shell/ritual-cli.ts`'s own dispatch-level log
 * lines (`ritual-cli.<subcommand>-failed`, `ritual-cli.missed-run-check-
 * failed`, etc.) — those are built and written directly against
 * `RitualCliIo.writeError`, that file's own injected IO seam, so they stay
 * testable through the same `RitualCliIo` fake every `ritual-cli.test.ts`
 * test already uses, rather than through this module's `process.stderr`
 * default. This module's own `LogEntry`/`writeStructuredLog` are for the
 * FOUR RITUALS' own `log?` seams specifically.
 */

/**
 * One structured log line — common to every `rituals/*.ts` ritual's own
 * `log?` seam. `detail` is `unknown` (not a generic) on purpose: each event
 * attaches whatever shape is useful for reconstructing THAT event, and
 * nothing here ever parses it back — it exists purely for a human (or a log
 * aggregator reading the JSON line later) to read, per this story's own AC:
 * "sufficient to reconstruct what that run did afterward."
 */
export interface LogEntry {
  readonly level: "info" | "warn" | "error";
  readonly event: string;
  readonly detail?: unknown;
}

/**
 * The minimal slice of a writable stream `writeStructuredLog` needs —
 * `process.stderr` satisfies this structurally, and a test can supply
 * anything with a `write` method instead (mirrors
 * `adapters/notification-adapter.ts`'s own "the global object satisfies
 * this structurally" `FetchLike` convention: no fake class needs to be
 * built just to intercept a write).
 */
export interface StructuredLogTarget {
  write(chunk: string): unknown;
}

/**
 * Writes `entry` as one single-line JSON object, newline-terminated, to
 * `target` (defaulting to `process.stderr` — the real destination every
 * ritual's structured log line has always gone to). This is the ONE place
 * `\`${JSON.stringify(entry)}\n\`` is written for a ritual's log line;
 * `shell/ritual-cli.ts`'s four `create*RitualDeps` functions each bind
 * their own ritual's `log?` seam to this rather than repeating the closure
 * inline.
 */
export function writeStructuredLog(entry: LogEntry, target: StructuredLogTarget = process.stderr): void {
  target.write(`${JSON.stringify(entry)}\n`);
}
