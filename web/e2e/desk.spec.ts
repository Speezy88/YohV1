/**
 * web/e2e/desk.spec.ts — Epic 12: the Desk page's widgets against the
 * fixture server's seeded records (no real Notion).
 */
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Mirrors the fixture's exports (`tests/e2e/fixture-server.ts`); not imported, because importing that file starts the fixture server.
const COMPLETED_TODAY = ["Desk seed today-3", "Desk seed today-2", "Desk seed today-1"] as const; // newest first

async function openDesk(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Desk", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Desk", level: 1 })).toBeVisible();
  await expect(page.getByText("75 min today")).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("page-desk").boundingBox())?.y).toBe(0);
}

test("the widgets show the seeded values", async ({ page }) => {
  await openDesk(page);
  const done = page.locator("section", { has: page.getByRole("heading", { name: "Tasks completed today" }) });
  await expect(done.getByRole("listitem")).toHaveText([...COMPLETED_TODAY]);
  await expect(done.locator("p").first()).toHaveText("3");
  await expect(page.getByText("75 min today")).toBeVisible();
  await expect(page.getByText("5 h with Yoh")).toBeVisible();
  await expect(page.getByText("50%", { exact: true })).toBeVisible();
  await expect(page.getByText("2 of 4 Tasks with a due date")).toBeVisible();
  await expect(page.getByText("Streak: 3 days · Longest: 5 days")).toBeVisible();
  await expect(page.getByText("$7.00")).toBeVisible();
  await expect(page.getByText("Desk isn't built yet.")).toHaveCount(0);
});

test("completed names are struck through and figures use tabular numerals", async ({ page }) => {
  await openDesk(page);
  const name = page.getByText(COMPLETED_TODAY[0], { exact: true });
  expect(await name.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  const figure = page.getByText("75 min today");
  expect(await figure.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
});

test("no horizontal page scroll at 390px or 1280px", async ({ page }) => {
  for (const [width, height] of [[390, 800], [1280, 800]] as const) {
    await page.setViewportSize({ width, height });
    await openDesk(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const deskOverflow = await page.getByTestId("page-desk").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(deskOverflow).toBeLessThanOrEqual(0);
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe passes in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openDesk(page);
    const results = await new AxeBuilder({ page }).include('[data-testid="page-desk"]').analyze();
    expect(results.violations).toEqual([]);
  });
}
