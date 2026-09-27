/**
 * Tests for `src/app/commands.ts` (Story 8.7).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMANDS, listCommands } from "../src/app/commands.ts";

test("COMMANDS lists exactly /morning and /night for Epic 8 — /sandbox and /research are later epics' own additions", () => {
  assert.deepEqual(
    COMMANDS.map((c) => c.name),
    ["/morning", "/night"],
  );
});

test("every command has a non-empty description and example (UX-DR38)", () => {
  for (const c of COMMANDS) {
    assert.ok(c.description.length > 0, `${c.name} needs a description`);
    assert.ok(c.example.length > 0, `${c.name} needs an example`);
  }
});

test("listCommands returns the registry verbatim, wrapped in a Result", async () => {
  const result = await listCommands({}, {});
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(result.value.commands, COMMANDS);
});
