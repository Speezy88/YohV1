/**
 * web/e2e/memory-receipt.spec.ts — Story 13.4: "remember that ..." files
 * through the fixture server's memory LLM seam (`FIXTURE_MEMORY_TEXT`), the
 * Remembered Receipt appears under the reply, Undo removes it, and the next
 * message closes the Undo window.
 */
import { expect, test, type Page } from "@playwright/test";

const REMEMBER = "remember that Chem club is a club, not a class";
const LINE = "Remembered: Chem club is a club, not a class · Corrections · Undo";

async function openChat(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /ask yoh/i }).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
});

test("remember shows the receipt line and Undo removes it", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  const input = chat.getByRole("textbox", { name: "Message Yoh" });
  await input.fill(REMEMBER);
  await input.press("Enter");

  const receipt = chat.getByTestId("remembered-receipt");
  await expect(receipt).toHaveText(LINE, { timeout: 10_000 });
  await receipt.getByRole("button", { name: "Undo" }).click();
  await expect(receipt).toHaveText("Removed from memory.");
  await expect(chat.getByRole("button", { name: "Undo" })).toHaveCount(0);
});

test("after another message the line no longer offers Undo", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  const input = chat.getByRole("textbox", { name: "Message Yoh" });
  await input.fill(REMEMBER);
  await input.press("Enter");
  await expect(chat.getByTestId("remembered-receipt")).toHaveText(LINE, { timeout: 10_000 });

  await input.fill("Thanks");
  await input.press("Enter");
  await expect(chat.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(chat.getByTestId("remembered-receipt")).toHaveText("Remembered: Chem club is a club, not a class · Corrections");
});
