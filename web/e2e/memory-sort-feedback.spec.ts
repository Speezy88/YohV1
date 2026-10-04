/**
 * web/e2e/memory-sort-feedback.spec.ts — sorting feedback on the Memory page against the fixture
 * server's seeded items: the "more" menu opens the panel, a Wrong verdict with a folder and a
 * reason is saved and shown on the card, it survives a reload, and the open panel passes axe.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_MEMORY_ITEMS } from "../../tests/e2e/fixture-memory-seed.ts";

const ITEM = FIXTURE_MEMORY_ITEMS.find((m) => m.key === "inferred")!;
const REASON = "It is a scheduling habit, not a loose note.";
const rowOf = (page: Page, text: string) => page.getByTestId("memory-item").filter({ hasText: text });

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
  expect((await request.post("/__fixture/seed-memory")).ok()).toBe(true);
});

async function openFolder(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Memory", level: 1 })).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("page-memory").boundingBox())?.y).toBe(0);
  await page.getByRole("navigation", { name: "Memory" }).getByRole("button", { name: /^Ideas & notes/ }).click();
}

/** Axe reads the blended color of a fading element; let entrance fades finish first. */
async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
}

test("mark a folder wrong with a reason: it saves, shows on the card and survives a reload", async ({ page }) => {
  await openFolder(page);
  await page.getByRole("button", { name: `More actions for ${ITEM.text}` }).click();
  await page.getByRole("menuitem", { name: "Sorting feedback" }).click();
  const panel = page.getByRole("group", { name: "Is Ideas & notes the right folder for this?" });
  await expect(panel.getByRole("button", { name: "Right" })).toBeFocused();
  await expect(panel.getByRole("button", { name: "Save" })).toBeDisabled();

  await panel.getByRole("button", { name: "Wrong" }).click();
  await panel.getByRole("combobox", { name: "Belongs in (optional)" }).selectOption({ label: "Patterns" });
  await panel.getByRole("textbox", { name: "Why" }).fill(REASON);
  await settleAnimations(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);

  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel).toHaveCount(0);
  const row = rowOf(page, ITEM.text);
  await expect(row).toContainText("Saved");
  await expect(row.getByTestId("memory-sort-feedback")).toHaveText(`Folder marked wrong · Belongs in Patterns · ${REASON}`);
  // The item itself stays where it was.
  await expect(row).toBeVisible();

  await page.reload();
  await expect(rowOf(page, ITEM.text).getByTestId("memory-sort-feedback")).toContainText(REASON);
});

test("Esc closes the panel and nothing is saved", async ({ page }) => {
  await openFolder(page);
  await page.getByRole("button", { name: `More actions for ${ITEM.text}` }).click();
  await page.getByRole("menuitem", { name: "Sorting feedback" }).click();
  await page.getByRole("button", { name: "Right" }).click();
  await page.getByRole("textbox", { name: "Why" }).fill("never sent");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: /right folder for this/ })).toHaveCount(0);
  await expect(rowOf(page, ITEM.text).getByTestId("memory-sort-feedback")).toHaveCount(0);
});
