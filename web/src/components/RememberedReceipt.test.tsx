import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RememberedReceipt } from "./RememberedReceipt.tsx";
import { PageNavigationContext } from "../lib/navigationContext.tsx";
import * as memoryLib from "../lib/memory.ts";
import { PAGES } from "../lib/pages.ts";
import * as memoryApi from "../lib/memoryApi.ts";
import * as chatStore from "../lib/chatStore.ts";
import type { RememberedReceipt as Receipt } from "../../../src/types/api.ts";

const CHEM: Receipt = {
  receiptId: "r1",
  kind: "remembered",
  items: [{ id: "i1", text: "Chem club is a club, not a class", folder: "corrections" }],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("RememberedReceipt", () => {
  it("renders an always-present polite live region, empty when there is no receipt", () => {
    const { container } = render(<RememberedReceipt messageId="m1" state="undoable" />);
    const live = container.querySelector("[aria-live='polite']");
    expect(live).not.toBeNull();
    expect(live).toBeEmptyDOMElement();
  });

  it("shows the filed line with the folder label and a real Undo button", () => {
    render(<RememberedReceipt messageId="m1" receipt={CHEM} state="undoable" />);
    expect(screen.getByTestId("remembered-receipt")).toHaveTextContent("Remembered: Chem club is a club, not a class · Corrections · Undo");
    expect(screen.getByRole("button", { name: "Undo" }).tagName).toBe("BUTTON");
  });

  it("Undo is a shared text button", () => {
    render(<RememberedReceipt messageId="m1" receipt={CHEM} state="undoable" />);
    expect(screen.getByRole("button", { name: "Undo" })).toHaveClass("hover:underline", "text-ink-accent", "disabled:opacity-50");
  });

  it("adds scope and until-date, and joins two items with ' ; '", () => {
    const receipt: Receipt = {
      receiptId: "r2",
      kind: "remembered",
      items: [
        { id: "a", text: "Keep mornings free", folder: "feedback", scope: "planning" },
        { id: "b", text: "No meetings", folder: "planning-preferences", expiresOn: "2026-10-15" },
      ],
    };
    render(<RememberedReceipt messageId="m1" receipt={receipt} state="undoable" />);
    expect(screen.getByTestId("remembered-receipt")).toHaveTextContent(
      "Remembered: Keep mornings free · Feedback · for planning ; No meetings · Planning preferences · until 2026-10-15 · Undo",
    );
  });

  it("shows the forgot line", () => {
    const receipt: Receipt = { receiptId: "r3", kind: "forgot", items: [{ id: "a", text: "Old note", folder: "ideas-notes" }] };
    render(<RememberedReceipt messageId="m1" receipt={receipt} state="undoable" />);
    expect(screen.getByTestId("remembered-receipt")).toHaveTextContent("Forgot: Old note · Undo");
  });

  it("reads the failure line with no Undo when the receipt has no items", () => {
    render(<RememberedReceipt messageId="m1" receipt={{ receiptId: "r4", kind: "remembered", items: [] }} state="settled" />);
    expect(screen.getByTestId("remembered-receipt")).toHaveTextContent("Couldn't save that to memory.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("Undo success stores the server message and the line shows it with no button", async () => {
    vi.spyOn(memoryApi, "undoMemoryReceipt").mockResolvedValue({ status: "ok", message: "Removed from memory." });
    const setOutcome = vi.spyOn(chatStore, "setReceiptOutcome").mockImplementation(() => {});
    render(<RememberedReceipt messageId="m1" receipt={CHEM} state="undoable" />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(setOutcome).toHaveBeenCalledWith("m1", "removed", "Removed from memory."));
  });

  it("a refusal settles the line with the server's message", async () => {
    vi.spyOn(memoryApi, "undoMemoryReceipt").mockResolvedValue({ status: "refused", message: "That can't be undone any more." });
    const setOutcome = vi.spyOn(chatStore, "setReceiptOutcome").mockImplementation(() => {});
    render(<RememberedReceipt messageId="m1" receipt={CHEM} state="undoable" />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(setOutcome).toHaveBeenCalledWith("m1", "settled", "That can't be undone any more."));
  });

  it("a failed request shows 'Couldn't undo that.' and keeps Undo", async () => {
    vi.spyOn(memoryApi, "undoMemoryReceipt").mockResolvedValue({ status: "failed" });
    render(<RememberedReceipt messageId="m1" receipt={CHEM} state="undoable" />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByTestId("remembered-receipt")).toHaveTextContent("Couldn't undo that."));
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("removed state shows the note and no button", () => {
    render(<RememberedReceipt messageId="m1" receipt={CHEM} state="removed" note="Removed from memory." />);
    expect(screen.getByTestId("remembered-receipt")).toHaveTextContent("Removed from memory.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("settled state offers View in Memory only when the Memory page exists", () => {
    const { rerender } = render(<RememberedReceipt messageId="m1" receipt={CHEM} state="settled" showViewInMemory={false} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("remembered-receipt")).not.toHaveTextContent("Undo");
    // Without a PageShell (no navigation), there is nowhere to go: no button.
    rerender(<RememberedReceipt messageId="m1" receipt={CHEM} state="settled" showViewInMemory />);
    expect(screen.queryByRole("button", { name: "View in Memory" })).toBeNull();
  });

  it("View in Memory opens the item and navigates to the Memory page", () => {
    const open = vi.spyOn(memoryLib, "openMemoryItem").mockReturnValue(true);
    const goTo = vi.fn();
    render(
      <PageNavigationContext.Provider value={{ index: 0, goTo, next: vi.fn(), prev: vi.fn() }}>
        <RememberedReceipt messageId="m1" receipt={CHEM} state="settled" showViewInMemory />
      </PageNavigationContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "View in Memory" }));
    expect(open).toHaveBeenCalledWith("i1");
    expect(goTo).toHaveBeenCalledWith(PAGES.findIndex((p) => p.id === "memory"));
  });

  it("for a forgotten item that is gone, links to its folder", () => {
    vi.spyOn(memoryLib, "openMemoryItem").mockReturnValue(false);
    const select = vi.spyOn(memoryLib, "selectMemory").mockImplementation(() => {});
    const goTo = vi.fn();
    render(
      <PageNavigationContext.Provider value={{ index: 0, goTo, next: vi.fn(), prev: vi.fn() }}>
        <RememberedReceipt messageId="m1" receipt={{ ...CHEM, kind: "forgot" }} state="settled" showViewInMemory />
      </PageNavigationContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "View in Memory" }));
    expect(select).toHaveBeenCalledWith({ kind: "folder", folder: "corrections" });
    expect(goTo).toHaveBeenCalled();
  });
});
