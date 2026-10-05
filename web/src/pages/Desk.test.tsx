/**
 * web/src/pages/Desk.test.tsx — the Desk page's six widgets (Ruling E12-R9 copy),
 * their zero states, the skeleton and the error + retry. `GET /api/desk` is
 * mocked at the one RPC client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import DeskPage from "./Desk.tsx";
import { apiClient } from "../lib/apiClient.ts";
import { __resetDeskFeedsForTests } from "../lib/deskFeeds.ts";
import { __resetDeskForTests } from "../lib/desk.ts";
import { PageNavigationContext } from "../lib/navigationContext.tsx";
import { PAGES } from "../lib/pages.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import type { DeskResponse } from "../../../src/types/api.ts";

vi.mock("../lib/apiClient.ts", () => ({ apiClient: { api: { desk: { $get: vi.fn(), feeds: { $get: vi.fn() } } } } }));
vi.mock("../hooks/useReducedMotion.ts", () => ({ useReducedMotion: vi.fn(() => false) }));
const reduced = useReducedMotion as unknown as ReturnType<typeof vi.fn>;
const get = apiClient.api.desk.$get as unknown as ReturnType<typeof vi.fn>;
const getFeeds = apiClient.api.desk.feeds.$get as unknown as ReturnType<typeof vi.fn>;

const BASE: DeskResponse = {
  today: "2026-10-04",
  completedToday: [
    { taskName: "Newest task", completedAt: "2026-10-04T10:00:00.000Z" },
    { taskName: "Older task", completedAt: "2026-10-04T09:00:00.000Z" },
  ],
  minutesToday: 75,
  hoursWithYoh: 5,
  onTime: { onTime: 2, counted: 4, percent: 50 },
  streak: { current: 3, longest: 5 },
  heatmap: { weeks: [] },
  spend: { monthUsd: 7, unpricedCalls: 0 },
};
const serve = (v: Partial<DeskResponse>) => get.mockResolvedValue({ json: async () => ({ ok: true, value: { ...BASE, ...v } }) });
const card = (name: string) => screen.getByRole("heading", { name }).closest("[data-wheel-nav]") as HTMLElement;

describe("DeskPage", () => {
  beforeEach(() => {
    __resetDeskForTests();
    __resetDeskFeedsForTests();
    get.mockReset();
    getFeeds.mockReset();
    getFeeds.mockReturnValue(new Promise(() => {}));
    reduced.mockReturnValue(false);
  });

  it("shows each widget's value from the response", async () => {
    serve({});
    render(<DeskPage />);
    expect(screen.getByRole("heading", { name: "Desk", level: 1 })).toBeInTheDocument();
    await screen.findByText("75 min today");
    const done = card("Tasks completed today");
    expect(done).toHaveAttribute("data-wheel-nav", "off");
    expect(within(done).getByText("2")).toBeInTheDocument();
    const rows = within(done).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Newest task", "Older task"]);
    expect(within(done).getByText("Newest task").className).toContain("line-through");
    expect(within(done).getByRole("region", { name: "Tasks completed today, list" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("5 h with Yoh")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("2 of 4 Tasks with a due date")).toBeInTheDocument();
    expect(screen.getByText("Streak: 3 days · Longest: 5 days")).toBeInTheDocument();
    expect(screen.getByText("A day counts when it has a Plan and a finished night close-out.")).toBeInTheDocument();
    expect(card("Claude API spend this month")).toHaveTextContent("$7.00");
    expect(screen.getByText("Estimated from recorded calls.")).toBeInTheDocument();
    expect(screen.queryByText(/calls? not priced/)).not.toBeInTheDocument();
    expect(screen.queryByText("Desk isn't built yet.")).not.toBeInTheDocument();
  });

  it("zero states: nothing completed, no on-time rate, streak 0, $0.00", async () => {
    serve({ completedToday: [], minutesToday: 0, hoursWithYoh: 0, onTime: { onTime: 0, counted: 0, percent: null }, streak: { current: 0, longest: 0 } , spend: { monthUsd: 0, unpricedCalls: 0 } });
    render(<DeskPage />);
    await screen.findByText("Nothing completed yet today.");
    expect(within(card("Tasks completed today")).getByText("0")).toBeInTheDocument();
    const onTime = card("On-time rate");
    expect(within(onTime).getByText("No on-time rate yet")).toHaveClass("sr-only");
    expect(within(onTime).getByText("—")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("No Tasks with a due date completed yet.")).toBeInTheDocument();
    expect(screen.getByText("Streak: 0 days · Longest: 0 days")).toBeInTheDocument();
    expect(card("Claude API spend this month")).toHaveTextContent("$0.00");
    expect(screen.getByText("0 min today")).toBeInTheDocument();
  });

  it("streak singular", async () => {
    serve({ streak: { current: 1, longest: 1 } });
    render(<DeskPage />);
    await screen.findByText("Streak: 1 day · Longest: 1 day");
  });

  it("unpriced calls: singular and plural", async () => {
    serve({ spend: { monthUsd: 1.5, unpricedCalls: 1 } });
    const { unmount } = render(<DeskPage />);
    await screen.findByText("1 call not priced.");
    unmount();
    __resetDeskForTests();
    serve({ spend: { monthUsd: 1.5, unpricedCalls: 3 } });
    render(<DeskPage />);
    await screen.findByText("3 calls not priced.");
    expect(card("Claude API spend this month")).toHaveTextContent("$1.50");
  });

  it("shows the Crypto widget after the heatmap, and a failed feeds request leaves the metrics alone", async () => {
    serve({});
    getFeeds.mockRejectedValue(new Error("down"));
    render(<DeskPage />);
    await screen.findByText("75 min today");
    const crypto = card("Crypto");
    await within(crypto).findByText("Unavailable");
    await within(card("Weather · Seattle, WA")).findByText("Unavailable");
    await within(card("Business and AI news")).findByText("Unavailable");
    expect(screen.getByText("50%")).toBeInTheDocument();
    const order = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(order.indexOf("Crypto")).toBe(order.indexOf("Activity") + 1);
    expect(order.slice(order.indexOf("Crypto"))).toEqual(["Crypto", "Weather · Seattle, WA", "Business and AI news"]);
  });

  it("shows skeleton cards while loading", () => {
    get.mockReturnValue(new Promise(() => {}));
    render(<DeskPage />);
    expect(screen.getAllByTestId("desk-widget-skeleton").length).toBe(9); // six metric widgets and the three feed widgets
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("M10: the three feed widgets render beside the error when /api/desk fails", async () => {
    get.mockResolvedValue({ json: async () => ({ ok: false, error: { message: "Server said no." } }) });
    getFeeds.mockResolvedValue({ json: async () => ({ ok: true, value: { timeZone: "UTC", crypto: { status: "ok", value: { tickers: [{ symbol: "BTC", priceUsd: 67123.4, changePercent: 1.2 }] }, fetchedAt: "2026-10-04T15:30:00.000Z" }, weather: { status: "unavailable" }, news: { status: "unavailable" } } }) });
    render(<DeskPage />);
    expect(await screen.findByText("Couldn't load Desk.")).toBeInTheDocument();
    expect(await screen.findByText("$67,123")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Weather · Seattle, WA" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Business and AI news" })).toBeInTheDocument();
  });

  it("M10: the feed widgets show their own value while /api/desk is still loading", async () => {
    get.mockReturnValue(new Promise(() => {}));
    getFeeds.mockResolvedValue({ json: async () => ({ ok: true, value: { timeZone: "UTC", crypto: { status: "ok", value: { tickers: [{ symbol: "BTC", priceUsd: 67123.4, changePercent: 1.2 }] }, fetchedAt: "2026-10-04T15:30:00.000Z" }, weather: { status: "unavailable" }, news: { status: "unavailable" } } }) });
    render(<DeskPage />);
    expect(await screen.findByText("$67,123")).toBeInTheDocument();
    expect(screen.getAllByTestId("desk-widget-skeleton").length).toBe(6 + 0);
  });

  it("shows an error with Try again that refetches", async () => {
    get.mockResolvedValue({ json: async () => ({ ok: false, error: { message: "Server said no." } }) });
    render(<DeskPage />);
    expect(await screen.findByText("Couldn't load Desk.")).toBeInTheDocument();
    serve({});
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("75 min today")).toBeInTheDocument());
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("the first skeleton card spans two columns like the loaded first card", () => {
    get.mockReturnValue(new Promise(() => {}));
    render(<DeskPage />);
    const cards = screen.getAllByTestId("desk-widget-skeleton");
    expect(cards[0]).toHaveClass("sm:col-span-2");
    expect(cards[1]).not.toHaveClass("sm:col-span-2");
  });

  it("the sixth skeleton card spans the full width like the Activity widget", () => {
    get.mockReturnValue(new Promise(() => {}));
    render(<DeskPage />);
    const cards = screen.getAllByTestId("desk-widget-skeleton");
    expect(cards[5]).toHaveClass("sm:col-span-2", "lg:col-span-3");
    expect(cards[4]).not.toHaveClass("lg:col-span-3");
  });

  it("shows the Activity heatmap widget after the five others, with its caption", async () => {
    serve({ heatmap: { weeks: [[{ date: "2026-10-03", completed: 2, level: 2 }, { date: "2026-10-04", completed: 0, level: 0 }]] } });
    render(<DeskPage />);
    await screen.findByText("75 min today");
    const activity = card("Activity");
    expect(activity).toHaveAttribute("data-wheel-nav", "off");
    expect(activity).toHaveClass("sm:col-span-2", "lg:col-span-3");
    expect(within(activity).getByText("Last 26 weeks")).toBeInTheDocument();
    expect(within(activity).getByRole("img", { name: "Oct 3, 2026: 2 Tasks completed" })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.at(-1)).toBe("Activity");
  });

  it("skeletons pulse normally and do not under reduced motion", () => {
    get.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<DeskPage />);
    expect(screen.getAllByTestId("desk-widget-skeleton")[0]).toHaveClass("animate-pulse");
    unmount();
    reduced.mockReturnValue(true);
    render(<DeskPage />);
    for (const s of screen.getAllByTestId("desk-widget-skeleton")) expect(s).not.toHaveClass("animate-pulse");
  });

  it("Try again is disabled and busy while the retry is in flight", async () => {
    get.mockResolvedValue({ json: async () => ({ ok: false, error: { message: "Server said no." } }) });
    render(<DeskPage />);
    await screen.findByText("Couldn't load Desk.");
    let release!: (v: unknown) => void;
    get.mockReturnValue(new Promise((r) => (release = r)));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const busy = await screen.findByRole("button", { name: "Try again" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    release({ json: async () => ({ ok: true, value: BASE }) });
    await screen.findByText("75 min today");
  });

  describe("only fetches while Desk is the page in view", () => {
    const deskIndex = PAGES.findIndex((p) => p.id === "desk");
    const nav = (index: number) => ({ index, goTo: () => {}, next: () => {}, prev: () => {} });
    it("makes no request while another page is current, and one on entering Desk", async () => {
      serve({});
      const ui = (index: number) => (
        <PageNavigationContext.Provider value={nav(index)}>
          <DeskPage />
        </PageNavigationContext.Provider>
      );
      const { rerender } = render(ui(0));
      await new Promise((r) => setTimeout(r, 20));
      expect(get).not.toHaveBeenCalled();
      rerender(ui(deskIndex));
      await screen.findByText("75 min today");
      expect(get).toHaveBeenCalledTimes(1);
    });
  });
});
