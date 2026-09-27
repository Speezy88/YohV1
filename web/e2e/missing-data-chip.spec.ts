/**
 * web/e2e/missing-data-chip.spec.ts — real-use fixes plan, Task 2 (Spencer:
 * "get rid of the 'waiting on you' section in the chat. maybe just add a
 * 'x tasks missing data' in the top right"). Against
 * `tests/e2e/fixture-server.ts`'s fake Tasks data source (Task 6B's own
 * fixture rows, plus Story 9.2's own dedicated fixture Task): three of its
 * seven Tasks are open and missing a planning field — "AP Bio ch. 7
 * reading" (no Energy), "College essay brainstorm" (no Due Date or time),
 * and "E2E Sandbox Task" (no Due Date, time, or Energy) — so the chip's
 * fixture count is 3.
 */
import { expect, test, type Page } from "@playwright/test";

async function openChat(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /ask yoh/i }).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
}

test("the Chat header's chip shows the fixture's missing-data count and never a 'Waiting on you' section", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");

  expect(await chat.getByText(/waiting on you/i).count()).toBe(0);
  await expect(chat.getByTestId("missing-data-chip")).toHaveText("3 tasks missing data");
});

test("clicking the chip closes Chat and opens Tasks filtered to those missing-data rows", async ({ page }) => {
  await openChat(page);
  const chat = page.getByTestId("chat-panel");
  await chat.getByTestId("missing-data-chip").click();

  await expect(chat).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
  await expect(page.getByTestId("tasks-filter-missing-data")).toBeVisible();

  await expect(page.getByTestId("task-row").filter({ hasText: "AP Bio ch. 7 reading" })).toBeVisible();
  await expect(page.getByTestId("task-row").filter({ hasText: "College essay brainstorm" })).toBeVisible();
  // Complete Tasks (nothing missing) are filtered out.
  await expect(page.getByTestId("task-row").filter({ hasText: "Calc problem set 4" })).toHaveCount(0);
  await expect(page.getByTestId("task-row").filter({ hasText: "Email Mr. Alvarez about the lab" })).toHaveCount(0);

  // The filter clears on demand.
  await page.getByRole("button", { name: "Clear Missing data filter" }).click();
  await expect(page.getByTestId("tasks-filter-missing-data")).toHaveCount(0);
  await expect(page.getByTestId("task-row").filter({ hasText: "Calc problem set 4" })).toBeVisible();
});
