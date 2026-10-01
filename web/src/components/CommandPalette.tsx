/**
 * web/src/components/CommandPalette.tsx
 *
 * Story 8.7 (UX-DR38): a glass panel listing the server's command registry
 * (`GET /api/commands`, `lib/commands.ts`), filtered live against `query` —
 * everything currently typed in the Chat Input (or Chat Bubble, Story 8.8)
 * while it starts with "/", so `query` IS that value.
 *
 * Owns its own keyboard handling (↑↓, Enter, Esc) via a capture-phase
 * `document` listener rather than a prop-driven `onKeyDown`: the text
 * input keeps focus the whole time (Spencer is still typing), so a
 * listener scoped to this component's own DOM subtree would never see the
 * keypress. A capture-phase listener on `document` runs before the Chat
 * Input's own bubble-phase Enter-to-send handler, and `stopPropagation()`
 * here keeps that handler from also firing.
 *
 * The highlighted row gets an accent-solid rim (`--rim-width`). No match
 * shows "No matching command" plus the full list.
 *
 * Story 8.8 review carry-in (from 8.7): full combobox semantics. Each row
 * has a stable `id` (`role="option"` was already there); the OWNING text
 * input (`ChatInput.tsx` / `ChatBubble.tsx` — this component never renders
 * the input itself, so it can't set the attribute on itself) sets
 * `aria-activedescendant` to the highlighted row's id via
 * `onHighlightedOptionChange`, so a screen reader announces the highlighted
 * command as ↑/↓ move it, without moving DOM focus off the input.
 */
import { ROW_HOVER_FLAT } from "../lib/controlStyles.ts";
import { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { StateMessage } from "./StateMessage.tsx";
import { fetchCommands, filterCommands } from "../lib/commands.ts";
import type { CommandDescriptor } from "../../../src/types/api.ts";

export interface CommandPaletteProps {
  readonly query: string;
  readonly onRun: (name: string) => void;
  readonly onClose: () => void;
  /** Story 8.8 review carry-in: called whenever the highlighted row's id changes (including on mount and back to `undefined` if the list becomes empty), so the owning input can mirror it as its own `aria-activedescendant`. */
  readonly onHighlightedOptionChange?: (id: string | undefined) => void;
}

/** A stable DOM id for `command`'s row — `aria-activedescendant` needs an id it can point at; `/` is stripped since it reads oddly in an id. */
/** The listbox id; the Chat Input combobox points aria-controls at it. */
export const COMMAND_PALETTE_ID = "command-palette-listbox";

function optionId(command: CommandDescriptor): string {
  return `command-option-${command.name.replace(/\//g, "")}`;
}

export function CommandPalette({ query, onRun, onClose, onHighlightedOptionChange }: CommandPaletteProps): React.JSX.Element {
  const [commands, setCommands] = useState<readonly CommandDescriptor[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [highlighted, setHighlighted] = useState(0);
  const reducedMotion = useReducedMotion();

  const load = useCallback((): (() => void) => {
    let cancelled = false;
    setLoadState("loading");
    fetchCommands().then(
      (c) => {
        if (cancelled) return;
        setCommands(c);
        setLoadState("ready");
      },
      () => {
        if (!cancelled) setLoadState("failed");
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  const filtered = filterCommands(commands, query);
  const rows = filtered.length === 0 ? commands : filtered;

  useEffect(() => {
    setHighlighted(0); // a new keystroke changed the filtered set — re-highlight the top row.
  }, [query, commands.length]);

  useEffect(() => {
    onHighlightedOptionChange?.(filtered.length > 0 ? optionId(filtered[highlighted]!) : undefined);
    // filtered is re-derived every render from commands/query, so listing it
    // as a dep would fire this on every render — highlighted/commands/query
    // are the only real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlighted, commands, query, onHighlightedOptionChange]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setHighlighted((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setHighlighted((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        // Task 8: `filtered` is `[]` until `fetchCommands()` resolves
        // (above) — swallowing Enter unconditionally here, before checking
        // `picked`, used to eat a fast-typed "/command" before the registry
        // even loaded. Only claim the keypress when a row is actually
        // picked; otherwise let it fall through to ChatInput's own
        // Enter-to-send (the server's slash dispatch then handles it), same
        // as if the palette weren't mounted at all.
        const picked = filtered[highlighted];
        if (picked) {
          e.preventDefault();
          e.stopPropagation();
          onRun(picked.name);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [filtered, highlighted, onRun, onClose]);

  return (
    <div id={COMMAND_PALETTE_ID} role="listbox" aria-label="Command palette" data-testid="command-palette" className="notification-glass absolute bottom-full left-0 z-(--z-raised) mb-2 w-full rounded-md p-2">
      {loadState === "loading" &&
        [0, 1, 2].map((i) => (
          <div key={i} data-testid="command-row-skeleton" className={`my-1 h-7 rounded-sm bg-surface-sunken ${reducedMotion ? "" : "animate-pulse"}`} />
        ))}
      {loadState === "failed" && <StateMessage variant="error" className="px-2 py-1" message="Couldn't load commands." onRetry={() => void load()} />}
      {loadState === "ready" && filtered.length === 0 && <div className="px-2 py-1 font-body text-body text-ink-secondary">No matching command</div>}
      {rows.map((c, i) => (
        <div
          key={c.name}
          id={optionId(c)}
          role="option"
          data-testid={`command-row-${c.name}`}
          aria-selected={filtered.length > 0 && i === highlighted}
          onClick={() => onRun(c.name)}
          onMouseMove={() => {
            if (filtered.length > 0 && i !== highlighted) setHighlighted(i);
          }}
          className={
            `flex cursor-pointer items-baseline justify-between gap-2 rounded-sm border-[length:var(--rim-width)] px-2 py-1 ${ROW_HOVER_FLAT} ` +
            (filtered.length > 0 && i === highlighted ? "border-accent-solid" : "border-transparent")
          }
        >
          <span className="shrink-0 font-body text-body font-bold text-ink-primary">{c.name}</span>
          <span className="min-w-0 flex-1 truncate px-2 font-body text-body text-ink-secondary">{c.description}</span>
          {/* A no-argument command's example is just its own name — repeating it adds nothing. */}
          {c.example !== c.name && <span className="shrink-0 font-body text-caption text-ink-secondary">{c.example}</span>}
        </div>
      ))}
    </div>
  );
}
