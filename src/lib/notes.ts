import { getDb } from "./db";

/**
 * Daily notes repository: one optional free-text note per WIB day.
 *
 * A daily note is a personal reminder/summary for a given work_date, completely
 * independent of timed entries and reminder slots — it never affects effort,
 * wall-clock, coverage or the untracked-gap warning. Edited in place (upsert on
 * work_date). Length is capped at NOTE_MAX_LEN in this layer; the DB stores
 * whatever the app writes.
 */

export const NOTE_MAX_LEN = 2000;

export interface DailyNote {
  work_date: string;
  note: string;
  created_at: string;
  updated_at: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Read the note for one day, or null when none exists. */
export function getDailyNote(workDate: string): DailyNote | null {
  if (!DATE_RE.test(workDate)) throw new Error(`invalid work_date: ${workDate}`);
  const db = getDb();
  const row = db
    .prepare(
      `SELECT work_date, note, created_at, updated_at FROM daily_notes WHERE work_date = ?`,
    )
    .get(workDate) as DailyNote | undefined;
  return row ?? null;
}

/**
 * Create or replace the note for a day (upsert on work_date).
 * - Trims to NOTE_MAX_LEN.
 * - An empty/whitespace note DELETES the row (clearing a note).
 * Returns the resulting note, or null when it was cleared.
 */
export function setDailyNote(workDate: string, rawNote: string): DailyNote | null {
  if (!DATE_RE.test(workDate)) throw new Error(`invalid work_date: ${workDate}`);
  const db = getDb();
  const note = (rawNote ?? "").slice(0, NOTE_MAX_LEN);
  const now = new Date().toISOString();

  if (note.trim() === "") {
    db.prepare(`DELETE FROM daily_notes WHERE work_date = ?`).run(workDate);
    return null;
  }

  db.prepare(
    `INSERT INTO daily_notes (work_date, note, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(work_date) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`,
  ).run(workDate, note, now, now);

  return getDailyNote(workDate);
}

/**
 * Notes for a date range, as a { work_date -> note text } map. Used by the
 * weekly/monthly recaps to show the notes written across the range. Days with
 * no note are simply absent from the map.
 */
export function dailyNotesInRange(from: string, to: string): Record<string, string> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new Error(`invalid range: ${from}..${to}`);
  }
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT work_date, note FROM daily_notes
       WHERE work_date BETWEEN ? AND ?
       ORDER BY work_date ASC`,
    )
    .all(from, to) as { work_date: string; note: string }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.work_date] = r.note;
  return map;
}
