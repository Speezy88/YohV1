/**
 * web/src/components/SandboxCard.tsx
 *
 * Story 9.2, UX-DR39: one Sandbox Card — a `neumorphic-card` at `rounded-md`
 * rendered inline in the Chat stream. Task name in `typography.title`, Due
 * Date/Estimated Duration rimmed and required, Area/Energy optional, a
 * Secondary "Skip" and a Primary "Save" (disabled until both required
 * fields are filled — a client-side convenience only; the server re-checks
 * regardless, AD-17), and "N remaining" in tabular numerals. A rejected save
 * (an unresolvable Area/Energy) re-prompts INLINE, on this same card,
 * showing the server's own message — the card never advances or leaves
 * history on a rejection (FR-38). `sandbox.ts`'s `saveCard` returns the
 * outcome directly (`SaveCardOutcome`); this component keeps a rejection's
 * message in local state and clears it on the next attempt.
 */
import { useState } from "react";
import { saveCard, skipCard } from "../lib/sandbox.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import type { SandboxCardView } from "../../../src/types/api.ts";

export interface SandboxCardProps {
  readonly view: SandboxCardView;
  readonly status: "pending" | "saved" | "skipped" | "failed";
  readonly receipt?: string;
}

const RIM_INPUT =
  "h-10 w-full min-w-0 rounded-md border-[length:var(--rim-width)] border-accent-solid bg-surface-sunken px-3 font-body text-small text-ink-primary shadow-inset outline-none " +
  "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid";
const PLAIN_INPUT =
  "h-10 w-full min-w-0 rounded-md border-[length:var(--rim-width)] border-rim-interactive bg-surface-raised px-3 font-body text-small text-ink-primary shadow-extruded-sm outline-none " +
  "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid";
const PRIMARY_BUTTON =
  "h-[42px] rounded-full border-transparent bg-gradient-to-br from-accent-gradient-start to-accent-gradient-end px-5 font-bold text-on-accent-solid shadow-extruded-sm disabled:opacity-40 " +
  "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid";
const SECONDARY_BUTTON =
  "h-[42px] rounded-full border-[length:var(--rim-width)] border-rim-interactive bg-surface-raised px-5 font-bold text-ink-primary shadow-extruded-sm disabled:opacity-40 " +
  "focus-visible:outline-[length:var(--focus-ring-width)] focus-visible:outline-offset-2 focus-visible:outline-accent-solid";

const SETTLED_LABEL: Record<Exclude<SandboxCardProps["status"], "pending">, string> = {
  saved: "Saved",
  skipped: "Skipped",
  failed: "Couldn't save",
};

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

  if (status !== "pending") {
    return (
      <div
        data-testid="sandbox-card"
        aria-live="polite"
        className={`flex flex-col gap-1 rounded-md bg-surface-raised p-5 font-body text-body text-ink-primary shadow-extruded-sm ${!reducedMotion && status === "saved" ? "sandbox-card-save-pulse" : ""}`}
      >
        <p className="m-0 font-medium text-title">{view.taskTitle}</p>
        <p className="m-0 text-ink-secondary">{SETTLED_LABEL[status]}</p>
        {receipt && <p className="m-0 font-body text-caption text-ink-secondary">{receipt}</p>}
      </div>
    );
  }

  const canSave = dueDate.trim() !== "" && estimatedDurationMinutes.trim() !== "";

  const onSave = async (): Promise<void> => {
    setBusy(true);
    setErrorText(undefined);
    const outcome = await saveCard({
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

  const onSkip = (): void => {
    void skipCard();
  };

  return (
    <div data-testid="sandbox-card" className="flex flex-col gap-3 rounded-md bg-surface-raised p-5 font-body text-body text-ink-primary shadow-extruded-sm">
      <p className="m-0 font-medium text-title">{view.taskTitle}</p>
      {errorText && (
        <p role="alert" className="m-0 text-caption text-ink-danger">
          {errorText}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-caption text-ink-secondary">
          Due Date
          <input type="date" aria-label="Due Date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={RIM_INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-caption text-ink-secondary">
          Estimated Duration (minutes)
          <input
            type="number"
            inputMode="numeric"
            min={1}
            aria-label="Estimated Duration"
            value={estimatedDurationMinutes}
            onChange={(e) => setEstimatedDurationMinutes(e.target.value)}
            className={RIM_INPUT}
          />
        </label>
        <label className="flex flex-col gap-1 text-caption text-ink-secondary">
          Area (optional)
          <input type="text" aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)} className={PLAIN_INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-caption text-ink-secondary">
          Energy (optional)
          <input type="text" aria-label="Energy" placeholder="low / medium / high" value={energy} onChange={(e) => setEnergy(e.target.value)} className={PLAIN_INPUT} />
        </label>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-body text-numerals tabular-nums text-ink-secondary">{view.remaining} remaining</span>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={onSkip} className={SECONDARY_BUTTON}>
            Skip
          </button>
          <button type="button" disabled={busy || !canSave} onClick={() => void onSave()} className={PRIMARY_BUTTON}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
