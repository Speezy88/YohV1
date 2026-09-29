/**
 * web/e2e/plan-calendar-sync.spec.ts — a Yoh Plan calendar edit reaches Home
 * without a reload: the fixture moves the first work block's event 60 minutes
 * later, then the sync route runs (the timed sweep is off in the fixture) and
 * Home shows the Task at its new time.
 */
import { expect, test, type Page } from "@playwright/test";

async function post(page: Page, path: string, data?: unknown): Promise<void> {
  const res = await page.request.post(path, data === undefined ? {} : { data });
  expect(res.ok()).toBe(true);
}

test.beforeEach(async ({ page }) => post(page, "/__fixture/reshuffle-scenario"));
test.afterEach(async ({ page }) => {
  // The sync raises a "re-fit" notification; mark it read so later specs (one shared fixture) start clean.
  const listed = (await (await page.request.get("/api/notifications")).json()) as { ok: boolean; value?: Array<{ id: string }> | { notifications: Array<{ id: string }> } };
  const items = Array.isArray(listed.value) ? listed.value : (listed.value?.notifications ?? []);
  for (const n of items) await page.request.post(`/api/notifications/${n.id}/read`);
  await post(page, "/__fixture/reset");
});

test("moving a block's event on the Yoh Plan calendar moves it on Home after a sync", async ({ page }) => {
  await page.goto("/");
  const alpha = page.getByTestId("calendar-block").filter({ hasText: "Reshuffle Alpha" });
  await alpha.scrollIntoViewIfNeeded();
  await expect(alpha).toContainText("9:00");

  const events = (await (await page.request.get("/__fixture/yoh-plan-events")).json()) as Array<{ eventId: string; blockId?: string; title: string; start: string; end: string }>;
  const later = (iso: string): string => new Date(new Date(iso).getTime() + 60 * 60_000).toISOString();
  const moved = events.map((e) => (e.title === "Reshuffle Alpha" ? { ...e, start: later(e.start), end: later(e.end) } : e));
  await post(page, "/__fixture/yoh-plan-events", moved);

  const sync = await page.request.post("/api/plan/sync");
  expect(sync.ok()).toBe(true);
  expect(await sync.json()).toMatchObject({ ok: true, value: { status: "applied" } });

  const after = page.getByTestId("calendar-block").filter({ hasText: "Reshuffle Alpha" });
  await expect(after).toContainText("10:00");
  await expect(after).not.toContainText("9:00");
});
