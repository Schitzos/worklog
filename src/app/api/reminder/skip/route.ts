import { NextRequest, NextResponse } from "next/server";
import { skipSlot } from "@/lib/entries";
import { clearSnooze } from "@/lib/reminder";
import { cancelSnoozeTimer } from "@/lib/scheduler";
import { isSlot } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/reminder/skip
 * body: { work_date: 'YYYY-MM-DD', slot: '10-12'|'12-14'|'14-16' }
 * Marks the slot intentionally empty (upserts reminder_log → 'skipped') AND
 * cancels any pending snooze: clears snooze_until in the row and the in-process
 * re-fire setTimeout, so a skipped slot never re-nags (design.md §4).
 */
export async function POST(req: NextRequest) {
  let body: { work_date?: string; slot?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { work_date, slot } = body;
  if (typeof work_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(work_date)) {
    return NextResponse.json({ error: "work_date (YYYY-MM-DD) is required" }, { status: 400 });
  }
  if (typeof slot !== "string" || !isSlot(slot)) {
    return NextResponse.json(
      { error: "slot must be one of 10-12, 12-14, 14-16" },
      { status: 400 },
    );
  }

  try {
    // Cancel any pending snooze (DB flag + in-process re-fire timer) first, then
    // record the skip. Order doesn't matter for correctness; both are idempotent.
    clearSnooze(work_date, slot);
    cancelSnoozeTimer(work_date, slot);
    skipSlot(work_date, slot);
    return NextResponse.json({ ok: true, work_date, slot, status: "skipped" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
