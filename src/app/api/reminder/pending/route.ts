import { NextRequest, NextResponse } from "next/server";
import { pendingSlots } from "@/lib/reminder";
import { wibToday } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reminder/pending?date=YYYY-MM-DD
 * Lightweight poll for the in-app toast: the slots that are 'fired' or 'snoozed'
 * for the day and NOT since filled by an entry or skipped. Defaults to today-WIB.
 * Returns { work_date, pending: [{ slot, status }] } — kept tiny for a 60s poll.
 */
export function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get("date");
  const workDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : wibToday();
  try {
    return NextResponse.json({ work_date: workDate, pending: pendingSlots(workDate) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
