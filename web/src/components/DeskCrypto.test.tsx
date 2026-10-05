/**
 * web/src/components/DeskCrypto.test.tsx — the Crypto widget's states (Ruling E12-R22).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DeskCrypto } from "./DeskCrypto.tsx";
import type { DeskFeedsState } from "../lib/deskFeeds.ts";
import type { DeskFeedsResponse } from "../../../src/types/api.ts";

const TICKERS = [
  { symbol: "BTC", priceUsd: 67123.4, changePercent: 1.2 },
  { symbol: "SOL", priceUsd: 142.57, changePercent: -0.8 },
  { symbol: "ETH", priceUsd: 3456.78, changePercent: null },
] as const;
const AT = "2026-10-04T15:30:00.000Z";
const loaded = (crypto: DeskFeedsResponse["crypto"]): DeskFeedsState => ({ status: "loaded", value: { timeZone: "UTC", crypto, weather: { status: "unavailable" }, news: { status: "unavailable" } }, loadedAt: new Date(AT) });
const rows = () => within(screen.getByRole("list")).getAllByRole("listitem").map((r) => r.textContent);

describe("DeskCrypto", () => {
  // The widget compares the value's date with today: pin today to the value's day.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(AT));
  });
  afterEach(() => vi.useRealTimers());

  it("ok: a row per coin with price and signed change, and the source caption", () => {
    render(<DeskCrypto state={loaded({ status: "ok", value: { tickers: TICKERS }, fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.getByRole("heading", { name: "Crypto" })).toBeInTheDocument();
    expect(rows()).toEqual(["BTC$67,123+1.2%", "SOL$142.57−0.8%", "ETH$3,457"]);
    expect(screen.getByText("Kraken · change since 00:00 UTC · updated 3:30 PM")).toBeInTheDocument();
  });

  it("a null change shows nothing for that coin", () => {
    render(<DeskCrypto state={loaded({ status: "ok", value: { tickers: TICKERS }, fetchedAt: AT })} reducedMotion={false} />);
    expect(rows()[2]).toBe("ETH$3,457");
  });

  it("stale: values stay and the caption is the unavailable line in ink-secondary", () => {
    render(<DeskCrypto state={loaded({ status: "stale", value: { tickers: TICKERS }, fetchedAt: AT })} reducedMotion={false} />);
    expect(rows()).toHaveLength(3);
    const caption = screen.getByText("Unavailable · last updated 3:30 PM");
    expect(caption.className).toContain("text-ink-secondary");
    expect(screen.queryByText(/Kraken ·/)).toBeNull();
  });

  it("unavailable with an expired value: the last-updated line and no rows", () => {
    render(<DeskCrypto state={loaded({ status: "unavailable", fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.getByText("Unavailable · last updated 3:30 PM")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("unavailable with no value: only Unavailable", () => {
    render(<DeskCrypto state={loaded({ status: "unavailable" })} reducedMotion={false} />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("loading: a skeleton card, no heading", () => {
    render(<DeskCrypto state={{ status: "loading" }} reducedMotion={false} />);
    expect(screen.getByTestId("desk-widget-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("request failed: Unavailable in the widget", () => {
    render(<DeskCrypto state={{ status: "error", message: "x" }} reducedMotion={false} />);
    expect(screen.getByRole("heading", { name: "Crypto" })).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("E12-R23: an ok caption from an earlier day carries the date; today's does not", () => {
    vi.setSystemTime(new Date("2026-10-05T09:00:00.000Z"));
    const { unmount } = render(<DeskCrypto state={loaded({ status: "ok", value: { tickers: TICKERS }, fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.getByText(/updated Oct 4, /)).toBeInTheDocument();
    unmount();
    vi.setSystemTime(new Date(AT));
    render(<DeskCrypto state={loaded({ status: "ok", value: { tickers: TICKERS }, fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.queryByText(/updated Oct/)).toBeNull();
  });

  it("E12-R23: the unavailable line from an earlier day carries the date", () => {
    vi.setSystemTime(new Date("2026-10-07T09:00:00.000Z"));
    render(<DeskCrypto state={loaded({ status: "unavailable", fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.getByText(/Unavailable · last updated Oct 4, /)).toBeInTheDocument();
  });
});
