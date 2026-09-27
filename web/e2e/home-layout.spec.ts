/**
 * web/e2e/home-layout.spec.ts — Polish-2 (Spencer's live-app report at
 * 1440x760: "the google calendar visualization overlaps with the search
 * tasks and tasks filtering section", "I do not want to be able to scroll
 * pages while my cursor is in the tasks section"). Both are real bugs seen
 * at a real, short viewport — this suite runs at that exact size, against
 * `tests/e2e/fixture-server.ts` (port 8788, never the live app's 8787).
 */
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 760 } });

test("no page bleed: after Home -> Tasks, the Tasks search box is not covered by any Home element", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  // The vertical page slide (--duration-page-transition) has settled: geometry is final.
  await expect.poll(async () => (await page.getByTestId("page-tasks").boundingBox())?.y).toBe(0);

  const search = page.getByRole("searchbox", { name: "Search tasks" });
  await expect(search).toBeVisible();
  const box = (await search.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const resolvesInsideTasks = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest('[data-testid="page-tasks"]') != null;
  }, center);
  expect(resolvesInsideTasks).toBe(true);

  // The Due/Area/Status grouping control (the other element Spencer's report named) is also unobstructed.
  const grouping = page.getByRole("group", { name: "Group by" });
  await expect(grouping).toBeVisible();
  const groupBox = (await grouping.boundingBox())!;
  const groupCenter = { x: groupBox.x + groupBox.width / 2, y: groupBox.y + groupBox.height / 2 };
  const groupResolvesInsideTasks = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest('[data-testid="page-tasks"]') != null;
  }, groupCenter);
  expect(groupResolvesInsideTasks).toBe(true);
});

test("Polish-3: the Tasks quick-add input sits below the table region and isn't covered by the Ask Yoh pill", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect.poll(async () => (await page.getByTestId("page-tasks").boundingBox())?.y).toBe(0);

  const table = page.getByRole("region", { name: "All tasks" });
  const quickAdd = page.getByRole("textbox", { name: "New task" });
  await expect(table).toBeVisible();
  await expect(quickAdd).toBeVisible();
  const tableBox = (await table.boundingBox())!;
  const inputBox = (await quickAdd.boundingBox())!;
  expect(inputBox.y).toBeGreaterThanOrEqual(tableBox.y + tableBox.height);

  const center = { x: inputBox.x + inputBox.width / 2, y: inputBox.y + inputBox.height / 2 };
  const resolvesToInput = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[aria-label="New task"]') != null, center);
  expect(resolvesToInput).toBe(true);
});

test("wheel-scrolling up at the Tasks list's top edge does not change the active page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect.poll(async () => (await page.getByTestId("page-tasks").boundingBox())?.y).toBe(0);

  const tasksBox = (await page.getByTestId("page-tasks").boundingBox())!;
  await page.mouse.move(tasksBox.x + tasksBox.width / 2, tasksBox.y + tasksBox.height / 2);
  // Already at the top; a wheel-up gesture here would, pre-fix, hit the
  // "already at the scroll edge" case and page-navigate to Home instead.
  await page.mouse.wheel(0, -300);
  await page.mouse.wheel(0, -300);
  await expect(page.getByRole("button", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
});

test("Home's calendar panel defaults to Day and switches to Month", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("group", { name: "Calendar view" });
  await expect(page.getByTestId("calendar-day-view")).toBeVisible();
  await toggle.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.getByTestId("calendar-day-view")).not.toBeVisible();
  await toggle.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page.getByTestId("calendar-day-view")).toBeVisible();
});
