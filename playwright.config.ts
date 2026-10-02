import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config — targets the local-only dev server on 127.0.0.1:7070 and boots it
 * via `webServer`. Never 0.0.0.0 (architecture.md §1).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // The specs share ONE dev server and ONE local worklog.db, and several seed
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
    baseURL: "http://127.0.0.1:7070",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:7070",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
