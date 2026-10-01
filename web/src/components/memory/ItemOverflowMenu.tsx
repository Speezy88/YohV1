/**
 * web/src/components/memory/ItemOverflowMenu.tsx — Story 13.10 (T11b Part 1).
 * The item's "more" menu: Move to folder, Set/Clear expiry, Delete. A real
 * menu button (`aria-haspopup="menu"`): ArrowDown opens, arrows/Home/End move
 * between items, Esc closes and returns focus to the button. Every action is
 * handed to the row; this component owns no writes.
 */
import { useEffect, useId, useRef, useState } from "react";
import { BUTTON_SECONDARY, CONTROL_SM, FOCUS_RING, ICON_BUTTON, ROW_HOVER_FLAT } from "../../lib/controlStyles.ts";
import type { MemoryFolder } from "../../../../src/types/domain.ts";

export interface FolderChoice {
  readonly folder: MemoryFolder;
  readonly label: string;
}

export interface ItemOverflowMenuProps {
  readonly itemText: string;
  readonly currentFolder: MemoryFolder;
  readonly origin: "stated" | "inferred";
  readonly expiresOn?: string;
  /** All eight folders, in PRD order. */
  readonly folders: readonly FolderChoice[];
  /** A pending rule change can only be deleted (the server refuses move and expiry). */
  readonly deleteOnly?: boolean;
  onMove(folder: MemoryFolder): void;
  onSetExpiry(expiresOn: string | null): void;
  onDelete(): void;
}

/** Folders that hold only things Spencer said; mirrors the server's rule, whose message the disabled item repeats. */
const STATED_ONLY: readonly MemoryFolder[] = ["feedback", "planning-preferences"];

const MENU_ITEM =
  `block w-full rounded-sm px-3 py-2 text-left font-body text-body text-ink-primary aria-disabled:text-ink-secondary ${ROW_HOVER_FLAT}`;

type View = "root" | "move" | "expiry";

function MoreGlyph(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  );
}

export function ItemOverflowMenu({ itemText, currentFolder, origin, expiresOn, folders, deleteOnly = false, onMove, onSetExpiry, onDelete }: ItemOverflowMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("root");
  const [date, setDate] = useState(expiresOn ?? "");
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const items = (): HTMLElement[] => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  const close = (returnFocus: boolean): void => {
    setOpen(false);
    setView("root");
    if (returnFocus) trigger.current?.focus();
  };

  // Focus the first item (or the date field) whenever the open panel changes.
  useEffect(() => {
    if (!open) return;
    if (view === "expiry") menu.current?.querySelector<HTMLElement>("input")?.focus();
    else items()[0]?.focus();
  }, [open, view]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!wrapper.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (!(e.target as HTMLElement).matches('[role="menuitem"]')) return;
    const list = items();
    const at = list.indexOf(e.target as HTMLElement);
    let next: number | undefined;
    if (e.key === "ArrowDown") next = (at + 1) % list.length;
    else if (e.key === "ArrowUp") next = (at - 1 + list.length) % list.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = list.length - 1;
    else if (e.key === "ArrowLeft" && view === "move") {
      e.preventDefault();
      setView("root");
      return;
    }
    if (next !== undefined) {
      e.preventDefault();
      list[next]?.focus();
    }
  };

  const choose = (action: () => void): void => {
    close(true);
    action();
  };

  return (
    <div
      ref={wrapper}
      className="relative"
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) close(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={`More actions for ${itemText}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`${ICON_BUTTON} h-9 w-9`}
      >
        <MoreGlyph />
      </button>
      {open && (
        <div
          ref={menu}
          role={view === "expiry" ? "group" : "menu"}
          aria-label={view === "expiry" ? "Set expiry" : view === "move" ? "Move to folder" : "Item actions"}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-(--z-popover) mt-1 flex min-w-[220px] flex-col gap-0.5 rounded-md bg-surface-raised p-1.5 shadow-extruded-md"
        >
          {view === "root" && (
            <>
              {!deleteOnly && (
                <button type="button" role="menuitem" aria-haspopup="menu" onClick={() => setView("move")} className={MENU_ITEM}>
                  Move to folder
                </button>
              )}
              {!deleteOnly && (
                <button type="button" role="menuitem" onClick={() => setView("expiry")} className={MENU_ITEM}>
                  Set expiry
                </button>
              )}
              {!deleteOnly && expiresOn && (
                <button type="button" role="menuitem" onClick={() => choose(() => onSetExpiry(null))} className={MENU_ITEM}>
                  Clear expiry
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => choose(onDelete)} className={MENU_ITEM}>
                Delete
              </button>
            </>
          )}
          {view === "move" &&
            folders
              .filter((f) => f.folder !== currentFolder)
              .map((f) => {
                const blocked = origin === "inferred" && STATED_ONLY.includes(f.folder);
                const descId = `${baseId}-${f.folder}`;
                return (
                  <div key={f.folder} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      aria-disabled={blocked || undefined}
                      aria-describedby={blocked ? descId : undefined}
                      onClick={() => {
                        if (!blocked) choose(() => onMove(f.folder));
                      }}
                      className={MENU_ITEM}
                    >
                      {f.label}
                    </button>
                    {blocked && (
                      <span id={descId} className="block px-3 pb-1 font-body text-small text-ink-secondary">
                        Only things you said can go in {f.label}.
                      </span>
                    )}
                  </div>
                );
              })}
          {view === "expiry" && (
            <form
              className="flex flex-col gap-2 p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (date) choose(() => onSetExpiry(date));
              }}
            >
              <label className="flex flex-col gap-1 font-body text-small text-ink-secondary">
                Expires on
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={`rounded-md bg-surface-sunken px-3 py-2 font-body text-body text-ink-primary shadow-inset ${FOCUS_RING}`}
                />
              </label>
              <button
                type="submit"
                disabled={!date}
                className={`self-start ${BUTTON_SECONDARY} ${CONTROL_SM}`}
              >
                Save
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
