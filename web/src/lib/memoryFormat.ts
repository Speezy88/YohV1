/** Small date formatters for the Memory page. Dates are the stored ISO day (UTC), never the browser's clock. */
export function formatMemoryDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
