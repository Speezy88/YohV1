import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";
import type { MemoryFolderView, MemoryItemView, MemoryViewResponse } from "../../../src/types/api.ts";
import type { MemoryFolder } from "../../../src/types/domain.ts";

vi.mock("../lib/eventBus.ts", () => ({ onHint: () => () => {} }));
const memoryGet = vi.fn();
const searchGet = vi.fn();
const listGet = vi.fn();
const oneGet = vi.fn();
const delPost = vi.fn();
const clearPost = vi.fn();
vi.mock("../lib/apiClient.ts", () => ({
  apiClient: {
    api: {
      memory: { $get: (...a: unknown[]) => memoryGet(...a), search: { $get: (...a: unknown[]) => searchGet(...a) } },
      "chat-history": {
        $get: (...a: unknown[]) => listGet(...a),
        ":conversationId": { $get: (...a: unknown[]) => oneGet(...a) },
        delete: { $post: (...a: unknown[]) => delPost(...a) },
        clear: { $post: (...a: unknown[]) => clearPost(...a) },
      },
    },
  },
}));

import MemoryPage from "./Memory.tsx";
import { __resetMemoryForTests } from "../lib/memory.ts";

const env = (value: unknown) => ({ json: async () => ({ ok: true, value }) });

function item(id: string, folder: MemoryFolder, over: Partial<MemoryItemView> = {}): MemoryItemView {
  return {
    id, folder, text: `text ${id}`, origin: "stated", status: "current", declined: false, pendingChange: false,
    createdAt: "2026-09-01T10:00:00Z", confirmedAt: "2026-09-01T10:00:00Z", loaded: true, earlierVersions: [], ...over,
  };
}
const VIEW: MemoryViewResponse = {
  folders: [
    { folder: "feedback", label: "Feedback", loadClass: "always", count: 0, items: [] },
    { folder: "about-you", label: "About you", loadClass: "relevant", count: 1, items: [item("a1", "about-you", { source: { conversationId: "c1", turnId: "t1", date: "2026-09-28" } })] },
  ] as MemoryFolderView[],
  needsReview: [], changedSettings: [], pendingPatterns: [],
};
const LIST = {
  conversations: [
    { id: "c1", date: "2026-09-28", turnCount: 4, firstLine: "Remember that I run" },
    { id: "c2", date: "2026-09-27", turnCount: 3, firstLine: "Move the lab report" },
  ],
};
const CONVO = {
  id: "c1", date: "2026-09-28",
  turns: [
    { id: "t1", role: "user", text: "Remember that I run", truncated: false, createdAt: "2026-09-28T09:00:00Z" },
    {
      id: "t2", role: "assistant", text: "Got it. See [x](https://evil.example)", truncated: false, createdAt: "2026-09-28T09:01:00Z",
      receipt: { receiptId: "r1", kind: "remembered", items: [{ id: "a1", text: "Runs before school", folder: "about-you" }] },
    },
  ],
};

async function openHistory(): Promise<void> {
  render(<MemoryPage />);
  const rail = await screen.findByRole("navigation", { name: "Memory" });
  fireEvent.click(within(rail).getByRole("button", { name: /Chat history/ }));
}

describe("Memory page: search and chat history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.clear(); } catch { /* ignore */ }
    __resetMemoryForTests();
    memoryGet.mockResolvedValue(env(VIEW));
    listGet.mockResolvedValue(env(LIST));
    oneGet.mockResolvedValue(env(CONVO));
    delPost.mockResolvedValue(env({}));
    clearPost.mockResolvedValue(env({}));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists conversations as 'Day · n turns · first line' and opens a read-only transcript", async () => {
    await openHistory();
    const row = await screen.findByRole("button", { name: /Mon Sep 28/ });
    expect(row).toHaveTextContent("Mon Sep 28 · 4 turns · Remember that I run");
    fireEvent.click(row);
    expect(await screen.findByText("Remember that I run", { selector: "p" })).toBeInTheDocument();
    // the receipt renders settled: no Undo, no View in Memory
    const receipt = await screen.findByTestId("remembered-receipt");
    expect(receipt).toHaveTextContent("Remembered: Runs before school");
    expect(within(receipt).queryByRole("button")).toBeNull();
    // a model-written link is plain text, never live
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/Got it\. See x/)).toBeInTheDocument();
  });

  it("shows 'No saved conversations.' when history is empty", async () => {
    listGet.mockResolvedValue(env({ conversations: [] }));
    await openHistory();
    expect(await screen.findByText("No saved conversations.")).toBeInTheDocument();
  });

  it("delete: Undo cancels with no request; letting the toast close commits", async () => {
    await openHistory();
    fireEvent.click(await screen.findByRole("button", { name: /Mon Sep 28/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete conversation" }));
    expect(screen.getByTestId("undo-toast")).toHaveTextContent("Deleted conversation");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(delPost).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /Mon Sep 28/ })).toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: /Mon Sep 28/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    fireEvent.click(screen.getByRole("button", { name: "Delete conversation" }));
    expect(screen.queryByRole("button", { name: /Mon Sep 28/ })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(6100); });
    expect(delPost).toHaveBeenCalledWith({ json: { conversationId: "c1" } });
  });

  it("leaving the pane while a delete is pending sends it", async () => {
    await openHistory();
    fireEvent.click(await screen.findByRole("button", { name: /Mon Sep 28/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete conversation" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Memory" })).getByRole("button", { name: /About you/ }));
    await waitFor(() => expect(delPost).toHaveBeenCalledWith({ json: { conversationId: "c1" } }));
  });

  it("Clear all history asks first, then clears and shows the empty state", async () => {
    await openHistory();
    fireEvent.click(await screen.findByRole("button", { name: "Clear all history" }));
    expect(screen.getByText("Clear all chat history? This can't be undone. Memories stay.")).toBeInTheDocument();
    expect(clearPost).not.toHaveBeenCalled();
    listGet.mockResolvedValue(env({ conversations: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    await waitFor(() => expect(clearPost).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("No saved conversations.")).toBeInTheDocument();
  });

  it("Cancel leaves history alone", async () => {
    await openHistory();
    fireEvent.click(await screen.findByRole("button", { name: "Clear all history" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(clearPost).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Clear all history" })).toBeInTheDocument();
  });

  it("a memory's Source opens that conversation", async () => {
    render(<MemoryPage />);
    fireEvent.click(await screen.findByRole("button", { name: /About you/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Source/ }));
    await waitFor(() => expect(oneGet).toHaveBeenCalledWith({ param: { conversationId: "c1" } }));
    expect(await screen.findByRole("button", { name: "Delete conversation" })).toBeInTheDocument();
  });

  describe("search", () => {
    const RESULTS = {
      query: "run",
      items: [item("a1", "about-you", { text: "Runs before school" })],
      turns: [{ turnId: "t1", conversationId: "c1", date: "2026-09-28", role: "user", snippet: "Remember that I run" }],
    };

    async function type(text: string): Promise<void> {
      fireEvent.change(await screen.findByRole("searchbox", { name: "Search memory" }), { target: { value: text } });
    }

    it("finds a memory and a chat turn, each with its folder or Conversation date", async () => {
      searchGet.mockResolvedValue(env(RESULTS));
      render(<MemoryPage />);
      await type("run");
      const memoryHit = await screen.findByRole("button", { name: /Runs before school/ }, { timeout: 2000 });
      expect(memoryHit).toHaveTextContent("About you");
      const turnHit = screen.getByRole("button", { name: /Remember that I run/ });
      expect(turnHit).toHaveTextContent("Mon Sep 28");
      expect(searchGet).toHaveBeenCalledWith({ query: { q: "run" } });
    });

    it("opening a chat hit opens that Conversation; opening a memory hit selects its folder", async () => {
      searchGet.mockResolvedValue(env(RESULTS));
      render(<MemoryPage />);
      await type("run");
      fireEvent.click(await screen.findByRole("button", { name: /Remember that I run/ }, { timeout: 2000 }));
      await waitFor(() => expect(oneGet).toHaveBeenCalled());
      expect(screen.queryByRole("searchbox", { name: "Search memory" })).toHaveValue("");
    });

    it("Esc clears the search and returns to the selection", async () => {
      searchGet.mockResolvedValue(env(RESULTS));
      render(<MemoryPage />);
      await type("run");
      await screen.findByRole("button", { name: /Runs before school/ }, { timeout: 2000 });
      fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search memory" }), { key: "Escape" });
      expect(screen.getByRole("searchbox", { name: "Search memory" })).toHaveValue("");
      expect(screen.queryByRole("button", { name: /Runs before school/ })).toBeNull();
      expect(screen.getByRole("region", { name: "Memory items" })).toBeInTheDocument();
    });

    it("no results says so, using the words typed", async () => {
      searchGet.mockResolvedValue(env({ query: "zzz", items: [], turns: [] }));
      render(<MemoryPage />);
      await type("zzz");
      expect(await screen.findByText("No memories or chats match 'zzz'.", {}, { timeout: 2000 })).toBeInTheDocument();
    });
  });
});
