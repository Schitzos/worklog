import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Daily SUMMARY E2E — auto-generated prose, distinct from the user's note.
 *   - API: GET /api/summary/daily (read), POST (regenerate), POST /api/summary/catchup
 *   - A summary is produced from the day's entries; source is 'gemini' when a
 *     key is configured, else 'fallback' (deterministic). We assert structure,
 *     not exact prose, so the suite passes with OR without a GEMINI_KEY.
 *   - It never touches the user's daily NOTE.
 *   - UI: the daily recap page renders the read-only Auto summary card.
 *
 * Isolated via a unique past date so it never collides with other specs.
 */

const RUN = Math.random().toString(36).slice(2, 8);
const SUM_DATE = "2021-05-10"; // a Monday, well before any "today" seeding

async function seedEntry(
  request: APIRequestContext,
  date: string,
  description: string,
  tag: string,
  startHour: number,
  endHour: number,
) {
  // WIB (UTC+7) wall-clock hour → UTC ISO.
  const start_at = `${date}T${String(startHour - 7).padStart(2, "0")}:00:00.000Z`;
  const end_at = `${date}T${String(endHour - 7).padStart(2, "0")}:00:00.000Z`;
  const res = await request.post("/api/entries", {
    data: { description, tags: [tag], start_at, end_at, ticket_id: "JIRA-7000" },
  });
  expect(res.status()).toBe(201);
}

test.describe("daily summary (auto, Gemini)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    // Two tagged activities on the isolated date → something to summarize.
    await seedEntry(request, SUM_DATE, `Refactor auth module ${RUN}`, "backlog", 10, 12);
    await seedEntry(request, SUM_DATE, `Fix flaky checkout test ${RUN}`, "bugfix", 13, 14);
  });

  test("(a) GET returns empty summary before generation", async ({ request }) => {
    const res = await request.get(`/api/summary/daily?date=${SUM_DATE}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.workDate).toBe(SUM_DATE);
    expect(body.summary).toBe("");
    expect(body.updatedAt).toBeNull();
    // hasKey reflects env — just assert it's a boolean.
    expect(typeof body.hasKey).toBe("boolean");
  });

  test("(b) POST generates a summary from the day's entries", async ({ request }) => {
    const res = await request.post(`/api/summary/daily?date=${SUM_DATE}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.workDate).toBe(SUM_DATE);
    expect(typeof body.summary).toBe("string");
    expect(body.summary.length).toBeGreaterThan(0);
    expect(["gemini", "fallback"]).toContain(body.source);
    expect(body.updatedAt).not.toBeNull();
    // When no key, source must be fallback; when key present, prose from gemini.
    if (body.hasKey === false) expect(body.source).toBe("fallback");
  });

  test("(c) GET reads the generated summary back", async ({ request }) => {
    const res = await request.get(`/api/summary/daily?date=${SUM_DATE}`);
    const body = await res.json();
    expect(body.summary.length).toBeGreaterThan(0);
    expect(["gemini", "fallback"]).toContain(body.source);
  });

  test("(d) catch-up endpoint summarizes past days with activity", async ({ request }) => {
    const res = await request.post(`/api/summary/catchup`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.summarizedDays)).toBe(true);
    expect(typeof body.count).toBe("number");
  });

  test("(e) summary never overwrites the user's daily note", async ({ request }) => {
    const note = `My own typed note ${RUN}`;
    await request.put(`/api/notes/daily?date=${SUM_DATE}`, { data: { note } });
    // Regenerate the summary …
    await request.post(`/api/summary/daily?date=${SUM_DATE}`);
    // … the note must be unchanged.
    const noteRes = await request.get(`/api/notes/daily?date=${SUM_DATE}`);
    expect((await noteRes.json()).note).toBe(note);
    await request.put(`/api/notes/daily?date=${SUM_DATE}`, { data: { note: "" } }); // cleanup
  });

  test("(f) a day with NO activity yields a fallback 'no activities' summary", async ({ request }) => {
    const EMPTY_DATE = "2021-05-11";
    const res = await request.post(`/api/summary/daily?date=${EMPTY_DATE}`);
    const body = await res.json();
    expect(body.source).toBe("fallback");
    expect(body.summary.toLowerCase()).toContain("no activities");
  });

  test("(g) daily recap page renders the Auto summary card", async ({ page }) => {
    await page.goto(`/recap/daily?date=${SUM_DATE}`);
    const card = page.getByTestId("daily-summary-card");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("daily-summary-regenerate")).toBeVisible();
    // The card and the note card are distinct.
    await expect(page.getByTestId("daily-note-card")).toBeVisible();
  });
});
