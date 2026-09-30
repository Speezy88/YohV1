import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { MemoryItemView, MemoryViewResponse } from "../../../src/types/api.ts";

vi.mock("../lib/eventBus.ts", () => ({ onHint: () => () => {} }));
vi.mock("../lib/apiClient.ts", () => ({
  apiClient: { api: { memory: { $get: vi.fn(), search: { $get: vi.fn() }, delete: { $post: vi.fn() } } } },
}));

import MemoryPage from "./Memory.tsx";
import { apiClient } from "../lib/apiClient.ts";
import { __resetMemoryForTests, MEMORY_UNDO_WINDOW_MS } from "../lib/memory.ts";

const api = apiClient.api as unknown as { memory: { $get: ReturnType<typeof vi.fn>; delete: { $post: ReturnType<typeof vi.fn> } } };
const envelope = (body: unknown) => ({ json: async () => body });

function item(id: string, text: string): MemoryItemView {
  return {
    id, folder: "feedback", text, origin: "stated", status: "current", declined: false, pendingChange: false,
    createdAt: "2026-09-01T10:00:00Z", confirmedAt: "2026-09-01T10:00:00Z", confirmedOn: "2026-09-01", loaded: true, earlierVersions: [],
  };
}
const FOLDER_ORDER = ["feedback", "planning-preferences", "corrections", "about-you", "patterns", "goals-projects", "decisions-commitments", "ideas-notes"] as const;
const VIEW: MemoryViewResponse = {
  folders: FOLDER_ORDER.map((folder) => ({
    folder, label: folder, loadClass: "always", count: folder === "feedback" ? 2 : 0,
    items: folder === "feedback" ? [item("a", "Alpha rule"), item("b", "Beta rule")] : [],
  })),
  needsReview: [], changedSettings: [], pendingPatterns: [],
};

const row = (text: string) => screen.getByText(text).closest("li") as HTMLElement;
function deleteVia(text: string): void {
  fireEvent.click(screen.getByRole("button", { name: `More actions for ${text}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
}

describe("Memory item delete flow", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    try { localStorage.clear(); } catch { /* ignore */ }
    __resetMemoryForTests();
    api.memory.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    api.memory.delete.$post.mockResolvedValue(envelope({ ok: true, value: {} }));
    render(<MemoryPage />);
    await screen.findByText("Alpha rule");
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("dissolves at once, shows the toast, Undo restores the row with no request", async () => {
    deleteVia("Alpha rule");
    expect(row("Alpha rule")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("undo-toast")).toHaveTextContent("Deleted 'Alpha rule'");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
    expect(row("Alpha rule")).not.toHaveAttribute("aria-hidden");
    await act(async () => { vi.advanceTimersByTime(MEMORY_UNDO_WINDOW_MS + 100); });
    expect(api.memory.delete.$post).not.toHaveBeenCalled();
  });

  it("sends the delete only when the toast closes", async () => {
    deleteVia("Alpha rule");
    await act(async () => { vi.advanceTimersByTime(MEMORY_UNDO_WINDOW_MS - 500); });
    expect(api.memory.delete.$post).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(api.memory.delete.$post).toHaveBeenCalledWith({ json: { itemId: "a" } });
  });

  it("a second delete commits the first immediately", async () => {
    deleteVia("Alpha rule");
    deleteVia("Beta rule");
    expect(api.memory.delete.$post).toHaveBeenCalledTimes(1);
    expect(api.memory.delete.$post).toHaveBeenCalledWith({ json: { itemId: "a" } });
    expect(screen.getByTestId("undo-toast")).toHaveTextContent("Deleted 'Beta rule'");
  });

  it("a failed send re-shows the row with the error", async () => {
    api.memory.delete.$post.mockResolvedValue(envelope({ ok: false, error: { kind: "conflict", message: "That item changed." } }));
    deleteVia("Alpha rule");
    await act(async () => { vi.advanceTimersByTime(MEMORY_UNDO_WINDOW_MS + 100); });
    expect(row("Alpha rule")).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("alert")).toHaveTextContent("That item changed.");
  });
});
