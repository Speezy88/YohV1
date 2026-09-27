/**
 * web/src/hooks/useCommandPaletteInput.ts
 *
 * Story 8.8 review fix: `ChatInput.tsx` (Story 8.5/8.7) and `ChatBubble.tsx`
 * (Story 8.8) each mount a `CommandPalette` directly under their own text
 * field, with byte-identical "/" detection, dismiss-on-Esc /
 * re-offer-on-typing, and combobox (`aria-activedescendant`) wiring — this
 * hook is the ONE place that logic lives, so both components stay in
 * lockstep with `CommandPalette`'s real props (Task 8/8.7) and this story's
 * `onHighlightedOptionChange` carry-in, instead of two copies drifting.
 *
 * `afterRun` is the one thing that legitimately differs between the two
 * callers: `ChatInput.tsx` has nothing extra to do once a command is sent;
 * `ChatBubble.tsx` also navigates to Chat (the SAME thing Enter-to-send
 * already does there). Everything else — running the picked command,
 * clearing the draft, re-offering the palette on the next keystroke, and
 * closing it on Esc (via `CommandPalette`'s own `onClose`) — is identical
 * and lives here.
 */
import { useState } from "react";
import { send, setDraft } from "../lib/chatStore.ts";
import type { CommandPaletteProps } from "../components/CommandPalette.tsx";

export interface UseCommandPaletteInputResult {
  /** Whether the palette should be mounted right now — `draft` starts with "/" and Esc hasn't dismissed it since. */
  readonly showPalette: boolean;
  /** Ready to use as the owning input's own `aria-activedescendant` — `undefined` whenever the palette isn't shown. */
  readonly activeDescendant: string | undefined;
  /** The owning input's `onChange` handler — re-offers the palette on any further typing. */
  readonly handleChange: (next: string) => void;
  /** Spread directly onto `<CommandPalette {...commandPaletteProps} />` — `onHighlightedOptionChange` is always supplied here, unlike `CommandPaletteProps`'s own optional declaration (a caller that doesn't need combobox wiring can still omit it on the prop itself). */
  readonly commandPaletteProps: Pick<CommandPaletteProps, "query" | "onRun" | "onClose"> & {
    readonly onHighlightedOptionChange: NonNullable<CommandPaletteProps["onHighlightedOptionChange"]>;
  };
}

export function useCommandPaletteInput(draft: string, afterRun?: () => void): UseCommandPaletteInputResult {
  const [paletteDismissed, setPaletteDismissed] = useState(false);
  const [highlightedOptionId, setHighlightedOptionId] = useState<string | undefined>(undefined);
  const showPalette = draft.startsWith("/") && !paletteDismissed;

  return {
    showPalette,
    activeDescendant: showPalette ? highlightedOptionId : undefined,
    handleChange: (next) => {
      setPaletteDismissed(false); // re-engaging (typing) always re-offers the palette
      setDraft(next);
    },
    commandPaletteProps: {
      query: draft,
      onRun: (name) => {
        void send(name);
        setDraft("");
        afterRun?.();
      },
      onClose: () => setPaletteDismissed(true),
      onHighlightedOptionChange: setHighlightedOptionId,
    },
  };
}
