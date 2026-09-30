import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ItemOverflowMenu } from "./ItemOverflowMenu.tsx";

const FOLDERS = [
  { folder: "feedback", label: "Feedback" },
  { folder: "planning-preferences", label: "Planning preferences" },
  { folder: "about-you", label: "About you" },
  { folder: "ideas-notes", label: "Ideas & notes" },
] as const;

function menu(over: Partial<Parameters<typeof ItemOverflowMenu>[0]> = {}) {
  const props = { itemText: "Likes mornings", currentFolder: "about-you" as const, origin: "stated" as const, folders: FOLDERS, onMove: vi.fn(), onSetExpiry: vi.fn(), onDelete: vi.fn(), ...over };
  render(<ItemOverflowMenu {...props} />);
  return props;
}
const open = () => fireEvent.click(screen.getByRole("button", { name: /More actions/ }));

describe("ItemOverflowMenu", () => {
  it("is a menu button whose items move with the arrow keys and Esc returns focus", () => {
    menu();
    const trigger = screen.getByRole("button", { name: /More actions/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Move to folder", "Set expiry", "Delete"]);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: "ArrowUp" });
    fireEvent.keyDown(items[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2]!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Move lists the other folders and calls onMove", () => {
    const p = menu();
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to folder" }));
    expect(screen.queryByRole("menuitem", { name: "About you" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Ideas & notes" }));
    expect(p.onMove).toHaveBeenCalledWith("ideas-notes");
  });

  it("an Inferred item shows the Stated-only folders disabled with the reason described", () => {
    const p = menu({ origin: "inferred" });
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to folder" }));
    const feedback = screen.getByRole("menuitem", { name: "Feedback" });
    expect(feedback).toHaveAttribute("aria-disabled", "true");
    expect(feedback).toHaveAccessibleDescription("Only things you said can go in Feedback.");
    fireEvent.click(feedback);
    expect(p.onMove).not.toHaveBeenCalled();
  });

  it("Set expiry saves the chosen date; Clear expiry clears it", () => {
    const p = menu({ expiresOn: "2026-12-01" });
    open();
    expect(screen.getByRole("menuitem", { name: "Clear expiry" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Set expiry" }));
    fireEvent.change(screen.getByLabelText("Expires on"), { target: { value: "2026-12-25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onSetExpiry).toHaveBeenCalledWith("2026-12-25");
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear expiry" }));
    expect(p.onSetExpiry).toHaveBeenLastCalledWith(null);
  });

  it("Delete calls onDelete", () => {
    const p = menu();
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(p.onDelete).toHaveBeenCalled();
  });
});
