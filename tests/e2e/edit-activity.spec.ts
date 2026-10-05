import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Editable activities E2E — each row in the daily recap "Activities by tag"
 * list opens an edit modal that PATCHes the entry in place.
 *   - API: PATCH /api/entries/:id updates fields and never deletes the row.
 *   - UI: click a row → modal → edit description/time → save → recap reloads
 *         with the new values; the row count is unchanged (edit, not delete).
 *
 * Uses an isolated past work_date so it never collides with other specs.
 */

const RUN = Date.now().toString(36);
const EDIT_DATE = "2021-04-12"; // a Monday, well before any "today" seeding
const TAG = `edit-${RUN}`;

function wibToUtc(dateYmd: string, hhmm: string): string {
  return new Date(`${dateYmd}T${hhmm}:00+07:00`).toISOString();
}

async function seedOne(request: APIRequestContext, description: string) {
  const res = await request.post("/api/entries", {
    data: {
      description,
      tags: [TAG],
      ticket_id: "JIRA-1",
      start_at: wibToUtc(EDIT_DATE, "10:00"),
      end_at: wibToUtc(EDIT_DATE, "11:00"),
      summary: "orig summary",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).entry as { id: string };
}

async function listForDay(request: APIRequestContext) {
  const res = await request.get(`/api/entries?date=${EDIT_DATE}`);
  expect(res.status()).toBe(200);
  return (await res.json()).entries as Array<{
    id: string;
    description: string;
    ticket_id: string | null;
    summary: string | null;
    tags: string[];
    start_at: string;
    end_at: string;
  }>;
}

test.describe("edit activity", () => {
  test.describe.configure({ mode: "serial" });

  test("(a) PATCH updates fields in place and keeps the row", async ({ request }) => {
    const created = await seedOne(request, `patch-target ${RUN}`);
    const before = await listForDay(request);
    const countBefore = before.length;

    const res = await request.patch(`/api/entries/${created.id}`, {
      data: {
        description: "patched description",
        tags: [TAG, "extra"],
        ticket_id: "JIRA-999",
        summary: "patched summary",
      },
    });
    expect(res.status()).toBe(200);
    const entry = (await res.json()).entry;
    expect(entry.description).toBe("patched description");
    expect(entry.ticket_id).toBe("JIRA-999");
    expect(entry.summary).toBe("patched summary");
    expect(entry.tags).toContain("extra");

    // Row still exists — edit must never delete.
    const after = await listForDay(request);
    expect(after.length).toBe(countBefore);
    expect(after.find((e) => e.id === created.id)?.description).toBe("patched description");
  });

  test("(b) PATCH empty description is rejected 400 (field required)", async ({ request }) => {
    const created = await seedOne(request, `empty-desc ${RUN}`);
    const res = await request.patch(`/api/entries/${created.id}`, {
      data: { description: "   " },
    });
    expect(res.status()).toBe(400);
  });

  test("(c) PATCH unknown id returns 404", async ({ request }) => {
    const res = await request.patch(`/api/entries/does-not-exist-${RUN}`, {
      data: { description: "x" },
    });
    expect(res.status()).toBe(404);
  });

  test("(d) daily recap page: click a row → edit → save → value changes", async ({
    page,
    request,
  }) => {
    const marker = `ui-edit ${RUN}`;
    await seedOne(request, marker);

    await page.goto(`/recap/daily?date=${EDIT_DATE}`);
    const row = page.getByTestId("activity-row").filter({ hasText: marker });
    await expect(row).toBeVisible();

    await row.click();
    const modal = page.getByTestId("edit-entry-modal");
    await expect(modal).toBeVisible();

    const newDesc = `ui-edited ${RUN} ${Date.now().toString(36)}`;
    await page.getByTestId("edit-entry-description").fill(newDesc);
    await page.getByTestId("edit-entry-save").click();

    // Modal closes and the new description appears in the list.
    await expect(modal).toBeHidden();
    await expect(
      page.getByTestId("activity-row").filter({ hasText: newDesc }),
    ).toBeVisible();

    // Persisted to DB.
    const after = await listForDay(request);
    expect(after.some((e) => e.description === newDesc)).toBe(true);
  });

  test("(e) edit modal: empty description shows an inline error, no save", async ({
    page,
    request,
  }) => {
    const marker = `ui-empty ${RUN}`;
    await seedOne(request, marker);

    await page.goto(`/recap/daily?date=${EDIT_DATE}`);
    const row = page.getByTestId("activity-row").filter({ hasText: marker });
    await row.click();
    await expect(page.getByTestId("edit-entry-modal")).toBeVisible();

    await page.getByTestId("edit-entry-description").fill("");
    await page.getByTestId("edit-entry-save").click();
    await expect(page.getByTestId("edit-entry-error")).toBeVisible();
    // Modal stays open because save was blocked.
    await expect(page.getByTestId("edit-entry-modal")).toBeVisible();
  });

  test("(f) edit modal tag picker: shows chips + suggestion dropdown, add via list", async ({
    page,
    request,
  }) => {
    // Seed a second tag so the suggestion list has something to offer.
    const otherTag = `edit-other-${RUN}`;
    const marker = `ui-tagpick ${RUN}`;
    await request.post("/api/entries", {
      data: {
        description: `seed-other ${RUN}`,
        tags: [otherTag],
        ticket_id: "JIRA-2",
        start_at: wibToUtc(EDIT_DATE, "13:00"),
        end_at: wibToUtc(EDIT_DATE, "14:00"),
      },
    });
    const created = await seedOne(request, marker); // tagged with TAG

    await page.goto(`/recap/daily?date=${EDIT_DATE}`);
    const row = page.getByTestId("activity-row").filter({ hasText: marker });
    await row.click();
    const modal = page.getByTestId("edit-entry-modal");
    await expect(modal).toBeVisible();

    // The entry's existing tag renders as a chip (loaded, not an empty field).
    await expect(
      modal.getByTestId("edit-tag-chip-label").filter({ hasText: TAG }),
    ).toBeVisible();

    // Focus the input → suggestion dropdown appears and EXCLUDES the already-
    // selected TAG, but offers the other existing tag.
    await page.getByTestId("edit-entry-tags").click();
    const suggestions = page.getByTestId("edit-entry-tag-suggestions");
    await expect(suggestions).toBeVisible();
    await expect(suggestions.getByText(otherTag, { exact: true })).toBeVisible();
    await expect(suggestions.getByText(TAG, { exact: true })).toHaveCount(0);

    // Click a suggestion → it becomes a chip and is removed from the list.
    await suggestions.getByText(otherTag, { exact: true }).click();
    await page.getByTestId("edit-entry-save").click();
    await expect(modal).toBeHidden();

    // Persisted: entry now carries BOTH tags.
    const after = await listForDay(request);
    const saved = after.find((e) => e.id === created.id);
    expect(saved?.tags).toContain(TAG);
    expect(saved?.tags).toContain(otherTag);
  });
});
