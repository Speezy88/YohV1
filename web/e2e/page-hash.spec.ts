import { test, expect } from "@playwright/test";

// P6-R12: the current page is kept in the URL hash.
test("reload stays on the page, Back returns to the previous one, and an unknown hash opens Home", async ({ page }) => {
  await page.goto("/#tasks");
  await expect(page.getByTestId("page-tasks")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("page-tasks")).toBeVisible();

  await page.getByRole("link", { name: "Memory" }).or(page.getByRole("button", { name: "Memory" })).first().click();
  await expect(page).toHaveURL(/#memory$/);
  await page.goBack();
  await expect(page).toHaveURL(/#tasks$/);
  await expect(page.getByTestId("page-tasks")).toBeVisible();

  await page.goto("/#nonsense");
  await expect(page.getByTestId("page-home")).toBeVisible();
  await expect(page).toHaveURL(/#home$/);
});
