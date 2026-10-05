import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Phase 5 E2E — weekly + monthly recap APIs, boss-ready Markdown export, and
 * the /export page. A per-run token isolates repeated runs against the shared
 * worklog.db. We seed entries across SEVERAL days of the current WIB week
 * (which also lands them in the current WIB month) via POST /api/entries using
 * ISO UTC instants, including one carrying a seeded JIRA-xxx ticket.
 */

const RUN = Date.now().toString(36);
const TAG_MEET = `p5meet-${RUN}`;
const TAG_BUG = `p5bug-${RUN}`;
const JIRA = `JIRA-${(Date.now() % 9000) + 1000}`; // JIRA-1000..9999, unique-ish per run

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
function monthStart(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}
/** WIB wall-clock (date + HH:mm) → ISO UTC. */
function wibToUtc(dateYmd: string, hhmm: string): string {
  return new Date(`${dateYmd}T${hhmm}:00+07:00`).toISOString();
}

/**
 * Seed within the CURRENT WIB week. The JIRA-ticketed entry is seeded on
 * `today`, which is always in the current WIB month, so the monthly top-tickets
 * assertion holds even when the week straddles a month boundary. The weekly
 * per-tag / per-day assertions use entries on this week's Monday.
 */
async function seed(request: APIRequestContext) {
  const today = todayWib();
  const monday = mondayOf(today);
  const dayA = monday; // Monday of this week — for weekly per-day/per-tag.

  const rows: [string, string, string, string][] = [
    [`P5 standup A ${RUN}`, "10:00", "11:00", TAG_MEET],
    // 11:00–12:00 stays entirely inside the 10-12 slot. (Was 11:00–12:30, which
    // bled into the 12-14 slot and, on weeks where today IS Monday, filled
    // today's 12-14 — colliding with recap/reminder specs that need it clear.)
    [`P5 fix login ${RUN}`, "11:00", "12:00", TAG_BUG],
  ];

  // Day A entries (Monday).
  for (const [description, s, e, tag] of rows) {
    const res = await request.post("/api/entries", {
      data: {
        description,
        tags: [tag],
        start_at: wibToUtc(dayA, s),
        end_at: wibToUtc(dayA, e),
      },
    });
    expect(res.status()).toBe(201);
  }

  // JIRA-ticketed entry on TODAY (always in the current week AND month).
  const resB = await request.post("/api/entries", {
    data: {
      description: `P5 code review ${RUN}`,
      tags: [TAG_BUG],
      ticket_id: JIRA,
      start_at: wibToUtc(today, "14:00"),
      end_at: wibToUtc(today, "15:30"),
    },
  });
  expect(resB.status()).toBe(201);

  return { today, monday, dayA };
}

test.describe("phase 5 — weekly/monthly/export", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    await seed(request);
  });

  test("(a) /api/recap/weekly returns per-tag + per-day totals", async ({ request }) => {
    const res = await request.get(`/api/recap/weekly?monday=${todayWib()}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    // Per-day structure: Mon–Fri (5 days) each with effortMin + coverage.
    expect(Array.isArray(body.days)).toBeTruthy();
    expect(body.days.length).toBe(5);
    for (const d of body.days) {
      expect(typeof d.effortMin).toBe("number");
      expect(typeof d.wallClockMin).toBe("number");
      expect(["complete", "partial", "empty"]).toContain(d.coverage);
    }

    // Our seeded tags appear in per-tag effort.
    const meet = body.effortPerTag.find((t: { label: string }) => t.label === TAG_MEET);
    const bug = body.effortPerTag.find((t: { label: string }) => t.label === TAG_BUG);
    expect(meet).toBeTruthy();
    expect(meet.effortMin).toBe(60); // 10:00–11:00
    expect(bug).toBeTruthy();
    expect(bug.effortMin).toBeGreaterThanOrEqual(90); // 11:00–12:30 (+ review on day B)

    // The week has some logged effort and at least one busiest tag.
    expect(body.totalEffortMin).toBeGreaterThan(0);
    expect(body.busiestTags.length).toBeGreaterThan(0);
  });

  test("(b) /api/recap/monthly returns topTickets including the seeded JIRA", async ({ request }) => {
    const today = todayWib();
    const res = await request.get(`/api/recap/monthly?from=${monthStart(today)}&to=${today}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    expect(Array.isArray(body.topTickets)).toBeTruthy();
    const hit = body.topTickets.find((t: { ticket_id: string }) => t.ticket_id === JIRA);
    expect(hit).toBeTruthy();
    expect(hit.effortMin).toBeGreaterThan(0);
    expect(hit.entries).toBeGreaterThanOrEqual(1);

    // Per-day trend present for the month.
    expect(Array.isArray(body.trend)).toBeTruthy();
    expect(body.trend.length).toBeGreaterThan(0);
  });

  test("(c) GET /api/recap/export?format=md returns markdown with a tag heading + totals table", async ({
    request,
  }) => {
    const today = todayWib();
    const res = await request.get(
      `/api/recap/export?from=${mondayOf(today)}&to=${today}&format=md`,
    );
    expect(res.ok()).toBeTruthy();
    expect(res.headers()["content-type"]).toContain("text/markdown");
    const md = await res.text();

    // Title with the range.
    expect(md).toContain(`# Worklog — ${mondayOf(today)} to ${today}`);
    // A per-tag section heading (## <tag> — Nh) for one of our tags.
    expect(md).toMatch(new RegExp(`## ${TAG_BUG} — [0-9.]+h`));
    // The seeded ticket appears in the prose.
    expect(md).toContain(JIRA);
    // A totals table (markdown table header + a Total row).
    expect(md).toContain("| Tag | Activities | Effort |");
    expect(md).toContain("| **Total** |");
  });

  test("(d) /export page shows the markdown preview and the Download button", async ({ page }) => {
    await page.goto("/export");

    await expect(page.getByRole("heading", { name: "Boss-ready export" })).toBeVisible();

    // Switch to "This week" preset to be sure our seeded range is covered.
    await page.getByTestId("preset-row").getByText("This week", { exact: true }).click();

    const preview = page.getByTestId("export-preview");
    await expect(preview).toBeVisible();
    // The preview renders the markdown title.
    await expect(preview).toContainText("# Worklog —");

    // Both actions are present; Download button exists.
    await expect(page.getByTestId("export-copy")).toBeVisible();
    await expect(page.getByTestId("export-download")).toBeVisible();
  });
});
