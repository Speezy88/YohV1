/**
 * Settings store (Story 13.7, AD-29): Spencer's planning-rule overrides.
 * Read at run time by every planning pipeline (`store.withDb(readPlanningSettings)`);
 * with no rows, planning is exactly the built-in defaults. Writes validate
 * (throwing on an invalid value; `app/` converts) and append one `memory`
 * outbox row.
 */
import type Database from "better-sqlite3";
import type { Area, IsoDateTime, RuleSettingKey } from "../types/domain.ts";
import type { SqliteConnection } from "./sqlite.ts";
import { appendOutboxInTx } from "./notification-store.ts";
import { MEMORY_TOPIC } from "./chat-store.ts";
import { writeStructuredLog } from "./logger.ts";
import {
  builtInPlanningDefaults,
  resolvePlanningSettings,
  validateRuleValue,
  type PlanningSettings,
  type RuleSettingValue,
  type SettingOverrides,
} from "../core/planning-settings.ts";

const readyDbs = new WeakSet<Database.Database>();

export function initSettingsStoreSchema(db: Database.Database): void {
  if (readyDbs.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS planning_settings (
      key TEXT NOT NULL,
      area TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (key, area)
    );
  `);
  // DDL inside a transaction rolls back with it, so only remember the table outside one.
  if (!db.inTransaction) readyDbs.add(db);
}

export function readSettingOverrides(db: Database.Database): SettingOverrides {
  initSettingsStoreSchema(db);
  const rows = db.prepare("SELECT key, area, value FROM planning_settings ORDER BY key, area").all() as { key: string; area: string; value: string }[];
  const out: SettingOverrides = {};
  const padding: Record<Area, number> = {};
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      writeStructuredLog({ level: "warn", event: "settings-store.invalid-row-skipped", detail: { key: row.key, area: row.area } });
      continue;
    }
    // A stored value that no longer validates is ignored rather than breaking planning.
    if (!isRuleKey(row.key) || !validateRuleValue(row.key, row.key === "areaDurationPadding" ? { area: row.area, minutes: parsed } : parsed).ok) {
      writeStructuredLog({ level: "warn", event: "settings-store.invalid-row-skipped", detail: { key: row.key, area: row.area } });
      continue;
    }
    if (row.key === "areaDurationPadding") padding[row.area] = parsed as number;
    else if (row.key === "schoolDayWorkStart" || row.key === "otherDayWorkStart") out[row.key] = parsed as string;
    else out[row.key] = parsed as { start: string; end: string };
  }
  if (Object.keys(padding).length > 0) out.areaDurationPadding = padding;
  return out;
}

/** Every valid override row with its `updated_at`, newest first; invalid rows are skipped and logged. */
export function listSettingRows(db: Database.Database): { key: RuleSettingKey; area?: Area; value: RuleSettingValue; updatedAt: IsoDateTime }[] {
  initSettingsStoreSchema(db);
  const rows = db.prepare("SELECT key, area, value, updated_at FROM planning_settings ORDER BY updated_at DESC, key, area").all() as {
    key: string;
    area: string;
    value: string;
    updated_at: string;
  }[];
  const out: { key: RuleSettingKey; area?: Area; value: RuleSettingValue; updatedAt: IsoDateTime }[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      writeStructuredLog({ level: "warn", event: "settings-store.invalid-row-skipped", detail: { key: row.key, area: row.area } });
      continue;
    }
    if (!isRuleKey(row.key)) {
      writeStructuredLog({ level: "warn", event: "settings-store.invalid-row-skipped", detail: { key: row.key, area: row.area } });
      continue;
    }
    const isPadding = row.key === "areaDurationPadding";
    const value = (isPadding ? { area: row.area, minutes: parsed } : parsed) as RuleSettingValue;
    if (!validateRuleValue(row.key, value).ok) {
      writeStructuredLog({ level: "warn", event: "settings-store.invalid-row-skipped", detail: { key: row.key, area: row.area } });
      continue;
    }
    out.push({ key: row.key, ...(isPadding ? { area: row.area } : {}), value, updatedAt: row.updated_at });
  }
  return out;
}

export function isRuleKey(key: string): key is RuleSettingKey {
  return ["schoolDayWorkStart", "otherDayWorkStart", "lunchWindow", "communityWindow", "areaDurationPadding"].includes(key);
}

export function readPlanningSettings(db: Database.Database): PlanningSettings {
  return resolvePlanningSettings(builtInPlanningDefaults(), readSettingOverrides(db));
}

export function writeSettingInTx(db: Database.Database, key: RuleSettingKey, value: RuleSettingValue): void {
  const checked = validateRuleValue(key, value);
  if (!checked.ok) throw new Error(checked.error.message);
  initSettingsStoreSchema(db);
  const v = checked.value;
  const isPadding = key === "areaDurationPadding";
  const area = isPadding ? (v as { area: Area }).area : "";
  const stored = isPadding ? (v as { minutes: number }).minutes : v;
  db.prepare(
    `INSERT INTO planning_settings (key, area, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key, area) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, area, JSON.stringify(stored), new Date().toISOString());
}

export function deleteSettingInTx(db: Database.Database, key: RuleSettingKey, area?: Area): void {
  initSettingsStoreSchema(db);
  db.prepare("DELETE FROM planning_settings WHERE key = ? AND area = ?").run(key, area?.trim() ?? "");
}

export function writeSetting(connection: SqliteConnection, key: RuleSettingKey, value: RuleSettingValue): void {
  connection.writeTx((db) => {
    writeSettingInTx(db, key, value);
    appendOutboxInTx(db, { topic: MEMORY_TOPIC, entityId: key });
  });
}

export function revertSetting(connection: SqliteConnection, key: RuleSettingKey, area?: Area): void {
  connection.writeTx((db) => {
    deleteSettingInTx(db, key, area);
    appendOutboxInTx(db, { topic: MEMORY_TOPIC, entityId: key });
  });
}
