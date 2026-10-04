/**
 * web/src/pages/ResearchHub.test.tsx — Task 6C (FR-43) + Story 11.2: the
 * Research Hub page. The server calls are mocked at the one RPC client
 * (`apiClient.ts`); `openChatPanel`/`send` are mocked so the ask box's
 * "sends into Chat" wire-up is checked without a real chat store.
 *
 * Covers: the loading skeleton, the library rows (buttons) with date and
 * source count, the Research Box (title, date, body, sources, Open in
 * Notion, absent parts, skeleton, error + retry), opening a row in place
 * with its current marker, opening by id (deep link) while mounted, Show
 * more (incl. failure), the empty-vault state, and the ask box.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react";
import ResearchHubPage from "./ResearchHub.tsx";
import { apiClient } from "../lib/apiClient.ts";
import { openChatPanel } from "../lib/chatPanel.ts";
import { send } from "../lib/chatStore.ts";
import { ROW_HOVER_RAISED } from "../lib/controlStyles.ts";
import { openResearchDocument, resetResearchSelection } from "../lib/research.ts";
import type { ResearchDocument, ResearchListResponse } from "../../../src/types/api.ts";

vi.mock("../lib/apiClient.ts", () => ({
  apiClient: { api: { research: { $get: vi.fn(), document: { $get: vi.fn() } } } },
}));
vi.mock("../lib/chatPanel.ts", () => ({ openChatPanel: vi.fn() }));
vi.mock("../lib/chatStore.ts", () => ({ send: vi.fn() }));

type Mock = ReturnType<typeof vi.fn>;
const api = apiClient.api as unknown as { research: { $get: Mock; document: { $get: Mock } } };
const envelope = (body: unknown) => ({ json: async () => body });
const EMPTY = { items: [], hasMore: false };

const VIEW: ResearchListResponse = {
  items: [
    { id: "rv-1", title: "AP Bio registration deadline", date: "2026-09-20", sourceCount: 2, url: "https://notion.so/rv-1" },
    { id: "rv-2", title: "Undated find", sourceCount: 1, url: "https://notion.so/rv-2" },
  ],
  hasMore: false,
};
const DOC1: ResearchDocument = {
  id: "rv-1",
  title: "AP Bio registration deadline",
  date: "2026-09-20",
  body: "Registration closes **October 1**.\n\nLate fee is $40.",
  sources: ["https://example.com/a", "plain text source"],
  url: "https://notion.so/rv-1",
};
const DOC2: ResearchDocument = { id: "rv-2", title: "Undated find", body: "", sources: [], url: "https://notion.so/rv-2" };
const docEnvelope = (d: ResearchDocument | undefined) => envelope({ ok: true, value: d ? { document: d } : {} });
const FAIL = envelope({ ok: false, error: { kind: "unreachable", message: "I couldn't reach Notion right now; nothing was changed." } });
const box = () => screen.findByRole("region", { name: "Research document" });

describe("ResearchHubPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetResearchSelection();
    api.research.document.$get.mockImplementation(async ({ query }: { query: { id?: string } }) => docEnvelope(query.id === "rv-2" ? DOC2 : DOC1));
  });

  it("shows a skeleton while loading, then the library rows (buttons) with date and source count", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    render(<ResearchHubPage />);
    expect(screen.getAllByTestId("research-row-skeleton").length).toBeGreaterThan(0);

    const rows = await screen.findAllByTestId("research-row");
    expect(rows[0]!.tagName).toBe("BUTTON");
    expect(rows[0]).toHaveTextContent("AP Bio registration deadline");
    expect(rows[0]).toHaveTextContent("2 sources");
    expect(rows[0]).toHaveTextContent("Sep 20, 2026");
    expect(rows[1]).toHaveTextContent("1 source");
  });

  it("the Research Box shows the newest document: title, date, body, sources (links only for http/https), Open in Notion", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    render(<ResearchHubPage />);
    const region = await box();
    expect(api.research.document.$get).toHaveBeenCalledWith({ query: {} });
    expect(within(region).getByRole("heading", { name: "AP Bio registration deadline" })).toBeInTheDocument();
    expect(region).toHaveTextContent("Sep 20, 2026");
    expect(region).toHaveTextContent("Registration closes");
    expect(region).toHaveTextContent("Late fee is $40.");
    expect(within(region).getByText("Sources")).toBeInTheDocument();
    const link = within(region).getByRole("link", { name: "https://example.com/a" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(region).toHaveTextContent("plain text source");
    expect(within(region).queryByRole("link", { name: "plain text source" })).toBeNull();
    const notion = within(region).getByRole("link", { name: "Open in Notion" });
    expect(notion).toHaveAttribute("href", "https://notion.so/rv-1");
    expect(notion).toHaveAttribute("target", "_blank");
  });

  it("an empty body and empty sources are simply absent, and an undated document shows no date", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    api.research.document.$get.mockResolvedValue(docEnvelope(DOC2));
    render(<ResearchHubPage />);
    const region = await box();
    expect(within(region).getByRole("heading", { name: "Undated find" })).toBeInTheDocument();
    expect(within(region).queryByText("Sources")).toBeNull();
    expect(within(region).queryByTestId("research-box-body")).toBeNull();
    expect(within(region).queryByTestId("research-box-date")).toBeNull();
    expect(within(region).getByRole("link", { name: "Open in Notion" })).toBeInTheDocument();
  });

  it("an empty vault has no box and the existing empty state", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: EMPTY }));
    api.research.document.$get.mockResolvedValue(docEnvelope(undefined));
    render(<ResearchHubPage />);
    await screen.findByText('Nothing saved yet. Ask a question, then say "save that".');
    expect(screen.queryByRole("region", { name: "Research document" })).toBeNull();
  });

  it("shows a skeleton in the box while the document loads", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    api.research.document.$get.mockReturnValue(new Promise(() => {}));
    render(<ResearchHubPage />);
    expect(await screen.findByTestId("research-box-skeleton")).toBeInTheDocument();
  });

  it("a failed document load shows an error with retry and leaves the library usable", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    api.research.document.$get.mockResolvedValueOnce(FAIL);
    render(<ResearchHubPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load this document right now.");
    expect(screen.getAllByTestId("research-row").length).toBe(2);
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await box();
  });

  it("clicking a row opens that document in the box and marks the row (aria-current plus a visible label)", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    render(<ResearchHubPage />);
    await box();
    const rows = screen.getAllByTestId("research-row");
    await waitFor(() => expect(rows[0]).toHaveAttribute("aria-current", "true"));
    expect(rows[0]).toHaveTextContent("Viewing");
    expect(rows[1]).not.toHaveAttribute("aria-current");
    fireEvent.click(rows[1]!);
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Research document" })).getByRole("heading", { name: "Undated find" })).toBeInTheDocument());
    expect(api.research.document.$get).toHaveBeenLastCalledWith({ query: { id: "rv-2" } });
    expect(screen.getAllByTestId("research-row")[1]).toHaveAttribute("aria-current", "true");
    expect(screen.getAllByTestId("research-row")[0]).not.toHaveAttribute("aria-current");
  });

  it("a row holds no block elements, and the box itself is not a live region", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    render(<ResearchHubPage />);
    const region = await box();
    for (const row of screen.getAllByTestId("research-row")) expect(row.querySelector("div")).toBeNull();
    expect(region.querySelector("[aria-live]")).toBeNull();
  });

  it("one always-mounted status region says Showing {title} only after a row click or a deep link", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    render(<ResearchHubPage />);
    const status = screen.getByRole("status");
    expect(status).toHaveClass("sr-only");
    await box();
    expect(status).toHaveTextContent("");
    fireEvent.click(screen.getAllByTestId("research-row")[1]!);
    await waitFor(() => expect(status).toHaveTextContent("Showing Undated find"));
    act(() => openResearchDocument("rv-1"));
    await waitFor(() => expect(status).toHaveTextContent("Showing AP Bio registration deadline"));
    expect(screen.getByRole("status")).toBe(status);
  });

  it("a hint refresh of the open document does not announce again", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    render(<ResearchHubPage />);
    await box();
    fireEvent.click(screen.getAllByTestId("research-row")[1]!);
    const status = screen.getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("Showing Undated find"));
    // The text is cleared by the next announcement only; a refetch with no selection change leaves it unchanged.
    const before = status.textContent;
    await act(async () => {});
    expect(status.textContent).toBe(before);
  });

  it("mounting with a selection already made does not scroll or announce", async () => {
    const scrollBy = vi.fn();
    Element.prototype.scrollBy = scrollBy;
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const [top, bottom] = this.dataset.testid === "research-box" ? [900, 1100] : [0, 700];
      return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) };
    });
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    openResearchDocument("rv-2");
    render(<ResearchHubPage />);
    await box();
    await waitFor(() => expect(screen.getByRole("region", { name: "Research document" })).toHaveTextContent("Undated find"));
    expect(scrollBy).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("");
    rect.mockRestore();
  });

  it("opening a row or a deep link scrolls the page so the box is in view; the initial load does not", async () => {
    const scrollBy = vi.fn();
    Element.prototype.scrollBy = scrollBy;
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const [top, bottom] = this.dataset.testid === "research-box" ? [900, 1100] : [0, 700];
      return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) };
    });
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    render(<ResearchHubPage />);
    await box();
    expect(scrollBy).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByTestId("research-row")[1]!);
    await waitFor(() => expect(scrollBy).toHaveBeenCalledTimes(1));
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 400, behavior: "smooth" });
    act(() => openResearchDocument("rv-1"));
    await waitFor(() => expect(scrollBy).toHaveBeenCalledTimes(2));
    rect.mockRestore();
  });

  it("openResearchDocument(id) while mounted opens that document; the marker follows the document actually returned", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    render(<ResearchHubPage />);
    await box();
    // An id the server no longer has: it answers with the newest, and that row is the marked one.
    act(() => openResearchDocument("gone"));
    await waitFor(() => expect(api.research.document.$get).toHaveBeenLastCalledWith({ query: { id: "gone" } }));
    await waitFor(() => expect(screen.getAllByTestId("research-row")[0]).toHaveAttribute("aria-current", "true"));
    act(() => openResearchDocument("rv-2"));
    await waitFor(() => expect(screen.getAllByTestId("research-row")[1]).toHaveAttribute("aria-current", "true"));
  });

  it("Show more appears only when hasMore, asks for the next page, and disappears when the list is complete", async () => {
    api.research.$get.mockResolvedValueOnce(envelope({ ok: true, value: { ...VIEW, hasMore: true } }));
    render(<ResearchHubPage />);
    const more = await screen.findByRole("button", { name: "Show more" });
    api.research.$get.mockResolvedValueOnce(envelope({ ok: true, value: { items: [...VIEW.items, { id: "rv-3", title: "Third", sourceCount: 0, url: "u" }], hasMore: false } }));
    fireEvent.click(more);
    await screen.findByText("Third");
    expect(api.research.$get).toHaveBeenLastCalledWith({ query: { pages: "2" } });
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("no Show more when hasMore is false", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    render(<ResearchHubPage />);
    await screen.findAllByTestId("research-row");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("a failed Show more keeps the rows and says Couldn't load more. with Try again", async () => {
    api.research.$get.mockResolvedValueOnce(envelope({ ok: true, value: { ...VIEW, hasMore: true } }));
    render(<ResearchHubPage />);
    const more = await screen.findByRole("button", { name: "Show more" });
    api.research.$get.mockResolvedValueOnce(FAIL);
    fireEvent.click(more);
    await screen.findByText("Couldn't load more.");
    expect(screen.getAllByTestId("research-row").length).toBe(2);
    api.research.$get.mockResolvedValueOnce(envelope({ ok: true, value: { items: [...VIEW.items, { id: "rv-3", title: "Third", sourceCount: 0, url: "u" }], hasMore: false } }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Third");
    expect(screen.queryByText("Couldn't load more.")).toBeNull();
  });

  it('shows the exact empty-vault copy when there is nothing saved yet', async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: EMPTY }));
    render(<ResearchHubPage />);
    await screen.findByText('Nothing saved yet. Ask a question, then say "save that".');
  });

  it("a failed load shows a plain message naming the reason", async () => {
    api.research.$get.mockResolvedValue(FAIL);
    render(<ResearchHubPage />);
    await screen.findByText(/Couldn't load your Research Vault right now/);
  });

  it("a first-load error is an alert with Try again that refetches the list", async () => {
    api.research.$get.mockResolvedValueOnce(FAIL);
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: EMPTY }));
    api.research.document.$get.mockResolvedValue(docEnvelope(undefined));
    render(<ResearchHubPage />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("I couldn't reach Notion right now");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByText('Nothing saved yet. Ask a question, then say "save that".');
    expect(api.research.$get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Enter in the ask box opens the Chat panel with the typed question, and clears the box", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: EMPTY }));
    render(<ResearchHubPage />);
    const input = screen.getByRole("textbox", { name: "Ask a research question" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "AP Bio registration deadline" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(openChatPanel).toHaveBeenCalledTimes(1);
    // Real-use fixes plan, Task 5 (Ruling): the ask box always sends an
    // explicit "search: <question>" line, so it never depends on
    // the chat model choosing to search — `core/search-intent.ts`'s
    // `parseSearchIntent` treats a leading "search:" as explicit.
    expect(send).toHaveBeenCalledWith("search: AP Bio registration deadline");
    expect(input).toHaveValue("");
  });

  it("a blank ask box does nothing on Enter", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: EMPTY }));
    render(<ResearchHubPage />);
    const input = screen.getByRole("textbox", { name: "Ask a research question" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(openChatPanel).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("Research rows use the raised-row hover and the ask field shows a visible focus treatment", async () => {
    api.research.$get.mockResolvedValue(envelope({ ok: true, value: VIEW }));
    render(<ResearchHubPage />);
    const rows = await screen.findAllByTestId("research-row");
    expect(rows[0]!.className).toContain(ROW_HOVER_RAISED);
    const field = screen.getByRole("textbox", { name: "Ask a research question" }).closest("label") as HTMLElement;
    expect(field.className).toContain("has-[:focus-visible]:outline-accent-solid");
  });
});
