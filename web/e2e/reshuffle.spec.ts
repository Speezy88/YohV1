/**
 * web/e2e/reshuffle.spec.ts — Epic 10 T8b: drag a Plan block on Home's
 * calendar -> a reshuffle preview appears -> Approve -> the Plan reorders.
 *
 * Isolation: the fixture server's fixture-only `POST /__fixture/reshuffle-scenario`
 * pins the plan clock to today 06:00 UTC and seeds a deterministic Plan and
 * Task set; `POST /__fixture/reset` restores the default Plan, clock and
 * Tasks. The spec resets before and after, so check-off, home-layout and
 * missing-data specs (one shared worker, config `workers: 1`) never see it.
 */
import { expect, test, type Page } from "@playwright/test";

async function post(page: Page, path: string): Promise<void> {
  const res = await page.request.post(path);
  expect(res.ok()).toBe(true);
}

test.beforeEach(async ({ page }) => post(page, "/__fixture/reshuffle-scenario"));
test.afterEach(async ({ page }) => post(page, "/__fixture/reset"));

test("drag a work block later -> preview -> Approve -> the Plan reorders", async ({ page }) => {
  await page.goto("/");
  const rows = page.getByRole("checkbox");
  await expect(rows.first()).toHaveAccessibleName("Reshuffle Alpha");

  const alpha = page.getByTestId("calendar-block").filter({ hasText: "Reshuffle Alpha" });
  await alpha.scrollIntoViewIfNeeded();
  const box = (await alpha.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 20, { steps: 4 });
  await page.mouse.move(x, y + 72 * 3, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
  const previewAlpha = page.getByTestId("calendar-block").filter({ hasText: "Reshuffle Alpha" }).first();
  await expect(previewAlpha).toHaveAttribute("data-moved", "true");
  // Drags are blocked while a preview is open.
  await expect(previewAlpha).not.toHaveAttribute("data-draggable", "true");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(rows.first()).toHaveAccessibleName("Reshuffle Beta");
});

test("a block can be moved with the keyboard", async ({ page }) => {
  await page.goto("/");
  const alpha = page.getByTestId("calendar-block").filter({ hasText: "Reshuffle Alpha" });
  await alpha.scrollIntoViewIfNeeded();
  await alpha.focus();
  await page.keyboard.press("Space");
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
});
