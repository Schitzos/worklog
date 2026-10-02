import { NextRequest, NextResponse } from "next/server";
import { snooze } from "@/lib/scheduler";
import { isSlot } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/reminder/snooze
 * body: { work_date: 'YYYY-MM-DD', slot: '10-12'|'12-14'|'14-16' }
 * Snoozes the slot 30 minutes (design.md §4): sets reminder_log → 'snoozed' with
 * snooze_until = now+30m and arms an in-process re-fire timer. No-op (still 200,
 * snoozed:false) when the slot is already filled/skipped.
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
    const snoozeUntil = snooze(work_date, slot, 30);
    return NextResponse.json({
      ok: true,
      work_date,
      slot,
      snoozed: snoozeUntil !== null,
      snooze_until: snoozeUntil,
      status: snoozeUntil ? "snoozed" : "already-resolved",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
