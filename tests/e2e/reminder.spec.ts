import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Phase 4 E2E — the local reminder scheduler's API surface.
 *
 * We cannot deterministically wait for a real 10/12/14/16 WIB cron fire in a
 * test, so we exercise the SAME code path via the DEV/TEST manual trigger
 * POST /api/reminder/fire, which upserts reminder_log exactly as the cron does.
 * node-notifier raising a desktop notification is a best-effort side effect that
 * degrades gracefully; the DB transition is the asserted contract.
 *
 * A per-run token isolates runs, but reminder_log is keyed (work_date, slot) with
 * only 3 slots/day — so to stay deterministic each test uses a DISTINCT PAST
 * work_date (no entries, no prior rows) rather than today.
 */

function wibToUtc(dateYmd: string, hhmm: string): string {
  return new Date(`${dateYmd}T${hhmm}:00+07:00`).toISOString();
}

/** Read a single reminder_log row via the pending endpoint is not enough (filled
 * rows aren't "pending"); assert through recap daily's slotStatus + direct fire
 * response instead. */
async function dailySlots(request: APIRequestContext, date: string) {
  const res = await request.get(`/api/recap/daily?date=${date}`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { slots: { slot: string; status: string }[] };
  return body.slots;
}

test.describe("phase 4 — reminder scheduler API", () => {
  test.describe.configure({ mode: "serial" });

  test("(a) POST /api/reminder/fire {slot:'12-14'} → 200 and the row is 'fired'", async ({
    request,
  }) => {
    // A past, otherwise-empty WIB day so nothing has filled 12-14.
    const date = "2020-01-06"; // a Monday
    const res = await request.post("/api/reminder/fire", {
      data: { work_date: date, slot: "12-14" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.fired).toBe(true);
    expect(body.status).toBe("fired");
    // Shape of the notifier environment report is present (critical for Phase 7).
    expect(body.notifier).toBeTruthy();
    expect(typeof body.notifier.mode).toBe("string");

    // The slot now reads as pending (fired, not filled/skipped).
    const pend = await request.get(`/api/reminder/pending?date=${date}`);
    const pbody = (await pend.json()) as { pending: { slot: string; status: string }[] };
    const row = pbody.pending.find((p) => p.slot === "12-14");
    expect(row).toBeTruthy();
    expect(row!.status).toBe("fired");
  });

  test("(b) snooze sets snooze_until in the future", async ({ request }) => {
    const date = "2020-01-07"; // Tuesday
    // Fire first so there's something to snooze (not required, but realistic).
    await request.post("/api/reminder/fire", { data: { work_date: date, slot: "10-12" } });

    const before = Date.now();
    const res = await request.post("/api/reminder/snooze", {
      data: { work_date: date, slot: "10-12" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.snoozed).toBe(true);
    expect(typeof body.snooze_until).toBe("string");
    const until = new Date(body.snooze_until).getTime();
    expect(until).toBeGreaterThan(before);
    // ~30 minutes out (allow generous slack for test timing).
    expect(until - before).toBeGreaterThan(25 * 60_000);
    expect(until - before).toBeLessThan(35 * 60_000);

    // Snoozed slot is reported pending with status 'snoozed'.
    const pend = await request.get(`/api/reminder/pending?date=${date}`);
    const pbody = (await pend.json()) as { pending: { slot: string; status: string }[] };
    const row = pbody.pending.find((p) => p.slot === "10-12");
    expect(row).toBeTruthy();
    expect(row!.status).toBe("snoozed");
  });

  test("(c) skip sets status 'skipped' and cancels the pending snooze", async ({ request }) => {
    const date = "2020-01-08"; // Wednesday
    await request.post("/api/reminder/fire", { data: { work_date: date, slot: "14-16" } });
    await request.post("/api/reminder/snooze", { data: { work_date: date, slot: "14-16" } });

    const res = await request.post("/api/reminder/skip", {
      data: { work_date: date, slot: "14-16" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("skipped");

    // slotStatus now reports 'skipped'; it is no longer pending.
    const slots = await dailySlots(request, date);
    expect(slots.find((s) => s.slot === "14-16")!.status).toBe("skipped");

    const pend = await request.get(`/api/reminder/pending?date=${date}`);
    const pbody = (await pend.json()) as { pending: { slot: string }[] };
    expect(pbody.pending.find((p) => p.slot === "14-16")).toBeUndefined();
  });

  test("(d) firing a slot that already has an overlapping entry stays 'filled', not 'fired'", async ({
    request,
  }) => {
    const date = "2020-01-09"; // Thursday
    // Seed an entry overlapping the 12-14 window → the save marks the slot filled.
    const start = wibToUtc(date, "12:30");
    const end = wibToUtc(date, "13:15");
    const seed = await request.post("/api/entries", {
      data: { description: `P4 filled-wins ${date}`, tags: ["p4"], start_at: start, end_at: end },
    });
    expect(seed.status()).toBe(201);

    // Pre-condition: slotStatus already 'filled'.
    let slots = await dailySlots(request, date);
    expect(slots.find((s) => s.slot === "12-14")!.status).toBe("filled");

    // Now fire the same slot — must be a no-op (not downgraded to 'fired').
    const res = await request.post("/api/reminder/fire", {
      data: { work_date: date, slot: "12-14" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.fired).toBe(false);
    expect(body.status).toBe("already-resolved");

    // Still 'filled' afterwards.
    slots = await dailySlots(request, date);
    expect(slots.find((s) => s.slot === "12-14")!.status).toBe("filled");

    // And it is not reported as pending.
    const pend = await request.get(`/api/reminder/pending?date=${date}`);
    const pbody = (await pend.json()) as { pending: { slot: string }[] };
    expect(pbody.pending.find((p) => p.slot === "12-14")).toBeUndefined();
  });

  test("(e) the in-app toast appears when a slot is pending while the tab is open", async ({
    page,
    request,
  }) => {
    // Fire TODAY's 12-14 so the toast's (today-WIB) poll sees it. 12-14 is the
    // one slot the other specs never seed an entry into today, so firing it is
    // not a filled-wins no-op regardless of parallel test order.
    const today = new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10);
    await request.post("/api/reminder/fire", { data: { work_date: today, slot: "12-14" } });

    await page.goto("/");
    // The toast polls on mount; it should surface the pending slot's actions.
    await expect(page.getByRole("status").getByText("Log now")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("status").getByRole("button", { name: "Snooze" })).toBeVisible();
    await expect(
      page.getByRole("status").getByRole("button", { name: "Nothing to log" }),
    ).toBeVisible();
  });
});
