import { test, expect } from "@playwright/test";

test("the app loads, titled Yoh, with the CSP header set", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toBe("default-src 'self'");
  await expect(page).toHaveTitle(/Yoh/);
});
