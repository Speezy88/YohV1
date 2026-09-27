/**
 * web/src/components/PlanChecklist.test.tsx — Story 7.10.
 *
 * The Plan checklist's check-off with undo: the instant, client-side
 * dissolve (before any server response), the Undo Toast (visible until the
 * server's `commitAt`, held while hovered/focused), Undo, the visible
 * failure paths, and rapid successive check-offs. The API calls are mocked
 * at `lib/checkOff.ts`; `remainingMs` stays real.
 *
 * Fix round (2026-09-27 review): rows now show a local time range, formatted
 * in the given `timeZone` — fixtures use real ISO timestamps (not the
 * former `start: "x", end: "y"` placeholders, which never round-tripped
 * through a real `Date` and would throw once the component started reading
 * them).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PlanChecklist } from "./PlanChecklist.tsx";
import * as checkOff from "../lib/checkOff.ts";
import * as notifications from "../lib/notifications.ts";
import type { HomePlanRow, PendingCheckOffResponse } from "../../../src/types/api.ts";

vi.mock("../lib/checkOff.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/checkOff.ts")>();
  return { ...actual, requestCheckOff: vi.fn(), requestUndo: vi.fn(), requestHold: vi.fn(), requestRelease: vi.fn() };
});

const TZ = "UTC";

const rows: HomePlanRow[] = [
  { blockId: "b1", taskId: "t1", label: "Draft the memo", start: "2026-09-25T09:00:00.000Z", end: "2026-09-25T10:30:00.000Z", completed: false, past: false },
  { blockId: "b2", taskId: "t2", label: "Call the dentist", start: "2026-09-25T10:30:00.000Z", end: "2026-09-25T10:45:00.000Z", completed: false, past: false },
];

/** Renders `PlanChecklist` with the fixture timezone — every call site below needs the same `timeZone`, so this is the one place that's spelled out. */
function renderChecklist(rowsArg: readonly HomePlanRow[]): ReturnType<typeof render> {
  return render(<PlanChecklist rows={rowsArg} timeZone={TZ} />);
}

function pending(id: string, taskId: string, windowMs = 5000, held = false): PendingCheckOffResponse {
  return { id, taskId, commitAt: new Date(Date.parse("2026-09-25T18:00:00.000Z") + windowMs).toISOString(), asOf: "2026-09-25T18:00:00.000Z", held };
}

const mocked = {
  checkOff: vi.mocked(checkOff.requestCheckOff),
  undo: vi.mocked(checkOff.requestUndo),
  hold: vi.mocked(checkOff.requestHold),
  release: vi.mocked(checkOff.requestRelease),
};

function row(taskId: string): HTMLElement {
  return screen.getAllByTestId("plan-row").find((el) => el.dataset["taskId"] === taskId)!;
}

async function flush(): Promise<void> {
  await act(async () => {});
}

function setReducedMotion(reduced: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({ matches: reduced, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
  );
}

describe("PlanChecklist", () => {
  beforeEach(() => {
    mocked.checkOff.mockResolvedValue({ ok: true, value: pending("p1", "t1") });
    mocked.undo.mockResolvedValue({ ok: true, value: { id: "p1" } });
    mocked.hold.mockResolvedValue({ ok: true, value: pending("p1", "t1", 5000, true) });
    mocked.release.mockResolvedValue({ ok: true, value: pending("p1", "t1", 3000) });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("renders every row in the given order, each with an accessible Checkbox", () => {
    renderChecklist(rows);
    expect(screen.getAllByTestId("plan-row").map((r) => r.textContent)).toEqual(["Draft the memo9:00–10:30", "Call the dentist10:30–10:45"]);
    expect(screen.getByRole("checkbox", { name: "Draft the memo" })).toHaveAttribute("aria-checked", "false");
  });

  it("shows each row's local time range, formatted in the given timeZone (fix round 2026-09-27)", () => {
    // 09:00Z-10:30Z is 2:00-3:30am in America/Los_Angeles (PDT, UTC-7) — a
    // different zone renders different clock digits, proving the value
    // actually came from the given `timeZone`, not a fixed UTC read.
    render(<PlanChecklist rows={[rows[0]!]} timeZone="America/Los_Angeles" />);
    expect(screen.getByText("2:00–3:30")).toBeInTheDocument();
  });

  it("checking a row shows checkmark + strikethrough + 50% opacity and starts the dissolve BEFORE any server response", () => {
    mocked.checkOff.mockReturnValue(new Promise(() => {})); // never resolves
    renderChecklist(rows);
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    expect(screen.getByRole("checkbox", { name: "Draft the memo" })).toHaveAttribute("aria-checked", "true");
    expect(row("t1")).toHaveClass("line-through", "opacity-50", "check-off-dissolve");
    expect(row("t2")).not.toHaveClass("line-through");
    expect(mocked.checkOff).toHaveBeenCalledWith("t1"); // only the Task id (Ruling R7)
  });

  it("under reduced motion the checked row is hidden instantly, with no dissolve animation", () => {
    setReducedMotion(true);
    mocked.checkOff.mockReturnValue(new Promise(() => {}));
    renderChecklist(rows);
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    expect(row("t1")).not.toBeVisible();
    expect(row("t1")).not.toHaveClass("check-off-dissolve");
  });

  it("the dissolve ends with the row hidden", async () => {
    renderChecklist(rows);
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    fireEvent.animationEnd(row("t1"));
    expect(row("t1")).not.toBeVisible();
    await flush();
  });

  it("shows the Undo Toast — 'Checked off {Task} · Undo', polite live region, Secondary Undo button — once the server confirms", async () => {
    renderChecklist(rows);
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    await flush();
    const toast = screen.getByTestId("undo-toast");
    expect(toast).toHaveAttribute("role", "status");
    expect(toast).toHaveAttribute("aria-live", "polite");
    expect(toast).toHaveTextContent("Checked off Draft the memo · Undo");
    expect(toast).toHaveClass("notification-glass", "glass-accent-bar");
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("the toast stays visible until the server's commitAt (commitAt - asOf), then closes; the row stays dissolved", async () => {
    vi.useFakeTimers();
    renderChecklist(rows);
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    await flush();
    await act(async () => vi.advanceTimersByTime(4999));
    expect(screen.getByTestId("undo-toast")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
    expect(row("t1")).toHaveClass("line-through");
  });

  it("Undo deletes the pending record, closes the toast, and the row returns", async () => {
    renderChecklist(rows);
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    fireEvent.animationEnd(row("t1"));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await flush();
    expect(mocked.undo).toHaveBeenCalledWith("p1");
    expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
    expect(row("t1")).toBeVisible();
    expect(row("t1")).not.toHaveClass("line-through");
    expect(screen.getByRole("checkbox", { name: "Draft the memo" })).toHaveAttribute("aria-checked", "false");
  });

  it("a failed Undo is visible: the toast closes, the row stays checked, and a failure notice names the Task", async () => {
    const notice = vi.spyOn(notifications, "addLocalFailureNotice").mockImplementation(() => {});
    mocked.undo.mockResolvedValue({ ok: false, message: "check-off: undo: p1 is no longer pending" });
    renderChecklist(rows);
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await flush();
    expect(notice).toHaveBeenCalledWith("Couldn't undo Draft the memo");
    expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
    expect(row("t1")).toHaveClass("line-through");
  });

  it("a failed check-off is visible: the row returns and a failure notice names the Task (no toast)", async () => {
    const notice = vi.spyOn(notifications, "addLocalFailureNotice").mockImplementation(() => {});
    mocked.checkOff.mockResolvedValue({ ok: false, message: "offline" });
    renderChecklist(rows);
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    await flush();
    expect(notice).toHaveBeenCalledWith("Couldn't check off Draft the memo");
    expect(row("t1")).not.toHaveClass("line-through");
    expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
  });

  it("hovering the toast holds the pending record (the timer pauses); leaving releases it and resumes with the server's remaining time", async () => {
    vi.useFakeTimers();
    renderChecklist(rows);
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    await flush();
    const toast = screen.getByTestId("undo-toast");

    await act(async () => vi.advanceTimersByTime(2000));
    fireEvent.mouseEnter(toast);
    expect(mocked.hold).toHaveBeenCalledWith("p1");
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(screen.getByTestId("undo-toast")).toBeInTheDocument();

    fireEvent.mouseLeave(toast);
    await flush();
    expect(mocked.release).toHaveBeenCalledWith("p1");
    await act(async () => vi.advanceTimersByTime(2999));
    expect(screen.getByTestId("undo-toast")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
  });

  it("focusing inside the toast holds it; moving focus within it doesn't release; focus leaving releases it", async () => {
    render(
      <>
        <PlanChecklist rows={rows} timeZone={TZ} />
        <button type="button">elsewhere</button>
      </>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    await flush();
    const undo = screen.getByRole("button", { name: "Undo" });
    act(() => undo.focus());
    expect(mocked.hold).toHaveBeenCalledTimes(1);
    act(() => screen.getByRole("button", { name: "elsewhere" }).focus());
    await flush();
    expect(mocked.release).toHaveBeenCalledTimes(1);
  });

  it("hover and focus together hold once and release once, when both have ended", async () => {
    render(
      <>
        <PlanChecklist rows={rows} timeZone={TZ} />
        <button type="button">elsewhere</button>
      </>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    await flush();
    const toast = screen.getByTestId("undo-toast");
    fireEvent.mouseEnter(toast);
    act(() => screen.getByRole("button", { name: "Undo" }).focus());
    fireEvent.mouseLeave(toast);
    expect(mocked.release).not.toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "elsewhere" }).focus());
    await flush();
    expect(mocked.hold).toHaveBeenCalledTimes(1);
    expect(mocked.release).toHaveBeenCalledTimes(1);
  });

  it("a toast replaced while held releases its hold; one closed by Undo doesn't (the record is being deleted)", async () => {
    mocked.checkOff.mockResolvedValueOnce({ ok: true, value: pending("p1", "t1") }).mockResolvedValueOnce({ ok: true, value: pending("p2", "t2") });
    renderChecklist(rows);
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    await flush();
    fireEvent.mouseEnter(screen.getByTestId("undo-toast"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Call the dentist" }));
    await flush();
    expect(mocked.release).toHaveBeenCalledWith("p1");

    mocked.undo.mockResolvedValue({ ok: true, value: { id: "p2" } });
    fireEvent.mouseEnter(screen.getByTestId("undo-toast"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await flush();
    expect(mocked.release).not.toHaveBeenCalledWith("p2");
  });

  it("rapid check-offs: each gets its own pending record, the toast shows the most recent, and its Undo undoes only that one", async () => {
    mocked.checkOff.mockResolvedValueOnce({ ok: true, value: pending("p1", "t1") }).mockResolvedValueOnce({ ok: true, value: pending("p2", "t2") });
    mocked.undo.mockResolvedValue({ ok: true, value: { id: "p2" } });
    renderChecklist(rows);
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    await flush();
    fireEvent.click(screen.getByRole("checkbox", { name: "Call the dentist" }));
    await flush();

    expect(screen.getAllByTestId("undo-toast")).toHaveLength(1);
    expect(screen.getByTestId("undo-toast")).toHaveTextContent("Checked off Call the dentist");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await flush();
    expect(mocked.undo).toHaveBeenCalledTimes(1);
    expect(mocked.undo).toHaveBeenCalledWith("p2");
    expect(row("t2")).not.toHaveClass("line-through");
    expect(row("t1")).toHaveClass("line-through"); // still dissolved; commits on its own
  });

  it("only completed rows are read-only; a past, incomplete row keeps its past cue but stays checkable (Ruling R18)", () => {
    renderChecklist([
      { ...rows[0]!, completed: true, past: true },
      { ...rows[1]!, past: true },
    ]);
    expect(screen.getByRole("checkbox", { name: "Draft the memo" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Draft the memo" })).toHaveAttribute("aria-checked", "true");
    expect(row("t1")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("checkbox", { name: "Call the dentist" })).toBeEnabled();
    expect(row("t2")).toHaveAttribute("aria-disabled", "false");
    expect(row("t2")).toHaveClass("opacity-70");
  });

  it("a past, incomplete row can be checked off (Ruling R18)", async () => {
    mocked.checkOff.mockResolvedValue({ ok: true, value: pending("p2", "t2") });
    renderChecklist([rows[0]!, { ...rows[1]!, past: true }]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Call the dentist" }));
    expect(row("t2")).toHaveClass("line-through", "opacity-50", "check-off-dissolve");
    expect(row("t2")).not.toHaveClass("opacity-70");
    expect(mocked.checkOff).toHaveBeenCalledWith("t2");
    await flush();
    expect(screen.getByTestId("undo-toast")).toHaveTextContent("Checked off Call the dentist");
  });

  it("a checked row stays dissolved when the server's refetch later reports it completed (it never pops back)", async () => {
    const { rerender } = renderChecklist(rows);
    fireEvent.click(screen.getByRole("checkbox", { name: "Draft the memo" }));
    fireEvent.animationEnd(row("t1"));
    await flush();
    rerender(<PlanChecklist rows={[{ ...rows[0]!, completed: true }, rows[1]!]} timeZone={TZ} />);
    expect(row("t1")).not.toBeVisible();
  });
});
