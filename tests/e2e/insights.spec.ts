import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Phase 6 E2E — habit insights: streak, hour heatmap, untracked-time rollup.
 *
 * A per-run token isolates repeated runs against the shared worklog.db. We seed
 * ONE entry on today (10:00–11:30 WIB) so:
 *   - the hour heatmap has effort in WIB hours 10 and 11,
 *   - today's untracked rollup has gapMin > 0 (slots 12–14 and 14–16 are empty,
 *     neither covered nor skipped),
 *   - the Today rail renders the streak badge,
 *   - the weekly recap renders the heatmap + untracked cards.
 */

const RUN = Date.now().toString(36);
const TAG = `p6-${RUN}`;
const WIB_OFFSET_MS = 7 * 60 * 60_000;

function todayWib(): string {
  return new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12) + days * 86_400_000).toISOString().slice(0, 10);
}
function mondayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(date, -back);
}
function fridayOf(date: string): string {
  return addDays(mondayOf(date), 4);
}
/** WIB wall-clock (date + HH:mm) → ISO UTC. */
function wibToUtc(dateYmd: string, hhmm: string): string {
  return new Date(`${dateYmd}T${hhmm}:00+07:00`).toISOString();
}

async function seed(request: APIRequestContext) {
  const today = todayWib();
  // 10:00–11:30 WIB → effort in hours 10 (60m) and 11 (30m); leaves 12–16 as gap.
  const res = await request.post("/api/entries", {
    data: {
      description: `P6 insight seed ${RUN}`,
      tags: [TAG],
      start_at: wibToUtc(today, "10:00"),
      end_at: wibToUtc(today, "11:30"),
    },
  });
  expect(res.status()).toBe(201);

  // Also seed on THIS WEEK's Monday so the weekly range (Mon–Fri) always has
  // logged effort even when `today` is a weekend (not in Mon–Fri).
  const monday = mondayOf(today);
  if (monday !== today) {
    const res2 = await request.post("/api/entries", {
      data: {
        description: `P6 weekly seed ${RUN}`,
        tags: [TAG],
        start_at: wibToUtc(monday, "10:00"),
        end_at: wibToUtc(monday, "11:30"),
      },
    });
    expect(res2.status()).toBe(201);
  }
  return { today };
}

test.describe("phase 6 — insights (streak, heatmap, untracked)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    await seed(request);
  });

  test("(a) /api/insights returns streak, heatmap with seeded effort, untracked gap", async ({
    request,
  }) => {
    const today = todayWib();
    const res = await request.get(
      `/api/insights?from=${today}&to=${today}&upTo=${today}`,
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    // streak { current, best } — both non-negative integers.
    expect(body.streak).toBeTruthy();
    expect(typeof body.streak.current).toBe("number");
    expect(typeof body.streak.best).toBe("number");
    expect(body.streak.current).toBeGreaterThanOrEqual(0);
    expect(body.streak.best).toBeGreaterThanOrEqual(body.streak.current);

    // heatmap: array covering hours 8..18, with the seeded effort in 10 and 11.
    expect(Array.isArray(body.heatmap)).toBeTruthy();
    const hours = body.heatmap.map((c: { hour: number }) => c.hour);
    expect(hours).toContain(8);
    expect(hours).toContain(18);
    const h10 = body.heatmap.find((c: { hour: number }) => c.hour === 10);
    const h11 = body.heatmap.find((c: { hour: number }) => c.hour === 11);
    expect(h10.effortMin).toBeGreaterThanOrEqual(60);
    expect(h11.effortMin).toBeGreaterThanOrEqual(30);

    // untracked: today's rollup has a gap (12–16 uncovered, unskipped).
    expect(body.untracked).toBeTruthy();
    expect(body.untracked.totalGapMin).toBeGreaterThan(0);
    const todayRow = body.untracked.days.find((d: { date: string }) => d.date === today);
    expect(todayRow).toBeTruthy();
    expect(todayRow.windowMin).toBe(360);
    expect(todayRow.gapMin).toBeGreaterThan(0);
    expect(todayRow.coveredMin).toBeGreaterThanOrEqual(90);
  });

  test("(b) the Today rail shows the streak badge", async ({ page }) => {
    await page.goto("/");
    const badge = page.getByTestId("streak-badge");
    await expect(badge).toBeVisible();
    // The current streak number is rendered (Geist Mono).
    await expect(page.getByTestId("streak-current")).toBeVisible();
    await expect(badge).toContainText("streak");
  });

  test("(c) the weekly recap shows the heatmap card and the untracked card", async ({ page }) => {
    const today = todayWib();
    await page.goto(`/recap/weekly?monday=${mondayOf(today)}`);

    await expect(page.getByRole("heading", { name: "Weekly recap" })).toBeVisible();

    // Hour heatmap card: cells rendered for the window hours.
    const heatmap = page.getByTestId("hour-heatmap");
    await expect(heatmap).toBeVisible();
    expect(await page.getByTestId("heat-cell").count()).toBe(11); // hours 8..18

    // Untracked-time card: amber headline + per-day breakdown.
    await expect(page.getByTestId("untracked-headline")).toBeVisible();
    await expect(page.getByTestId("untracked-days")).toBeVisible();
  });

  test("(d) the weekly range insights cover Mon–Fri (untracked days length = 5)", async ({
    request,
  }) => {
    const today = todayWib();
    const res = await request.get(
      `/api/insights?from=${mondayOf(today)}&to=${fridayOf(today)}&upTo=${today}`,
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.untracked.days.length).toBe(5);
  });
});
