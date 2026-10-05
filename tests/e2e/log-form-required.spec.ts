import { test, expect } from "@playwright/test";

/**
 * Log form required-field validation — every field is required EXCEPT the
 * summary (optional). Saving with any required field blank shows an inline
 * error and does NOT navigate away; a fully-filled form (no summary) saves.
 */

const RUN = Date.now().toString(36);
const TAG = `req-${RUN}`;

test.describe("log form required fields", () => {
  test.describe.configure({ mode: "serial" });

  test("(a) blank description is rejected", async ({ page }) => {
    await page.goto("/log?slot=10-12");
    await page.getByTestId("save-entry").click();
    await expect(page.getByText("Add a short description")).toBeVisible();
    await expect(page).not.toHaveURL(/\/$/); // did not navigate
  });

  test("(b) missing tag is rejected even with a description", async ({ page }) => {
    await page.goto("/log?slot=10-12");
    await page.getByLabel("What did you do?").fill(`req-desc ${RUN}`);
    // Ticket field: fill it so the only thing missing is a tag.
    await page.locator("#ticket").fill("JIRA-55");
    await page.getByTestId("save-entry").click();
    await expect(page.getByText("Add at least one tag.")).toBeVisible();
    await expect(page).not.toHaveURL(/\/$/);
  });

  test("(c) missing ticket is rejected", async ({ page }) => {
    await page.goto("/log?slot=10-12");
    // Description WITHOUT an auto-detectable ticket pattern.
    await page.getByLabel("What did you do?").fill(`plain work ${RUN}`);
    const tagInput = page.locator("#tag-input");
    await tagInput.fill(TAG);
    await tagInput.press("Enter");
    // Ensure ticket is empty (no auto-detect from this description).
    await page.locator("#ticket").fill("");
    await page.getByTestId("save-entry").click();
    await expect(page.getByText("Ticket / backlog ID is required.")).toBeVisible();
    await expect(page).not.toHaveURL(/\/$/);
  });

  test("(d) all required filled, no summary → saves successfully", async ({ page }) => {
    await page.goto("/log?slot=10-12");
    const desc = `complete entry ${RUN}`;
    await page.getByLabel("What did you do?").fill(desc);
    const tagInput = page.locator("#tag-input");
    await tagInput.fill(TAG);
    await tagInput.press("Enter");
    await page.locator("#ticket").fill("JIRA-77");
    // Summary intentionally left blank — it is optional.
    await page.getByTestId("save-entry").click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(desc)).toBeVisible();
  });
});
