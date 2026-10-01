/**
 * web/src/components/memory/ChangedSettingsPane.tsx — Story 13.10 (T11b Part 2).
 * Planning rules Spencer changed from their built-in defaults, each with Revert.
 * Revert is a direct write (never a Proposal): the server's message ("Reverted
 * to 3:15 PM.") replaces the row's text, the row then leaves once the refreshed
 * view drops it, and a failure keeps the row with the message in place.
 */
import { useEffect, useRef, useState } from "react";
import { revertSetting } from "../../lib/memory.ts";
import { formatMemoryDay } from "../../lib/memoryFormat.ts";
import { SMALL_BUTTON_CLASS } from "./MemoryItemRow.tsx";
import { MEMORY_WRITE_NOTE_CLASS } from "./MemorySkeletonRow.tsx";
import { StateMessage } from "../StateMessage.tsx";
import type { ChangedSettingView } from "../../../../src/types/api.ts";

const RESULT_HOLD_MS = 3000;
/** The server's rule labels are lowercase ("school-day work start"); the list shows them as a sentence start. */
const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const rowKey = (s: ChangedSettingView): string => `${s.key}:${s.area ?? ""}`;
const BUTTON = SMALL_BUTTON_CLASS;
const CARD = "flex list-none flex-col gap-1 rounded-lg bg-surface-raised px-4 py-4 font-body shadow-extruded-sm";

interface Reverted {
  readonly setting: ChangedSettingView;
  readonly message: string;
}

export function ChangedSettingsPane({ settings }: { readonly settings: readonly ChangedSettingView[] }): React.JSX.Element {
  const [busyKey, setBusyKey] = useState<string | undefined>(undefined);
  const [failures, setFailures] = useState<Readonly<Record<string, string>>>({});
  const [reverted, setReverted] = useState<Readonly<Record<string, Reverted>>>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const revert = async (s: ChangedSettingView): Promise<void> => {
    const k = rowKey(s);
    setBusyKey(k);
    setFailures((f) => {
      const { [k]: _dropped, ...rest } = f;
      return rest;
    });
    const outcome = await revertSetting(s.key, s.area);
    setBusyKey(undefined);
    if (!outcome.ok) {
      setFailures((f) => ({ ...f, [k]: outcome.message }));
      return;
    }
    setReverted((r) => ({ ...r, [k]: { setting: s, message: outcome.value.message } }));
    timers.current.push(
      setTimeout(() => {
        setReverted((r) => {
          const { [k]: _gone, ...rest } = r;
          return rest;
        });
      }, RESULT_HOLD_MS),
    );
  };

  const rows = [...settings.filter((s) => !(rowKey(s) in reverted)).map((s) => ({ setting: s, done: undefined as string | undefined })), ...Object.values(reverted).map((r) => ({ setting: r.setting, done: r.message }))];
  if (rows.length === 0) return <StateMessage variant="empty" message="No planning rules changed." className="p-5" />;

  return (
    <ul aria-label="Changed settings" className="m-0 flex flex-col gap-2 p-0">
      {rows.map(({ setting: s, done }) => {
        const k = rowKey(s);
        const label = capitalize(s.label);
        return (
          <li key={k} className={CARD}>
            {done ? (
              <span role="status" className="text-body font-medium text-ink-primary">
                {done}
              </span>
            ) : (
              <>
                <span className="text-body font-medium text-ink-primary">
                  {label}: {s.value} (was {s.was}) - changed {formatMemoryDay(s.changedOn)}
                </span>
                <div>
                  <button type="button" disabled={busyKey === k} aria-label={`Revert ${label}`} onClick={() => void revert(s)} className={BUTTON}>
                    Revert
                  </button>
                </div>
                {failures[k] && (
                  <p role="alert" className={MEMORY_WRITE_NOTE_CLASS}>
                    {failures[k]}
                  </p>
                )}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
