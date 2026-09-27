import { describe, it, expect, afterEach } from "vitest";
import { loadCalendarView, saveCalendarView } from "./calendarView.ts";

describe("calendarView", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to 'day' with nothing stored", () => {
    expect(loadCalendarView()).toBe("day");
  });

  it("round-trips 'month' through save/load", () => {
    saveCalendarView("month");
    expect(loadCalendarView()).toBe("month");
  });

  it("round-trips back to 'day'", () => {
    saveCalendarView("month");
    saveCalendarView("day");
    expect(loadCalendarView()).toBe("day");
  });

  it("falls back to 'day' for a garbage stored value", () => {
    window.localStorage.setItem("yoh.home.calendarView", "nonsense");
    expect(loadCalendarView()).toBe("day");
  });

  it("falls back to 'day' when localStorage.getItem throws", () => {
    const original = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("blocked");
    };
    expect(loadCalendarView()).toBe("day");
    window.localStorage.getItem = original;
  });

  it("saveCalendarView swallows a thrown setItem — never crashes the caller", () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("blocked");
    };
    expect(() => saveCalendarView("month")).not.toThrow();
    window.localStorage.setItem = original;
  });
});
