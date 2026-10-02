import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Daily notes E2E — optional free-text note per WIB day.
 *   - API: GET/PUT /api/notes/daily (upsert, empty clears, 2000-char cap)
 *   - Recap integration: note flows into daily payload + weekly/monthly notes map
 *   - UI: the daily recap page shows an editable note form that persists
 *
 * Isolated per run via a unique date far in the past so it never collides with
 * other specs' "today" seeding (notes are keyed by work_date only).
 */

// A deterministic, isolated work_date for this spec (well before any seeding).
const NOTE_DATE = "2021-03-04";
const NOTE_MONDAY = "2021-03-01"; // week containing 2021-03-04 (Thu)

function wibToday(): string {
  return new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10);
}

async function putNote(request: APIRequestContext, date: string, note: string) {
  return request.put(`/api/notes/daily?date=${date}`, { data: { note } });
}

test.describe("daily notes", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(async ({ request }) => {
    // Clean the isolated date so re-runs start fresh.
    await putNote(request, NOTE_DATE, "");
  });

  test("(a) GET returns empty note for a day with none", async ({ request }) => {
    await putNote(request, NOTE_DATE, ""); // ensure clean
    const res = await request.get(`/api/notes/daily?date=${NOTE_DATE}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.workDate).toBe(NOTE_DATE);
    expect(body.note).toBe("");
    expect(body.updatedAt).toBeNull();
  });

  test("(b) PUT upserts and GET reads it back", async ({ request }) => {
    const text = "Finished the quarterly deck; follow up with Dina on the budget line.";
    const put = await putNote(request, NOTE_DATE, text);
    expect(put.status()).toBe(200);
    expect((await put.json()).note).toBe(text);

    const get = await request.get(`/api/notes/daily?date=${NOTE_DATE}`);
    const body = await get.json();
    expect(body.note).toBe(text);
    expect(body.updatedAt).not.toBeNull();
  });

  test("(c) PUT with new text overwrites (edit in place)", async ({ request }) => {
    const edited = "Edited: deck done, budget synced with Dina.";
    const put = await putNote(request, NOTE_DATE, edited);
    expect((await put.json()).note).toBe(edited);
    const get = await request.get(`/api/notes/daily?date=${NOTE_DATE}`);
    expect((await get.json()).note).toBe(edited);
  });

  test("(d) empty/whitespace PUT clears the note", async ({ request }) => {
    const put = await putNote(request, NOTE_DATE, "   ");
    const body = await put.json();
    expect(body.note).toBe("");
    expect(body.updatedAt).toBeNull();
  });

  test("(e) note is capped at 2000 chars", async ({ request }) => {
    const put = await putNote(request, NOTE_DATE, "x".repeat(2500));
    expect((await put.json()).note.length).toBe(2000);
    await putNote(request, NOTE_DATE, ""); // clean
  });

  test("(f) non-string body is rejected 400", async ({ request }) => {
    const res = await request.put(`/api/notes/daily?date=${NOTE_DATE}`, {
      data: { note: 123 },
    });
    expect(res.status()).toBe(400);
  });

  test("(g) note appears in daily recap payload + weekly/monthly notes map", async ({ request }) => {
    const text = "Recap-integration note.";
    await putNote(request, NOTE_DATE, text);

    const daily = await (await request.get(`/api/recap/daily?date=${NOTE_DATE}`)).json();
    expect(daily.note).toBe(text);

    // Weekly route takes ?monday= (snaps to that week's Monday).
    const weekly = await (await request.get(`/api/recap/weekly?monday=${NOTE_MONDAY}`)).json();
    expect(weekly.notes[NOTE_DATE]).toBe(text);

    // Monthly route takes ?from=&to= (explicit range).
    const monthly = await (
      await request.get(`/api/recap/monthly?from=2021-03-01&to=2021-03-31`)
    ).json();
    expect(monthly.notes[NOTE_DATE]).toBe(text);

    await putNote(request, NOTE_DATE, ""); // clean
  });

  test("(h) daily recap page: note form saves and persists on reload", async ({ page, request }) => {
    const today = wibToday();
    await putNote(request, today, ""); // start clean for today

    await page.goto(`/recap/daily?date=${today}`);
    const card = page.getByTestId("daily-note-card");
    await expect(card).toBeVisible();

    const input = page.getByTestId("daily-note-input");
    const text = `UI note ${Date.now().toString(36)}`;
    await input.fill(text);
    await page.getByTestId("daily-note-save").click();
    await expect(page.getByText("Saved ✓")).toBeVisible();

    // Reload — the note must still be there (persisted to DB).
    await page.reload();
    await expect(page.getByTestId("daily-note-input")).toHaveValue(text);

    await putNote(request, today, ""); // clean up today's note
  });
});
