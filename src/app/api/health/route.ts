import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Local-only app; always run on Node (better-sqlite3 is a native module) and
// never cache the health probe.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const db = getDb();
    // Prove the connection + that migrations ran: SELECT against a known table.
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM _migrations")
      .get() as { n: number };
    return NextResponse.json({ ok: true, migrations: row.n });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
