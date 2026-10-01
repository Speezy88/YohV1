/**
 * web/src/components/SandboxCard.tsx
 *
 * Story 9.2, UX-DR39: one Sandbox Card — a `neumorphic-card` at `rounded-md`
 * rendered inline in the Chat stream. Task name in `typography.title`, Due
 * Date/Estimated Duration rimmed and required, Area/Energy optional, a
 * Secondary "Skip" and a Primary "Save" (enabled while idle; pressing it with a required
 * field empty names that field inline and focuses it — the server re-checks
 * regardless, AD-17), and "N remaining" in tabular numerals. A rejected save
 * (an unresolvable Area/Energy) re-prompts INLINE, on this same card,
 * showing the server's own message — the card never advances or leaves
 * history on a rejection (FR-38). `sandbox.ts`'s `saveCard` returns the
 * outcome directly (`SaveCardOutcome`); this component keeps a rejection's
 * message in local state and clears it on the next attempt. Task 6
 * (polish-5): `skipCard` mirrors that same `SaveCardOutcome` shape — a
 * failed Skip reuses this same `errorText` state and `role=alert` markup
 * (with a fixed "Couldn't skip — try again." rather than the server's own
 * message) and leaves the card pending and usable.
 */
import { useRef, useState } from "react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CONTROL_MD, FOCUS_RING } from "../lib/controlStyles.ts";
import { saveCard, skipCard } from "../lib/sandbox.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { optionLabel } from "../lib/tasks.ts";
import type { SandboxCardView } from "../../../src/types/api.ts";

export interface SandboxCardProps {
  readonly view: SandboxCardView;
  readonly status: "pending" | "saved" | "skipped" | "failed";
  readonly receipt?: string;
}

const RIM_INPUT =
  `h-11 w-full min-w-0 rounded-md border-[length:var(--rim-width)] border-accent-solid bg-surface-sunken px-3 font-body text-small text-ink-primary shadow-inset outline-none ${FOCUS_RING}`;
const PLAIN_INPUT =
  `h-11 w-full min-w-0 rounded-md border-[length:var(--rim-width)] border-rim-interactive bg-surface-raised px-3 font-body text-small text-ink-primary shadow-extruded-sm outline-none ${FOCUS_RING}`;
const PRIMARY_BUTTON = `${BUTTON_PRIMARY} ${CONTROL_MD}`;
const SECONDARY_BUTTON = `${BUTTON_SECONDARY} ${CONTROL_MD}`;

const SETTLED_LABEL: Record<Exclude<SandboxCardProps["status"], "pending">, string> = {
  saved: "Saved",
  skipped: "Skipped",
  failed: "Couldn't save",
};

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Task 5 (polish-5): the live options list, plus — if `current` isn't among
 * them — `current` itself appended as an extra, already-selected option.
 * Never silently drops a value the view sent just because it's since fallen
 * out of the live Notion schema.
 */
function withCurrent(options: readonly SelectOption[], current: string): readonly SelectOption[] {
  return current === "" || options.some((o) => o.value === current) ? options : [...options, { value: current, label: current }];
}

export function SandboxCard({ view, status, receipt }: SandboxCardProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [dueDate, setDueDate] = useState(view.dueDate ?? "");
  const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState(
    view.estimatedDurationMinutes !== undefined ? String(view.estimatedDurationMinutes) : "",
  );
  const [area, setArea] = useState(view.area ?? "");
  const [energy, setEnergy] = useState(view.energy ?? "");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | undefined>(undefined);
  const dueDateRef = useRef<HTMLInputElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);

  // Task 6 (polish-5): a PERSISTENT status region — mounted from the card's
  // very first (pending) render, not created fresh on settle. Only its text
  // content changes here; the `<p>` element itself (same `key`, in both
  // branches below) is the same DOM node throughout, so a screen reader's
  // `aria-live="polite"` region is already attached and announces the
  // settle-time text change rather than a brand-new node that starts out
  // already holding the content (easy to miss for a live region).
  const statusText = status === "pending" ? "" : `${SETTLED_LABEL[status]}. ${view.remaining} remaining.`;
  const statusRegion = (
    <p key="sandbox-status-region" role="status" aria-live="polite" className="sr-only">
      {statusText}
    </p>
  );

  if (status !== "pending") {
    return (
      <div
        data-testid="sandbox-card"
        className={`flex flex-col gap-1 rounded-md bg-surface-raised p-5 font-body text-body text-ink-primary shadow-extruded-sm ${!reducedMotion && status === "saved" ? "sandbox-card-save-pulse" : ""}`}
      >
        <p className="m-0 font-medium text-title">{view.taskTitle}</p>
        <p className="m-0 text-ink-secondary">{SETTLED_LABEL[status]}</p>
        {receipt && <p className="m-0 font-body text-caption-lg text-ink-secondary">{receipt}</p>}
        {/* FR-37: the ONE announcement of this settling — status plus the
            counter's new value — read together so a screen reader user
            hears "Saved. 2 remaining." as one utterance. Visually hidden;
            the paragraphs above already show the same status text sighted. */}
        {statusRegion}
      </div>
    );
  }

  const areaOptions = withCurrent(
    view.options.area.map((a) => ({ value: a, label: a })),
    area,
  );
  const energyOptions = withCurrent(
    view.options.energy.map((o) => ({ value: o.value, label: optionLabel(o.label) })),
    energy,
  );

  const onSave = async (): Promise<void> => {
    if (busy) return;
    if (dueDate.trim() === "") {
      setErrorText("Due Date is required — pick a date.");
      dueDateRef.current?.focus();
      return;
    }
    if (estimatedDurationMinutes.trim() === "") {
      setErrorText("Estimated Duration is required — enter the minutes.");
      durationRef.current?.focus();
      return;
    }
    setBusy(true);
    setErrorText(undefined);
    const outcome = await saveCard(view.taskId, {
      dueDate,
      estimatedDurationMinutes,
      ...(area.trim() !== "" ? { area: area.trim() } : {}),
      ...(energy.trim() !== "" ? { energy: energy.trim() } : {}),
    });
    setBusy(false);
    if (!outcome.ok) {
      // FR-38: the card stays pending — this same instance re-prompts with
      // the server's own rejection message, editable and retryable.
      setErrorText(outcome.message);
    }
  };

  const onSkip = async (): Promise<void> => {
    setBusy(true);
    setErrorText(undefined);
    const outcome = await skipCard(view.taskId);
    setBusy(false);
    if (!outcome.ok) {
      // Task 6 (polish-5): a fixed, generic line — never the server's own
      // message (unlike `onSave`'s FR-38 re-prompt above) — since a failed
      // Skip has no field-level correction to make; the card just stays
      // pending and usable, re-enabled by `setBusy(false)` above.
      setErrorText("Couldn't skip — try again.");
    }
  };

  const onFieldKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      void onSave();
    }
  };

  return (
    <div data-testid="sandbox-card" className="flex flex-col gap-3 rounded-md bg-surface-raised p-5 font-body text-body text-ink-primary shadow-extruded-sm">
      <p className="m-0 font-medium text-title">{view.taskTitle}</p>
      {errorText && (
        <p role="alert" className="m-0 text-caption-lg text-ink-danger">
          {errorText}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-caption-lg text-ink-secondary">
          Due Date
          <input ref={dueDateRef} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} onKeyDown={onFieldKeyDown} className={RIM_INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-caption-lg text-ink-secondary">
          Estimated Duration (minutes)
          <input
            ref={durationRef}
            type="number"
            inputMode="numeric"
            min={1}
            value={estimatedDurationMinutes}
            onChange={(e) => setEstimatedDurationMinutes(e.target.value)}
            onKeyDown={onFieldKeyDown}
            className={RIM_INPUT}
          />
        </label>
        <label className="flex flex-col gap-1 text-caption-lg text-ink-secondary">
          Area (optional)
          {view.options.area.length > 0 ? (
            <select value={area} onChange={(e) => setArea(e.target.value)} className={PLAIN_INPUT}>
              <option value="">—</option>
              {areaOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input type="text" value={area} onChange={(e) => setArea(e.target.value)} onKeyDown={onFieldKeyDown} className={PLAIN_INPUT} />
          )}
        </label>
        <label className="flex flex-col gap-1 text-caption-lg text-ink-secondary">
          Energy (optional)
          {view.options.energy.length > 0 ? (
            <select value={energy} onChange={(e) => setEnergy(e.target.value)} className={PLAIN_INPUT}>
              <option value="">—</option>
              {energyOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input type="text" placeholder="low / medium / high" value={energy} onChange={(e) => setEnergy(e.target.value)} onKeyDown={onFieldKeyDown} className={PLAIN_INPUT} />
          )}
        </label>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-body text-numerals tabular-nums text-ink-secondary">{view.remaining} remaining</span>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => void onSkip()} className={SECONDARY_BUTTON}>
            Skip
          </button>
          <button type="button" disabled={busy} onClick={() => void onSave()} className={PRIMARY_BUTTON}>
            Save
          </button>
        </div>
      </div>
      {statusRegion}
    </div>
  );
}
