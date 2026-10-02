import { NextRequest, NextResponse } from "next/server";
import { weeklyRecap } from "@/lib/recap";
import { mondayOf, wibToday } from "@/lib/time";

// better-sqlite3 is a native module → force the Node runtime, never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/recap/weekly?monday=YYYY-MM-DD
 * Mon–Fri rollup for the work-week of ?monday (any date in the week is accepted
 * and snapped to its Monday). Defaults to the current WIB week.
 */
export function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("monday");
  const seed = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : wibToday();
  try {
    return NextResponse.json(weeklyRecap(mondayOf(seed)));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
