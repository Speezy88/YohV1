/**
 * web/src/components/DeskNews.test.tsx — the Business and AI news widget's states (Ruling E12-R22).
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DeskNews } from "./DeskNews.tsx";
import type { DeskFeedsState } from "../lib/deskFeeds.ts";
import type { DeskFeedsResponse } from "../../../src/types/api.ts";

const AT = "2026-10-04T22:30:00.000Z";
const ITEMS = [
  { title: "Chipmaker's sales rise on AI demand", url: "https://example.org/a", source: "TechCrunch", publishedAt: "2026-10-04T21:10:00.000Z" },
  { title: "<b>Rates</b> & markets", url: "https://example.org/b", source: "NPR", publishedAt: "2026-10-04T18:00:00.000Z" },
] as const;
const loaded = (news: DeskFeedsResponse["news"]): DeskFeedsState => ({
  status: "loaded",
  value: { timeZone: "America/Los_Angeles", crypto: { status: "unavailable" }, weather: { status: "unavailable" }, news },
  loadedAt: new Date(AT),
});

describe("DeskNews", () => {
  it("ok: each row is a link by title, then source and date in the host zone", () => {
    render(<DeskNews state={loaded({ status: "ok", value: { items: ITEMS }, fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.getByRole("heading", { name: "Business and AI news" })).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Chipmaker's sales rise on AI demandTechCrunch · Oct 4, 2:10 PM");
    expect(rows[1]).toHaveTextContent("NPR · Oct 4, 11:00 AM");
  });

  it("links open in a new tab with noopener noreferrer and are named by the title", () => {
    render(<DeskNews state={loaded({ status: "ok", value: { items: ITEMS }, fetchedAt: AT })} reducedMotion={false} />);
    const link = screen.getByRole("link", { name: "Chipmaker's sales rise on AI demand" });
    expect(link).toHaveAttribute("href", "https://example.org/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("titles are text, never HTML", () => {
    const { container } = render(<DeskNews state={loaded({ status: "ok", value: { items: ITEMS }, fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.getByRole("link", { name: "<b>Rates</b> & markets" })).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
  });

  it("stale: rows stay and the unavailable line shows in ink-secondary", () => {
    render(<DeskNews state={loaded({ status: "stale", value: { items: ITEMS }, fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Unavailable · last updated 3:30 PM").className).toContain("text-ink-secondary");
  });

  it("unavailable: only the line", () => {
    const { unmount } = render(<DeskNews state={loaded({ status: "unavailable", fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.getByText("Unavailable · last updated 3:30 PM")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
    unmount();
    render(<DeskNews state={loaded({ status: "unavailable" })} reducedMotion={false} />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("loading: a skeleton card, no heading", () => {
    render(<DeskNews state={{ status: "loading" }} reducedMotion={false} />);
    expect(screen.getByTestId("desk-widget-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("request failed: Unavailable in the widget", () => {
    render(<DeskNews state={{ status: "error", message: "x" }} reducedMotion={false} />);
    const card = screen.getByRole("heading", { name: "Business and AI news" }).closest("section")!;
    expect(within(card).getByText("Unavailable")).toBeInTheDocument();
  });
});
