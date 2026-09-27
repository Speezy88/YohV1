/**
 * Tests for `src/app/quick-add-normalize.ts` (Polish 4 Task 1): the app-
 * layer orchestration around `adapters/llm-adapter.ts`'s
 * `normalizeQuickAddLine` — timeout handling, and validating every claimed
 * field against the live options / Yoh's fixed enums before it's ever
 * trusted. Every test here injects `deps.normalize` (never a real
 * `AnthropicMessagesClient` call), so nothing ever touches the network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AnthropicMessagesClient, QuickAddNormalizeRawFields } from "../src/adapters/llm-adapter.ts";
import { normalizeQuickAdd, type NormalizeQuickAddDeps } from "../src/app/quick-add-normalize.ts";
import type { TaskFieldOptions } from "../src/types/domain.ts";

const NOW = new Date("2026-09-27T15:00:00.000Z");
const DUMMY_LLM_CLIENT: AnthropicMessagesClient = { messages: { create: (() => { throw new Error("not used in these tests"); }) as never } };

const OPTIONS: TaskFieldOptions = {
  area: ["School/ACT/College Apps", "Personal Goals"],
  energy: [
    { value: "high", label: "Deep" },
    { value: "medium", label: "medium" },
    { value: "low", label: "low" },
  ],
  status: [
    { value: "not-started", label: "Nothing" },
    { value: "in-progress", label: "In Progress" },
    { value: "completed", label: "Completed" },
  ],
};

function baseDeps(normalize: NonNullable<NormalizeQuickAddDeps["normalize"]>): NormalizeQuickAddDeps {
  return { llmClient: DUMMY_LLM_CLIENT, now: () => NOW, timeZone: "UTC", normalize };
}

function fakeNormalize(raw: QuickAddNormalizeRawFields | undefined): NonNullable<NormalizeQuickAddDeps["normalize"]> {
  return async () => raw;
}

test("no llmClient configured: resolves ok:false without calling normalize at all", async () => {
  let called = false;
  const result = await normalizeQuickAdd(
    { now: () => NOW, timeZone: "UTC", normalize: async () => { called = true; return undefined; } },
    { text: "x", options: OPTIONS },
  );
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("valid claimed fields are coerced and passed through", async () => {
  const result = await normalizeQuickAdd(
    baseDeps(fakeNormalize({ title: "ACT Math section", estimatedDurationMinutes: "60", energy: "high", area: "School/ACT/College Apps", status: "not-started" })),
    { text: "add ACT Math section to act. 60 minutes. deep work. status not started", options: OPTIONS },
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value, {
    title: "ACT Math section",
    fields: { estimatedDurationMinutes: 60, energy: "high", area: "School/ACT/College Apps", status: "not-started" },
  });
});

// ---------------------------------------------------------------------------
// Fix round 1, finding 2: Haiku's title is validated, not trusted verbatim.
// ---------------------------------------------------------------------------

test("an empty Haiku title falls back to undefined (createTask then keeps its own deterministic title)", async () => {
  const result = await normalizeQuickAdd(baseDeps(fakeNormalize({ title: "   ", estimatedDurationMinutes: "60" })), { text: "x", options: OPTIONS });
  assert.ok(result.ok);
  assert.equal(result.value.title, undefined);
  // Fields are still validated/kept even when the title itself is rejected.
  assert.equal(result.value.fields.estimatedDurationMinutes, 60);
});

test("an over-long (>200 char) Haiku title falls back to undefined", async () => {
  const result = await normalizeQuickAdd(baseDeps(fakeNormalize({ title: "x".repeat(201) })), { text: "x", options: OPTIONS });
  assert.ok(result.ok);
  assert.equal(result.value.title, undefined);
});

test("a Haiku title exactly at the 200 char limit is accepted", async () => {
  const result = await normalizeQuickAdd(baseDeps(fakeNormalize({ title: "x".repeat(200) })), { text: "x", options: OPTIONS });
  assert.ok(result.ok);
  assert.equal(result.value.title, "x".repeat(200));
});

test("a Haiku title that still carries a field value it just extracted (e.g. '60 minutes', 'due friday') falls back to undefined", async () => {
  const minutes = await normalizeQuickAdd(baseDeps(fakeNormalize({ title: "Draft budget 60 minutes", estimatedDurationMinutes: "60" })), {
    text: "x",
    options: OPTIONS,
  });
  assert.ok(minutes.ok);
  assert.equal(minutes.value.title, undefined);

  const due = await normalizeQuickAdd(baseDeps(fakeNormalize({ title: "Essay due friday", dueDate: "2026-10-02" })), { text: "x", options: OPTIONS });
  assert.ok(due.ok);
  assert.equal(due.value.title, undefined);
});

test("a clean, reasonably-sized Haiku title with no leftover field words is accepted", async () => {
  const result = await normalizeQuickAdd(baseDeps(fakeNormalize({ title: "  ACT Math section  ", estimatedDurationMinutes: "60" })), {
    text: "x",
    options: OPTIONS,
  });
  assert.ok(result.ok);
  assert.equal(result.value.title, "ACT Math section");
});

test("an Area that isn't one of the live options is dropped, never guessed", async () => {
  const result = await normalizeQuickAdd(baseDeps(fakeNormalize({ title: "x", area: "Made Up Area" })), { text: "x", options: OPTIONS });
  assert.ok(result.ok);
  assert.equal(result.value.fields.area, undefined);
});

test("an Area IS accepted verbatim when the workspace's Area property is free text (no live option list)", async () => {
  const freeTextOptions: TaskFieldOptions = { ...OPTIONS, area: undefined };
  const result = await normalizeQuickAdd(baseDeps(fakeNormalize({ title: "x", area: "Anything Spencer typed" })), { text: "x", options: freeTextOptions });
  assert.ok(result.ok);
  assert.equal(result.value.fields.area, "Anything Spencer typed");
});

test("an invalid Energy/dueDate/duration value is dropped, never guessed", async () => {
  const result = await normalizeQuickAdd(
    baseDeps(fakeNormalize({ title: "x", energy: "nonsense", dueDate: "not-a-date", estimatedDurationMinutes: "not-a-number" })),
    { text: "x", options: OPTIONS },
  );
  assert.ok(result.ok);
  assert.deepEqual(result.value.fields, {});
});

test("Status 'completed'/'slipped' is ALWAYS dropped — quick-add must never set Completed via the Haiku path either", async () => {
  const completed = await normalizeQuickAdd(baseDeps(fakeNormalize({ title: "x", status: "completed" })), { text: "x", options: OPTIONS });
  assert.ok(completed.ok);
  assert.equal(completed.value.fields.status, undefined);

  const slipped = await normalizeQuickAdd(baseDeps(fakeNormalize({ title: "x", status: "slipped" })), { text: "x", options: OPTIONS });
  assert.ok(slipped.ok);
  assert.equal(slipped.value.fields.status, undefined);

  const inProgress = await normalizeQuickAdd(baseDeps(fakeNormalize({ title: "x", status: "in-progress" })), { text: "x", options: OPTIONS });
  assert.ok(inProgress.ok);
  assert.equal(inProgress.value.fields.status, "in-progress");
});

test("a timeout resolves ok:false rather than waiting forever", async () => {
  const deps: NormalizeQuickAddDeps = {
    ...baseDeps(async () => new Promise((resolve) => setTimeout(() => resolve({ title: "x" }), 500))),
    timeoutMs: 15,
  };
  const result = await normalizeQuickAdd(deps, { text: "x", options: OPTIONS });
  assert.equal(result.ok, false);
});

test("a thrown error from the injected normalize resolves ok:false rather than propagating", async () => {
  const result = await normalizeQuickAdd(
    baseDeps(async () => { throw new Error("simulated failure"); }),
    { text: "x", options: OPTIONS },
  );
  assert.equal(result.ok, false);
});

test("normalize returning undefined (couldn't extract anything) resolves ok:false", async () => {
  const result = await normalizeQuickAdd(baseDeps(fakeNormalize(undefined)), { text: "x", options: OPTIONS });
  assert.equal(result.ok, false);
});
