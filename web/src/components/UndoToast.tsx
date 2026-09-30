/**
 * web/src/components/UndoToast.tsx — Story 7.10, DESIGN.md `undo-toast`,
 * EXPERIENCE.md Component Patterns ("Undo Toast").
 *
 * "Checked off {Task} · Undo": glass, a 3px `accent-solid` left bar, a
 * Secondary Undo button, announced politely (`role="status"`,
 * `aria-live="polite"`). It stays up for `durationMs` — the server's own
 * `commitAt - asOf`, never a client constant (AD-20) — then calls
 * `onExpire`.
 *
 * WCAG 2.2.1 (UX-DR31): while the toast is hovered or has focus, its timer
 * pauses AND the server is asked to hold the pending record; when both end,
 * the hold is released and the timer resumes with the server's remaining
 * time (or, if the release request fails, the time it had left locally —
 * the server caps an abandoned hold on its own). A toast unmounted while
 * held (a newer check-off replaced it) releases its hold on the way out —
 * unless Undo was pressed, which deletes the record instead.
 *
 * Enter motion reuses the notification card's "Toast enter" classes
 * (DESIGN.md: one row for "toast / notification appears"), with its
 * fade-only variant under reduced motion.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { remainingMs, requestHold, requestRelease } from "../lib/checkOff.ts";

export interface UndoToastProps {
  /** The pending check-off's id. */
  readonly id: string;
  /** Required unless `label` is given: the default copy is "Checked off {taskName}". */
  readonly taskName?: string;
  /** Replaces the default copy (Story 13.9: "Deleted conversation"). */
  readonly label?: string;
  /** Default true (check-off): pausing also holds the server's pending record. False pauses the local timer only. */
  readonly serverHold?: boolean;
  /** How long the toast stays up from mount: the server's `commitAt - asOf`. */
  readonly durationMs: number;
  onUndo(): Promise<void>;
  onExpire(): void;
}

export function UndoToast({ id, taskName, label, serverHold = true, durationMs, onUndo, onExpire }: UndoToastProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [busy, setBusy] = useState(false);
  /** `undefined` while held; otherwise the ms left to run from when the timer (re)starts. */
  const [runMs, setRunMs] = useState<number | undefined>(durationMs);
  const startedAt = useRef(Date.now());
  const leftAtHold = useRef(durationMs);
  const hovered = useRef(false);
  const focused = useRef(false);
  const held = useRef(false);
  /** Once Undo is pressed the record is being deleted — no release is owed on the way out. */
  const undoRequested = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (runMs === undefined) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => onExpireRef.current(), runMs);
    return () => clearTimeout(timer);
  }, [runMs]);

  // Leaving while held (replaced by a newer check-off, or Home unmounting)
  // must not strand the hold.
  useEffect(
    () => () => {
      if (serverHold && held.current && !undoRequested.current) void requestRelease(id);
    },
    [id, serverHold],
  );

  const sync = (): void => {
    if (undoRequested.current) return; // the record is being deleted; nothing to hold or release
    const engaged = hovered.current || focused.current;
    if (engaged && !held.current) {
      held.current = true;
      leftAtHold.current = Math.max(0, (runMs ?? 0) - (Date.now() - startedAt.current));
      setRunMs(undefined);
      if (serverHold) void requestHold(id);
    } else if (!engaged && held.current) {
      held.current = false;
      if (!serverHold) {
        setRunMs(leftAtHold.current);
        return;
      }
      void requestRelease(id).then((outcome) => {
        if (held.current) return; // re-engaged while the release was in flight
        setRunMs(outcome.ok ? remainingMs(outcome.value) : leftAtHold.current);
      });
    }
  };

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
      onMouseEnter={() => {
        hovered.current = true;
        sync();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        sync();
      }}
      onFocus={() => {
        focused.current = true;
        sync();
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; // focus moved within the toast
        focused.current = false;
        sync();
      }}
      className={
        "notification-glass glass-accent-bar fixed bottom-12 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-md px-4 py-2 font-body text-body text-ink-primary " +
        (reducedMotion ? "notification-card--reduced-motion" : "notification-card")
      }
    >
      <span>{label ?? `Checked off ${taskName ?? ""}`}</span>{" "}
      <span aria-hidden="true" className="text-ink-secondary">
        ·
      </span>{" "}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          undoRequested.current = true;
          setBusy(true);
          void onUndo().finally(() => setBusy(false));
        }}
        className={
          "rounded-sm border-[length:var(--rim-width)] border-rim-interactive bg-transparent px-3 py-1 font-bold text-ink-primary " +
          "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid"
        }
      >
        Undo
      </button>
    </div>,
    document.body,
  );
}
