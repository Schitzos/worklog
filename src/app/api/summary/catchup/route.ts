import { NextResponse } from "next/server";
import { summarizeMissingDays, summaryMeta } from "@/lib/summary";
import { wibToday } from "@/lib/time";

// better-sqlite3 is a native module → force the Node runtime, never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/summary/catchup
 * Summarize every PAST day (before today-in-WIB) that has activity but no
 * up-to-date Gemini summary. This is the reliable mechanism behind the
 * launchd/cron job: if the machine was asleep at the scheduled time, the next
 * run backfills. Today is skipped (still in progress). Writes daily_summary
 * only — never the user's note, never entries.
 */
export async function POST() {
  const today = wibToday();
  try {
    const done = await summarizeMissingDays(today);
    return NextResponse.json({
      ok: true,
      summarizedDays: done,
      count: done.length,
      hasKey: summaryMeta.hasKey(),
      model: summaryMeta.model,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
