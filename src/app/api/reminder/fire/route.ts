import { NextRequest, NextResponse } from "next/server";
import { fireSlot, notifierReport } from "@/lib/scheduler";
import { isLocalRequest } from "@/lib/localhost";
import { isSlot, wibToday } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/reminder/fire — DEV/TEST manual trigger (architecture.md §3.1).
 * body: { work_date?: 'YYYY-MM-DD' (defaults to today-WIB), slot: '10-12'|'12-14'|'14-16' }
 *
 * Fires a single slot exactly as the cron would: upsert reminder_log → 'fired'
 * (unless already filled/skipped) + raise the desktop notification. Localhost-only
 * — a non-loopback request is refused 403, so this cannot be reached from off-box.
 */
export async function POST(req: NextRequest) {
  if (!isLocalRequest(req)) {
    return NextResponse.json({ error: "localhost only" }, { status: 403 });
  }

  let body: { work_date?: string; slot?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const workDate =
    typeof body.work_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.work_date)
      ? body.work_date
      : wibToday();

  const { slot } = body;
  if (typeof slot !== "string" || !isSlot(slot)) {
    return NextResponse.json(
      { error: "slot must be one of 10-12, 12-14, 14-16" },
      { status: 400 },
    );
  }

  try {
    const row = await fireSlot(workDate, slot);
    return NextResponse.json({
      ok: true,
      work_date: workDate,
      slot,
      fired: row !== null,
      status: row?.status ?? "already-resolved",
      notifier: notifierReport(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
