import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UndoToast } from "./UndoToast.tsx";
import * as checkOff from "../lib/checkOff.ts";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("UndoToast generalization (Story 13.9)", () => {
  it("shows a custom label instead of the check-off copy", () => {
    render(<UndoToast id="x" label="Deleted conversation" durationMs={1000} onUndo={async () => {}} onExpire={() => {}} />);
    expect(screen.getByTestId("undo-toast")).toHaveTextContent("Deleted conversation");
    expect(screen.getByTestId("undo-toast")).not.toHaveTextContent("Checked off");
  });

  it("Undo is a shared Secondary button", () => {
    render(<UndoToast id="x" label="Deleted" durationMs={1000} onUndo={async () => {}} onExpire={() => {}} />);
    expect(screen.getByRole("button", { name: "Undo" })).toHaveClass("hover:shadow-extruded-md", "active:shadow-inset", "disabled:opacity-50");
  });

  it("keeps the default check-off copy", () => {
    render(<UndoToast id="x" taskName="Read ch. 4" durationMs={1000} onUndo={async () => {}} onExpire={() => {}} />);
    expect(screen.getByTestId("undo-toast")).toHaveTextContent("Checked off Read ch. 4");
  });

  it("serverHold false pauses locally and never calls the hold endpoints", () => {
    const hold = vi.spyOn(checkOff, "requestHold").mockResolvedValue({ ok: false, message: "n/a" } as never);
    const release = vi.spyOn(checkOff, "requestRelease").mockResolvedValue({ ok: false, message: "n/a" } as never);
    render(<UndoToast id="x" label="Deleted" serverHold={false} durationMs={1000} onUndo={async () => {}} onExpire={() => {}} />);
    const toast = screen.getByTestId("undo-toast");
    fireEvent.mouseEnter(toast);
    fireEvent.mouseLeave(toast);
    expect(hold).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("serverHold false: local pause stops the timer and resumes with the time left", async () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<UndoToast id="x" label="Deleted" serverHold={false} durationMs={1000} onUndo={async () => {}} onExpire={onExpire} />);
    const toast = screen.getByTestId("undo-toast");
    vi.advanceTimersByTime(400);
    fireEvent.mouseEnter(toast);
    vi.advanceTimersByTime(5000);
    expect(onExpire).not.toHaveBeenCalled();
    fireEvent.mouseLeave(toast);
    await vi.advanceTimersByTimeAsync(700);
    expect(onExpire).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
