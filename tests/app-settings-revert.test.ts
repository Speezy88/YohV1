/** Story 13.10: revertPlanningSetting and the deleteSettingInTx area trim. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { readPlanningSettings, writeSetting, deleteSettingInTx, initSettingsStoreSchema } from "../src/adapters/settings-store.ts";
import { revertPlanningSetting } from "../src/app/settings-revert.ts";

function conn() {
  const c = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(c.db);
  initSettingsStoreSchema(c.db);
  return c;
}

test("revert deletes the override and says what it went back to", async () => {
  const c = conn();
  writeSetting(c, "schoolDayWorkStart", "16:00");
  const r = await revertPlanningSetting({ connection: c }, { key: "schoolDayWorkStart" });
  assert.ok(r.ok);
  assert.match(r.value.message, /^Reverted to \d{1,2}:\d{2} [AP]M\.$/);
  assert.deepEqual(readPlanningSettings(c.db).workStart.schoolDay, readPlanningSettings(conn().db).workStart.schoolDay);
  const again = await revertPlanningSetting({ connection: c }, { key: "schoolDayWorkStart" });
  assert.ok(!again.ok && again.error.kind === "conflict" && again.error.message === "That setting is already back to its default.");
});

test("revert validates key and area; padding reverts by area", async () => {
  const c = conn();
  const bad = await revertPlanningSetting({ connection: c }, { key: "nope" as never });
  assert.ok(!bad.ok && bad.error.kind === "validation");
  const stray = await revertPlanningSetting({ connection: c }, { key: "lunchWindow", area: "Work" });
  assert.ok(!stray.ok && stray.error.kind === "validation");
  writeSetting(c, "areaDurationPadding", { area: "Work", minutes: 15 });
  const r = await revertPlanningSetting({ connection: c }, { key: "areaDurationPadding", area: "Work" });
  assert.ok(r.ok);
  assert.deepEqual(readPlanningSettings(c.db).areaDurationPadding, {});
});

test("deleteSettingInTx trims area", () => {
  const c = conn();
  writeSetting(c, "areaDurationPadding", { area: "Work", minutes: 15 });
  deleteSettingInTx(c.db, "areaDurationPadding", "  Work ");
  assert.deepEqual(readPlanningSettings(c.db).areaDurationPadding, {});
});
