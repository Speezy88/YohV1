/**
 * web/src/components/memory/MemoryRail.tsx — Story 13.9 (T10b Part 1).
 * The left well: Needs review (hidden at zero), the eight folders under their
 * load-class captions, Changed settings, Chat history. A
 * `data-captures-arrow-keys` region: Up/Down move the selection here instead
 * of paging the app.
 */
import { useRef } from "react";
import { ROW_HOVER_FLAT, ROW_HOVER_RAISED } from "../../lib/controlStyles.ts";
import type { MemoryViewResponse } from "../../../../src/types/api.ts";
import type { MemoryLoadClass } from "../../../../src/types/domain.ts";
import type { MemorySelection } from "../../lib/memory.ts";

const GROUPS: readonly { readonly loadClass: MemoryLoadClass; readonly caption: string }[] = [
  { loadClass: "always", caption: "Always used" },
  { loadClass: "relevant", caption: "Used when relevant" },
  { loadClass: "on-ask", caption: "Only when asked" },
];

const CAPTION_CLASS = "m-0 px-3 pb-1 pt-3 font-body text-small font-bold text-ink-secondary";

function sameSelection(a: MemorySelection, b: MemorySelection): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "folder" || (b.kind === "folder" && a.folder === b.folder);
}

interface Entry {
  readonly key: string;
  readonly label: string;
  readonly count?: number;
  readonly selection: MemorySelection;
}

export function MemoryRail({
  view,
  selection,
  onSelect,
}: {
  readonly view: MemoryViewResponse;
  readonly selection: MemorySelection;
  readonly onSelect: (s: MemorySelection) => void;
}): React.JSX.Element {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const entry = (e: Entry): React.JSX.Element => {
    const active = sameSelection(e.selection, selection);
    return (
      <button
        key={e.key}
        type="button"
        ref={(el) => {
          if (el) refs.current.set(e.key, el);
          else refs.current.delete(e.key);
        }}
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect(e.selection)}
        className={
          "flex w-full items-center justify-between gap-2 rounded-lg border-[length:var(--rim-width)] px-3 py-2 text-left font-body text-body text-ink-primary " +
          (active ? `border-accent-solid bg-surface-raised shadow-extruded-sm ${ROW_HOVER_RAISED}` : `border-transparent ${ROW_HOVER_FLAT}`)
        }
      >
        <span>{e.label}</span>
        {e.count !== undefined && <span className="font-body text-small text-ink-secondary">{e.count}</span>}
      </button>
    );
  };

  const order: Entry[] = [];
  if (view.needsReview.length > 0) {
    order.push({ key: "needs-review", label: "Needs review", count: view.needsReview.length, selection: { kind: "needs-review" } });
  }
  const groups = GROUPS.map((g) => ({
    caption: g.caption,
    entries: view.folders
      .filter((f) => f.loadClass === g.loadClass)
      .map<Entry>((f) => ({ key: f.folder, label: f.label, count: f.count, selection: { kind: "folder", folder: f.folder } })),
  }));
  const tail: Entry[] = [
    { key: "settings", label: "Changed settings", count: view.changedSettings.length, selection: { kind: "settings" } },
    { key: "history", label: "Chat history", selection: { kind: "history" } },
  ];
  const all = [...order, ...groups.flatMap((g) => g.entries), ...tail];

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const at = all.findIndex((x) => sameSelection(x.selection, selection));
    const next = all[Math.max(0, Math.min(all.length - 1, (at < 0 ? 0 : at) + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    e.preventDefault();
    onSelect(next.selection);
    refs.current.get(next.key)?.focus();
  };

  return (
    <nav
      aria-label="Memory"
      data-captures-arrow-keys
      data-wheel-nav="off"
      onKeyDown={onKeyDown}
      className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto rounded-xl bg-surface-sunken p-2 shadow-inset"
    >
      {order.map(entry)}
      {groups.map((g) => (
        <div key={g.caption} className="flex flex-col gap-0.5">
          <p className={CAPTION_CLASS}>{g.caption}</p>
          {g.entries.map(entry)}
        </div>
      ))}
      <div className="mt-2 flex flex-col gap-0.5">{tail.map(entry)}</div>
    </nav>
  );
}
