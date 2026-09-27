/**
 * web/e2e/check-off.spec.ts — Story 7.10's Playwright smoke, against
 * `tests/e2e/fixture-server.ts` (fake Notion; Ruling R8). Two flows:
 * check-off → toast → Undo writes nothing; check-off → commit writes the
 * Notion Status and a Completion Log entry. The undo window is read from
 * the server's own check-off response (`commitAt - asOf`), never assumed.
 */
import { expect, test, type Page } from "@playwright/test";

interface FixtureState {
  readonly statusWrites: ReadonlyArray<{ readonly taskId: string; readonly status: string }>;
  readonly completedToday: boolean;
}

/** Picks only the two fields this file cares about — the fixture's `/__fixture/state` endpoint grew a `createdPages` field in Story 8.8 (unrelated to check-off), and this suite's shared webServer process means that array can carry an entry from an earlier spec file's own test. */
async function fixtureState(page: Page, taskId: string): Promise<FixtureState> {
  const res = await page.request.get(`/__fixture/state?taskId=${encodeURIComponent(taskId)}`);
  const body = (await res.json()) as FixtureState & { readonly createdPages?: unknown };
  return { statusWrites: body.statusWrites, completedToday: body.completedToday };
}

/** Clicks a row's Checkbox and returns the undo window the server granted (ms). */
async function checkOff(page: Page, taskName: string): Promise<number> {
  const response = page.waitForResponse((r) => r.url().endsWith("/api/check-off") && r.request().method() === "POST");
  await page.getByRole("checkbox", { name: taskName }).click();
  const body = (await (await response).json()) as { ok: boolean; value: { commitAt: string; asOf: string } };
  expect(body.ok).toBe(true);
  return Date.parse(body.value.commitAt) - Date.parse(body.value.asOf);
}

test("check-off -> toast -> Undo: the row returns and nothing is written to Notion or the Completion Log", async ({ page }) => {
  await page.goto("/");
  const windowMs = await checkOff(page, "E2E Undo Task");
  const toast = page.getByRole("status").filter({ hasText: "Checked off E2E Undo Task" });
  await expect(toast).toBeVisible();

  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(toast).toHaveCount(0);
  const checkbox = page.getByRole("checkbox", { name: "E2E Undo Task" });
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toHaveAttribute("aria-checked", "false");

  // Well past the window plus a few commit ticks: an undone check-off must never commit.
  await page.waitForTimeout(windowMs + 3_000);
  expect(await fixtureState(page, "e2e-undo")).toEqual({ statusWrites: [], completedToday: false });
});

test("check-off -> commit: the Notion Status is written and a Completion Log entry is present", async ({ page }) => {
  await page.goto("/");
  const windowMs = await checkOff(page, "E2E Commit Task");
  await expect(page.getByRole("status").filter({ hasText: "Checked off E2E Commit Task" })).toBeVisible();

  await expect
    .poll(() => fixtureState(page, "e2e-commit"), { timeout: windowMs + 10_000 })
    .toEqual({ statusWrites: [{ taskId: "e2e-commit", status: "Completed" }], completedToday: true });
  await expect(page.getByRole("status").filter({ hasText: "Checked off E2E Commit Task" })).toHaveCount(0);

  // Server truth after a reload: the Task shows as done, not back on the list.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "E2E Commit Task" })).toHaveAttribute("aria-checked", "true");
});
