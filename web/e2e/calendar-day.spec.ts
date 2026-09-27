/**
 * web/e2e/calendar-day.spec.ts — Real-use fixes plan, Task 4 ("I cant see
 * my google calendar on other days when i select a day on the month view.
 * it just reverts back to day"). Against `tests/e2e/fixture-server.ts`
 * (Ruling R8; fixed Calendar events, no real Notion/Google) — a Month
 * click on a NON-today day now switches Day to that date and renders its
 * real events, rather than reverting to today.
 *
 * The target date is computed here the SAME way `tests/e2e/fixture-server.ts`
 * computes it (`today + 3 days`, real UTC "now") so both processes land on
 * the identical date without talking to each other — see that file's own
 * `FIXTURE_OTHER_DAY_DATE`/`FIXTURE_OTHER_DAY_EVENT_TITLE` doc comment.
 */
import { expect, test } from "@playwright/test";

const FIXTURE_OTHER_DAY_EVENT_TITLE = "Team Sync";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

function targetDate(): { readonly year: number; readonly month: number; readonly day: number; readonly monthName: string; readonly crossesMonth: boolean } {
  const now = new Date();
  const todayMonth = now.getUTCMonth();
  const todayYear = now.getUTCFullYear();
  const target = new Date(Date.UTC(todayYear, todayMonth, now.getUTCDate() + 3));
  return {
    year: target.getUTCFullYear(),
    month: target.getUTCMonth(),
    day: target.getUTCDate(),
    monthName: MONTH_NAMES[target.getUTCMonth()]!,
    crossesMonth: target.getUTCMonth() !== todayMonth || target.getUTCFullYear() !== todayYear,
  };
}

test("Month -> click another date -> the Day header shows that date and the fixture's events for it render", async ({ page }) => {
  await page.goto("/");
  const target = targetDate();

  await page.getByRole("button", { name: "Month", exact: true }).click();
  if (target.crossesMonth) {
    await page.getByRole("button", { name: "Next month" }).click();
    await expect(page.getByText(new RegExp(`^${target.monthName} `))).toBeVisible();
  }
  await page.getByLabel(`${target.monthName} ${target.day}`, { exact: true }).click();

  // Back in Day view, now for the CLICKED date — the header shows it, and
  // this date isn't today, so the Today button appears.
  await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
  const todayButton = page.getByRole("button", { name: "Today", exact: true });
  await expect(todayButton).toBeVisible();
  await expect(page.getByTestId("calendar-day-view")).toBeVisible();
  await expect(page.getByText(FIXTURE_OTHER_DAY_EVENT_TITLE)).toBeVisible();

  // "Today" returns to today's own live Day view; the button disappears again.
  await todayButton.click();
  await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveCount(0);
});
