/**
 * web/src/pages/Desk.test.tsx — the Desk page's five widgets (Ruling E12-R9 copy),
 * their zero states, the skeleton and the error + retry. `GET /api/desk` is
 * mocked at the one RPC client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import DeskPage from "./Desk.tsx";
import { apiClient } from "../lib/apiClient.ts";
import { __resetDeskForTests } from "../lib/desk.ts";
import type { DeskResponse } from "../../../src/types/api.ts";

vi.mock("../lib/apiClient.ts", () => ({ apiClient: { api: { desk: { $get: vi.fn() } } } }));
const get = apiClient.api.desk.$get as unknown as ReturnType<typeof vi.fn>;

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
    get.mockReset();
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
    expect(screen.getByLabelText("No on-time rate yet")).toHaveTextContent("—");
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

  it("shows skeleton cards while loading", () => {
    get.mockReturnValue(new Promise(() => {}));
    render(<DeskPage />);
    expect(screen.getAllByTestId("desk-widget-skeleton").length).toBe(5);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
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
});
