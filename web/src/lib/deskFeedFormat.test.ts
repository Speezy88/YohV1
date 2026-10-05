import { describe, it, expect } from "vitest";
import { formatChangePercent, formatFeedTime, formatUsdPrice, unavailableCaption } from "./deskFeedFormat.ts";

describe("formatUsdPrice", () => {
  it("shows whole dollars with a thousands separator at 1,000 and above", () => {
    expect(formatUsdPrice(67123.4)).toBe("$67,123");
    expect(formatUsdPrice(1000)).toBe("$1,000");
    expect(formatUsdPrice(3456.78)).toBe("$3,457");
  });
  it("shows cents below 1,000", () => {
    expect(formatUsdPrice(142.57)).toBe("$142.57");
    expect(formatUsdPrice(999.999)).toBe("$1,000.00");
    expect(formatUsdPrice(5)).toBe("$5.00");
  });
});

describe("formatChangePercent", () => {
  it("writes the sign in text", () => {
    expect(formatChangePercent(1.24)).toBe("+1.2%");
    expect(formatChangePercent(-0.8)).toBe("−0.8%");
  });
  it("shows no sign for a change that rounds to zero", () => {
    expect(formatChangePercent(0)).toBe("0.0%");
    expect(formatChangePercent(-0.04)).toBe("0.0%");
  });
  it("is empty for null", () => expect(formatChangePercent(null)).toBe(""));
});

describe("formatFeedTime", () => {
  it("formats in the given zone, not the browser's", () => {
    expect(formatFeedTime("2026-10-04T15:30:00.000Z", "UTC")).toBe("3:30 PM");
    expect(formatFeedTime("2026-10-04T15:30:00.000Z", "America/Los_Angeles")).toBe("8:30 AM");
  });
});

describe("unavailableCaption", () => {
  it("names the last update when there was one", () => expect(unavailableCaption("2026-10-04T15:30:00.000Z", "UTC")).toBe("Unavailable · last updated 3:30 PM"));
  it("is just Unavailable otherwise", () => expect(unavailableCaption(undefined, "UTC")).toBe("Unavailable"));
});
