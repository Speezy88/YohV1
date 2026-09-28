import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SandboxCard } from "./SandboxCard.tsx";
import * as sandboxModule from "../lib/sandbox.ts";
import * as reducedMotionModule from "../hooks/useReducedMotion.ts";
import type { SandboxCardView } from "../../../src/types/api.ts";

const VIEW: SandboxCardView = { taskId: "t1", taskTitle: "Chem problem set", area: "School", remaining: 2, options: { area: [], energy: [] } };

// Task 5 (polish-5): live Area/Energy options — the select-rendering path.
const OPTIONS_VIEW: SandboxCardView = {
  taskId: "t2",
  taskTitle: "Physics lab report",
  area: "School",
  energy: "low",
  remaining: 0,
  options: {
    area: ["School", "Personal", "Math"],
    energy: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
  },
};

afterEach(() => vi.restoreAllMocks());

describe("SandboxCard", () => {
  it("renders the Task name, prefilled Area, and the remaining count in tabular numerals", () => {
    render(<SandboxCard view={VIEW} status="pending" />);
    expect(screen.getByText("Chem problem set")).toBeInTheDocument();
    expect(screen.getByDisplayValue("School")).toBeInTheDocument();
    expect(screen.getByText(/2 remaining/i)).toBeInTheDocument();
  });

  it("Save stays disabled until both Due Date and Estimated Duration are filled", () => {
    render(<SandboxCard view={VIEW} status="pending" />);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Due Date/i), { target: { value: "2026-09-30" } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Estimated Duration/i), { target: { value: "45" } });
    expect(save).toBeEnabled();
  });

  it("Save calls sandbox.ts's saveCard with the typed values", async () => {
    const saveCard = vi.spyOn(sandboxModule, "saveCard").mockResolvedValue({ ok: true });
    render(<SandboxCard view={VIEW} status="pending" />);
    fireEvent.change(screen.getByLabelText(/Due Date/i), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText(/Estimated Duration/i), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCard).toHaveBeenCalledWith("t1", { dueDate: "2026-09-30", estimatedDurationMinutes: "45", area: "School" }));
  });

  it("Skip calls sandbox.ts's skipCard with this card's taskId", () => {
    const skipCard = vi.spyOn(sandboxModule, "skipCard").mockResolvedValue({ ok: true });
    render(<SandboxCard view={VIEW} status="pending" />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(skipCard).toHaveBeenCalledWith("t1");
    expect(skipCard).toHaveBeenCalledTimes(1);
  });

  // Task 6 (polish-5): a failed Skip must be visible, not a silent no-op —
  // and the card stays usable (buttons re-enabled) so Spencer can retry.
  it("a failed Skip shows an inline alert on the card and re-enables the buttons", async () => {
    const skipCard = vi.spyOn(sandboxModule, "skipCard").mockResolvedValue({ ok: false, message: "network down" });
    render(<SandboxCard view={VIEW} status="pending" />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't skip — try again."));
    expect(skipCard).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Skip" })).toBeEnabled();
    expect(screen.queryByText("Skipped")).not.toBeInTheDocument();
  });

  it("a saved status renders 'Saved' and disables both buttons", () => {
    render(<SandboxCard view={VIEW} status="saved" receipt="Due Date, Estimated Duration saved." />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("a skipped status renders 'Skipped' and disables both buttons", () => {
    render(<SandboxCard view={VIEW} status="skipped" />);
    expect(screen.getByText("Skipped")).toBeInTheDocument();
  });

  it("the settled state announces the new remaining count to screen readers, after a save and after a skip (FR-37)", () => {
    const { rerender } = render(<SandboxCard view={VIEW} status="saved" receipt="Due Date, Estimated Duration saved." />);
    expect(screen.getByRole("status")).toHaveTextContent(/saved.*2 remaining/i);

    rerender(<SandboxCard view={VIEW} status="skipped" />);
    expect(screen.getByRole("status")).toHaveTextContent(/skipped.*2 remaining/i);
  });

  // Task 6 (polish-5): the status region is PERSISTENT — mounted empty from
  // the very first (pending) render, and it's the SAME node once the card
  // settles, not a fresh node that already holds the content.
  it("mounts the status region empty while pending, then updates the SAME node's text when the card settles", () => {
    const { rerender } = render(<SandboxCard view={VIEW} status="pending" />);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("");

    rerender(<SandboxCard view={VIEW} status="saved" receipt="Due Date, Estimated Duration saved." />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent(/saved.*2 remaining/i);
  });

  it("under reduced motion, a saved card shows 'Saved' immediately with no pulse animation class", () => {
    vi.spyOn(reducedMotionModule, "useReducedMotion").mockReturnValue(true);
    render(<SandboxCard view={VIEW} status="saved" receipt="Due Date, Estimated Duration saved." />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByTestId("sandbox-card").className).not.toContain("sandbox-card-save-pulse");
  });

  it("a rejected save shows the server's message inline, on this same card, and leaves it retryable", async () => {
    const saveCard = vi
      .spyOn(sandboxModule, "saveCard")
      .mockResolvedValue({ ok: false, message: "Energy must be Low, Medium, or High." });
    render(<SandboxCard view={VIEW} status="pending" />);
    fireEvent.change(screen.getByLabelText(/Due Date/i), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText(/Estimated Duration/i), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Energy must be Low, Medium, or High."));
    expect(saveCard).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("an empty options list falls back to free-text Area/Energy inputs", () => {
    render(<SandboxCard view={VIEW} status="pending" />);
    expect(screen.getByLabelText(/^Area/i).tagName).toBe("INPUT");
    expect(screen.getByLabelText(/^Energy/i).tagName).toBe("INPUT");
  });

  it("renders Area/Energy as selects fed with the live options, pre-selecting the view's value", () => {
    render(<SandboxCard view={OPTIONS_VIEW} status="pending" />);
    const areaSelect = screen.getByLabelText(/^Area/i) as HTMLSelectElement;
    expect(areaSelect.tagName).toBe("SELECT");
    expect(areaSelect.value).toBe("School");
    expect(screen.getByRole("option", { name: "Personal" })).toBeInTheDocument();

    const energySelect = screen.getByLabelText(/^Energy/i) as HTMLSelectElement;
    expect(energySelect.tagName).toBe("SELECT");
    expect(energySelect.value).toBe("low");
    expect(screen.getByRole("option", { name: "Medium" })).toBeInTheDocument();
  });

  it("keeps a view value that isn't among the live options as an extra, still-selected option — never drops it", () => {
    const view: SandboxCardView = { ...OPTIONS_VIEW, area: "Legacy Area" };
    render(<SandboxCard view={view} status="pending" />);
    const areaSelect = screen.getByLabelText(/^Area/i) as HTMLSelectElement;
    expect(areaSelect.value).toBe("Legacy Area");
    expect(screen.getByRole("option", { name: "Legacy Area" })).toBeInTheDocument();
  });

  it("Save sends the value picked from the Area/Energy selects", async () => {
    const saveCard = vi.spyOn(sandboxModule, "saveCard").mockResolvedValue({ ok: true });
    render(<SandboxCard view={OPTIONS_VIEW} status="pending" />);
    fireEvent.change(screen.getByLabelText(/Due Date/i), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText(/Estimated Duration/i), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText(/^Area/i), { target: { value: "Personal" } });
    fireEvent.change(screen.getByLabelText(/^Energy/i), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(saveCard).toHaveBeenCalledWith("t2", { dueDate: "2026-09-30", estimatedDurationMinutes: "45", area: "Personal", energy: "high" }),
    );
  });
});
