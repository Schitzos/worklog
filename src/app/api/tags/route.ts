import { NextRequest, NextResponse } from "next/server";
import { searchTags } from "@/lib/entries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tags?q= — tag autocomplete (schema.md §3.1).
 * Prefix match on the normalized key, ranked usage_count desc / last_used_at desc,
 * limit 10. Empty q returns the top tags.
 */
export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  try {
    const tags = searchTags(q, 10);
    return NextResponse.json({ tags });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
