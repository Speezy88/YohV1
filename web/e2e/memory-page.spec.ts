/**
 * web/e2e/memory-page.spec.ts — Story 13.9 (T10b): the Memory page against
 * the fixture server's seeded memory items and two Conversations
 * (`POST /__fixture/seed-memory`). Rail counts, an item's meta line, search
 * over items and chat turns, Esc, delete-with-Undo, "source deleted",
 * "View in Memory" from a receipt, and axe in light and dark.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_CONVERSATIONS, FIXTURE_MEMORY_ITEMS } from "../../tests/e2e/fixture-memory-seed.ts";

const ITEM = (key: string) => FIXTURE_MEMORY_ITEMS.find((m) => m.key === key)!;

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
  const seeded = await request.post("/__fixture/seed-memory");
  expect(seeded.ok()).toBe(true);
});

async function openMemory(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Memory", level: 1 })).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("page-memory").boundingBox())?.y).toBe(0);
}

/** Axe reads the blended color of a fading element; let entrance fades finish first. */
async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
}

const rail = (page: Page) => page.getByRole("navigation", { name: "Memory" });

test("Memory is page 5 of 5, and the rail shows counts with Needs review for the expired item", async ({ page }) => {
  await openMemory(page);
  await expect(page.getByText("Memory, page 5 of 5")).toBeAttached();
  await expect(rail(page).getByRole("button", { name: /^Needs review/ })).toContainText("1");
  await expect(rail(page).getByRole("button", { name: /^Goals & projects/ })).toContainText("2");
  await expect(rail(page).getByRole("button", { name: /^About you/ })).toContainText("1");
  await expect(rail(page).getByRole("button", { name: /^Chat history/ })).toBeVisible();
});

test("an item shows its meta line: origin, scope", async ({ page }) => {
  await openMemory(page);
  await rail(page).getByRole("button", { name: /^Feedback/ }).click();
  const row = page.getByTestId("memory-item").filter({ hasText: ITEM("feedback").text });
  await expect(row).toContainText("Stated");
  await expect(row).toContainText("mornings");
  await rail(page).getByRole("button", { name: /^Ideas & notes/ }).click();
  await expect(page.getByTestId("memory-item").filter({ hasText: ITEM("inferred").text })).toContainText("Inferred");
});

test("search finds a memory and a chat turn, each showing its folder or Conversation date; Esc clears", async ({ page }) => {
  await openMemory(page);
  const box = page.getByRole("searchbox", { name: "Search memory" });
  await box.fill("chemistry");
  const turnText = FIXTURE_CONVERSATIONS[1]!.turns[0]!.text;
  const turnHit = page.getByRole("button", { name: new RegExp(turnText.slice(0, 20), "i") });
  await expect(turnHit.first()).toBeVisible();
  await expect(turnHit.first()).toContainText("Conversation");
  await box.fill("school");
  const itemHit = page.getByRole("button", { name: new RegExp(ITEM("about").text) });
  await expect(itemHit).toBeVisible();
  await expect(itemHit).toContainText("About you");
  await box.press("Escape");
  await expect(box).toHaveValue("");
  await expect(itemHit).toHaveCount(0);
});

test("delete conversation: Undo cancels; letting it close commits, and the memory's source shows 'source deleted'", async ({ page }) => {
  await openMemory(page);
  await rail(page).getByRole("button", { name: /^Chat history/ }).click();
  const rows = page.getByRole("list", { name: "Conversations" }).getByRole("button");
  await expect(rows).toHaveCount(2);
  await rows.first().click();
  await page.getByRole("button", { name: "Delete conversation" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Delete conversation" })).toHaveCount(0);
  await expect(rows).toHaveCount(2);

  await rows.first().click();
  await page.getByRole("button", { name: "Delete conversation" }).click();
  await expect(page.getByTestId("undo-toast")).toContainText("Deleted conversation");
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId("undo-toast")).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(async () => (await page.request.get("/api/chat-history")).json().then((b) => b.value.conversations.length), { timeout: 15_000 }).toBe(1);

  await rail(page).getByRole("button", { name: /^About you/ }).click();
  await expect(page.getByTestId("memory-item").filter({ hasText: ITEM("about").text })).toContainText("source deleted");
});

test("a Conversation opens read-only, with its Remembered Receipt and no actions", async ({ page }) => {
  await openMemory(page);
  await rail(page).getByRole("button", { name: /^Chat history/ }).click();
  await page.getByRole("list", { name: "Conversations" }).getByRole("button").first().click();
  await expect(page.getByTestId("transcript-turn")).toHaveCount(FIXTURE_CONVERSATIONS[0]!.turns.length);
  const receipt = page.getByTestId("remembered-receipt");
  await expect(receipt).toContainText("Remembered:");
  await expect(receipt.getByRole("button")).toHaveCount(0);
});

test("View in Memory on a receipt opens the Memory page on that item", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /ask yoh/i }).click();
  const chat = page.getByTestId("chat-panel");
  const input = chat.getByRole("combobox", { name: "Message Yoh" });
  await input.fill("remember that Chem club is a club, not a class");
  await input.press("Enter");
  await expect(chat.getByTestId("remembered-receipt")).toContainText("Remembered:", { timeout: 10_000 });
  await input.fill("thanks");
  await input.press("Enter");
  await chat.getByRole("button", { name: "View in Memory" }).click();
  await expect.poll(async () => (await page.getByTestId("page-memory").boundingBox())?.y).toBe(0);
  await expect(page.locator('[data-testid="memory-item"]', { hasText: "Chem club is a club, not a class" })).toBeAttached();
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe: no violations on the Memory page in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openMemory(page);
    await expect(page.getByTestId("memory-item").first()).toBeVisible();
    await settleAnimations(page);
    const results = await new AxeBuilder({ page }).include('[data-testid="page-memory"]').analyze();
    expect(results.violations).toEqual([]);
    await rail(page).getByRole("button", { name: /^Chat history/ }).click();
    await page.getByRole("list", { name: "Conversations" }).getByRole("button").first().click();
    await expect(page.getByTestId("transcript-turn").first()).toBeVisible();
    await settleAnimations(page);
    const history = await new AxeBuilder({ page }).include('[data-testid="page-memory"]').analyze();
    expect(history.violations).toEqual([]);
  });
}
