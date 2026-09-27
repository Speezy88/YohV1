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

// Polish-4 addendum ("only tasks... when it is outside [a card], but still
// on the same page, it should be able to scroll between pages"): the
// wheel-nav opt-out now lives on the Tasks table region and bottom dock —
// never the page root — so a gesture over the table never pages, but one
// over the title area (open page space) still does.
test("wheel-scrolling up at the Tasks table's top edge does not change the active page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect.poll(async () => (await page.getByTestId("page-tasks").boundingBox())?.y).toBe(0);

  const tableBox = (await page.getByRole("region", { name: "All tasks" }).boundingBox())!;
  await page.mouse.move(tableBox.x + tableBox.width / 2, tableBox.y + 10);
  // Already at the top; a wheel-up gesture here would, pre-fix, hit the
  // "already at the scroll edge" case and page-navigate to Home instead.
  await page.mouse.wheel(0, -300);
  await page.mouse.wheel(0, -300);
  await expect(page.getByRole("button", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
});

test("wheel-scrolling over the Tasks title area (open page space) changes the active page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect.poll(async () => (await page.getByTestId("page-tasks").boundingBox())?.y).toBe(0);

  const titleBox = (await page.getByRole("heading", { name: "Tasks", level: 1 }).boundingBox())!;
  await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
  await page.mouse.wheel(0, -300);
  await expect(page.getByRole("button", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
});

test("wheel-scrolling over Home's Calendar card does not change the active page", async ({ page }) => {
  await page.goto("/");
  const calendarBox = (await page.getByRole("complementary", { name: "Calendar" }).boundingBox())!;
  await page.mouse.move(calendarBox.x + calendarBox.width / 2, calendarBox.y + calendarBox.height / 2);
  await page.mouse.wheel(0, 300);
  await page.mouse.wheel(0, 300);
  await expect(page.getByRole("button", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
});

test("wheel-scrolling over Home's greeting (open page space) changes the active page", async ({ page }) => {
  await page.goto("/");
  const greetingBox = (await page.getByTestId("home-greeting").boundingBox())!;
  await page.mouse.move(greetingBox.x + greetingBox.width / 2, greetingBox.y + greetingBox.height / 2);
  await page.mouse.wheel(0, 300);
  await expect(page.getByRole("button", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "page");
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
