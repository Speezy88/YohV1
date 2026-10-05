import { describe, it, expect } from "vitest";
import { formatChangePercent, formatFeedDateTime, formatFeedStamp, formatFeedTime, formatUsdPrice, unavailableCaption } from "./deskFeedFormat.ts";

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
  const NOW = new Date("2026-10-04T20:00:00.000Z");
  it("names the last update when there was one", () => expect(unavailableCaption("2026-10-04T15:30:00.000Z", "UTC", NOW)).toBe("Unavailable · last updated 3:30 PM"));
  it("carries the date when the update is not from the host's today", () => expect(unavailableCaption("2026-10-03T15:30:00.000Z", "UTC", NOW)).toBe("Unavailable · last updated Oct 3, 3:30 PM"));
  it("is just Unavailable otherwise", () => expect(unavailableCaption(undefined, "UTC")).toBe("Unavailable"));
});

describe("formatFeedDateTime", () => {
  it("is Mon D, h:mm AM/PM in the given zone", () => {
    expect(formatFeedDateTime("2026-10-04T21:10:00.000Z", "UTC")).toBe("Oct 4, 9:10 PM");
    expect(formatFeedDateTime("2026-10-04T21:10:00.000Z", "America/Los_Angeles")).toBe("Oct 4, 2:10 PM");
    expect(formatFeedDateTime("2026-10-05T02:10:00.000Z", "America/Los_Angeles")).toBe("Oct 4, 7:10 PM");
  });
});

describe("formatFeedStamp", () => {
  it("is the time for the host's today and date and time otherwise, in the host zone", () => {
    const now = new Date("2026-10-04T20:00:00.000Z");
    expect(formatFeedStamp("2026-10-04T15:30:00.000Z", "UTC", now)).toBe("3:30 PM");
    expect(formatFeedStamp("2026-10-03T15:30:00.000Z", "UTC", now)).toBe("Oct 3, 3:30 PM");
    // 02:00Z on Oct 5 is still Oct 4 in Los Angeles, as is `now`.
    expect(formatFeedStamp("2026-10-05T02:00:00.000Z", "America/Los_Angeles", now)).toBe("7:00 PM");
    expect(formatFeedStamp("2026-10-04T05:00:00.000Z", "America/Los_Angeles", now)).toBe("Oct 3, 10:00 PM");
  });
});
