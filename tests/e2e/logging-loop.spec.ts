import { test, expect } from "@playwright/test";

/**
 * Phase 2 E2E — the core logging loop.
 * Uses a per-run unique token in descriptions/tags so repeated runs against the
 * local worklog.db stay deterministic and don't collide with earlier data.
 */

const RUN = Date.now().toString(36);
const TAG = `e2e-${RUN}`;

test.describe("logging loop", () => {
  test.describe.configure({ mode: "serial" });

  test("log an entry from /log?slot=10-12 with ticket auto-detect, tag, 30m", async ({ page }) => {
    await page.goto("/log?slot=10-12");

    const desc = `Fix login bug JIRA-123 ${RUN}`;
    await page.getByLabel("What did you do?").fill(desc);

    // Ticket is auto-detected from the description.
    await expect(page.locator("#ticket")).toHaveValue("JIRA-123");

    // Add a tag.
    const tagInput = page.locator("#tag-input");
    await tagInput.fill(TAG);
    await tagInput.press("Enter");
    await expect(page.locator(".tag-pill", { hasText: TAG })).toBeVisible();

    // Pick the 30m duration preset.
    await page.locator(".chip", { hasText: "30m" }).click();

    await page.getByTestId("save-entry").click();

    // Routed home; the entry shows up.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(desc)).toBeVisible();
  });

  test("the saved entry appears on / with its ticket and tag", async ({ page, request }) => {
    await page.goto("/");
    // Phase 3: the Today view is now a calendar timeline. The entry renders as a
    // positioned timeline block carrying its description + auto-detected ticket.
    const block = page
      .locator('[data-testid="timeline-block"]', { hasText: `JIRA-123 ${RUN}` })
      .first();
    await expect(block).toBeVisible();
    await expect(block.locator(".tb-meta", { hasText: "JIRA-123" })).toBeVisible();

    // The tag persisted with the entry — verify via the day's recap payload.
    const today = new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10);
    const res = await request.get(`/api/recap/daily?date=${today}`);
    const body = (await res.json()) as {
      entries: { description: string; tags: string[] }[];
    };
    const saved = body.entries.find((e) => e.description.includes(`JIRA-123 ${RUN}`));
    expect(saved).toBeTruthy();
    expect(saved!.tags).toContain(TAG);
  });

  test("two overlapping entries in the same slot BOTH persist (Option A)", async ({ page, request }) => {
    const a = `Overlap A ${RUN}`;
    const b = `Overlap B ${RUN}`;

    // Both cover 10:00–11:00 WIB today — overlapping on purpose.
    const today = new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10);
    const startUtc = new Date(`${today}T10:00:00+07:00`).toISOString();
    const endUtc = new Date(`${today}T11:00:00+07:00`).toISOString();

    for (const description of [a, b]) {
      const res = await request.post("/api/entries", {
        data: { description, tags: ["meeting"], start_at: startUtc, end_at: endUtc },
      });
      expect(res.status()).toBe(201);
    }

    await page.goto("/");
    await expect(page.getByText(a)).toBeVisible();
    await expect(page.getByText(b)).toBeVisible();
  });

  test("GET /api/tags?q= returns the tag just created", async ({ request }) => {
    const res = await request.get("/api/tags?q=");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { tags: { label: string; usage_count: number }[] };
    expect(body.tags.some((t) => t.label === TAG)).toBeTruthy();

    // Prefix search also finds it.
    const res2 = await request.get(`/api/tags?q=${encodeURIComponent(TAG.slice(0, 5))}`);
    const body2 = (await res2.json()) as { tags: { label: string }[] };
    expect(body2.tags.some((t) => t.label === TAG)).toBeTruthy();
  });
});
