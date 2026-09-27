/**
 * web/e2e/capture-flow.spec.ts — Story 8.8's Playwright smoke, the
 * permanent NFR-CaptureSpeed regression gate for every later story.
 *
 * Runs against `tests/e2e/fixture-server.ts`, whose `runChatTurn` seam
 * routes a Task-shaped message through the REAL `app/create-item.ts`
 * `draftItem` -> `openProposal` pipeline (only `detectTaskCapture`'s own
 * classifier decision is stood in for, by a simple keyword match — that
 * classifier is unit-tested directly in `tests/llm-adapter.test.ts`), so
 * confirming here goes through the REAL `answerOpenItem` -> `confirmProposal`
 * -> `createPage` write path, against a fake (never real) Notion client.
 */
import { expect, test, type Page } from "@playwright/test";

function bubble(page: Page) {
  return page.getByRole("textbox", { name: /ask yoh, or type \/ for commands/i });
}

test("fresh launch: no login, picker, or extra screen appears before a focused Chat Bubble", async ({ page }) => {
  await page.goto("/");

  // Action 1: focus the bubble — reachable and focusable immediately, not
  // gated on Home's own data (Review Focus #5).
  const input = bubble(page);
  await input.click();
  await expect(input).toBeFocused();

  // Nothing modal ever stood between launch and this focus.
  expect(await page.locator('[role="dialog"], [role="alertdialog"]').count()).toBe(0);
});

test("capture -> confirm -> receipt: three actions get a Task drafted through FR-26's real pipeline and created", async ({ page }) => {
  await page.goto("/");
  const input = bubble(page);

  // Action 1: focus.
  await input.click();
  // Action 2: type.
  await input.fill("Lab report draft, due Thursday");
  // Action 3: Enter — sends AND navigates to Chat (FR-40/UX-DR35).
  await input.press("Enter");

  await expect(page.getByTestId("page-chat")).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.getByText(/Here's what I'll create in Tasks/)).toBeVisible();

  // The FR-26 confirm-then-write trust boundary: the Task must not exist in
  // Notion yet, only the draft is shown (Review Focus #3).
  const preConfirm = await (await page.request.get("/__fixture/state?taskId=x")).json();
  expect(preConfirm.createdPages).toEqual([]);

  // The "Create" chip is pre-focused (Story 8.8 AC3, Task 4) — Enter alone confirms it.
  const createChip = page.getByRole("button", { name: "Create" });
  await expect(createChip).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByText(/Created "Lab report draft" in Tasks/)).toBeVisible();
  await expect
    .poll(async () => (await (await page.request.get("/__fixture/state?taskId=x")).json()).createdPages)
    .toEqual([{ title: "Lab report draft" }]);
});

test("a genuine question is never captured as a Task", async ({ page }) => {
  await page.goto("/");
  const input = bubble(page);
  await input.click();
  await input.fill("What's my next meeting?");
  await input.press("Enter");

  await expect(page.getByTestId("page-chat")).not.toHaveAttribute("aria-hidden", "true");
  await expect(page.getByText(/Here's what I'll create/)).toHaveCount(0);
});
