import { NextRequest, NextResponse } from "next/server";
import {
  deleteEntry,
  updateEntry,
  ValidationError,
  type UpdateEntryInput,
} from "@/lib/entries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/entries/:id — partial update of any entry field. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: UpdateEntryInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const patch: UpdateEntryInput = {};
  if (typeof body.description === "string") patch.description = body.description;
  if (body.ticket_id !== undefined) patch.ticket_id = body.ticket_id;
  if (body.summary !== undefined) patch.summary = body.summary;
  if (typeof body.start_at === "string") patch.start_at = body.start_at;
  if (typeof body.end_at === "string") patch.end_at = body.end_at;
  if (Array.isArray(body.tags)) {
    patch.tags = body.tags.filter((t): t is string => typeof t === "string");
  }

  try {
    const entry = updateEntry(id, patch);
    if (!entry) return NextResponse.json({ error: "entry not found" }, { status: 404 });
    return NextResponse.json({ entry });
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

/** DELETE /api/entries/:id */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const ok = deleteEntry(id);
    if (!ok) return NextResponse.json({ error: "entry not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
