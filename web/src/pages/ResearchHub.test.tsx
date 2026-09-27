/**
 * web/src/pages/ResearchHub.test.tsx — Task 6C (FR-43): the Research Hub
 * page. The server call is mocked at the one RPC client (`apiClient.ts`);
 * `openChatPanel`/`send` are mocked so the ask box's "sends into Chat" wire-
 * up is checked without a real chat store or panel mounted.
 *
 * Covers: the loading skeleton, the list rendering title/date/source count
 * and linking to the item's own Notion page, the empty-vault state's exact
 * copy, and the ask box opening the Chat panel with the typed question.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ResearchHubPage from "./ResearchHub.tsx";
import { apiClient } from "../lib/apiClient.ts";
import { openChatPanel } from "../lib/chatPanel.ts";
import { send } from "../lib/chatStore.ts";
import type { ResearchListResponse } from "../../../src/types/api.ts";

vi.mock("../lib/apiClient.ts", () => ({
  apiClient: { api: { research: { $get: vi.fn() } } },
}));
vi.mock("../lib/chatPanel.ts", () => ({ openChatPanel: vi.fn() }));
vi.mock("../lib/chatStore.ts", () => ({ send: vi.fn() }));

type Mock = ReturnType<typeof vi.fn>;
const api = apiClient.api as unknown as { research: { $get: Mock } };
const envelope = (body: unknown) => ({ json: async () => body });

const VIEW: ResearchListResponse = {
  items: [
    { id: "rv-1", title: "AP Bio registration deadline", date: "2026-09-20", sourceCount: 2, url: "https://notion.so/rv-1" },
    { id: "rv-2", title: "Undated find", sourceCount: 1, url: "https://notion.so/rv-2" },
  ],
};

describe("ResearchHubPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a skeleton while loading, then the recent list with date and source count, each linking to its own Notion page", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    render(<ResearchHubPage />);
    expect(screen.getAllByTestId("research-row-skeleton").length).toBeGreaterThan(0);

    await screen.findByText("AP Bio registration deadline");
    const row = screen.getByText("AP Bio registration deadline").closest("a") as HTMLAnchorElement;
    expect(row).toHaveAttribute("href", "https://notion.so/rv-1");
    expect(row).toHaveAttribute("target", "_blank");
    expect(row).toHaveTextContent("2 sources");
    expect(row).toHaveTextContent("Sep 20, 2026");

    const undated = screen.getByText("Undated find").closest("a") as HTMLAnchorElement;
    expect(undated).toHaveTextContent("1 source");
  });

  it('shows the exact empty-vault copy when there is nothing saved yet', async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: { items: [] } }));
    render(<ResearchHubPage />);
    await screen.findByText('Nothing saved yet. Ask a question, then say "save that".');
  });

  it("a failed load shows a plain message naming the reason", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: false, error: { kind: "unreachable", message: "I couldn't reach Notion right now; nothing was changed." } }));
    render(<ResearchHubPage />);
    await screen.findByText(/Couldn't load your Research Vault right now/);
  });

  it("Enter in the ask box opens the Chat panel with the typed question, and clears the box", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: { items: [] } }));
    render(<ResearchHubPage />);
    const input = screen.getByRole("textbox", { name: "Ask a research question" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "AP Bio registration deadline" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(openChatPanel).toHaveBeenCalledTimes(1);
    // Real-use fixes plan, Task 5 (Ruling): the ask box always sends an
    // explicit "search: <question>" line, so it never depends on
    // classifyChatIntent's classifier — `core/search-intent.ts`'s
    // `parseSearchIntent` treats a leading "search:" as explicit.
    expect(send).toHaveBeenCalledWith("search: AP Bio registration deadline");
    expect(input).toHaveValue("");
  });

  it("a blank ask box does nothing on Enter", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: { items: [] } }));
    render(<ResearchHubPage />);
    const input = screen.getByRole("textbox", { name: "Ask a research question" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(openChatPanel).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
