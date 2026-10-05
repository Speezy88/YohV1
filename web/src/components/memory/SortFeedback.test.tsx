import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { MemoryItemView } from "../../../../src/types/api.ts";

vi.mock("../../lib/memory.ts", async (orig) => {
  const actual = await orig<typeof import("../../lib/memory.ts")>();
  return { ...actual, sendSortFeedback: vi.fn() };
});

import { MemoryItemRow } from "./MemoryItemRow.tsx";
import { sendSortFeedback, __resetMemorySavedForTests } from "../../lib/memory.ts";

const send = sendSortFeedback as unknown as ReturnType<typeof vi.fn>;

const FOLDERS = [
  { folder: "feedback", label: "Feedback" },
  { folder: "planning-preferences", label: "Planning preferences" },
  { folder: "about-you", label: "About you" },
  { folder: "patterns", label: "Patterns" },
] as const;

function item(over: Partial<MemoryItemView> = {}): MemoryItemView {
  return {
    id: "m1", folder: "about-you", text: "Likes early mornings", origin: "stated", status: "current", declined: false, pendingChange: false,
    createdAt: "2026-09-01T10:00:00Z", confirmedAt: "2026-09-01T10:00:00Z", confirmedOn: "2026-09-01", loaded: true, earlierVersions: [], ...over,
  };
}
const row = (over: Partial<MemoryItemView> = {}) => render(<ul><MemoryItemRow item={item(over)} folders={FOLDERS} onDelete={vi.fn()} /></ul>);

function openPanel(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Sorting feedback" }));
  return screen.getByRole("group", { name: "Is About you the right folder for this?" });
}
const reasonField = () => screen.getByRole("textbox", { name: "Why" });

describe("memory sorting feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetMemorySavedForTests();
  });

  it("the menu opens a panel that needs a verdict and a reason before Save", () => {
    row();
    openPanel();
    expect(screen.queryByRole("menu")).toBeNull();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Right" }));
    expect(screen.getByRole("button", { name: "Right" })).toHaveAttribute("aria-pressed", "true");
    expect(save).toBeDisabled();
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.change(reasonField(), { target: { value: "  " } });
    expect(save).toBeDisabled();
    fireEvent.change(reasonField(), { target: { value: "It is a fact about me." } });
    expect(save).toBeEnabled();
  });

  it("Right sends the verdict and trimmed reason, closes the panel and shows Saved", async () => {
    send.mockResolvedValue({ ok: true, value: { itemId: "m1" } });
    row();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Right" }));
    fireEvent.change(reasonField(), { target: { value: " It is a fact about me. " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("group")).toBeNull());
    expect(send).toHaveBeenCalledWith("m1", "right", "It is a fact about me.", undefined);
    expect(screen.getByText(/^Saved ·/)).toBeInTheDocument();
  });

  it("Wrong offers the other folders and sends the one picked", async () => {
    send.mockResolvedValue({ ok: true, value: { itemId: "m1" } });
    row({ origin: "inferred" });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Wrong" }));
    const select = screen.getByRole("combobox", { name: "Belongs in (optional)" });
    const options = Array.from(select.querySelectorAll("option"));
    expect(options.map((o) => o.textContent)).toEqual(["Not sure", "Feedback", "Planning preferences", "Patterns"]);
    expect(options.filter((o) => o.disabled).map((o) => o.textContent)).toEqual(["Feedback", "Planning preferences"]);
    fireEvent.change(select, { target: { value: "patterns" } });
    fireEvent.change(reasonField(), { target: { value: "It's a habit." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("m1", "wrong", "It's a habit.", "patterns"));
  });

  it("a failed save keeps the panel and the reason and shows the error", async () => {
    send.mockResolvedValue({ ok: false, message: "I couldn't reach Meeseek's server just now." });
    row();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Wrong" }));
    fireEvent.change(reasonField(), { target: { value: "It's a habit." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("I couldn't reach Meeseek's server just now.");
    expect(reasonField()).toHaveValue("It's a habit.");
  });

  it("Esc and Cancel close the panel without sending", () => {
    row();
    fireEvent.keyDown(openPanel(), { key: "Escape" });
    expect(screen.queryByRole("group")).toBeNull();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("a saved verdict shows on the card and prefills the panel", () => {
    row({ sortFeedback: { verdict: "wrong", reason: "It's a habit.", belongsIn: "patterns" } });
    expect(screen.getByTestId("memory-sort-feedback")).toHaveTextContent("Folder marked wrong · Belongs in Patterns · It's a habit.");
    openPanel();
    expect(screen.getByRole("button", { name: "Wrong" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox")).toHaveValue("patterns");
    expect(reasonField()).toHaveValue("It's a habit.");
  });

  it("a right verdict reads as right", () => {
    row({ sortFeedback: { verdict: "right", reason: "A fact about me." } });
    expect(screen.getByTestId("memory-sort-feedback")).toHaveTextContent("Folder marked right · A fact about me.");
  });
});
