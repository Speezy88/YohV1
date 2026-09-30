import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  applyAreaPadding,
  defaultPlanningSettings,
  resolvePlanningSettings,
  validateRuleValue,
} from "../src/core/planning-settings.ts";
import { computeSchoolDay } from "../src/core/school-day.ts";
import { initNotificationStoreSchema } from "../src/adapters/notification-store.ts";
import { readPlanningSettings, writeSetting, revertSetting, initSettingsStoreSchema } from "../src/adapters/settings-store.ts";
import { openSqliteConnection } from "../src/adapters/sqlite.ts";
import type { CompleteTask } from "../src/types/domain.ts";

test("validateRuleValue: work start floors at 09:00 (G1), ceilings at 21:00, 5-minute step", () => {
  for (const bad of ["08:55", "21:05", "09:03", "9:00", 900, null]) {
    const r = validateRuleValue("schoolDayWorkStart", bad);
    assert.equal(r.ok, false, String(bad));
    if (!r.ok) assert.equal(r.error.kind, "validation");
  }
  for (const good of ["09:00", "15:20", "21:00"]) assert.equal(validateRuleValue("otherDayWorkStart", good).ok, true, good);
});

test("validateRuleValue: windows and padding shapes", () => {
  assert.equal(validateRuleValue("lunchWindow", { start: "11:00", end: "11:30" }).ok, true);
  assert.equal(validateRuleValue("lunchWindow", { start: "11:30", end: "11:00" }).ok, false);
  assert.equal(validateRuleValue("lunchWindow", { start: "11:00", end: "11:02" }).ok, false);
  assert.equal(validateRuleValue("communityWindow", { start: "10:00", end: "13:01" }).ok, false);
  assert.equal(validateRuleValue("communityWindow", { start: "10:00", end: "13:00" }).ok, true);
  assert.equal(validateRuleValue("areaDurationPadding", { area: "Work", minutes: 15 }).ok, true);
  assert.equal(validateRuleValue("areaDurationPadding", { area: "Work", minutes: 12 }).ok, false);
  assert.equal(validateRuleValue("areaDurationPadding", { area: "Work", minutes: 125 }).ok, false);
  assert.equal(validateRuleValue("areaDurationPadding", { area: "  ", minutes: 5 }).ok, false);
  assert.equal(validateRuleValue("areaDurationPadding", { area: "Work", minutes: 0 }).ok, true);
});

test("defaults match today's constants", () => {
  const s = defaultPlanningSettings();
  assert.deepEqual(s.workStart, { schoolDay: { hour: 15, minute: 15 }, otherDay: { hour: 9, minute: 0 } });
  assert.deepEqual(s.protectedWindows.map((w) => w.key), ["lunch", "community"]);
  assert.deepEqual(s.areaDurationPadding, {});
});

test("resolvePlanningSettings applies overrides; computeSchoolDay honors them", () => {
  const s = resolvePlanningSettings(
    { workStart: defaultPlanningSettings().workStart, protectedWindows: defaultPlanningSettings().protectedWindows },
    { schoolDayWorkStart: "16:00", lunchWindow: { start: "11:00", end: "11:30" } },
  );
  const events = [{ id: "e", title: "Class", start: "2026-09-30T14:00:00.000Z", end: "2026-09-30T15:00:00.000Z", calendarId: "school" }];
  const r = computeSchoolDay(events, "2026-09-30", "UTC", s);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.workStart, "2026-09-30T16:00:00.000Z");
    const lunch = r.value.protectedWindows.find((w) => w.id.startsWith("school-protected:lunch:"));
    assert.equal(lunch?.start, "2026-09-30T11:00:00.000Z");
    assert.equal(lunch?.end, "2026-09-30T11:30:00.000Z");
  }
});

test("applyAreaPadding pads set Areas only", () => {
  const mk = (id: string, area: CompleteTask["area"]) => ({ id, estimatedDurationMinutes: 30, area }) as unknown as CompleteTask;
  const s = resolvePlanningSettings(
    { workStart: defaultPlanningSettings().workStart, protectedWindows: defaultPlanningSettings().protectedWindows },
    { areaDurationPadding: { Work: 10 } },
  );
  const out = applyAreaPadding([mk("a", { kind: "set", value: "Work" }), mk("b", { kind: "set", value: "Home" }), mk("c", { kind: "missing" })], s);
  assert.deepEqual(out.map((t) => t.estimatedDurationMinutes), [40, 30, 30]);
});

test("settings store: no overrides = defaults; write, read, revert", () => {
  const conn = openSqliteConnection({ databasePath: ":memory:" });
  initNotificationStoreSchema(conn.db);
  initSettingsStoreSchema(conn.db);
  assert.deepEqual(readPlanningSettings(conn.db), defaultPlanningSettings());
  writeSetting(conn, "otherDayWorkStart", "10:30");
  writeSetting(conn, "areaDurationPadding", { area: "Work", minutes: 15 });
  writeSetting(conn, "areaDurationPadding", { area: "Home", minutes: 5 });
  const s = readPlanningSettings(conn.db);
  assert.deepEqual(s.workStart.otherDay, { hour: 10, minute: 30 });
  assert.deepEqual(s.areaDurationPadding, { Work: 15, Home: 5 });
  assert.throws(() => writeSetting(conn, "otherDayWorkStart", "08:00"));
  revertSetting(conn, "areaDurationPadding", "Work");
  revertSetting(conn, "otherDayWorkStart");
  assert.deepEqual(readPlanningSettings(conn.db).areaDurationPadding, { Home: 5 });
  assert.deepEqual(readPlanningSettings(conn.db).workStart, defaultPlanningSettings().workStart);
});

test("source scan: school constants are read only in planning-settings.ts", () => {
  const offenders: string[] = [];
  const counts: Record<string, number> = {};
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!full.endsWith(".ts")) continue;
      const text = readFileSync(full, "utf8");
      const hits = (text.match(/WORK_START_TIMES|SCHOOL_PROTECTED_WINDOWS/g) ?? []).length;
      if (hits === 0) continue;
      if (full.endsWith("core/planning-settings.ts")) continue;
      if (full.endsWith("core/school-day.ts")) { counts[full] = hits; continue; }
      offenders.push(full);
    }
  }
  walk(join(import.meta.dirname, "..", "src"));
  assert.deepEqual(offenders, []);
  assert.deepEqual(Object.values(counts), [2], "school-day.ts declares each constant exactly once");
});
