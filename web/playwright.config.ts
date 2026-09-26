import { defineConfig } from "@playwright/test";

// Story 7.5: the Playwright smoke suite starts here and grows in 7.10, 8.8,
// and 10.4. Runs against a real server (loopback), serving the real built
// web/dist bundle — a true end-to-end check that Vitest/RTL (jsdom) can't
// give.
//
// Story 7.10 (controller Ruling R8): that server is now the test-only
// fixture entry `tests/e2e/fixture-server.ts` — the production
// `startServer`/`createApp` seams wired to a fake Notion client, no
// Calendar, and a throwaway SQLite file seeded with today's Plan — so the
// check-off smoke can write "to Notion" without touching a real workspace.
// No production file carries a test switch. It listens on its own port
// (not the real server's 8787) and is never reused, so a leftover dev
// server or a previous run's state can't leak into a run.
const E2E_PORT = 8788;

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: `cd .. && npm run build:web && YOH_SERVER_PORT=${E2E_PORT} node tests/e2e/fixture-server.ts`,
    url: `http://127.0.0.1:${E2E_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL: `http://127.0.0.1:${E2E_PORT}` },
});
