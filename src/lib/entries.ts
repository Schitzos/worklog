import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { coveringSlots, durationMin, wibWorkDate } from "./time";

/**
 * Entries + tags repository. All DB access for the core logging loop lives here,
 * on top of the Phase-1 better-sqlite3 layer. Everything is synchronous
 * (better-sqlite3 is sync) and wrapped in transactions where multiple tables
 * change together.
 */

export interface TagRow {
  label: string;
  usage_count: number;
}

export interface EntryRow {
  id: string;
  description: string;
  ticket_id: string | null;
  summary: string | null;
  start_at: string;
  end_at: string;
  duration_min: number;
  work_date: string;
  created_at: string;
  updated_at: string;
  tags: string[];
}

export interface CreateEntryInput {
  description: string;
  tags?: string[];
  ticket_id?: string | null;
  start_at: string; // ISO UTC
  end_at: string; // ISO UTC
  summary?: string | null;
}

export interface UpdateEntryInput {
  description?: string;
  tags?: string[];
  ticket_id?: string | null;
  start_at?: string;
  end_at?: string;
  summary?: string | null;
}

function normTag(name: string): string {
  return name.trim().toLowerCase();
}

/** Attach the ordered tag labels to a set of entries in one query. */
function tagsForEntries(entryIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (entryIds.length === 0) return map;
  const db = getDb();
  const placeholders = entryIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT et.entry_id AS entry_id, t.label AS label
       FROM entry_tags et
       JOIN tags t ON t.id = et.tag_id
       WHERE et.entry_id IN (${placeholders})
       ORDER BY t.label COLLATE NOCASE ASC`,
    )
    .all(...entryIds) as { entry_id: string; label: string }[];
  for (const r of rows) {
    const list = map.get(r.entry_id) ?? [];
    list.push(r.label);
    map.set(r.entry_id, list);
  }
  return map;
}

/** Upsert a tag by its normalized key; bump usage + refresh casing. Returns id. */
function upsertTag(name: string, nowIso: string): string | null {
  const label = name.trim();
  if (!label) return null;
  const norm = normTag(name);
  const db = getDb();

  const existing = db
    .prepare("SELECT id FROM tags WHERE norm = ?")
    .get(norm) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE tags
         SET usage_count = usage_count + 1,
             last_used_at = ?,
             label = ?
       WHERE id = ?`,
    ).run(nowIso, label, existing.id);
    return existing.id;
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO tags (id, norm, label, usage_count, created_at, last_used_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(id, norm, label, nowIso, nowIso);
  return id;
}

/** Mark every slot an entry's window covers as 'filled' for its work_date. */
function markCoveringSlotsFilled(
  workDate: string,
  startAt: string,
  endAt: string,
  nowIso: string,
) {
  const db = getDb();
  const slots = coveringSlots(workDate, startAt, endAt);
  const up = db.prepare(
    `INSERT INTO reminder_log (id, work_date, slot, status, resolved_at, created_at)
     VALUES (?, ?, ?, 'filled', ?, ?)
     ON CONFLICT (work_date, slot) DO UPDATE SET
       status = 'filled',
       resolved_at = excluded.resolved_at`,
  );
  for (const slot of slots) {
    up.run(randomUUID(), workDate, slot, nowIso, nowIso);
  }
}

function dedupeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const label = raw.trim();
    if (!label) continue;
    const key = normTag(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function createEntry(input: CreateEntryInput): EntryRow {
  const db = getDb();
  const nowIso = new Date().toISOString();

  const description = input.description.trim();
  if (!description) throw new ValidationError("description is required");

  const startAt = input.start_at;
  const endAt = input.end_at;
  if (Number.isNaN(Date.parse(startAt)))
    throw new ValidationError("start_at must be a valid ISO datetime");
  if (Number.isNaN(Date.parse(endAt)))
    throw new ValidationError("end_at must be a valid ISO datetime");
  if (new Date(endAt).getTime() < new Date(startAt).getTime()) {
    throw new ValidationError("end_at must be >= start_at");
  }

  const workDate = wibWorkDate(startAt);
  const dMin = durationMin(startAt, endAt);
  const ticketId = input.ticket_id?.trim() || null;
  const summary = input.summary?.trim() || null;
  const id = randomUUID();
  const tags = dedupeTags(input.tags);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO entries
         (id, description, ticket_id, summary, start_at, end_at, duration_min, work_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, description, ticketId, summary, startAt, endAt, dMin, workDate, nowIso, nowIso);

    const link = db.prepare(
      "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)",
    );
    for (const tag of tags) {
      const tagId = upsertTag(tag, nowIso);
      if (tagId) link.run(id, tagId);
    }

    markCoveringSlotsFilled(workDate, startAt, endAt, nowIso);
  });
  tx();

  return getEntry(id)!;
}

export function getEntry(id: string): EntryRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM entries WHERE id = ?").get(id) as
    | Omit<EntryRow, "tags">
    | undefined;
  if (!row) return null;
  const tags = tagsForEntries([id]).get(id) ?? [];
  return { ...row, tags };
}

export function listEntriesByDate(workDate: string): EntryRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM entries WHERE work_date = ? ORDER BY start_at ASC, created_at ASC",
    )
    .all(workDate) as Omit<EntryRow, "tags">[];
  const tagMap = tagsForEntries(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, tags: tagMap.get(r.id) ?? [] }));
}

export function updateEntry(id: string, input: UpdateEntryInput): EntryRow | null {
  const db = getDb();
  const current = db.prepare("SELECT * FROM entries WHERE id = ?").get(id) as
    | Omit<EntryRow, "tags">
    | undefined;
  if (!current) return null;

  const nowIso = new Date().toISOString();
  const description =
    input.description !== undefined ? input.description.trim() : current.description;
  if (!description) throw new ValidationError("description cannot be empty");

  const startAt = input.start_at ?? current.start_at;
  const endAt = input.end_at ?? current.end_at;
  if (Number.isNaN(Date.parse(startAt)))
    throw new ValidationError("start_at must be a valid ISO datetime");
  if (Number.isNaN(Date.parse(endAt)))
    throw new ValidationError("end_at must be a valid ISO datetime");
  if (new Date(endAt).getTime() < new Date(startAt).getTime()) {
    throw new ValidationError("end_at must be >= start_at");
  }

  const workDate = wibWorkDate(startAt);
  const dMin = durationMin(startAt, endAt);
  const ticketId =
    input.ticket_id !== undefined ? input.ticket_id?.trim() || null : current.ticket_id;
  const summary =
    input.summary !== undefined ? input.summary?.trim() || null : current.summary;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE entries
         SET description = ?, ticket_id = ?, summary = ?, start_at = ?, end_at = ?,
             duration_min = ?, work_date = ?, updated_at = ?
       WHERE id = ?`,
    ).run(description, ticketId, summary, startAt, endAt, dMin, workDate, nowIso, id);

    if (input.tags !== undefined) {
      db.prepare("DELETE FROM entry_tags WHERE entry_id = ?").run(id);
      const link = db.prepare(
        "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)",
      );
      for (const tag of dedupeTags(input.tags)) {
        const tagId = upsertTag(tag, nowIso);
        if (tagId) link.run(id, tagId);
      }
    }

    markCoveringSlotsFilled(workDate, startAt, endAt, nowIso);
  });
  tx();

  return getEntry(id);
}

export function deleteEntry(id: string): boolean {
  const db = getDb();
  const res = db.prepare("DELETE FROM entries WHERE id = ?").run(id);
  return res.changes > 0;
}

/** Autocomplete per schema.md §3.1: prefix match on norm, ranked. Empty q = top tags. */
export function searchTags(q: string, limit = 10): TagRow[] {
  const db = getDb();
  const query = q.trim().toLowerCase();
  if (!query) {
    return db
      .prepare(
        `SELECT label, usage_count FROM tags
         ORDER BY usage_count DESC, last_used_at DESC
         LIMIT ?`,
      )
      .all(limit) as TagRow[];
  }
  const escaped = query.replace(/[%_\\]/g, (c) => `\\${c}`);
  return db
    .prepare(
      `SELECT label, usage_count FROM tags
       WHERE norm LIKE ? ESCAPE '\\'
       ORDER BY usage_count DESC, last_used_at DESC
       LIMIT ?`,
    )
    .all(`${escaped}%`, limit) as TagRow[];
}

/** Mark a slot intentionally empty (design.md §4 "Nothing to log"). */
export function skipSlot(workDate: string, slot: string): void {
  const db = getDb();
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO reminder_log (id, work_date, slot, status, resolved_at, created_at)
     VALUES (?, ?, ?, 'skipped', ?, ?)
     ON CONFLICT (work_date, slot) DO UPDATE SET
       status = 'skipped',
       resolved_at = excluded.resolved_at`,
  ).run(randomUUID(), workDate, slot, nowIso, nowIso);
}

/** A validation failure the route handlers translate into a 400. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
