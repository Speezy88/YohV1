import { test } from "node:test";
import assert from "node:assert/strict";
import { recognizeMemoryCommand, parseSlashMemoryCommand } from "../src/core/memory-commands.ts";

test("remember to / remind me to fall through", () => {
  assert.equal(recognizeMemoryCommand("remember to call mom"), undefined);
  assert.equal(recognizeMemoryCommand("Remind me to call mom"), undefined);
});

test("remember that / remember: yield text", () => {
  assert.deepEqual(recognizeMemoryCommand("  Remember that Chem club is a club, not a class "), { kind: "remember", text: "Chem club is a club, not a class" });
  assert.deepEqual(recognizeMemoryCommand("remember: I run at 6"), { kind: "remember", text: "I run at 6" });
  assert.equal(recognizeMemoryCommand("remember that"), undefined);
  assert.equal(recognizeMemoryCommand("remember:  "), undefined);
});

test("forget variants", () => {
  assert.deepEqual(recognizeMemoryCommand("forget that"), { kind: "forget", words: "" });
  assert.deepEqual(recognizeMemoryCommand("Forget the AP Bio deadline"), { kind: "forget", words: "the AP Bio deadline" });
  assert.equal(recognizeMemoryCommand("forget it"), undefined);
  assert.equal(recognizeMemoryCommand("forget about it"), undefined);
  assert.equal(recognizeMemoryCommand("forget"), undefined);
});

test("recall", () => {
  assert.deepEqual(recognizeMemoryCommand("What do you remember about AP Bio?"), { kind: "recall", topic: "AP Bio" });
  assert.equal(recognizeMemoryCommand("what do you remember about"), undefined);
  assert.equal(recognizeMemoryCommand("what's on my plan"), undefined);
});

test("slash parsing", () => {
  assert.deepEqual(parseSlashMemoryCommand("/remember", "Chem club"), { kind: "remember", text: "Chem club" });
  assert.equal(parseSlashMemoryCommand("/remember", " "), undefined);
  assert.deepEqual(parseSlashMemoryCommand("/forget", ""), { kind: "forget", words: "" });
  assert.deepEqual(parseSlashMemoryCommand("/forget", "AP Bio"), { kind: "forget", words: "AP Bio" });
  assert.equal(parseSlashMemoryCommand("/plan", "x"), undefined);
});
