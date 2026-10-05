/**
 * web/src/components/DeskWeather.test.tsx — the Weather widget's states (Ruling E12-R22).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeskWeather } from "./DeskWeather.tsx";
import type { DeskFeedsState } from "../lib/deskFeeds.ts";
import type { DeskFeedsResponse } from "../../../src/types/api.ts";

const AT = "2026-10-04T22:30:00.000Z";
const VALUE = { location: "Seattle, WA", temperatureF: 58, conditions: "Partly Cloudy", next: { name: "Tonight", temperatureF: 49, summary: "Mostly Clear" } };
const loaded = (weather: DeskFeedsResponse["weather"], timeZone = "America/Los_Angeles"): DeskFeedsState => ({
  status: "loaded",
  value: { timeZone, crypto: { status: "unavailable" }, weather, news: { status: "unavailable" } },
  loadedAt: new Date(AT),
});

describe("DeskWeather", () => {
  // The widget compares the value's date with today: pin today to the value's day.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(AT));
  });
  afterEach(() => vi.useRealTimers());

  it("ok: figure, conditions, next period and the caption in the host zone", () => {
    render(<DeskWeather state={loaded({ status: "ok", value: VALUE, fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.getByRole("heading", { name: "Weather · Seattle, WA" })).toBeInTheDocument();
    expect(screen.getByText("58°F")).toBeInTheDocument();
    expect(screen.getByText("Partly Cloudy")).toBeInTheDocument();
    expect(screen.getByText("Tonight: 49°F, Mostly Clear")).toBeInTheDocument();
    expect(screen.getByText("National Weather Service · updated 3:30 PM")).toBeInTheDocument();
  });

  it("the caption uses the response's time zone", () => {
    render(<DeskWeather state={loaded({ status: "ok", value: VALUE, fetchedAt: AT }, "UTC")} reducedMotion={false} />);
    expect(screen.getByText("National Weather Service · updated 10:30 PM")).toBeInTheDocument();
  });

  it("a null next shows no next line", () => {
    render(<DeskWeather state={loaded({ status: "ok", value: { ...VALUE, next: null }, fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.queryByText(/Tonight/)).toBeNull();
  });

  it("stale: values stay and the caption is the unavailable line in ink-secondary", () => {
    render(<DeskWeather state={loaded({ status: "stale", value: VALUE, fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.getByText("58°F")).toBeInTheDocument();
    expect(screen.getByText("Unavailable · last updated 3:30 PM").className).toContain("text-ink-secondary");
    expect(screen.queryByText(/National Weather Service/)).toBeNull();
  });

  it("unavailable: only the line, with the last update when an expired value existed", () => {
    const { unmount } = render(<DeskWeather state={loaded({ status: "unavailable", fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.getByText("Unavailable · last updated 3:30 PM")).toBeInTheDocument();
    expect(screen.queryByText("58°F")).toBeNull();
    unmount();
    render(<DeskWeather state={loaded({ status: "unavailable" })} reducedMotion={false} />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("loading: a skeleton card, no heading", () => {
    render(<DeskWeather state={{ status: "loading" }} reducedMotion={false} />);
    expect(screen.getByTestId("desk-widget-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("request failed: Unavailable in the widget", () => {
    render(<DeskWeather state={{ status: "error", message: "x" }} reducedMotion={false} />);
    expect(screen.getByRole("heading", { name: "Weather · Seattle, WA" })).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("E12-R23: an ok caption from an earlier day carries the date; today's does not", () => {
    vi.setSystemTime(new Date("2026-10-05T09:00:00.000Z"));
    const { unmount } = render(<DeskWeather state={loaded({ status: "ok", value: VALUE, fetchedAt: AT }, "UTC")} reducedMotion={false} />);
    expect(screen.getByText(/updated Oct 4, /)).toBeInTheDocument();
    unmount();
    vi.setSystemTime(new Date(AT));
    render(<DeskWeather state={loaded({ status: "ok", value: VALUE, fetchedAt: AT }, "UTC")} reducedMotion={false} />);
    expect(screen.queryByText(/updated Oct/)).toBeNull();
  });

  it("E12-R23: the unavailable line from an earlier day carries the date", () => {
    vi.setSystemTime(new Date("2026-10-07T09:00:00.000Z"));
    render(<DeskWeather state={loaded({ status: "unavailable", fetchedAt: AT })} reducedMotion={false} />);
    expect(screen.getByText(/Unavailable · last updated Oct 4, /)).toBeInTheDocument();
  });
});
