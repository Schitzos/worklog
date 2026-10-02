import { NextRequest, NextResponse } from "next/server";
import { getDailySummary, buildDailySummary, summaryMeta } from "@/lib/summary";
import { wibToday } from "@/lib/time";

// better-sqlite3 is a native module → force the Node runtime, never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function resolveDate(req: NextRequest): string {
  const p = req.nextUrl.searchParams.get("date");
  return p && DATE_RE.test(p) ? p : wibToday();
}

/**
 * GET /api/summary/daily?date=YYYY-MM-DD
 * Returns the stored auto-summary for the day (or summary:"" when none yet).
 */
export function GET(req: NextRequest) {
  const workDate = resolveDate(req);
  try {
    const row = getDailySummary(workDate);
    return NextResponse.json({
      workDate,
      summary: row?.summary ?? "",
      source: row?.source ?? null,
      model: row?.model ?? null,
      updatedAt: row?.updated_at ?? null,
      hasKey: summaryMeta.hasKey(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/summary/daily?date=YYYY-MM-DD
 * (Re)generates the summary for the day via Gemini (fallback on failure),
 * stores it, and returns it. Used by the "Regenerate" button and by the
 * cron/launchd job. Writes daily_summary only — never the user's note.
 */
export async function POST(req: NextRequest) {
  const workDate = resolveDate(req);
  try {
    const row = await buildDailySummary(workDate, { force: true });
    return NextResponse.json({
      workDate,
      summary: row.summary,
      source: row.source,
      model: row.model,
      updatedAt: row.updated_at,
      hasKey: summaryMeta.hasKey(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
