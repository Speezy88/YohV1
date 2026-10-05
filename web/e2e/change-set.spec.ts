/**
 * web/e2e/change-set.spec.ts — Epic 14: a chat change set shows its staged
 * items once, as a list with one Approve and one Discard, and applies (or
 * writes nothing) through the REAL `answerOpenItem` -> `confirmProposal`
 * path of `tests/e2e/fixture-server.ts`. Specs hardcode the fixture's
 * strings rather than importing them (see capture-flow.spec.ts).
 */
import { expect, test, type Page } from "@playwright/test";

const CHANGE_SET_MESSAGE = "add a workout at 1 and mark the first task done";

async function calendarCreates(page: Page): Promise<number> {
  const body = (await (await page.request.get("/__fixture/state?taskId=none")).json()) as { calendarCreates: number };
  return body.calendarCreates;
}

async function sendChangeSet(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /ask meeseek/i }).click();
  const input = page.getByRole("combobox", { name: "Message Meeseek" });
  await input.fill(CHANGE_SET_MESSAGE);
  await input.press("Enter");
  return page.getByTestId("chat-panel");
}

// The reset also undoes the change set's pending check-off, so check-off.spec.ts still finds its Tasks open.
test.beforeEach(async ({ request }) => {
  await request.post("/__fixture/reset");
});
test.afterEach(async ({ request }) => {
  await request.post("/__fixture/reset");
});

test("a change set shows every item once and applies on Approve", async ({ page }) => {
  const panel = await sendChangeSet(page);
  const list = panel.getByRole("list", { name: "Proposed changes" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(panel.getByText('Add "Workout"', { exact: false })).toHaveCount(1);
  await expect(panel.getByText("Here's what I'd change:")).toHaveCount(1);
  await panel.getByRole("button", { name: "Approve" }).click();
  await expect(panel.getByText(/^Added "Workout"/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Approve" })).toHaveCount(0);
  expect(await calendarCreates(page)).toBe(1);
});

test("Discard writes nothing", async ({ page }) => {
  const before = await calendarCreates(page);
  const panel = await sendChangeSet(page);
  await expect(panel.getByRole("list", { name: "Proposed changes" }).getByRole("listitem")).toHaveCount(2);
  await panel.getByRole("button", { name: "Discard" }).click();
  await expect(panel.getByRole("button", { name: "Discard" })).toHaveCount(0);
  expect(await calendarCreates(page)).toBe(before);
});
