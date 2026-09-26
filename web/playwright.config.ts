import { defineConfig } from "@playwright/test";

// Story 7.5: the Playwright smoke suite starts here and grows in 7.10, 8.8,
// and 10.4. Runs against the real server (loopback), serving the real
// built web/dist bundle — a true end-to-end check that Vitest/RTL (jsdom)
// can't give.
export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "cd .. && MEMORY_DB_PATH=:memory: node src/shell/server.ts",
    url: "http://127.0.0.1:8787/api/health",
    reuseExistingServer: !process.env["CI"],
  },
  use: { baseURL: "http://127.0.0.1:8787" },
});
