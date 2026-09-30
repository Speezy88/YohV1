import { test } from "node:test";
import assert from "node:assert/strict";
import { MEMORY_FOLDERS_IN_ORDER, MEMORY_ITEM_MAX_CHARS, isMemoryFolder, memoryFolderLabel, memoryLoadClass, ALWAYS_LOADED_FOLDERS, STATED_ONLY_FOLDERS } from "../src/core/memory-folders.ts";

test("eight folders in PRD order with labels and load classes", () => {
  assert.equal(MEMORY_FOLDERS_IN_ORDER.length, 8);
  assert.equal(MEMORY_ITEM_MAX_CHARS, 280);
  assert.equal(memoryFolderLabel("goals-projects"), "Goals & projects");
  assert.equal(memoryFolderLabel("ideas-notes"), "Ideas & notes");
  assert.deepEqual(MEMORY_FOLDERS_IN_ORDER.map(memoryLoadClass), ["always", "always", "always", "always", "always", "relevant", "relevant", "on-ask"]);
  assert.deepEqual(ALWAYS_LOADED_FOLDERS, MEMORY_FOLDERS_IN_ORDER.slice(0, 5));
  assert.deepEqual(STATED_ONLY_FOLDERS, ["feedback", "planning-preferences"]);
  assert.equal(isMemoryFolder("patterns"), true);
  assert.equal(isMemoryFolder("nope"), false);
  assert.equal(isMemoryFolder(3), false);
});
