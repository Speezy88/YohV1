/**
 * web/e2e/desk.spec.ts — Epic 12: the Desk page's widgets against the
 * fixture server's seeded records (no real Notion).
 */
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Mirrors the fixture's exports (`tests/e2e/fixture-server.ts`); not imported, because importing that file starts the fixture server.
const COMPLETED_TODAY = ["Desk seed today-3", "Desk seed today-2", "Desk seed today-1"] as const; // newest first

interface DeskNow {
  readonly completedToday: readonly { readonly taskName: string }[];
  readonly minutesToday: number;
  readonly hoursWithYoh: number;
  readonly onTime: { readonly onTime: number; readonly counted: number; readonly percent: number | null };
}

// The fixture keeps its records for the whole run, and other specs check Tasks off, so today's totals are read
// from the server rather than fixed here. The seeded rows, the streak and the spend do not change.
async function deskNow(page: Page): Promise<DeskNow> {
  const body = (await (await page.request.get("/api/desk")).json()) as { ok: true; value: DeskNow };
  return body.value;
}

async function openDesk(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Desk", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Desk", level: 1 })).toBeVisible();
  await expect(page.getByText(/^\d+ min today$/)).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("page-desk").boundingBox())?.y).toBe(0);
  await expect(page.getByRole("group", { name: "Activity, last 26 weeks" })).toBeVisible();
}

test("the widgets show the seeded values", async ({ page }) => {
  await openDesk(page);
  const done = page.locator("section", { has: page.getByRole("heading", { name: "Tasks completed today" }) });
  const now = await deskNow(page);
  const names = now.completedToday.map((item) => item.taskName);
  // Lower bounds from the seed (`FIXTURE_DESK_*`): other specs only add completions, so these hold whatever ran before.
  expect(now.minutesToday).toBeGreaterThanOrEqual(75);
  expect(now.hoursWithYoh).toBeGreaterThanOrEqual(5);
  expect(now.onTime.counted).toBeGreaterThanOrEqual(4);
  expect(now.onTime.onTime).toBeGreaterThanOrEqual(2);
  expect(names.filter((name) => name.startsWith("Desk seed"))).toEqual([...COMPLETED_TODAY]);
  await expect(done.getByRole("listitem")).toHaveText(names);
  await expect(done.locator("p").first()).toHaveText(String(names.length));
  await expect(page.getByText(`${now.minutesToday} min today`)).toBeVisible();
  await expect(page.getByText(`${now.hoursWithYoh} h with Yoh`)).toBeVisible();
  await expect(page.getByText(`${now.onTime.percent}%`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${now.onTime.onTime} of ${now.onTime.counted} Tasks with a due date`)).toBeVisible();
  await expect(page.getByText("Streak: 3 days · Longest: 5 days")).toBeVisible();
  await expect(page.getByText("$7.00")).toBeVisible();
  await expect(page.getByText("Desk isn't built yet.")).toHaveCount(0);
});

test("completed names are struck through and figures use tabular numerals", async ({ page }) => {
  await openDesk(page);
  const name = page.getByText(COMPLETED_TODAY[0], { exact: true });
  expect(await name.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe("line-through");
  const figure = page.getByText(/^\d+ min today$/);
  expect(await figure.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
});

test("no horizontal page scroll at 390px or 1280px", async ({ page }) => {
  for (const [width, height] of [[390, 800], [1280, 800]] as const) {
    await page.setViewportSize({ width, height });
    await openDesk(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const deskOverflow = await page.getByTestId("page-desk").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(deskOverflow).toBeLessThanOrEqual(0);
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe passes in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openDesk(page);
    const results = await new AxeBuilder({ page }).include('[data-testid="page-desk"]').analyze();
    expect(results.violations).toEqual([]);
  });
}

// ---- Task 5: the Activity heatmap (Bklit chart, patched) ----

interface HeatDay {
  readonly date: string;
  readonly completed: number;
  readonly level: 0 | 1 | 2 | 3 | 4;
}
async function heatmapDays(page: Page): Promise<HeatDay[]> {
  const body = (await (await page.request.get("/api/desk")).json()) as { ok: true; value: { heatmap: { weeks: HeatDay[][] } } };
  return body.value.heatmap.weeks.flat();
}
// Mirrors lib/deskHeatmap.ts's wording, from the ISO date's own parts.
const dayText = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const countText = (d: HeatDay): string => (d.completed > 0 ? `${d.completed} ${d.completed === 1 ? "Task" : "Tasks"} completed` : d.level >= 1 ? "Opened Yoh, no Tasks completed" : "No activity");
const cellName = (d: HeatDay): string => `${dayText(d.date)}: ${d.completed > 0 ? countText(d) : d.level >= 1 ? "opened Yoh, no Tasks completed" : "no activity"}`;
const isoMinus = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** Focus the Tasks list region just before the heatmap, then Tab once: the next stop is the grid. */
async function tabIntoGrid(page: Page): Promise<HeatDay> {
  const days = await heatmapDays(page);
  const today = days.at(-1)!;
  await page.getByRole("region", { name: "Tasks completed today, list" }).focus();
  await page.keyboard.press("Tab");
  return today;
}
const focusedLabel = (page: Page): Promise<string | null> => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);

test("Tab lands on today's cell; arrow keys move by day and week; the tooltip follows focus and Escape hides it", async ({ page }) => {
  await openDesk(page);
  const days = await heatmapDays(page);
  const today = await tabIntoGrid(page);
  expect(await focusedLabel(page)).toBe(cellName(today));
  // One tab stop: Tab leaves the grid instead of walking cells.
  await expect(page.locator('[role="img"][tabindex="0"]')).toHaveCount(1);
  // Up goes to the day before, unless today is a Sunday (the top row), where it stays put.
  const dayBefore = new Date(`${today.date}T00:00:00Z`).getUTCDay() > 0 ? days.at(-2)! : today;
  await page.keyboard.press("ArrowUp");
  expect(await focusedLabel(page)).toBe(cellName(dayBefore));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  const weekBack = days.find((d) => d.date === isoMinus(today.date, 7))!;
  expect(await focusedLabel(page)).toBe(cellName(weekBack));
  await expect(page.getByText(dayText(weekBack.date), { exact: true })).toBeVisible();
  await expect(page.getByText(countText(weekBack), { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(dayText(weekBack.date), { exact: true })).toBeHidden();
  await page.keyboard.press("Home");
  expect(await focusedLabel(page)).toBe(cellName(days[0]!));
  await page.keyboard.press("End");
  expect(await focusedLabel(page)).toBe(cellName(today));
});

test("the five levels have five distinct fills and strokes, each the token's value; the focused cell shows the focus ring", async ({ page }) => {
  await openDesk(page);
  // Let the enter fade finish (it ends at full opacity).
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('[role="img"][tabindex]')].every((r) => getComputedStyle(r).opacity === "1"))).toBe(true);
  const days = await heatmapDays(page);
  const style = await page.evaluate(
    ({ names }) => {
      const probe = (token: string): string => {
        const el = document.createElement("div");
        el.style.color = `var(${token})`;
        document.body.appendChild(el);
        const value = getComputedStyle(el).color;
        el.remove();
        return value;
      };
      const read = (name: string) => {
        const rect = document.querySelector(`[role="img"][aria-label="${name}"]`)!;
        const cs = getComputedStyle(rect);
        return { fill: cs.fill, stroke: cs.stroke, opacity: cs.opacity };
      };
      return {
        cells: names.map(read),
        fills: [0, 1, 2, 3, 4].map((n) => probe(`--color-heatmap-level-${n}`)),
        rim: probe("--color-rim-structural"),
        accent: probe("--color-accent-solid"),
        ringWidth: getComputedStyle(document.documentElement).getPropertyValue("--focus-ring-width").trim(),
      };
    },
    { names: [0, 1, 2, 3, 4].map((level) => cellName(days.find((d) => d.level === level && d !== days.at(-1))!)) },
  );
  style.cells.forEach((c, level) => {
    expect(c.fill, `level ${level} fill`).toBe(style.fills[level]);
    expect(c.stroke, `level ${level} stroke`).toBe(style.rim); // every cell has the rim (Ruling E12-R24)
    expect(c.opacity).toBe("1");
  });
  expect(new Set(style.cells.map((c) => c.fill)).size).toBe(5);
  // Focus a level 4 cell: the ring is its own rect, outside the cell, so it sits on the card and not on the fill.
  const level4 = cellName(days.find((d) => d.level === 4)!);
  await page.evaluate((name) => (document.querySelector(`[role="img"][aria-label="${name}"]`) as SVGElement).focus(), level4);
  await expect(page.locator("[data-heatmap-focus-ring]")).toHaveCount(1);
  const ring = await page.evaluate((name) => {
    const cell = document.querySelector(`[role="img"][aria-label="${name}"]`) as SVGElement;
    const ringEl = document.querySelector("[data-heatmap-focus-ring]") as SVGElement | null;
    if (!ringEl) return null;
    const cs = getComputedStyle(ringEl);
    const c = cell.getBoundingClientRect();
    const r = ringEl.getBoundingClientRect();
    return { stroke: cs.stroke, width: cs.strokeWidth, fill: cs.fill, cellStroke: getComputedStyle(cell).stroke, cell: { x: c.x, y: c.y, w: c.width, h: c.height }, ring: { x: r.x, y: r.y, w: r.width, h: r.height } };
  }, level4);
  expect(ring).not.toBeNull();
  expect(ring!.stroke).toBe(style.accent);
  expect(ring!.width).toBe(style.ringWidth);
  expect(ring!.fill).toBe("none");
  expect(ring!.cellStroke).toBe(style.rim);
  // The ring's box is larger than the cell's on every side, and its inner edge starts outside the cell.
  expect(ring!.ring.w).toBeGreaterThan(ring!.cell.w);
  expect(ring!.ring.h).toBeGreaterThan(ring!.cell.h);
  expect(ring!.ring.x).toBeLessThan(ring!.cell.x);
  expect(ring!.ring.y).toBeLessThan(ring!.cell.y);
  expect(ring!.ring.x + ring!.ring.w).toBeGreaterThan(ring!.cell.x + ring!.cell.w);
  expect(ring!.ring.y + ring!.ring.h).toBeGreaterThan(ring!.cell.y + ring!.cell.h);
});

test("the heatmap scrolls sideways inside its region at 390px, starts at the newest week, and the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openDesk(page);
  const region = page.getByRole("region", { name: "Activity heatmap, scrollable" });
  await expect(region).toHaveAttribute("data-wheel-nav", "off");
  const m = await region.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft }));
  expect(m.scrollWidth).toBeGreaterThan(m.clientWidth);
  expect(m.scrollLeft + m.clientWidth).toBeGreaterThanOrEqual(m.scrollWidth - 1);
  await region.evaluate((el) => { el.scrollLeft = 0; });
  expect(await region.evaluate((el) => el.scrollLeft)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a wheel gesture over the heatmap does not change the active page", async ({ page }) => {
  await openDesk(page);
  const box = (await page.getByRole("region", { name: "Activity heatmap, scrollable" }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await page.mouse.wheel(0, -300);
  await expect(page.getByRole("button", { name: "Desk", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Desk", level: 1 })).toBeVisible();
});

test("Desk logs no Content Security Policy violation", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /content security policy|refused to/i.test(msg.text())) problems.push(msg.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  await openDesk(page);
  const first = (await page.locator('[role="img"][tabindex]').first().getAttribute("aria-label"))!;
  await page.getByRole("img", { name: first, exact: true }).hover();
  await page.waitForTimeout(300);
  expect(problems).toEqual([]);
});

// ---- Task 6: the Crypto feed widget (fake feed on the fixture server; no provider is ever contacted) ----

// Mirrors the fixture's `FIXTURE_DESK_FEEDS_*` exports (`tests/e2e/fixture-server.ts`).
// Today (the fixture zone is UTC) at 3:30 PM, so captions read `3:30 PM` with no date.
const FEEDS_FETCHED_AT = `${new Date().toISOString().slice(0, 10)}T15:30:00.000Z`;
const FEED_TICKERS = [
  { symbol: "BTC", priceUsd: 67123.4, changePercent: 1.2 },
  { symbol: "SOL", priceUsd: 142.57, changePercent: -0.8 },
  { symbol: "ETH", priceUsd: 3456.78, changePercent: null },
] as const;
const cryptoCard = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Crypto" }) });

const FEED_WEATHER = { location: "Seattle, WA", temperatureF: 58, conditions: "Partly Cloudy", next: { name: "Tonight", temperatureF: 49, summary: "Mostly Clear" } };
const FEED_NEWS = [
  { title: "Chipmaker\u2019s sales rise on AI demand", url: "https://example.org/chipmaker", source: "TechCrunch", publishedAt: "2026-10-04T21:10:00.000Z" },
  { title: "Rates & markets: what the Fed signaled", url: "https://example.org/rates", source: "NPR", publishedAt: "2026-10-04T18:00:00.000Z" },
  { title: "Startup raises a seed round for AI agents", url: "https://example.org/seed", source: "TechCrunch", publishedAt: "2026-10-04T16:45:00.000Z" },
] as const;
const OK_WEATHER = { status: "ok", value: FEED_WEATHER, fetchedAt: FEEDS_FETCHED_AT };
const OK_NEWS = { status: "ok", value: { items: FEED_NEWS }, fetchedAt: FEEDS_FETCHED_AT };
const OK_CRYPTO = { status: "ok", value: { tickers: FEED_TICKERS }, fetchedAt: FEEDS_FETCHED_AT };
const weatherCard = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Weather · Seattle, WA" }) });
const newsCard = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Business and AI news" }) });

/** Overrides the feeds response; any feed not given stays the fixture's `ok` value. */
async function routeFeeds(page: Page, feeds: { crypto?: unknown; weather?: unknown; news?: unknown }): Promise<void> {
  await page.route("**/api/desk/feeds", (route) =>
    route.fulfill({ json: { ok: true, value: { timeZone: "UTC", crypto: feeds.crypto ?? OK_CRYPTO, weather: feeds.weather ?? OK_WEATHER, news: feeds.news ?? OK_NEWS } } }),
  );
}
const routeCrypto = (page: Page, crypto: unknown) => routeFeeds(page, { crypto });

test("the Crypto widget shows the fixture's prices, signed changes and caption", async ({ page }) => {
  await openDesk(page);
  const card = cryptoCard(page);
  await expect(card.getByRole("listitem")).toHaveText(["BTC$67,123+1.2%", "SOL$142.57−0.8%", "ETH$3,457"]);
  await expect(card.getByText("Kraken · change since 00:00 UTC · updated 3:30 PM")).toBeVisible();
  // Placed after the Activity heatmap.
  const order = await page.getByTestId("page-desk").getByRole("heading", { level: 2 }).allTextContents();
  expect(order.indexOf("Crypto")).toBe(order.indexOf("Activity") + 1);
});

test("a stale feed keeps the values and shows the unavailable line; the other widgets still render", async ({ page }) => {
  await routeCrypto(page, { status: "stale", value: { tickers: FEED_TICKERS }, fetchedAt: FEEDS_FETCHED_AT });
  await openDesk(page);
  const card = cryptoCard(page);
  await expect(card.getByRole("listitem")).toHaveCount(3);
  await expect(card.getByText("Unavailable · last updated 3:30 PM")).toBeVisible();
  await expect(card.getByText(/Kraken ·/)).toHaveCount(0);
  await expect(page.getByText(/^\d+ min today$/)).toBeVisible();
  await expect(page.getByRole("group", { name: "Activity, last 26 weeks" })).toBeVisible();
});

test("an unavailable feed shows only the unavailable line, in the ink-secondary color", async ({ page }) => {
  await routeCrypto(page, { status: "unavailable" });
  await openDesk(page);
  const card = cryptoCard(page);
  const line = card.getByText("Unavailable", { exact: true });
  await expect(line).toBeVisible();
  await expect(card.getByRole("listitem")).toHaveCount(0);
  const { color, token } = await line.evaluate((el) => {
    const probe = document.createElement("div");
    probe.style.color = "var(--color-ink-secondary)";
    document.body.appendChild(probe);
    const token = getComputedStyle(probe).color;
    probe.remove();
    return { color: getComputedStyle(el).color, token };
  });
  expect(color).toBe(token);
  await expect(page.getByText(/^\d+ min today$/)).toBeVisible();
  await expect(page.getByRole("group", { name: "Activity, last 26 weeks" })).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe passes with the Crypto widget in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openDesk(page);
    await expect(cryptoCard(page).getByRole("listitem")).toHaveCount(3);
    const results = await new AxeBuilder({ page }).include('[data-testid="page-desk"]').analyze();
    expect(results.violations).toEqual([]);
  });
}

test("no request leaves the page for any host but the fixture", async ({ page }) => {
  const hosts = new Set<string>();
  page.on("request", (req) => {
    if (/^https?:/.test(req.url())) hosts.add(new URL(req.url()).host);
  });
  await openDesk(page);
  await expect(cryptoCard(page).getByRole("listitem")).toHaveCount(3);
  expect([...hosts]).toEqual([new URL(page.url()).host]);
});

// ---- Task 7: the Weather and News feed widgets ----

test("the Weather and News widgets show the fixture values after Crypto", async ({ page }) => {
  await openDesk(page);
  const weather = weatherCard(page);
  await expect(weather.getByText("58°F")).toBeVisible();
  await expect(weather.getByText("Partly Cloudy")).toBeVisible();
  await expect(weather.getByText("Tonight: 49°F, Mostly Clear")).toBeVisible();
  await expect(weather.getByText("National Weather Service · updated 3:30 PM")).toBeVisible();
  const news = newsCard(page);
  await expect(news.getByRole("listitem")).toHaveCount(3);
  const link = news.getByRole("link", { name: "Chipmaker\u2019s sales rise on AI demand" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(news.getByRole("listitem").first()).toContainText("TechCrunch · Oct 4,");
  const order = await page.getByTestId("page-desk").getByRole("heading", { level: 2 }).allTextContents();
  expect(order.slice(order.indexOf("Crypto"))).toEqual(["Crypto", "Weather · Seattle, WA", "Business and AI news"]);
});

test("one feed forced unavailable leaves the other widgets rendering", async ({ page }) => {
  await routeFeeds(page, { weather: { status: "unavailable" } });
  await openDesk(page);
  await expect(weatherCard(page).getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(weatherCard(page).getByText("58°F")).toHaveCount(0);
  await expect(cryptoCard(page).getByRole("listitem")).toHaveCount(3);
  await expect(newsCard(page).getByRole("listitem")).toHaveCount(3);
  await expect(page.getByText(/^\d+ min today$/)).toBeVisible();
  await page.unroute("**/api/desk/feeds");
  await routeFeeds(page, { news: { status: "unavailable" } });
  await page.reload();
  await expect(newsCard(page).getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(weatherCard(page).getByText("58°F")).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe passes with every feed widget in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openDesk(page);
    await expect(newsCard(page).getByRole("listitem")).toHaveCount(3);
    await expect(weatherCard(page).getByText("58°F")).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[data-testid="page-desk"]').analyze();
    expect(results.violations).toEqual([]);
  });
}

test("no horizontal page scroll at 390px with every widget present", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDesk(page);
  await expect(newsCard(page).getByRole("listitem")).toHaveCount(3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const inner = await page.getByTestId("page-desk").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(inner).toBeLessThanOrEqual(0);
});
