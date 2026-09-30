import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { MemoryFolderView, MemoryItemView, MemoryViewResponse } from "../../../src/types/api.ts";
import type { MemoryFolder, MemoryLoadClass } from "../../../src/types/domain.ts";

vi.mock("../lib/eventBus.ts", () => ({ onHint: () => () => {} }));
vi.mock("../lib/apiClient.ts", () => ({ apiClient: { api: { memory: { $get: vi.fn() } } } }));

import MemoryPage from "./Memory.tsx";
import { apiClient } from "../lib/apiClient.ts";
import { __resetMemoryForTests } from "../lib/memory.ts";

const api = apiClient.api as unknown as { memory: { $get: ReturnType<typeof vi.fn> } };
const envelope = (body: unknown) => ({ json: async () => body });

function item(id: string, folder: MemoryFolder, over: Partial<MemoryItemView> = {}): MemoryItemView {
  return {
    id, folder, text: `text ${id}`, origin: "stated", status: "current", declined: false, pendingChange: false,
    createdAt: "2026-09-01T10:00:00Z", confirmedAt: "2026-09-01T10:00:00Z", loaded: true, earlierVersions: [], ...over,
  };
}
const ORDER: [MemoryFolder, string, MemoryLoadClass][] = [
  ["feedback", "Feedback", "always"],
  ["planning-preferences", "Planning preferences", "always"],
  ["corrections", "Corrections", "always"],
  ["about-you", "About you", "relevant"],
  ["patterns", "Patterns", "relevant"],
  ["goals-projects", "Goals & projects", "relevant"],
  ["decisions-commitments", "Decisions & commitments", "on-ask"],
  ["ideas-notes", "Ideas & notes", "on-ask"],
];
function view(items: MemoryItemView[] = [], over: Partial<MemoryViewResponse> = {}): MemoryViewResponse {
  const folders: MemoryFolderView[] = ORDER.map(([folder, label, loadClass]) => {
    const own = items.filter((i) => i.folder === folder);
    return { folder, label, loadClass, count: own.filter((i) => i.status === "current").length, items: own };
  });
  return { folders, needsReview: [], changedSettings: [], pendingPatterns: [], ...over };
}
const load = (v: MemoryViewResponse) => api.memory.$get.mockResolvedValue(envelope({ ok: true, value: v }));

describe("MemoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.clear(); } catch { /* ignore */ }
    __resetMemoryForTests();
  });

  it("shows skeletons, then the rail with group captions and folder counts", async () => {
    load(view([item("a", "about-you"), item("b", "about-you")]));
    render(<MemoryPage />);
    expect(screen.getAllByTestId("memory-skeleton").length).toBeGreaterThan(0);
    const rail = await screen.findByRole("navigation", { name: "Memory" });
    for (const caption of ["Always used", "Used when relevant", "Only when asked"]) expect(within(rail).getByText(caption)).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: /About you/ })).toHaveTextContent("2");
    expect(within(rail).getByRole("button", { name: /Changed settings/ })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: /Chat history/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Memory" })).toBeInTheDocument();
  });

  it("hides Needs review at zero and shows it with a count otherwise", async () => {
    load(view());
    const { unmount } = render(<MemoryPage />);
    await screen.findByRole("navigation", { name: "Memory" });
    expect(screen.queryByRole("button", { name: /Needs review/ })).toBeNull();
    unmount();
    __resetMemoryForTests();
    const stale = { ...item("s", "goals-projects"), reason: "Expired 10 days ago", canRenew: true };
    load(view([], { needsReview: [stale] }));
    render(<MemoryPage />);
    const btn = await screen.findByRole("button", { name: /Needs review/ });
    expect(btn).toHaveTextContent("1");
    fireEvent.click(btn);
    expect(screen.getByText("Expired 10 days ago")).toBeInTheDocument();
    expect(screen.getByText("text s")).toBeInTheDocument();
  });

  it("shows the error copy when the store is down, with no rail counts", async () => {
    api.memory.$get.mockResolvedValue(envelope({ ok: false, error: { kind: "unreachable", message: "raw" } }));
    render(<MemoryPage />);
    expect(await screen.findByText("Couldn't load memory right now.")).toBeInTheDocument();
    expect(screen.queryByText("raw")).toBeNull();
  });

  it("shows the empty-folder copy, and the Patterns variant", async () => {
    load(view());
    render(<MemoryPage />);
    await screen.findByRole("navigation", { name: "Memory" });
    expect(screen.getByText('Nothing here yet. Say "remember that ..." in Chat.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Patterns/ }));
    expect(screen.getByText("No patterns yet. Yoh will ask before adding one.")).toBeInTheDocument();
  });

  it("restores the last selection", async () => {
    load(view([item("g", "goals-projects")]));
    const first = render(<MemoryPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Goals & projects/ }));
    expect(screen.getByText("text g")).toBeInTheDocument();
    first.unmount();
    __resetMemoryForTests({ keepStorage: true });
    render(<MemoryPage />);
    expect(await screen.findByText("text g")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Goals & projects/ })).toHaveAttribute("aria-current", "true");
  });

  it("moves the selection with Up/Down in the rail", async () => {
    load(view());
    render(<MemoryPage />);
    const feedback = await screen.findByRole("button", { name: /^Feedback/ });
    feedback.focus();
    fireEvent.keyDown(feedback, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /Planning preferences/ })).toHaveAttribute("aria-current", "true");
    fireEvent.keyDown(screen.getByRole("button", { name: /Planning preferences/ }), { key: "ArrowUp" });
    expect(screen.getByRole("button", { name: /^Feedback/ })).toHaveAttribute("aria-current", "true");
  });

  it("item rows show text, Stated/Inferred, scope, expiry, Not loaded, earlier versions and the source", async () => {
    load(view([
      item("x", "feedback", { text: "Be brief", scope: "mornings", expiresOn: "2026-10-13", loaded: false, notLoadedReason: "Expired", source: "deleted",
        earlierVersions: [{ id: "old", text: "Be very brief", confirmedAt: "2026-08-01T10:00:00Z" }] }),
      item("y", "feedback", { origin: "inferred", source: { conversationId: "c1", turnId: "t1", date: "2026-09-28" } }),
    ]));
    render(<MemoryPage />);
    await screen.findByText("Be brief");
    const rows = screen.getAllByTestId("memory-item");
    expect(rows[0]).toHaveTextContent("Stated");
    expect(rows[0]).toHaveTextContent("mornings");
    expect(rows[0]).toHaveTextContent("Oct 13");
    expect(rows[0]).toHaveTextContent("Not loaded");
    expect(rows[0]).toHaveTextContent("source deleted");
    expect(rows[0]).toHaveTextContent("1 earlier version");
    expect(rows[1]).toHaveTextContent("Inferred");
    expect(rows[1]).toHaveTextContent("Source");
    fireEvent.click(within(rows[0]!).getByRole("button", { name: /1 earlier version/ }));
    expect(screen.getByText(/Be very brief/)).toBeInTheDocument();
  });

  it("lists changed settings with Revert, and pending patterns at the top of Patterns", async () => {
    load(view([], {
      changedSettings: [{ key: "schoolDayWorkStart", label: "School-day work start", value: "16:00", was: "15:00", changedAt: "2026-09-20T10:00:00Z" }],
      pendingPatterns: [{ requestId: "r1", questionId: "proposal:1", text: "Add a pattern: you skip Friday reviews?", options: [], allowsFreeText: false }],
    }));
    render(<MemoryPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Changed settings/ }));
    expect(screen.getByText("School-day work start: 16:00 (was 15:00) - changed Sep 20")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revert School-day work start" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Patterns/ }));
    expect(screen.getByText(/Add a pattern/)).toBeInTheDocument();
  });
});
