import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Phase 3 E2E — Today timeline (lane-packed overlap), wall-clock vs effort,
 * the daily recap API, and the /recap/daily page.
 *
 * A per-run token keeps repeated runs against the shared worklog.db isolated.
 * We seed via the API: 2 OVERLAPPING entries (10:00–11:00 WIB) + 1
 * NON-overlapping entry (14:00–15:00 WIB), all on today's WIB work_date.
 */

const RUN = Date.now().toString(36);
const TAG_OVERLAP = `p3ov-${RUN}`;
const TAG_SOLO = `p3solo-${RUN}`;

function wibToday(): string {
  return new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10);
}

function wibToUtc(dateYmd: string, hhmm: string): string {
  return new Date(`${dateYmd}T${hhmm}:00+07:00`).toISOString();
}

async function seed(request: APIRequestContext) {
  const day = wibToday();
  const ovStart = wibToUtc(day, "10:00");
  const ovEnd = wibToUtc(day, "11:00");
  const soloStart = wibToUtc(day, "14:00");
  const soloEnd = wibToUtc(day, "15:00");

  const descA = `P3 overlap A ${RUN}`;
  const descB = `P3 overlap B ${RUN}`;
  const descSolo = `P3 solo ${RUN}`;

  for (const [description, start_at, end_at, tag] of [
    [descA, ovStart, ovEnd, TAG_OVERLAP],
    [descB, ovStart, ovEnd, TAG_OVERLAP],
    [descSolo, soloStart, soloEnd, TAG_SOLO],
  ] as const) {
    const res = await request.post("/api/entries", {
      data: { description, tags: [tag], start_at, end_at },
    });
    expect(res.status()).toBe(201);
  }
  return { day, descA, descB, descSolo };
}

const DESC_A = `P3 overlap A ${RUN}`;
const DESC_B = `P3 overlap B ${RUN}`;
const DESC_SOLO = `P3 solo ${RUN}`;

test.describe("phase 3 — timeline + recap", () => {
  test.describe.configure({ mode: "serial" });

  // Seed EXACTLY ONCE for the whole describe block so effort/wall-clock totals
  // are deterministic (seeding per-test would multiply the figures).
  test.beforeAll(async ({ request }) => {
    await seed(request);
  });

  test("(a) Today timeline renders all 3 blocks; the overlapping pair is in separate lanes", async ({
    page,
  }) => {
    await page.goto("/");

    // All three blocks render.
    await expect(page.getByText(DESC_A)).toBeVisible();
    await expect(page.getByText(DESC_B)).toBeVisible();
    await expect(page.getByText(DESC_SOLO)).toBeVisible();

    // The two overlapping blocks sit in different lanes (lanes >= 2, distinct lane idx).
    const blockA = page.locator('[data-testid="timeline-block"]', { hasText: DESC_A }).first();
    const blockB = page.locator('[data-testid="timeline-block"]', { hasText: DESC_B }).first();
    const laneA = await blockA.getAttribute("data-lane");
    const laneB = await blockB.getAttribute("data-lane");
    const lanesA = await blockA.getAttribute("data-lanes");
    expect(Number(lanesA)).toBeGreaterThanOrEqual(2);
    expect(laneA).not.toEqual(laneB);

    // They render side-by-side: non-overlapping horizontal extents (different left).
    const boxA = await blockA.boundingBox();
    const boxB = await blockB.boundingBox();
    expect(boxA).not.toBeNull();
    expect(boxB).not.toBeNull();
    if (boxA && boxB) {
      const aRight = boxA.x + boxA.width;
      const bRight = boxB.x + boxB.width;
      const sideBySide = aRight <= boxB.x + 2 || bRight <= boxA.x + 2;
      expect(sideBySide).toBeTruthy();
    }
  });

  test("(b) the rail shows effort > wall-clock for the overlapping pair", async ({ page, request }) => {
    await page.goto("/");

    // effort = 120m (two 60m) + solo 60m = 180m; wall-clock = 60m (overlap) + 60m = 120m.
    const res = await request.get(`/api/recap/daily?date=${wibToday()}`);
    const body = await res.json();
    expect(body.effortMin).toBeGreaterThan(body.wallClockMin);

    await expect(page.getByTestId("effort-min")).toBeVisible();
    await expect(page.getByTestId("wallclock-min")).toBeVisible();
  });

  test("(c) GET /api/recap/daily returns correct effortPerTag and non-empty slots/gaps", async ({
    request,
  }) => {
    const res = await request.get(`/api/recap/daily?date=${wibToday()}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    // effortPerTag has our overlap tag at 120 minutes (2 × 60m) across 2 activities.
    const ov = body.effortPerTag.find(
      (t: { label: string }) => t.label === TAG_OVERLAP,
    );
    expect(ov).toBeTruthy();
    expect(ov.effortMin).toBe(120);
    expect(ov.activities).toBe(2);

    const solo = body.effortPerTag.find(
      (t: { label: string }) => t.label === TAG_SOLO,
    );
    expect(solo).toBeTruthy();
    expect(solo.effortMin).toBe(60);

    // slots structure present for all 3 slots; 12-14 has NO entry seeded there
    // (its status may be 'empty' or 'fired' depending on reminder-spec order,
    // but never 'filled' — nothing is logged into it).
    expect(Array.isArray(body.slots)).toBeTruthy();
    expect(body.slots.length).toBe(3);
    const midday = body.slots.find((s: { slot: string }) => s.slot === "12-14");
    expect(midday.status).not.toBe("filled");

    // gaps is a non-empty structure (12:00–14:00 is uncovered + unskipped).
    expect(Array.isArray(body.gaps)).toBeTruthy();
    expect(body.gaps.length).toBeGreaterThan(0);
    const hasMiddayGap = body.gaps.some(
      (g: { fromHour: number; toHour: number }) => g.fromHour <= 12 && g.toHour >= 14,
    );
    expect(hasMiddayGap).toBeTruthy();
  });

  test("(d) /recap/daily shows per-tag bars and totals", async ({ page }) => {
    await page.goto(`/recap/daily?date=${wibToday()}`);

    await expect(page.getByRole("heading", { name: "Daily recap" })).toBeVisible();

    // Per-tag growing bars are present.
    const bars = page.locator('[data-testid="recap-tagbar-fill"]');
    await expect(bars.first()).toBeVisible();
    expect(await bars.count()).toBeGreaterThanOrEqual(2);

    // Totals block with the three count-up metrics.
    await expect(page.getByText("Effort logged")).toBeVisible();
    await expect(page.getByText("Wall-clock")).toBeVisible();
    await expect(page.getByText("Activities", { exact: true })).toBeVisible();

    // Our tags are shown in the recap.
    await expect(page.getByText(TAG_OVERLAP).first()).toBeVisible();
    await expect(page.getByText(TAG_SOLO).first()).toBeVisible();
  });
});
