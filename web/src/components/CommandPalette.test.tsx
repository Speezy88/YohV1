import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette.tsx";
import * as commands from "../lib/commands.ts";

// Note: `example` intentionally differs from `name` in this fixture (unlike
// the real registry, where a no-arg command's example is just its own
// name, which the palette now leaves out rather than repeat) so each row
// renders all three spans. Every assertion below that cares about a SPECIFIC row
// still keys off the row's own `data-testid`, never bare text, for exactly
// that reason.
const REGISTRY = [
  { name: "/morning", description: "Opens today's Morning Ritual…", example: "run it after waking up" },
  { name: "/night", description: "Runs the Night Ritual close-out…", example: "run it before bed" },
];

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.spyOn(commands, "fetchCommands").mockResolvedValue(REGISTRY);
  });

  it("lists every command, filtered live by query", async () => {
    render(<CommandPalette query="/m" onRun={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("command-row-/morning")).toBeInTheDocument());
    expect(screen.queryByTestId("command-row-/night")).not.toBeInTheDocument();
  });

  it("no match shows 'No matching command' plus the full list", async () => {
    render(<CommandPalette query="/zzz" onRun={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("No matching command")).toBeInTheDocument());
    expect(screen.getByTestId("command-row-/morning")).toBeInTheDocument();
    expect(screen.getByTestId("command-row-/night")).toBeInTheDocument();
  });

  it("↓ moves the highlight and Enter runs the highlighted command", async () => {
    const onRun = vi.fn();
    render(<CommandPalette query="/" onRun={onRun} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("command-row-/morning")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onRun).toHaveBeenCalledWith("/night");
  });

  it("moving the mouse over a row moves the same highlight the arrow keys use", async () => {
    const onRun = vi.fn();
    render(<CommandPalette query="/" onRun={onRun} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("command-row-/morning")).toBeInTheDocument());
    fireEvent.mouseMove(screen.getByTestId("command-row-/night"));
    expect(screen.getByTestId("command-row-/night")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("command-row-/morning")).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onRun).toHaveBeenCalledWith("/night");
  });

  it("↑ from the top row stays at the top row (no wrap-under)", async () => {
    const onRun = vi.fn();
    render(<CommandPalette query="/" onRun={onRun} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("command-row-/morning")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "ArrowUp" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onRun).toHaveBeenCalledWith("/morning");
  });

  it("Esc closes without running anything", async () => {
    const onClose = vi.fn();
    const onRun = vi.fn();
    render(<CommandPalette query="/" onRun={onRun} onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId("command-row-/morning")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
  });

  it("clicking a row runs it directly (mouse path, same target as Enter)", async () => {
    const onRun = vi.fn();
    render(<CommandPalette query="/" onRun={onRun} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("command-row-/morning")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("command-row-/night"));
    expect(onRun).toHaveBeenCalledWith("/night");
  });

  it("Enter with no match does nothing (forces Esc or a real command)", async () => {
    const onRun = vi.fn();
    render(<CommandPalette query="/zzz" onRun={onRun} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("No matching command")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onRun).not.toHaveBeenCalled();
  });

  it("is fully keyboard-operable: every row has role=option and the highlighted row is aria-selected", async () => {
    render(<CommandPalette query="/" onRun={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(screen.getByTestId("command-row-/morning")).toHaveAttribute("aria-selected", "true");
  });

  // ==========================================================================
  // Story 8.8 review carry-in (from 8.7): combobox semantics — a stable id
  // per option, reported to the owning input via onHighlightedOptionChange
  // as ↑/↓ move the highlight, so it can set its own aria-activedescendant.
  // ==========================================================================

  it("reports the top row's own id on mount, via onHighlightedOptionChange", async () => {
    const onHighlightedOptionChange = vi.fn();
    render(<CommandPalette query="/" onRun={() => {}} onClose={() => {}} onHighlightedOptionChange={onHighlightedOptionChange} />);
    await waitFor(() => expect(screen.getByTestId("command-row-/morning")).toBeInTheDocument());
    const morningId = screen.getByTestId("command-row-/morning").id;
    expect(morningId).toBeTruthy();
    expect(onHighlightedOptionChange).toHaveBeenLastCalledWith(morningId);
  });

  it("↓ reports the NEXT row's id, matching that row's own DOM id", async () => {
    const onHighlightedOptionChange = vi.fn();
    render(<CommandPalette query="/" onRun={() => {}} onClose={() => {}} onHighlightedOptionChange={onHighlightedOptionChange} />);
    await waitFor(() => expect(screen.getByTestId("command-row-/night")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "ArrowDown" });
    const nightId = screen.getByTestId("command-row-/night").id;
    expect(onHighlightedOptionChange).toHaveBeenLastCalledWith(nightId);
  });

  it("reports undefined when no command matches (nothing to point at)", async () => {
    const onHighlightedOptionChange = vi.fn();
    render(<CommandPalette query="/zzz" onRun={() => {}} onClose={() => {}} onHighlightedOptionChange={onHighlightedOptionChange} />);
    await waitFor(() => expect(screen.getByText("No matching command")).toBeInTheDocument());
    expect(onHighlightedOptionChange).toHaveBeenLastCalledWith(undefined);
  });

  it("shows a command's example only when it adds something beyond the name", async () => {
    vi.spyOn(commands, "fetchCommands").mockResolvedValue([
      { name: "/plan", description: "Builds today's Plan.", example: "/plan" },
      { name: "/remember", description: "Saves a memory.", example: "/remember I prefer mornings" },
    ]);
    render(<CommandPalette query="/" onRun={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("command-row-/plan")).toBeInTheDocument());
    expect(screen.getAllByText("/plan")).toHaveLength(1);
    expect(screen.getByText("/remember I prefer mornings")).toBeInTheDocument();
  });
});
