import { NextRequest, NextResponse } from "next/server";
import { monthlyRecap, monthlyRecapForMonth } from "@/lib/recap";
import { wibToday } from "@/lib/time";

// better-sqlite3 is a native module → force the Node runtime, never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/recap/monthly?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Per-tag totals, top tickets, and a per-day trend for the WIB range. When
 * from/to are omitted, defaults to the whole current WIB month.
 */
export function GET(req: NextRequest) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  try {
    if (from && to && re.test(from) && re.test(to)) {
      return NextResponse.json(monthlyRecap(from, to));
    }
    return NextResponse.json(monthlyRecapForMonth(wibToday()));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
