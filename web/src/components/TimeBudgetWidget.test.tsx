import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TimeBudgetWidget } from "./TimeBudgetWidget.tsx";
import * as timeBudgetLib from "../lib/timeBudget.ts";
import * as homeViewLib from "../lib/homeView.ts";

describe("TimeBudgetWidget", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows budget, planned, and done, e.g. 'Time Budget 6 h · 4 h planned · 1 h done'", () => {
    render(<TimeBudgetWidget timeBudget={{ totalMinutes: 360, plannedMinutes: 240, doneMinutes: 60, carriedForward: false }} />);
    expect(screen.getByText("Time Budget 6 h · 4 h planned · 1 h done")).toBeInTheDocument();
  });

  it("with no budget set today, names it as a default and invites setting one (fix round 2026-09-27)", () => {
    render(<TimeBudgetWidget timeBudget={undefined} />);
    expect(screen.getByText(/Time Budget 6 h \(default\)/)).toBeInTheDocument();
    expect(screen.getByText("Set today's budget")).toBeInTheDocument();
  });

  it("clicking opens an inline edit form with the current hours pre-filled", () => {
    render(<TimeBudgetWidget timeBudget={{ totalMinutes: 300, plannedMinutes: 0, doneMinutes: 0, carriedForward: false }} />);
    fireEvent.click(screen.getByTestId("time-budget-widget"));
    expect(screen.getByLabelText("Today's Time Budget, in hours")).toHaveValue(5);
  });

  it("saving posts the new total in minutes and refetches Home", async () => {
    const setSpy = vi.spyOn(timeBudgetLib, "requestSetTimeBudget").mockResolvedValue({ ok: true, receipt: "Got it." });
    const refetchSpy = vi.spyOn(homeViewLib, "refetchHomeView").mockResolvedValue(undefined);
    render(<TimeBudgetWidget timeBudget={undefined} />);
    fireEvent.click(screen.getByTestId("time-budget-widget"));
    fireEvent.change(screen.getByLabelText("Today's Time Budget, in hours"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(setSpy).toHaveBeenCalledWith(420));
    await waitFor(() => expect(refetchSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("time-budget-edit")).not.toBeInTheDocument());
  });

  it("Escape cancels the edit without saving", () => {
    const setSpy = vi.spyOn(timeBudgetLib, "requestSetTimeBudget").mockResolvedValue({ ok: true, receipt: "Got it." });
    render(<TimeBudgetWidget timeBudget={undefined} />);
    fireEvent.click(screen.getByTestId("time-budget-widget"));
    fireEvent.keyDown(screen.getByLabelText("Today's Time Budget, in hours"), { key: "Escape" });
    expect(screen.queryByTestId("time-budget-edit")).not.toBeInTheDocument();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("a failed save keeps the form open and surfaces a local failure notice, never a raw error", async () => {
    vi.spyOn(timeBudgetLib, "requestSetTimeBudget").mockResolvedValue({ ok: false, message: "server: home-view dependencies not configured" });
    render(<TimeBudgetWidget timeBudget={undefined} />);
    fireEvent.click(screen.getByTestId("time-budget-widget"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("time-budget-edit")).toBeInTheDocument());
  });

  it("an empty hours value shows the inline message and does not call the API", () => {
    const setSpy = vi.spyOn(timeBudgetLib, "requestSetTimeBudget").mockResolvedValue({ ok: true, receipt: "Got it." });
    render(<TimeBudgetWidget timeBudget={undefined} />);
    fireEvent.click(screen.getByTestId("time-budget-widget"));
    fireEvent.change(screen.getByLabelText("Today's Time Budget, in hours"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter hours between 0 and 24.");
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("a value over 24 hours shows the inline message and does not call the API", () => {
    const setSpy = vi.spyOn(timeBudgetLib, "requestSetTimeBudget").mockResolvedValue({ ok: true, receipt: "Got it." });
    render(<TimeBudgetWidget timeBudget={undefined} />);
    fireEvent.click(screen.getByTestId("time-budget-widget"));
    fireEvent.change(screen.getByLabelText("Today's Time Budget, in hours"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter hours between 0 and 24.");
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("Save reads 'Saving…' while the request is pending", async () => {
    vi.spyOn(timeBudgetLib, "requestSetTimeBudget").mockReturnValue(new Promise(() => {}));
    render(<TimeBudgetWidget timeBudget={undefined} />);
    fireEvent.click(screen.getByTestId("time-budget-widget"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("the pill, Save and Cancel carry the shared focus ring", () => {
    render(<TimeBudgetWidget timeBudget={undefined} />);
    const pill = screen.getByTestId("time-budget-widget");
    expect(pill.className).toContain("focus-visible:outline-accent-solid");
    expect(pill.className).toMatch(/hover:/);
    fireEvent.click(pill);
    for (const name of ["Save", "Cancel"]) expect(screen.getByRole("button", { name }).className).toContain("focus-visible:outline-accent-solid");
  });
});
