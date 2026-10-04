/**
 * web/src/lib/activity.test.ts: the activity ping (Ruling E12-R14). Only a real
 * pointerdown or keydown sends it, once per host day.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./apiClient.ts";
import { __resetActivityForTests, startActivityPing } from "./activity.ts";

vi.mock("./apiClient.ts", () => ({ apiClient: { api: { activity: { $post: vi.fn() } } } }));

const post = apiClient.api.activity.$post as unknown as ReturnType<typeof vi.fn>;
const ok = (date: string, timeZone = "America/Los_Angeles") => ({ json: async () => ({ ok: true, value: { date, timeZone } }) });
const input = (type = "pointerdown"): void => void window.dispatchEvent(new Event(type));
const flush = async (): Promise<void> => void (await vi.advanceTimersByTimeAsync(0));

describe("activity ping", () => {
  let stop: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T18:00:00.000Z")); // 11:00 on the 4th in LA
    post.mockReset();
    __resetActivityForTests();
    stop = startActivityPing();
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("sends nothing without input, however much time passes", async () => {
    post.mockResolvedValue(ok("2026-10-04"));
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(post).not.toHaveBeenCalled();
  });

  it("pings on the first input and not on later inputs the same host day", async () => {
    post.mockResolvedValue(ok("2026-10-04"));
    input();
    await flush();
    input("keydown");
    input();
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ json: {} });
  });

  it("pings again on the first input after the host day changes, using the returned zone", async () => {
    post.mockResolvedValue(ok("2026-10-04"));
    input();
    await flush();
    // 06:00Z on the 5th is still the 4th in LA, so no ping; it would be the 5th in UTC.
    vi.setSystemTime(new Date("2026-10-05T06:00:00.000Z"));
    input();
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-05T08:00:00.000Z")); // 01:00 on the 5th in LA
    post.mockResolvedValue(ok("2026-10-05"));
    input();
    await flush();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("retries on the next input after a failed ping, with no timer", async () => {
    post.mockRejectedValueOnce(new Error("offline"));
    input();
    await flush();
    post.mockResolvedValueOnce({ json: async () => ({ ok: false, error: { kind: "unreachable", message: "x" } }) });
    input();
    await flush();
    post.mockResolvedValue(ok("2026-10-04"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(post).toHaveBeenCalledTimes(2);
    input();
    await flush();
    expect(post).toHaveBeenCalledTimes(3);
    input();
    await flush();
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("two quick inputs send one ping", async () => {
    post.mockResolvedValue(ok("2026-10-04"));
    input();
    input("keydown");
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
