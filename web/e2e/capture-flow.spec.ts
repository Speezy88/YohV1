/**
 * web/e2e/capture-flow.spec.ts — Story 8.8's Playwright smoke, the
 * permanent NFR-CaptureSpeed regression gate for every later story.
 *
 * Task 6A (2026-09-27) rewrite: the capture surface is now the Ask Yoh
 * pill (a plain button, fixed bottom-center, on every page) which opens
 * the large Chat panel with its input already focused — "click the pill
 * (or ⌘K), type, Enter" is still exactly three actions, just through the
 * panel's real Chat Input rather than a second inline text field of its
 * own.
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

async function openPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: /ask yoh/i }).click();
}

function messageInput(page: Page) {
  return page.getByRole("combobox", { name: "Message Yoh" });
}

test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
});

test("fresh launch: no login, picker, or extra screen appears before a focused Chat Input", async ({ page }) => {
  await page.goto("/");

  // Action 1: click the Ask Yoh pill — opens the Chat panel with its input
  // already focused (Review Focus #5: reachable and focusable immediately,
  // not gated on Home's own data).
  await openPanel(page);
  await expect(messageInput(page)).toBeFocused();

  // Nothing modal ever stood between launch and this focus, other than the
  // Chat panel itself (a real, intentional dialog, not an extra screen).
  expect(await page.locator('[role="alertdialog"]').count()).toBe(0);
});

test("capture -> confirm -> receipt: three actions get a Task drafted through FR-26's real pipeline and created", async ({ page }) => {
  await page.goto("/");

  // Action 1: click the pill.
  await openPanel(page);
  const input = messageInput(page);
  // Action 2: type.
  await input.fill("Lab report draft, due Thursday");
  // Action 3: Enter — sends.
  await input.press("Enter");

  const panel = page.getByTestId("chat-panel");
  await expect(panel.getByText(/Here's what I'll create in Tasks/)).toBeVisible();

  // The FR-26 confirm-then-write trust boundary: the Task must not exist in
  // Notion yet, only the draft is shown (Review Focus #3).
  const preConfirm = await (await page.request.get("/__fixture/state?taskId=x")).json();
  expect(preConfirm.createdPages).toEqual([]);

  // The "Create" chip is pre-focused (Story 8.8 AC3, Task 4) — Enter alone confirms it.
  const createChip = panel.getByRole("button", { name: "Create" });
  await expect(createChip).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(panel.getByText(/Created "Lab report draft" in Tasks/)).toBeVisible();
  await expect
    .poll(async () => (await (await page.request.get("/__fixture/state?taskId=x")).json()).createdPages)
    .toEqual([{ title: "Lab report draft" }]);
});

test("a genuine question is never captured as a Task", async ({ page }) => {
  await page.goto("/");
  await openPanel(page);
  const input = messageInput(page);
  await input.fill("What's my next meeting?");
  await input.press("Enter");

  const panel = page.getByTestId("chat-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/Here's what I'll create/)).toHaveCount(0);
});
