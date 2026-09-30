/** `POST /api/settings/revert` (Story 13.10): delete a planning-setting override so the default applies again. */
import type { SqliteConnection } from "../adapters/sqlite.ts";
import { isRuleKey, listSettingRows, revertSetting } from "../adapters/settings-store.ts";
import { errorCopyForThrown } from "../core/error-copy.ts";
import { currentRuleValue, defaultPlanningSettings } from "../core/planning-settings.ts";
import { formatRuleValue } from "../core/rule-change.ts";
import type { RevertSettingRequest, RevertSettingResponse } from "../types/api.ts";
import type { Result, YohError } from "../types/domain.ts";

export interface RevertPlanningSettingDeps {
  readonly connection: SqliteConnection;
}

const fail = (kind: "validation" | "conflict", message: string): Result<never, YohError> => ({ ok: false, error: { kind, message } });

export async function revertPlanningSetting(deps: RevertPlanningSettingDeps, input: RevertSettingRequest): Promise<Result<RevertSettingResponse, YohError>> {
  if (typeof input.key !== "string" || !isRuleKey(input.key)) return fail("validation", "That isn't a planning setting.");
  const key = input.key;
  const area = input.area?.trim();
  if (input.area !== undefined && key !== "areaDurationPadding") return fail("validation", "That setting has no area.");
  if (key === "areaDurationPadding" && !area) return fail("validation", "Pick an area to revert.");
  try {
    const has = listSettingRows(deps.connection.db).some((r) => r.key === key && (r.area ?? "") === (area ?? ""));
    if (!has) return fail("conflict", "That setting is already back to its default.");
    revertSetting(deps.connection, key, area);
    const value = currentRuleValue(defaultPlanningSettings(), key, area);
    return { ok: true, value: { message: `Reverted to ${formatRuleValue(key, value)}.` } };
  } catch (error) {
    return { ok: false, error: { kind: "unreachable", message: errorCopyForThrown(error) } };
  }
}
