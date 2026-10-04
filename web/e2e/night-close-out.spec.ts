/**
 * web/e2e/night-close-out.spec.ts — the close-out's final "anything else?" step.
 * The fixture server runs the REAL startNightCloseOut and answerOpenItem.
 */
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
});

test("/night ends by asking for anything else; Nothing else closes out", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /ask yoh/i }).click();
  const chat = page.getByTestId("chat-panel");
  await expect(chat).toBeVisible();

  const input = page.getByRole("combobox", { name: "Message Yoh" });
  await input.fill("/night");
  await input.press("Enter");

  const card = chat.getByTestId("structured-question").filter({ hasText: "Anything else to add before closing out?" });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card.getByRole("textbox")).toHaveCount(0);

  await card.getByRole("button", { name: "Nothing else", exact: true }).click();
  await expect(chat.getByText("Closed out for tonight.")).toBeVisible({ timeout: 10_000 });
  await expect(card).toHaveCount(0);
});
