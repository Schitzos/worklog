import { NextRequest, NextResponse } from "next/server";
import { exportMarkdown, rangeExport } from "@/lib/recap";
import { wibToday } from "@/lib/time";

// better-sqlite3 is a native module → force the Node runtime, never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/recap/export?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|md
 * The boss-ready export (schema.md §4) for an arbitrary WIB range.
 *   - format=json (default) → the RangeExport structure.
 *   - format=md             → clean Markdown (text/markdown).
 * Defaults from/to to today-in-WIB when missing/malformed.
 */
export function GET(req: NextRequest) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const today = wibToday();
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const from = fromParam && re.test(fromParam) ? fromParam : today;
  const to = toParam && re.test(toParam) ? toParam : today;
  const format = (req.nextUrl.searchParams.get("format") || "json").toLowerCase();

  try {
    if (format === "md" || format === "markdown") {
      const md = exportMarkdown(from, to);
      return new NextResponse(md, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `inline; filename="worklog-${from}_to_${to}.md"`,
        },
      });
    }
    return NextResponse.json(rangeExport(from, to));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
