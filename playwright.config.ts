import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config — boots a DEDICATED, ISOLATED test server so the suite NEVER
 * touches the real dev server or any real database:
 *   - its own port 7072 (prod runs on 7070, dev on 7071), and
 *   - its own throwaway database worklog.test.db (via DATABASE_URL), and
 *   - reuseExistingServer:false so it always starts its own instance and never
 *     hijacks a running dev/prod server.
 * Everything stays 127.0.0.1-only (architecture.md §1).
 */
const TEST_PORT = 7072;
const TEST_DB = "worklog.test.db";

export default defineConfig({
  testDir: "./tests/e2e",
  // The specs share ONE test server and ONE throwaway test DB, and several seed
  // overlapping fixtures (e.g. phase-3 "overlap" entries). Running files in
  // parallel lets those seeds interleave and collide under substring text
  // matching, which is flaky. They're fast, so run single-worker + serial for a
  // deterministic shared-DB run. (Still 127.0.0.1-only per architecture.md §1.)
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${TEST_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `next dev -H 127.0.0.1 -p ${TEST_PORT}`,
    url: `http://127.0.0.1:${TEST_PORT}`,
    // Always boot our OWN isolated server; never reuse the dev server on 7070.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // Isolate test writes into a throwaway DB file (gitignored).
      DATABASE_URL: `file:./${TEST_DB}`,
    },
  },
});
