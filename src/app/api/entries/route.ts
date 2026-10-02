import { NextRequest, NextResponse } from "next/server";
import {
  createEntry,
  listEntriesByDate,
  ValidationError,
  type CreateEntryInput,
} from "@/lib/entries";
import { wibToday } from "@/lib/time";

// better-sqlite3 is a native module → force the Node runtime, never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/entries?date=YYYY-MM-DD
 * Lists entries for a WIB work_date (defaults to today-in-WIB), ordered by start.
 */
export function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get("date");
  const workDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : wibToday();
  try {
    const entries = listEntriesByDate(workDate);
    return NextResponse.json({ work_date: workDate, entries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/entries
 * body: { description, tags[], ticket_id?, start_at (ISO UTC), end_at (ISO UTC), summary? }
 */
export async function POST(req: NextRequest) {
  let body: Partial<CreateEntryInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.description !== "string") {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }
  if (typeof body.start_at !== "string" || typeof body.end_at !== "string") {
    return NextResponse.json(
      { error: "start_at and end_at (ISO UTC strings) are required" },
      { status: 400 },
    );
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string")
    : [];

  try {
    const entry = createEntry({
      description: body.description,
      tags,
      ticket_id: body.ticket_id ?? null,
      start_at: body.start_at,
      end_at: body.end_at,
      summary: body.summary ?? null,
    });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
