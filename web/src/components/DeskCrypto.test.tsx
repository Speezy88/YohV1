/**
 * web/src/components/DeskCrypto.test.tsx — the Crypto widget's states (Ruling E12-R22).
 */
import { describe, it, expect } from "vitest";
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
const loaded = (crypto: DeskFeedsResponse["crypto"]): DeskFeedsState => ({ status: "loaded", value: { timeZone: "UTC", crypto }, loadedAt: new Date(AT) });
const rows = () => within(screen.getByRole("list")).getAllByRole("listitem").map((r) => r.textContent);

describe("DeskCrypto", () => {
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
});
