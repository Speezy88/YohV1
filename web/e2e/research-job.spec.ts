/**
 * web/e2e/research-job.spec.ts — Story 11.3's end-to-end path against `tests/e2e/fixture-server.ts`:
 * `/research <question>` in Chat queues a job (the REAL `queueResearch`), the fixture's runner (the real
 * `startResearchJobRunner` over a fake search and the fake Research Vault) files it, a "Research ready"
 * notification appears, and clicking it opens that document in the Research Box.
 */
import { expect, test } from "@playwright/test";

// The fixture server keeps state for a whole run: a unique question, matched by its own text.
const QUESTION = `how do AP Bio late fees work ${Date.now()}`;

test("/research queues a job, a Research ready notification appears, and opening it shows the document on Research Hub", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /ask yoh/i }).click();
  const chat = page.getByTestId("chat-panel");
  await expect(chat).toBeVisible();
  const input = chat.getByRole("combobox", { name: "Message Yoh" });
  await input.fill(`/research ${QUESTION}`);
  await input.press("Enter");

  await expect(chat.getByText("Queued. You'll get a notification when it's on Research Hub.")).toBeVisible();

  const card = page.getByTestId("notification-card").filter({ hasText: `Research ready: ${QUESTION}` });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button").first().click();

  // Activating the notification closes the Chat panel so the document is visible.
  await expect(chat).toBeHidden();
  // Pages scroll into view; wait for Research Hub to settle (same wait as research-hub.spec.ts).
  await expect.poll(async () => (await page.getByTestId("page-research").boundingBox())?.y).toBe(0);
  const box = page.getByTestId("page-research");
  await expect(box.getByRole("heading", { name: QUESTION })).toBeVisible();
  await expect(box).toContainText(`Fixture findings for: ${QUESTION}`);
  await expect(box.getByRole("link", { name: "https://example.com/fixture-research" })).toBeVisible();
});
