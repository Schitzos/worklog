import { NextRequest, NextResponse } from "next/server";
import { insights } from "@/lib/insights";
import { mondayOf, wibToday, workWeekDates } from "@/lib/time";

// better-sqlite3 is a native module → force the Node runtime, never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/insights?from=YYYY-MM-DD&to=YYYY-MM-DD&upTo=YYYY-MM-DD
 * Returns { streak:{current,best}, heatmap:[{hour,effortMin}], untracked:{…} }.
 *
 * Defaults, when a param is missing/malformed:
 *   - from/to → the current WIB work-week (Mon–Fri).
 *   - upTo    → today in WIB (streak counts back from here).
 */
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const today = wibToday();

  const week = workWeekDates(mondayOf(today));
  const fromParam = sp.get("from");
  const toParam = sp.get("to");
  const upToParam = sp.get("upTo");

  const from = fromParam && RE.test(fromParam) ? fromParam : week[0];
  const to = toParam && RE.test(toParam) ? toParam : week[week.length - 1];
  const upTo = upToParam && RE.test(upToParam) ? upToParam : today;

  try {
    return NextResponse.json(insights(from, to, upTo));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
