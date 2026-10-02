import { test, expect } from "@playwright/test";

test("home page loads and shows the Today shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  // The floating "+" entry point is present.
  await expect(page.getByRole("button", { name: "Log an entry" })).toBeVisible();
});

test("health route proves DB connectivity", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.migrations).toBeGreaterThanOrEqual(1);
});
