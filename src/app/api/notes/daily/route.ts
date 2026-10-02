import { NextRequest, NextResponse } from "next/server";
import { getDailyNote, setDailyNote, NOTE_MAX_LEN } from "@/lib/notes";
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
 * GET /api/notes/daily?date=YYYY-MM-DD
 * Returns { workDate, note, updatedAt } — note is "" when none exists.
 * Defaults to today-in-WIB when ?date is missing/malformed.
 */
export function GET(req: NextRequest) {
  const workDate = resolveDate(req);
  try {
    const row = getDailyNote(workDate);
    return NextResponse.json({
      workDate,
      note: row?.note ?? "",
      updatedAt: row?.updated_at ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/notes/daily?date=YYYY-MM-DD   body: { note: string }
 * Upserts the note for the day. An empty/whitespace note clears it.
 * Caps at NOTE_MAX_LEN chars.
 */
export async function PUT(req: NextRequest) {
  const workDate = resolveDate(req);
  try {
    const body = (await req.json().catch(() => ({}))) as { note?: unknown };
    if (typeof body.note !== "string") {
      return NextResponse.json(
        { error: "body.note must be a string" },
        { status: 400 },
      );
    }
    const row = setDailyNote(workDate, body.note);
    return NextResponse.json({
      workDate,
      note: row?.note ?? "",
      updatedAt: row?.updated_at ?? null,
      maxLen: NOTE_MAX_LEN,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
