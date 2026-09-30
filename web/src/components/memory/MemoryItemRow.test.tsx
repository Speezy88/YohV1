import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { MemoryItemView } from "../../../../src/types/api.ts";

vi.mock("../../lib/memory.ts", async (orig) => {
  const actual = await orig<typeof import("../../lib/memory.ts")>();
  return { ...actual, editItem: vi.fn(), moveItem: vi.fn(), setExpiry: vi.fn() };
});

import { MemoryItemRow } from "./MemoryItemRow.tsx";
import { editItem, __resetMemorySavedForTests } from "../../lib/memory.ts";

const edit = editItem as unknown as ReturnType<typeof vi.fn>;

const FOLDERS = [
  { folder: "feedback", label: "Feedback" },
  { folder: "about-you", label: "About you" },
] as const;

function item(over: Partial<MemoryItemView> = {}): MemoryItemView {
  return {
    id: "m1", folder: "about-you", text: "Likes early mornings", origin: "inferred", status: "current", declined: false, pendingChange: false,
    createdAt: "2026-09-01T10:00:00Z", confirmedAt: "2026-09-01T10:00:00Z", loaded: true, earlierVersions: [], ...over,
  };
}
const row = (over: Partial<MemoryItemView> = {}, props: Partial<Parameters<typeof MemoryItemRow>[0]> = {}) =>
  render(<ul><MemoryItemRow item={item(over)} folders={FOLDERS} onDelete={vi.fn()} {...props} /></ul>);

function startEdit(): HTMLInputElement {
  fireEvent.click(screen.getByRole("button", { name: "Likes early mornings" }));
  return screen.getByRole("textbox", { name: "Edit memory" }) as HTMLInputElement;
}

describe("MemoryItemRow editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetMemorySavedForTests();
  });

  it("Enter saves an edited item through editItem and shows Saved in the meta line", async () => {
    edit.mockResolvedValue({ ok: true, value: { status: "saved", itemId: "m1" } });
    row();
    const field = startEdit();
    fireEvent.change(field, { target: { value: "Likes late mornings" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(edit).toHaveBeenCalledWith("m1", "Likes late mornings");
    expect(field).toBeDisabled();
    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Esc cancels without a request and restores the text", () => {
    row();
    const field = startEdit();
    fireEvent.change(field, { target: { value: "changed" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(edit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Likes early mornings" })).toBeInTheDocument();
  });

  it("a Visible Edit button is a second way in", () => {
    row();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Edit memory" })).toBeInTheDocument();
  });

  it("a failure restores the old text and shows the message in place", async () => {
    edit.mockResolvedValue({ ok: false, message: "That's too long." });
    row();
    const field = startEdit();
    fireEvent.change(field, { target: { value: "x".repeat(10) } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("That's too long.");
    expect(screen.getByRole("button", { name: "Likes early mornings" })).toBeInTheDocument();
  });

  it("a duplicate offers Merge; Yes resends with mergeWithId, No with allowDuplicate", async () => {
    edit.mockResolvedValueOnce({ ok: true, value: { status: "duplicate", other: { id: "o9", text: "Mornings are best", folder: "about-you" } } });
    row();
    let field = startEdit();
    fireEvent.change(field, { target: { value: "Mornings are best" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(await screen.findByText("Merge with 'Mornings are best'?")).toBeInTheDocument();
    edit.mockResolvedValueOnce({ ok: true, value: { status: "merged", itemId: "o9" } });
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(edit).toHaveBeenLastCalledWith("m1", "Mornings are best", { mergeWithId: "o9" }));

    edit.mockReset();
    edit.mockResolvedValueOnce({ ok: true, value: { status: "duplicate", other: { id: "o9", text: "Mornings are best", folder: "about-you" } } });
    field = startEdit();
    fireEvent.change(field, { target: { value: "Mornings are best" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await screen.findByText("Merge with 'Mornings are best'?");
    edit.mockResolvedValueOnce({ ok: true, value: { status: "saved", itemId: "m1" } });
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await waitFor(() => expect(edit).toHaveBeenLastCalledWith("m1", "Mornings are best", { allowDuplicate: true }));
  });

  it("a pending-change item is read-only with a caption and no Edit", () => {
    row({ pendingChange: true });
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Likes early mornings" })).toBeNull();
    expect(screen.getByText("Waiting on your answer in Chat")).toBeInTheDocument();
  });
});
