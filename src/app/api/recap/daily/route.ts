import { NextRequest, NextResponse } from "next/server";
import { dailyRecap } from "@/lib/recap";
import { wibToday } from "@/lib/time";

// better-sqlite3 is a native module → force the Node runtime, never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/recap/daily?date=YYYY-MM-DD
 * Returns the full daily recap payload (schema.md §3.2/§3.5/§3.6):
 *   { workDate, entries, effortPerTag, effortMin, wallClockMin, slots, gaps }
 * Defaults to today-in-WIB when ?date is missing or malformed.
 */
export function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get("date");
  const workDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : wibToday();
  try {
    return NextResponse.json(dailyRecap(workDate));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
