import { describe, it, expect } from "vitest";
import { hostIsoDate, localHourMinute, localMinutesSinceMidnight, formatClockTime } from "./hostTime.ts";

describe("hostTime", () => {
  it("localHourMinute reads the wall-clock hour/minute in the given zone, not the browser's own zone", () => {
    // 22:00Z is 3:00 PM in America/Los_Angeles (PDT, UTC-7) in September.
    const date = new Date("2026-09-25T22:00:00.000Z");
    expect(localHourMinute(date, "America/Los_Angeles")).toEqual({ hour: 15, minute: 0 });
    // The SAME instant reads as a completely different wall-clock hour in UTC.
    expect(localHourMinute(date, "UTC")).toEqual({ hour: 22, minute: 0 });
  });

  it("handles a non-whole-hour offset zone", () => {
    // 2026-09-25T14:30:00Z is 8:00 PM in Asia/Kolkata (UTC+5:30).
    const date = new Date("2026-09-25T14:30:00.000Z");
    expect(localHourMinute(date, "Asia/Kolkata")).toEqual({ hour: 20, minute: 0 });
  });

  it("localMinutesSinceMidnight combines hour and minute", () => {
    const date = new Date("2026-09-25T22:15:00.000Z"); // 3:15 PM Los Angeles
    expect(localMinutesSinceMidnight(date, "America/Los_Angeles")).toBe(15 * 60 + 15);
  });

  it("formatClockTime renders 12-hour, no AM/PM, zero-padded minutes", () => {
    expect(formatClockTime(new Date("2026-09-25T17:00:00.000Z"), "UTC")).toBe("5:00");
    expect(formatClockTime(new Date("2026-09-25T00:00:00.000Z"), "UTC")).toBe("12:00");
    expect(formatClockTime(new Date("2026-09-25T13:05:00.000Z"), "UTC")).toBe("1:05");
  });
});

describe("hostIsoDate", () => {
  it("gives the date in the given zone, not the browser's", () => {
    const date = new Date("2026-10-05T03:00:00.000Z");
    expect(hostIsoDate(date, "America/Los_Angeles")).toBe("2026-10-04");
    expect(hostIsoDate(date, "UTC")).toBe("2026-10-05");
  });
});
