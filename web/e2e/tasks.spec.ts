/**
 * web/e2e/tasks.spec.ts — Task 6B's Playwright smoke for the Tasks page,
 * against `tests/e2e/fixture-server.ts`'s fake Notion Tasks data source (no
 * real services). The speed bar: from a fresh load, arriving on Tasks puts
 * the cursor in quick-add, and ONE typed line + Enter creates a Task with
 * the right Due and Duration — visible in the list and written to (fake)
 * Notion. Plus: the grouped list, an inline edit that survives a reload,
 * and ↓ moving between rows without changing pages.
 */
import { expect, test, type Page } from "@playwright/test";

interface FakeTaskRow {
  readonly id: string;
  readonly title: string;
  readonly dueDate?: string;
  readonly minutes?: number;
}

async function tasksRows(page: Page): Promise<readonly FakeTaskRow[]> {
  const res = await page.request.get("/__fixture/state?taskId=none");
  return ((await res.json()) as { tasksRows: FakeTaskRow[] }).tasksRows;
}

async function openTasks(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
  // The vertical page slide (--duration-page-transition) has settled: geometry is final.
  await expect.poll(async () => (await page.getByTestId("page-tasks").boundingBox())?.y).toBe(0);
}

function row(page: Page, title: string) {
  return page.getByTestId("task-row").filter({ hasText: title });
}

test("fresh load → Tasks → quick-add is focused → one line + Enter creates the Task with the right Due and Duration", async ({ page }) => {
  await openTasks(page);
  const quickAdd = page.getByRole("textbox", { name: "New task" });
  await expect(quickAdd).toBeFocused();

  await page.keyboard.type("Test task due tomorrow 30m");
  // Nothing is read silently: the chips show before Enter.
  await expect(page.getByTestId("quick-add-chip")).toHaveText(["Due Tomorrow", "30 min"]);
  await page.keyboard.press("Enter");

  const created = row(page, "Test task");
  await expect(created).toBeVisible();
  await expect(created).toContainText("Tomorrow");
  await expect(created).toContainText("30 min");
  await expect(quickAdd).toHaveValue("");
  await expect(quickAdd).toBeFocused();

  // Written to (fake) Notion as a real Task, due tomorrow, 30 minutes.
  await expect
    .poll(async () => (await tasksRows(page)).find((r) => r.title === "Test task"))
    .toMatchObject({ title: "Test task", minutes: 30 });
  const written = (await tasksRows(page)).find((r) => r.title === "Test task")!;
  const today = new Date().toISOString().slice(0, 10); // the fixture runs in UTC
  expect(Date.parse(written.dueDate!) - Date.parse(today)).toBe(86_400_000);

  // Server truth after a reload: listed under This week with the same values.
  await page.reload();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(row(page, "Test task")).toContainText("Tomorrow");
  await expect(row(page, "Test task")).toContainText("30 min");
});

test("the list is grouped by Due, shows completed Tasks, and badges what's missing", async ({ page }) => {
  await openTasks(page);
  await expect(page.getByRole("heading", { name: "Overdue · 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Today · / })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No date · 1" })).toBeVisible();
  await expect(row(page, "Return library books").getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await expect(row(page, "College essay brainstorm")).toContainText("Add due date");
  await expect(row(page, "College essay brainstorm")).toContainText("Add time");
});

test("an inline Duration edit writes straight through and survives a reload", async ({ page }) => {
  await openTasks(page);
  const calc = row(page, "Calc problem set 4");
  await calc.getByRole("button", { name: /^Duration for Calc problem set 4/ }).click();
  const editor = page.getByRole("spinbutton", { name: "Duration for Calc problem set 4" });
  await expect(editor).toBeFocused();
  await editor.fill("45");
  await editor.press("Enter");
  await expect(calc).toContainText("45 min");
  await expect.poll(async () => (await tasksRows(page)).find((r) => r.id === "tp-today")?.minutes).toBe(45);

  await page.reload();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(row(page, "Calc problem set 4")).toContainText("45 min");
});

test("↓ from quick-add moves into the rows, and ↓/↑ there move rows — never pages", async ({ page }) => {
  await openTasks(page);
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "Email Mr. Alvarez about the lab").getByRole("checkbox")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("textbox", { name: "New task" })).toBeFocused();
});

test("scrolled to its very end, the last row sits fully above the Ask Yoh pill", async ({ page }) => {
  await openTasks(page);
  const list = page.locator("[data-captures-arrow-keys]");
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const lastRow = page.getByTestId("task-row").last();
  await expect(lastRow).toBeVisible();
  const rowBox = (await lastRow.boundingBox())!;
  const pillBox = (await page.getByRole("button", { name: /ask yoh/i }).boundingBox())!;
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(pillBox.y);
});

test("renaming a Task in place writes the title through and survives a reload", async ({ page }) => {
  await openTasks(page);
  await row(page, "Soccer fundraiser flyers").getByRole("button", { name: "Title: Soccer fundraiser flyers" }).click();
  const editor = page.getByRole("textbox", { name: "Title of Soccer fundraiser flyers" });
  await expect(editor).toBeFocused();
  await editor.fill("Soccer fundraiser flyers v2");
  await editor.press("Enter");
  await expect(page.getByRole("button", { name: "Title: Soccer fundraiser flyers v2" })).toBeVisible();
  await expect.poll(async () => (await tasksRows(page)).find((r) => r.id === "tp-soccer")?.title).toBe("Soccer fundraiser flyers v2");
  await page.reload();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("button", { name: "Title: Soccer fundraiser flyers v2" })).toBeVisible();
});
