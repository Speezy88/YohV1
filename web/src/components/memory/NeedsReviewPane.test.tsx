import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { NeedsReviewItemView } from "../../../../src/types/api.ts";

vi.mock("../../lib/memory.ts", async (orig) => {
  const actual = await orig<typeof import("../../lib/memory.ts")>();
  return { ...actual, reviewItem: vi.fn() };
});

import { NeedsReviewPane } from "./NeedsReviewPane.tsx";
import { reviewItem, __resetMemorySavedForTests } from "../../lib/memory.ts";

const review = reviewItem as unknown as ReturnType<typeof vi.fn>;

function item(over: Partial<NeedsReviewItemView> = {}): NeedsReviewItemView {
  return {
    id: "m1", folder: "goals-projects", text: "Submit the scholarship form", origin: "stated", status: "current", declined: false, pendingChange: false,
    createdAt: "2026-09-01T10:00:00Z", confirmedAt: "2026-09-01T10:00:00Z", confirmedOn: "2026-09-01", loaded: true, earlierVersions: [],
    reason: "Expired Sep 19", canRenew: true, expiresOn: "2026-09-19", ...over,
  };
}
const FOLDERS = [{ folder: "goals-projects", label: "Goals & projects" }] as const;
const show = (items: NeedsReviewItemView[], onDelete = vi.fn()) =>
  render(<NeedsReviewPane items={items} folders={FOLDERS} onDelete={onDelete} isDissolving={() => false} errorFor={() => undefined} onOpenSource={vi.fn()} />);

describe("NeedsReviewPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetMemorySavedForTests();
  });

  it("shows the reason and Renew only for rows that can renew", () => {
    show([item(), item({ id: "m2", text: "Not loaded one", reason: "Not loaded: over the cap", canRenew: false })]);
    expect(screen.getByText("Expired Sep 19")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Renew" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Keep as history" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
  });

  it("an expired item's Renew opens the inline choice: a new expiry date or no expiry", async () => {
    review.mockResolvedValue({ ok: true, value: { itemId: "m1b" } });
    show([item()]);
    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    expect(review).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("New expiry"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Set new expiry" }));
    expect(review).toHaveBeenCalledWith("m1", "renew", "2026-12-01");
    await waitFor(() => expect(screen.queryByLabelText("New expiry")).toBeNull());
  });

  it("No expiry renews with none", async () => {
    review.mockResolvedValue({ ok: true, value: { itemId: "m1" } });
    show([item()]);
    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    fireEvent.click(screen.getByRole("button", { name: "No expiry" }));
    expect(review).toHaveBeenCalledWith("m1", "renew", undefined);
  });

  it("an unused item renews directly", async () => {
    review.mockResolvedValue({ ok: true, value: { itemId: "m3" } });
    show([item({ id: "m3", text: "Old note", reason: "Unused since May 2", expiresOn: undefined })]);
    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    await waitFor(() => expect(review).toHaveBeenCalledWith("m3", "renew", undefined));
  });

  it("Keep as history calls review keep; a failure shows the message in place and the row stays", async () => {
    review.mockResolvedValue({ ok: false, message: "That item changed. Reload." });
    show([item()]);
    fireEvent.click(screen.getByRole("button", { name: "Keep as history" }));
    expect(review).toHaveBeenCalledWith("m1", "keep", undefined);
    expect(await screen.findByRole("alert")).toHaveTextContent("That item changed. Reload.");
    expect(screen.getByText("Submit the scholarship form")).toBeInTheDocument();
  });

  it("Delete hands the item to the delete flow", () => {
    const onDelete = vi.fn();
    show([item()], onDelete);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
  });
});
